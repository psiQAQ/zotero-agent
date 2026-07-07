const test = require('node:test');
const assert = require('node:assert');
const { buildProxyPacDataUrl, isLocalhostHost } = require('../.tmp-test/scihubProxy.js');

test("buildProxyPacDataUrl embeds host:port and greys-only routing", () => {
  const u = buildProxyPacDataUrl("127.0.0.1", 7890);
  assert.ok(u.startsWith("data:text/plain,"));
  const decoded = decodeURIComponent(u.slice("data:text/plain,".length));
  assert.ok(decoded.includes("PROXY 127.0.0.1:7890"));
  assert.ok(decoded.includes("SOCKS5 127.0.0.1:7890"));
  assert.ok(decoded.includes("sci-hub"));
  assert.ok(decoded.includes("annas-archive"));
  assert.ok(decoded.includes('return "DIRECT"'));
});

test("buildProxyPacDataUrl defaults and coerces", () => {
  const u = buildProxyPacDataUrl("localhost", 1080);
  assert.ok(decodeURIComponent(u).includes("localhost:1080"));
});

test("isLocalhostHost detects loopback", () => {
  assert.equal(isLocalhostHost("localhost"), true);
  assert.equal(isLocalhostHost("127.0.0.1"), true);
  assert.equal(isLocalhostHost("::1"), true);
  assert.equal(isLocalhostHost("example.com"), false);
});
