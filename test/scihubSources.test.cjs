const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_SCIHUB_SOURCES, parseSources, syncScihubResolvers } = require('../.tmp-test/scihubSources.js');

test("DEFAULT_SCIHUB_SOURCES has 9 Sci-Hub + 2 Anna's Archive", () => {
  assert.equal(DEFAULT_SCIHUB_SOURCES.length, 11);
  assert.equal(DEFAULT_SCIHUB_SOURCES.filter((s) => s.url.includes("sci-hub")).length, 9);
  assert.equal(DEFAULT_SCIHUB_SOURCES.filter((s) => s.url.includes("annas-archive")).length, 2);
});

test("parseSources handles junk and JSON", () => {
  assert.deepEqual(parseSources('[{"url":"https://x/{doi}"}]'), [{ url: "https://x/{doi}" }]);
  assert.deepEqual(parseSources("not json"), []);
  assert.deepEqual(parseSources(null), []);
});

test("syncScihubResolvers enabled = our sources (automatic:false) + external", () => {
  const existing = [{ name: "Foreign", url: "y", mcpManaged: false }];
  const out = syncScihubResolvers(true, [{ url: "https://sci-hub.se/{doi}" }], JSON.stringify(existing));
  assert.equal(out.length, 2);
  const mine = out.find((r) => r.mcpManaged);
  assert.equal(mine.automatic, false);
  assert.ok(mine.selector.includes("#pdf"));
  assert.ok(out.some((r) => r.name === "Foreign"));
});

test("syncScihubResolvers disabled = external only (our sources removed)", () => {
  const existing = [{ name: "Sci-Hub", url: "https://sci-hub.se/{doi}", automatic: false, mcpManaged: true }, { name: "Foreign", url: "y", mcpManaged: false }];
  const out = syncScihubResolvers(false, [{ url: "https://sci-hub.se/{doi}" }], JSON.stringify(existing));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Foreign");
});

test("Anna's Archive source gets href selector/attribute", () => {
  const out = syncScihubResolvers(true, [{ url: "https://annas-archive.se/scidb/{doi}/" }], "[]");
  const r = out[0];
  assert.equal(r.attribute, "href");
  assert.ok(r.selector.includes("href"));
});
