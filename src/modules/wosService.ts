declare const Zotero: any;

const WOS_BASE_URL = "https://api.clarivate.com/apis/wos-starter/v1/documents";
const PREF_PREFIX = "extensions.zotero.zotero-agent.";

export type WosPlan =
  | "trial"
  | "institutional-member"
  | "institutional-integration";

export const WOS_PLAN_POLICIES = {
  trial: {
    requestsPerSecond: 1,
    dailyLimit: 50,
    minIntervalMs: 1100,
    maxRecordsPerCall: 50,
    timesCited: false,
  },
  "institutional-member": {
    requestsPerSecond: 5,
    dailyLimit: 5000,
    minIntervalMs: 220,
    maxRecordsPerCall: 500,
    timesCited: true,
  },
  "institutional-integration": {
    requestsPerSecond: 5,
    dailyLimit: 20000,
    minIntervalMs: 220,
    maxRecordsPerCall: 1000,
    timesCited: true,
  },
} as const;

const DATABASES = new Set([
  "WOS", "BIOABS", "BCI", "BIOSIS", "CCC", "DIIDW",
  "DRCI", "MEDLINE", "ZOOREC", "PPRN", "WOK",
]);

const SORT_FIELDS = {
  relevance: "RS+D",
  publication_date_desc: "PY+D",
  times_cited_desc: "TC+D",
} as const;

export interface WosSearchOptions {
  query: string;
  database?: string;
  maxResults?: number;
  sort?: keyof typeof SORT_FIELDS;
  detail?: "full" | "short";
}

interface WosRequestGate {
  run<T>(minIntervalMs: number, work: () => Promise<T>): Promise<T>;
}

export interface WosServiceDeps {
  prefGet: (key: string) => unknown;
  prefSet: (key: string, value: string | number | boolean) => void;
  request: (method: string, url: string, options: any) => Promise<any>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  gate: WosRequestGate;
}

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function selectedPlan(value: unknown): WosPlan {
  const plan = String(value ?? "trial") as WosPlan;
  return Object.prototype.hasOwnProperty.call(WOS_PLAN_POLICIES, plan) ? plan : "trial";
}

export function calculateEffectiveMaxResults(
  requested: unknown,
  configured: unknown,
  plan: WosPlan,
): number {
  const requestedLimit = integerInRange(requested, 50, 1, 1000);
  const configuredLimit = integerInRange(configured, 100, 1, 1000);
  return Math.min(requestedLimit, configuredLimit, WOS_PLAN_POLICIES[plan].maxRecordsPerCall);
}

export function nextWosUsageState(
  storedDateUtc: unknown,
  storedCount: unknown,
  nowMs: number,
): { dateUtc: string; count: number } {
  const dateUtc = new Date(nowMs).toISOString().slice(0, 10);
  const count = Math.max(0, Math.floor(Number(storedCount) || 0));
  return String(storedDateUtc ?? "") === dateUtc
    ? { dateUtc, count }
    : { dateUtc, count: 0 };
}

