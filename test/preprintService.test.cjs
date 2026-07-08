const test = require('node:test');
const assert = require('node:assert');
const { isPreprintCandidate, extractArxivId, pickPublishedVersion, classifyHandleResponse } = require('../.tmp-test/preprintService.js');

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

// Fixtures mirror the recon-verified (2026-07-08) OpenAlex title-search result shapes.
const TITLE = "Appearance-based Gaze Estimation With Deep Learning: A Review and Benchmark";
const publishedWork = {
  id: "https://openalex.org/W4396720000",
  doi: "https://doi.org/10.1109/tpami.2024.3393571",
  title: TITLE,
  type: "article",
  publication_year: 2024,
  primary_location: {
    version: "publishedVersion",
    source: { display_name: "IEEE Transactions on Pattern Analysis and Machine Intelligence", type: "journal" },
  },
};
const preprintWork = {
  id: "https://openalex.org/W3157864944",
  doi: "https://doi.org/10.48550/arxiv.2104.12668",
  title: TITLE,
  type: "preprint",
  publication_year: 2021,
  primary_location: {
    version: "submittedVersion",
    is_published: false,
    source: { display_name: "arXiv (Cornell University)", type: "repository" },
  },
};

test("pickPublishedVersion picks the publisher work over the arXiv work", () => {
  const hit = pickPublishedVersion([preprintWork, publishedWork], TITLE);
  assert.ok(hit);
  assert.strictEqual(hit.doi, "10.1109/tpami.2024.3393571");
  assert.strictEqual(hit.venue, "IEEE Transactions on Pattern Analysis and Machine Intelligence");
  assert.strictEqual(hit.year, "2024");
  assert.strictEqual(hit.openalexId, "https://openalex.org/W4396720000");
});

test("pickPublishedVersion returns null for repository-only results (pure preprint)", () => {
  assert.strictEqual(pickPublishedVersion([preprintWork], TITLE), null);
  assert.strictEqual(pickPublishedVersion([], TITLE), null);
  assert.strictEqual(pickPublishedVersion(null, TITLE), null);
});

test("pickPublishedVersion rejects title mismatches (fuzzy-search guard)", () => {
  const wrong = { ...publishedWork, title: "A Completely Different Survey About Neural Radiance Fields" };
  assert.strictEqual(pickPublishedVersion([wrong], TITLE), null);
});

test("pickPublishedVersion rejects publishedVersion works whose DOI is still arXiv", () => {
  const arxivDoiButPublished = { ...publishedWork, doi: "https://doi.org/10.48550/arXiv.2104.12668" };
  assert.strictEqual(pickPublishedVersion([arxivDoiButPublished], TITLE), null);
});

test("extractArxivId parses abs/pdf URLs, arXiv: prefix, arXiv DOI", () => {
  assert.strictEqual(extractArxivId("https://arxiv.org/abs/2401.00001v2"), "2401.00001");
  assert.strictEqual(extractArxivId("https://arxiv.org/pdf/2401.00001"), "2401.00001");
  assert.strictEqual(extractArxivId("arXiv:2401.00001"), "2401.00001");
  assert.strictEqual(extractArxivId("10.48550/arXiv.2401.00001"), "2401.00001");
  assert.strictEqual(extractArxivId("https://example.com"), null);
  assert.strictEqual(extractArxivId(""), null);
});

test("classifyHandleResponse: 200+rc1 alive, 404+rc100 dead, everything else unknown", () => {
  assert.strictEqual(classifyHandleResponse(200, { responseCode: 1, handle: "10.1038/nature14539" }), "alive");
  assert.strictEqual(classifyHandleResponse(404, { responseCode: 100 }), "dead");
  assert.strictEqual(classifyHandleResponse(500, { responseCode: 1 }), "unknown");
  assert.strictEqual(classifyHandleResponse(200, { responseCode: 2 }), "unknown");
  assert.strictEqual(classifyHandleResponse(404, null), "unknown");
  assert.strictEqual(classifyHandleResponse(0, null), "unknown");
});
