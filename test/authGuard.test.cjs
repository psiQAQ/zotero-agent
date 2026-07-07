const test = require('node:test');
const assert = require('node:assert');
const { extractBearerToken, tokensMatch, generateAuthToken, extractOriginHeader, isOriginAllowed } = require('../.tmp-test/authGuard.js');

test('extractBearerToken pulls token from raw request headers', () => {
  const req = 'POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer abc123\r\n\r\n{}';
  assert.strictEqual(extractBearerToken(req), 'abc123');
});

test('extractBearerToken is case-insensitive on header name and scheme', () => {
  const req = 'POST /mcp HTTP/1.1\r\nauthorization: bearer TOK\r\n\r\n';
  assert.strictEqual(extractBearerToken(req), 'TOK');
});

test('extractBearerToken returns null when absent', () => {
  assert.strictEqual(extractBearerToken('POST /mcp HTTP/1.1\r\n\r\n'), null);
});

test('tokensMatch true only on exact equal strings', () => {
  assert.strictEqual(tokensMatch('abc', 'abc'), true);
  assert.strictEqual(tokensMatch('abc', 'abd'), false);
  assert.strictEqual(tokensMatch('abc', 'ab'), false);
  assert.strictEqual(tokensMatch('', ''), true);
});

test('generateAuthToken returns url-safe high-entropy string', () => {
  const t = generateAuthToken();
  assert.match(t, /^[A-Za-z0-9_-]{40,}$/);
  assert.notStrictEqual(generateAuthToken(), t);
});

test("extractOriginHeader finds the Origin header", () => {
  const req = "POST /mcp HTTP/1.1\r\nHost: x\r\nOrigin: http://evil.example\r\n\r\n{}";
  assert.equal(extractOriginHeader(req), "http://evil.example");
  assert.equal(extractOriginHeader("POST /mcp HTTP/1.1\r\nHost: x\r\n\r\n{}"), null);
});

test("isOriginAllowed: absent passes, loopback passes, others rejected", () => {
  assert.equal(isOriginAllowed(null), true);
  assert.equal(isOriginAllowed("http://localhost:8080"), true);
  assert.equal(isOriginAllowed("http://127.0.0.1"), true);
  assert.equal(isOriginAllowed("https://[::1]:23120"), true);
  assert.equal(isOriginAllowed("http://evil.example"), false);
  assert.equal(isOriginAllowed("http://localhost.evil.example"), false);
  assert.equal(isOriginAllowed("null"), false);                              // opaque origin (sandboxed iframe) — literal string, not JS null
  assert.equal(isOriginAllowed("http://127.0.0.1.evil.example"), false);     // IP-branch suffix attack
  assert.equal(isOriginAllowed("http://localhost:8080/foo"), false);         // path suffix — $ anchor
});
