const test = require("node:test");
const assert = require("node:assert");
const { extractIdentifiers } = require("../.tmp-test/pdfIdentifier.js");

test("extracts DOI and arXiv from mixed text (ZotMeta case)", () => {
  const r = extractIdentifiers(
    "arXiv:2209.14577v1 [stat.ML]\nDOI: 10.1108/03321640510615607."
  );
  assert.equal(r.arxiv, "2209.14577v1");
  assert.equal(r.doi, "10.1108/03321640510615607"); // trailing dot stripped
});

test("DOI frequency vote picks the recurring one, not the first", () => {
  // reference-list DOI appears once first; the paper's own DOI recurs in header/footer
  const text =
    "References: 10.1000/refA ... \n Header 10.1234/mypaper \n Footer 10.1234/mypaper \n page 10.1234/mypaper";
  assert.equal(extractIdentifiers(text).doi, "10.1234/mypaper");
});

test("handles full-width colon in arXiv", () => {
  assert.equal(extractIdentifiers("arXiv：1706.03762").arxiv, "1706.03762");
});

test("old-style arXiv id (category/number)", () => {
  const r = extractIdentifiers("see arXiv:math.GT/0309136 for details");
  assert.ok(r.arxiv && r.arxiv.includes("0309136"));
});

test("returns nulls when nothing present", () => {
  assert.deepEqual(extractIdentifiers("just plain text no identifiers"), {
    doi: null,
    arxiv: null,
  });
});

test("strips trailing punctuation from DOI", () => {
  assert.equal(extractIdentifiers("10.1234/abc)").doi, "10.1234/abc");
});