export function createWosRequestGate(
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): WosRequestGate {
  let tail: Promise<void> = Promise.resolve();
  let lastStartedAt: number | null = null;

  return {
    run<T>(minIntervalMs: number, work: () => Promise<T>): Promise<T> {
      const run = tail.then(async () => {
        if (lastStartedAt !== null) {
          const waitMs = Math.max(0, lastStartedAt + minIntervalMs - now());
          if (waitMs > 0) await sleep(waitMs);
        }
        lastStartedAt = now();
        return work();
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}

function pageRange(pages: any): string | undefined {
  if (!pages || typeof pages !== "object") return undefined;
  if (pages.range) return String(pages.range);
  if (pages.begin && pages.end) return `${pages.begin}-${pages.end}`;
  if (pages.begin) return String(pages.begin);
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}

export function normalizeWosDocument(document: any, database: string): any {
  const source = document?.source ?? {};
  const citations = Array.isArray(document?.citations) ? document.citations : [];
  const citation = citations.find((entry: any) => entry?.db === database)
    ?? citations.find((entry: any) => entry?.db === "WOS");

  return {
    uid: String(document?.uid ?? ""),
    title: optionalString(document?.title) ?? null,
    documentTypes: Array.isArray(document?.types) ? document.types.map(String) : [],
    authors: Array.isArray(document?.names?.authors)
      ? document.names.authors
        .filter((author: any) => author?.displayName)
        .map((author: any) => ({
          displayName: String(author.displayName),
          wosStandard: optionalString(author.wosStandard),
          researcherId: optionalString(author.researcherId),
        }))
      : [],
    source: {
      title: optionalString(source.sourceTitle),
      year: typeof source.publishYear === "number"
        ? source.publishYear
        : (Number.isFinite(Number(source.publishYear)) ? Number(source.publishYear) : undefined),
      month: optionalString(source.publishMonth),
      volume: optionalString(source.volume),
      issue: optionalString(source.issue),
      articleNumber: optionalString(source.articleNumber),
      pages: pageRange(source.pages),
    },
    identifiers: {
      doi: optionalString(document?.identifiers?.doi),
      pmid: optionalString(document?.identifiers?.pmid),
      issn: optionalString(document?.identifiers?.issn),
      eissn: optionalString(document?.identifiers?.eissn),
      isbn: optionalString(document?.identifiers?.isbn),
      eisbn: optionalString(document?.identifiers?.eisbn),
    },
    keywords: Array.isArray(document?.keywords?.authorKeywords)
      ? document.keywords.authorKeywords.map(String)
      : [],
    timesCited: Number.isFinite(Number(citation?.count)) ? Number(citation.count) : null,
    links: {
      record: optionalString(document?.links?.record),
      citingArticles: optionalString(document?.links?.citingArticles),
      references: optionalString(document?.links?.references),
      related: optionalString(document?.links?.related),
    },
  };
}

function mappedRequestError(error: any): Error {
  const status = Number(error?.status ?? error?.xmlhttp?.status ?? error?.response?.status);
  if (status === 400) return new Error("Web of Science rejected the query");
  if (status === 401) return new Error("Web of Science API Key is missing or invalid");
  if (status === 403) return new Error("Web of Science subscription does not permit this request");
  if (status === 404) return new Error("Web of Science resource was not found");
  if (status === 429) return new Error("Web of Science rate limit or request quota was exceeded; no retry was attempted");
  if (status >= 500) return new Error("Web of Science service is temporarily unavailable");
  return new Error("Web of Science request failed or timed out");
}

const productionGate = createWosRequestGate(
  () => Date.now(),
  (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
);

function productionDeps(): WosServiceDeps {
  return {
    prefGet: (key) => Zotero.Prefs.get(PREF_PREFIX + key, true),
    prefSet: (key, value) => Zotero.Prefs.set(PREF_PREFIX + key, value, true),
    request: (method, url, options) => Zotero.HTTP.request(method, url, options),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    gate: productionGate,
  };
}

function reserveRequest(policy: (typeof WOS_PLAN_POLICIES)[WosPlan], plan: WosPlan, deps: WosServiceDeps): number {
  const usage = nextWosUsageState(
    deps.prefGet("wos.usageDateUtc"),
    deps.prefGet("wos.requestsToday"),
    deps.now(),
  );
  if (usage.count >= policy.dailyLimit) {
    throw new Error(
      `Web of Science local daily request limit reached for ${plan}: ${usage.count}/${policy.dailyLimit}`,
    );
  }
  const nextCount = usage.count + 1;
  deps.prefSet("wos.usageDateUtc", usage.dateUtc);
  deps.prefSet("wos.requestsToday", nextCount);
  return nextCount;
}

export async function searchWebOfScience(
  options: WosSearchOptions,
  dependencies?: Partial<WosServiceDeps>,
): Promise<any> {
  const deps = { ...productionDeps(), ...dependencies } as WosServiceDeps;
  const query = String(options?.query ?? "").trim();
  if (!query) throw new Error("query is required");

  const apiKey = String(deps.prefGet("wos.apiKey") ?? "").trim();
  if (!apiKey) throw new Error("Web of Science API Key is not configured");

  const plan = selectedPlan(deps.prefGet("wos.plan"));
  const policy = WOS_PLAN_POLICIES[plan];
  const database = String(options.database ?? deps.prefGet("wos.database") ?? "WOS").toUpperCase();
  if (!DATABASES.has(database)) {
    throw new Error(`Unsupported Web of Science database: ${database}`);
  }
  const sort = options.sort ?? "relevance";
  if (!Object.prototype.hasOwnProperty.call(SORT_FIELDS, sort)) {
    throw new Error(`Unsupported Web of Science sort: ${String(sort)}`);
  }
  const detail = options.detail ?? "full";
  if (detail !== "full" && detail !== "short") {
    throw new Error(`Unsupported Web of Science detail: ${String(detail)}`);
  }

  const effectiveMaxResults = calculateEffectiveMaxResults(
    options.maxResults,
    deps.prefGet("wos.maxRecords"),
    plan,
  );
  const pageSize = Math.min(50, effectiveMaxResults);
  const timeout = integerInRange(deps.prefGet("wos.timeoutSeconds"), 30, 5, 600) * 1000;
  const records: any[] = [];
  let total = 0;
  let page = 1;
  let requestsUsed = 0;

  while (records.length < effectiveMaxResults) {
    const params = new URLSearchParams({
      q: query,
      db: database,
      limit: String(pageSize),
      page: String(page),
      sortField: SORT_FIELDS[sort],
    });
    if (detail === "short") params.set("detail", "short");

    reserveRequest(policy, plan, deps);
    let response: any;
    try {
      response = await deps.gate.run(policy.minIntervalMs, () => deps.request(
        "GET",
        `${WOS_BASE_URL}?${params.toString()}`,
        {
          headers: { Accept: "application/json", "X-ApiKey": apiKey },
          responseType: "json",
          timeout,
        },
      ));
    } catch (error) {
      throw mappedRequestError(error);
    }

    requestsUsed++;
    const body = response?.response ?? response ?? {};
    const hits = Array.isArray(body.hits) ? body.hits : [];
    total = Math.max(0, Math.floor(Number(body.metadata?.total) || 0));
    records.push(...hits.map((hit: any) => normalizeWosDocument(hit, database)));

    if (records.length >= effectiveMaxResults) break;
    if (total > 0 && records.length >= total) break;
    if (hits.length === 0 || hits.length < pageSize) break;
    page++;
  }

  const usage = nextWosUsageState(
    deps.prefGet("wos.usageDateUtc"),
    deps.prefGet("wos.requestsToday"),
    deps.now(),
  );
  const limitedRecords = records.slice(0, effectiveMaxResults);
  return {
    total,
    returned: limitedRecords.length,
    requestsUsed,
    database,
    usage: {
      plan,
      localRequestsToday: usage.count,
      localDailyLimit: policy.dailyLimit,
    },
    records: limitedRecords,
  };
}
