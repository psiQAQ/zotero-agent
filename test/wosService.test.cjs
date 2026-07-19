const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WOS_PLAN_POLICIES,
  calculateEffectiveMaxResults,
  createWosRequestGate,
  nextWosUsageState,
  normalizeWosDocument,
  searchWebOfScience,
} = require("../.tmp-test/wosService.js");

function makeDeps(overrides = {}) {
  const prefs = {
    "wos.apiKey": "secret-key",
    "wos.plan": "trial",
    "wos.database": "WOS",
    "wos.maxRecords": 100,
    "wos.timeoutSeconds": 30,
    "wos.usageDateUtc": "",
    "wos.requestsToday": 0,
    ...overrides.prefs,
  };
  let now = Date.parse("2026-07-19T12:00:00Z");
  const sleeps = [];
  const deps = {
    prefGet: (key) => prefs[key],
    prefSet: (key, value) => { prefs[key] = value; },
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    request: overrides.request ?? (async () => ({ response: { metadata: { total: 0 }, hits: [] } })),
  };
  deps.gate = createWosRequestGate(deps.now, deps.sleep);
  return { deps, prefs, sleeps };
}

test("plan policies mirror official limits and conservative plugin caps", () => {
  assert.deepEqual(WOS_PLAN_POLICIES.trial, {
    requestsPerSecond: 1,
    dailyLimit: 50,
    minIntervalMs: 1100,
    maxRecordsPerCall: 50,
    timesCited: false,
  });
  assert.equal(WOS_PLAN_POLICIES["institutional-member"].dailyLimit, 5000);
  assert.equal(WOS_PLAN_POLICIES["institutional-integration"].dailyLimit, 20000);
});

test("effective max respects request, preference, and plan cap", () => {
  assert.equal(calculateEffectiveMaxResults(900, 800, "trial"), 50);
  assert.equal(calculateEffectiveMaxResults(900, 800, "institutional-member"), 500);
  assert.equal(calculateEffectiveMaxResults(undefined, 100, "institutional-integration"), 50);
});

test("usage state resets on a new UTC date and otherwise preserves count", () => {
  assert.deepEqual(nextWosUsageState("2026-07-18", 49, Date.parse("2026-07-19T00:00:00Z")), {
    dateUtc: "2026-07-19",
    count: 0,
  });
  assert.deepEqual(nextWosUsageState("2026-07-19", 7, Date.parse("2026-07-19T23:59:59Z")), {
    dateUtc: "2026-07-19",
    count: 7,
  });
});

test("request gate serializes starts and applies the configured interval", async () => {
  let now = 1000;
  const sleeps = [];
  const gate = createWosRequestGate(() => now, async (ms) => { sleeps.push(ms); now += ms; });
  const starts = [];
  await Promise.all([
    gate.run(1100, async () => { starts.push(now); }),
    gate.run(1100, async () => { starts.push(now); }),
  ]);
  assert.deepEqual(starts, [1000, 2100]);
  assert.deepEqual(sleeps, [1100]);
});

test("normalizes the official camelCase document shape", () => {
  const record = normalizeWosDocument({
    uid: "WOS:0001",
    title: "A paper",
    types: ["Article"],
    source: {
      sourceTitle: "Journal",
      publishYear: 2025,
      publishMonth: "JAN",
      volume: "3",
      issue: "2",
      articleNumber: "e10",
      pages: { begin: "10", end: "19" },
    },
    names: { authors: [{ displayName: "Ada Lovelace", wosStandard: "Lovelace, A", researcherId: "RID-1" }] },
    identifiers: { doi: "10.1000/test", pmid: "123", issn: "0000-0000" },
    keywords: { authorKeywords: ["one", "two"] },
    citations: [{ db: "MEDLINE", count: 2 }, { db: "WOS", count: 7 }],
    links: { record: "https://example.test/record", citingArticles: "https://example.test/citing" },
  }, "WOS");
  assert.equal(record.uid, "WOS:0001");
  assert.equal(record.source.pages, "10-19");
  assert.equal(record.authors[0].researcherId, "RID-1");
  assert.equal(record.identifiers.doi, "10.1000/test");
  assert.deepEqual(record.keywords, ["one", "two"]);
  assert.equal(record.timesCited, 7);
  assert.equal(record.links.citingArticles, "https://example.test/citing");
});

