const test = require('node:test');
const assert = require('node:assert');
const { titleSimilarity, normalizeTitle, MATCH_THRESHOLD } = require('../.tmp-test/titleSimilarity.js');

test("identical titles score 1", () => {
  assert.equal(titleSimilarity("Attention Is All You Need", "Attention is all you need"), 1);
});
test("diacritics folded — Müller equals Muller after normalize", () => {
  assert.equal(normalizeTitle("Müller-Lyer Illusion"), normalizeTitle("Muller-Lyer Illusion"));
});
test("subtitle difference still scores high (>=0.9)", () => {
  const s = titleSimilarity("Deep Residual Learning", "Deep Residual Learning for Image Recognition");
  assert.ok(s >= 0.9, `expected >=0.9, got ${s}`);
});
test("unrelated titles score low (<0.5)", () => {
  assert.ok(titleSimilarity("Attention Is All You Need", "A Survey of Eye Tracking in Virtual Reality") < 0.5);
});
test("threshold constant is 0.86", () => {
  assert.equal(MATCH_THRESHOLD, 0.86);
});
test("near-identical with punctuation/case scores >= threshold", () => {
  assert.ok(titleSimilarity("GANs for Machine Learning.", "GANs for machine learning") >= 0.86);
});
test("empty input scores 0", () => {
  assert.equal(titleSimilarity("", "anything"), 0);
});
