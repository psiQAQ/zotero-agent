const test = require('node:test');
const assert = require('node:assert');
const { parseResolvers, mergeResolvers, buildResolver } = require('../.tmp-test/pdfResolvers.js');

test("parseResolvers handles array, json string, single object, junk", () => {
  assert.deepEqual(parseResolvers([{a:1}]), [{a:1}]);
  assert.deepEqual(parseResolvers('[{"a":1}]'), [{a:1}]);
  assert.deepEqual(parseResolvers('{"a":1}'), [{a:1}]);
  assert.deepEqual(parseResolvers("not json"), []);
  assert.deepEqual(parseResolvers(null), []);
});

test("mergeResolvers keeps external and dedupes ours", () => {
  const existing = [{name:"Foreign",url:"x",mcpManaged:false}, {name:"Old",url:"y",mcpManaged:true}];
  const mine = [{name:"Sci-Hub",url:"https://sci-hub.se/{doi}",automatic:false,mcpManaged:true}];
  const merged = mergeResolvers(existing, mine);
  assert.equal(merged.length, 2); // 1 mine + 1 external (Old dropped, Foreign kept)
  assert.ok(merged.some(r=>r.name==="Foreign"));
  assert.ok(!merged.some(r=>r.name==="Old"));
});

test("mergeResolvers dedupes ours by name+url ignoring automatic", () => {
  const mine = [{name:"S",url:"u",automatic:true,mcpManaged:true},{name:"S",url:"u",automatic:false,mcpManaged:true}];
  assert.equal(mergeResolvers([], mine).length, 1);
});

test("buildResolver from preset defaults automatic false", () => {
  const r = buildResolver({preset:"scihub-se"});
  assert.equal(r.automatic, false); assert.equal(r.mcpManaged, true);
  assert.ok(r.url.includes("{doi}")); assert.equal(r.name, "Sci-Hub");
});

test("buildResolver custom requires name/url/selector and {doi}", () => {
  assert.throws(()=>buildResolver({name:"X",url:"https://x/no-placeholder",selector:"#p"}));
  assert.throws(()=>buildResolver({name:"X",url:"https://x/{doi}"})); // no selector
  const r = buildResolver({name:"X",url:"https://x/{doi}",selector:"#p",automatic:true});
  assert.equal(r.automatic, true);
});

test("buildResolver unknown preset throws", () => {
  assert.throws(()=>buildResolver({preset:"nope"}));
});

test("buildResolver from preset ignores explicit undefined overrides (wiring passes undefined keys)", () => {
  // reproduces the tool's case call: only preset set, other fields explicitly undefined
  const r = buildResolver({ preset: "scihub-se", name: undefined, url: undefined, selector: undefined, attribute: undefined, automatic: undefined });
  assert.equal(r.name, "Sci-Hub");
  assert.ok(r.url.includes("sci-hub.se"));
  assert.ok(r.selector); // must not be undefined
  assert.equal(r.automatic, false);
  assert.equal(r.mcpManaged, true);
});

test("buildResolver custom still works with explicit undefined preset key", () => {
  const r = buildResolver({ preset: undefined, name: "X", url: "https://x/{doi}", selector: "#p", attribute: undefined, automatic: true });
  assert.equal(r.name, "X");
  assert.equal(r.attribute, "src"); // default kept since custom didn't specify
  assert.equal(r.automatic, true);
});
