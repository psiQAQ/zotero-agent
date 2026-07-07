const test = require('node:test');
const assert = require('node:assert');
const { reconstructAbstract, shouldReplaceAbstract, shouldReplaceCreators, shouldUpdateDate, computeEnrichPatch, cslToZoteroFields } = require('../.tmp-test/metadataMerge.js');

test("reconstructAbstract rebuilds from inverted index", () => {
  assert.equal(reconstructAbstract({ "Hello": [0], "world": [1] }), "Hello world");
  assert.equal(reconstructAbstract(null), null);
  assert.equal(reconstructAbstract({}), null);
});

test("shouldReplaceAbstract: empty→yes, short+longer→yes, long→no", () => {
  assert.equal(shouldReplaceAbstract("", "anything"), true);
  assert.equal(shouldReplaceAbstract("short", "a much longer abstract than before"), true);
  assert.equal(shouldReplaceAbstract("x".repeat(250), "y".repeat(300)), false); // existing already >=200
  assert.equal(shouldReplaceAbstract("short", ""), false); // no incoming
});

test("shouldReplaceCreators: <2 existing→yes, shorter→no, longer+shared surname→yes", () => {
  assert.equal(shouldReplaceCreators([{lastName:"A"}], [{lastName:"A"},{lastName:"B"}]), true); // existing <2
  assert.equal(shouldReplaceCreators([{lastName:"A"},{lastName:"B"},{lastName:"C"}], [{lastName:"A"},{lastName:"B"}]), false); // shorter
  assert.equal(shouldReplaceCreators([{lastName:"Smith"},{lastName:"Jones"}], [{lastName:"Smith"},{lastName:"Jones"},{lastName:"Lee"}]), true); // longer + shared
  assert.equal(shouldReplaceCreators([{lastName:"Smith"},{lastName:"Jones"}], [{lastName:"X"},{lastName:"Y"},{lastName:"Z"}]), false); // longer but no shared surname
  assert.equal(shouldReplaceCreators([{lastName:"A"},{lastName:"B"}], []), false); // no incoming
});

test("shouldUpdateDate: no year→yes, bare year + full incoming→yes, full existing→no", () => {
  assert.equal(shouldUpdateDate("", "2020-05"), true);
  assert.equal(shouldUpdateDate("n.d.", "2020"), true); // no 4-digit year in existing
  assert.equal(shouldUpdateDate("2020", "2020-05-01"), true); // bare year upgraded
  assert.equal(shouldUpdateDate("2020-05-01", "2019"), false); // already full
});

test("computeEnrichPatch fills only empty scalars", () => {
  const existing = { publicationTitle: "", volume: "3", abstractNote: "" };
  const incoming = { publicationTitle: "Nature", volume: "99", pages: "1-10", abstractNote: "A new abstract of decent length here." };
  const patch = computeEnrichPatch(existing, incoming);
  assert.equal(patch.publicationTitle, "Nature"); // was empty → filled
  assert.equal(patch.volume, undefined); // had value → untouched
  assert.equal(patch.pages, "1-10"); // was missing → filled
  assert.equal(patch.abstractNote, "A new abstract of decent length here."); // was empty → filled
});

test("cslToZoteroFields maps container-title, page, issued, author", () => {
  const csl = { "container-title": ["Nature"], volume: 521, issue: "7553", page: "436-444", ISSN: ["0028-0836"], publisher: "Springer", issued: { "date-parts": [[2015, 5, 28]] }, author: [{ family: "LeCun", given: "Yann" }] };
  const f = cslToZoteroFields(csl);
  assert.equal(f.publicationTitle, "Nature");
  assert.equal(f.volume, "521"); // stringified
  assert.equal(f.pages, "436-444");
  assert.equal(f.ISSN, "0028-0836"); // first of array
  assert.equal(f.date, "2015-05-28");
  assert.equal(f.creators[0].lastName, "LeCun");
  assert.equal(f.creators[0].firstName, "Yann");
});

test("cslToZoteroFields strips HTML from abstract, tolerates empty", () => {
  assert.equal(cslToZoteroFields({ abstract: "<jats:p>Hello</jats:p>" }).abstractNote, "Hello");
  assert.deepEqual(cslToZoteroFields({}), {});
  assert.deepEqual(cslToZoteroFields(null), {});
});
