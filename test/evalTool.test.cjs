const test = require('node:test');
const assert = require('node:assert');
const { runUserJavaScript } = require('../.tmp-test/evalTool.js');

test('returns JSON-serialized result of top-level return', async () => {
  const r = await runUserJavaScript('return 1 + 2;', {});
  assert.deepStrictEqual(r, { result: 3, logs: [], error: null });
});

test('injected globals are visible to user code', async () => {
  const fakeZotero = { Libraries: { userLibraryID: 42 } };
  const r = await runUserJavaScript('return Zotero.Libraries.userLibraryID;', { Zotero: fakeZotero });
  assert.strictEqual(r.result, 42);
});

test('captures console output into logs', async () => {
  const r = await runUserJavaScript('console.log("hi", 7); return null;', {});
  assert.deepStrictEqual(r.logs, ['hi 7']);
});

test('top-level await works', async () => {
  const r = await runUserJavaScript('const v = await Promise.resolve(5); return v * 2;', {});
  assert.strictEqual(r.result, 10);
});

test('errors are captured, not thrown', async () => {
  const r = await runUserJavaScript('throw new Error("boom");', {});
  assert.strictEqual(r.result, null);
  assert.strictEqual(r.error.message, 'boom');
  assert.ok(typeof r.error.stack === 'string');
});

test('undefined return normalizes to null', async () => {
  const r = await runUserJavaScript('const x = 1;', {});
  assert.strictEqual(r.result, null);
});

test("times out and says the code may still be running", async () => {
  const r = await runUserJavaScript("await new Promise(() => {});", {}, 200);
  assert.equal(r.timedOut, true);
  assert.match(r.error.message, /may still be running/i);
});

test("clears the timer on fast completion (no dangling timeout)", async () => {
  const r = await runUserJavaScript("return 1;", {}, 60000);
  assert.equal(r.result, 1);
  assert.equal(r.timedOut, undefined);
});

test("truncates oversized results and flags it", async () => {
  const r = await runUserJavaScript("return 'x'.repeat(300000);", {});
  assert.equal(r.truncated, true);
  assert.ok(r.result.length <= 100000);
  assert.match(r.error?.message ?? "", /truncated/i);
});

test("console shim stringifies objects", async () => {
  const r = await runUserJavaScript("console.log({a: 1}); return null;", {});
  assert.equal(r.logs[0], '{"a":1}');
});

test("negative timeout_ms clamps to minimum without hanging; sync return still wins", async () => {
  // clamp(-5) → 1ms; a synchronous return resolves as a microtask, beating the 1ms macrotask timer
  const r = await runUserJavaScript("return 'fast';", {}, -5);
  assert.equal(r.result, "fast");
  assert.equal(r.timedOut, undefined);
});

test("truncation cutting a surrogate pair still yields a JSON-serializable envelope", async () => {
  // '"' + 99998×a puts the 100_000-char cut right between the 😀 high/low surrogates
  const r = await runUserJavaScript("return 'a'.repeat(99998) + '\\u{1F600}'.repeat(2000);", {});
  assert.equal(r.truncated, true);
  const s = JSON.stringify(r); // well-formed stringify must not throw on the lone surrogate
  assert.ok(JSON.parse(s));
});

test("circular return falls back to String() instead of crashing", async () => {
  const r = await runUserJavaScript("const o = {}; o.self = o; return o;", {});
  assert.equal(r.error, null);
  assert.equal(r.result, "[object Object]");
});
