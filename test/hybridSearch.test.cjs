const test = require('node:test');
const assert = require('node:assert');
const { rrfFuse, analyzeQuery } = require('../.tmp-test/semantic/hybridSearch.js');

test("rrfFuse ranks items appearing in both lists above single-list items", () => {
  const sem = [{ itemKey: "A" }, { itemKey: "B" }, { itemKey: "C" }];
  const key = [{ itemKey: "B" }, { itemKey: "D" }];
  const fused = rrfFuse(sem, key, 0.5, 0.5);
  assert.equal(fused[0].itemKey, "B");
  assert.equal(fused.length, 4);
});

test("analyzeQuery boosts keyword weight for author-year queries", () => {
  const w = analyzeQuery("Vaswani 2017");
  assert.ok(w.wKey > w.wSem);
});

test("analyzeQuery boosts semantic weight for conceptual questions", () => {
  const w = analyzeQuery("how do transformer models handle long-range dependencies");
  assert.ok(w.wSem > w.wKey);
});

test("weights stay clamped to [0.2, 0.8]", () => {
  for (const q of ["2017", "x", "what why how does this survey compare every possible approach"]) {
    const w = analyzeQuery(q);
    assert.ok(w.wSem >= 0.2 && w.wSem <= 0.8 && w.wKey >= 0.2 && w.wKey <= 0.8);
  }
});
