const test = require('node:test');
const assert = require('node:assert');
const { isPreprintCandidate, extractArxivId } = require('../.tmp-test/preprintService.js');

test("isPreprintCandidate: itemType preprint hits directly", () => {
  assert.strictEqual(isPreprintCandidate({ itemType: "preprint", url: "", extra: "", DOI: "" }), true);
});

test("isPreprintCandidate: journalArticle with arXiv-shaped DOI hits", () => {
  assert.strictEqual(isPreprintCandidate({ itemType: "journalArticle", url: "", extra: "", DOI: "10.48550/arXiv.2401.00001" }), true);
});

test("isPreprintCandidate: normal journal article does not hit", () => {
  assert.strictEqual(isPreprintCandidate({ itemType: "journalArticle", url: "", extra: "", DOI: "10.1145/3313831" }), false);
});

test("isPreprintCandidate: arXiv URL or extra hits", () => {
  assert.strictEqual(isPreprintCandidate({ itemType: "journalArticle", url: "https://arxiv.org/abs/2104.12668", extra: "", DOI: "" }), true);
  assert.strictEqual(isPreprintCandidate({ itemType: "journalArticle", url: "", extra: "arXiv:2104.12668", DOI: "" }), true);
});

test("extractArxivId parses abs/pdf URLs, arXiv: prefix, arXiv DOI", () => {
  assert.strictEqual(extractArxivId("https://arxiv.org/abs/2401.00001v2"), "2401.00001");
  assert.strictEqual(extractArxivId("https://arxiv.org/pdf/2401.00001"), "2401.00001");
  assert.strictEqual(extractArxivId("arXiv:2401.00001"), "2401.00001");
  assert.strictEqual(extractArxivId("10.48550/arXiv.2401.00001"), "2401.00001");
  assert.strictEqual(extractArxivId("https://example.com"), null);
  assert.strictEqual(extractArxivId(""), null);
});
