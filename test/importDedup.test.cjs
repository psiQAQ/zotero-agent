const test = require('node:test');
const assert = require('node:assert');
const { classifyIncoming } = require('../.tmp-test/importDedup.js');

const existing = [
  { key: "K1", doi: "10.1234/s1", title: "Sample One" },
  { key: "K2", doi: "", title: "An Existing Paper About Gaze" },
];

test("DOI exact match (case-insensitive) → skip", () => {
  assert.deepStrictEqual(
    classifyIncoming({ doi: "10.1234/S1", title: "whatever" }, existing),
    { action: "skip", reason: "doi-match", existingKey: "K1" },
  );
});

test("no DOI, high title similarity → skip with title-match", () => {
  const r = classifyIncoming({ doi: "", title: "An Existing Paper about Gaze" }, existing);
  assert.strictEqual(r.action, "skip");
  assert.strictEqual(r.reason, "title-match");
  assert.strictEqual(r.existingKey, "K2");
});

test("brand new item → import", () => {
  assert.strictEqual(classifyIncoming({ doi: "10.9/new", title: "Brand New Work" }, existing).action, "import");
});

test("empty library → import", () => {
  assert.strictEqual(classifyIncoming({ doi: "", title: "Anything" }, []).action, "import");
});

test("unrelated DOI does not match existing empty-DOI entries", () => {
  const r = classifyIncoming({ doi: "10.5555/none", title: "Totally Different Subject Matter" }, existing);
  assert.strictEqual(r.action, "import");
});