test("search uses fixed endpoint/header, stable pagination, plan spacing, and local counting", async () => {
  const calls = [];
  const hits = Array.from({ length: 55 }, (_, i) => ({ uid: `WOS:${i + 1}`, title: `Paper ${i + 1}` }));
  const { deps, prefs, sleeps } = makeDeps({
    prefs: { "wos.plan": "institutional-member" },
    request: async (method, url, options) => {
      calls.push({ method, url, options });
      const page = Number(new URL(url).searchParams.get("page"));
      return { response: { metadata: { total: 55, page, limit: 50 }, hits: page === 1 ? hits.slice(0, 50) : hits.slice(50) } };
    },
  });
  const result = await searchWebOfScience({
    query: 'TS=("graph neural network")',
    database: "WOS",
    maxResults: 55,
    sort: "publication_date_desc",
  }, deps);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "GET");
  assert.equal(new URL(calls[0].url).origin, "https://api.clarivate.com");
  assert.equal(new URL(calls[0].url).pathname, "/apis/wos-starter/v1/documents");
  assert.equal(new URL(calls[0].url).searchParams.get("q"), 'TS=("graph neural network")');
  assert.equal(new URL(calls[0].url).searchParams.get("limit"), "50");
  assert.equal(new URL(calls[1].url).searchParams.get("limit"), "50");
  assert.equal(new URL(calls[1].url).searchParams.get("page"), "2");
  assert.equal(new URL(calls[0].url).searchParams.get("sortField"), "PY+D");
  assert.equal(calls[0].options.headers["X-ApiKey"], "secret-key");
  assert.ok(!calls[0].url.includes("secret-key"));
  assert.deepEqual(sleeps, [220]);
  assert.equal(result.returned, 55);
  assert.equal(result.requestsUsed, 2);
  assert.equal(result.usage.localRequestsToday, 2);
  assert.equal(prefs["wos.requestsToday"], 2);
  assert.equal(prefs["wos.usageDateUtc"], "2026-07-19");
});

test("trial cap prevents pagination beyond one page", async () => {
  let calls = 0;
  const { deps } = makeDeps({
    request: async () => {
      calls++;
      return { response: { metadata: { total: 1000 }, hits: Array.from({ length: 50 }, (_, i) => ({ uid: `WOS:${i}` })) } };
    },
  });
  const result = await searchWebOfScience({ query: "PY=2025", maxResults: 1000 }, deps);
  assert.equal(calls, 1);
  assert.equal(result.returned, 50);
});

test("local daily exhaustion rejects without sending a request", async () => {
  let called = false;
  const { deps } = makeDeps({
    prefs: { "wos.usageDateUtc": "2026-07-19", "wos.requestsToday": 50 },
    request: async () => { called = true; throw new Error("should not run"); },
  });
  await assert.rejects(
    () => searchWebOfScience({ query: "PY=2025" }, deps),
    /local daily request limit.*trial.*50/i,
  );
  assert.equal(called, false);
});

test("errors are actionable and never include the API key", async () => {
  for (const [status, message] of [
    [400, /rejected the query/i],
    [401, /missing or invalid/i],
    [403, /subscription does not permit/i],
    [429, /rate limit or request quota/i],
    [503, /temporarily unavailable/i],
  ]) {
    const { deps } = makeDeps({ request: async () => { throw Object.assign(new Error("secret-key server dump"), { status }); } });
    await assert.rejects(async () => {
      try {
        await searchWebOfScience({ query: "PY=2025" }, deps);
      } catch (error) {
        assert.doesNotMatch(String(error), /secret-key/);
        throw error;
      }
    }, message);
  }
});

