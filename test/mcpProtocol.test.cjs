const test = require('node:test');
const assert = require('node:assert');
const { negotiateProtocolVersion } = require('../.tmp-test/mcpProtocol.js');

test("negotiateProtocolVersion echoes known versions", () => {
  assert.equal(negotiateProtocolVersion("2024-11-05"), "2024-11-05");
  assert.equal(negotiateProtocolVersion("2025-03-26"), "2025-03-26");
  assert.equal(negotiateProtocolVersion("2025-06-18"), "2025-06-18");
});

test("negotiateProtocolVersion answers latest for unknown/absent", () => {
  assert.equal(negotiateProtocolVersion("1999-01-01"), "2025-06-18");
  assert.equal(negotiateProtocolVersion(undefined), "2025-06-18");
  assert.equal(negotiateProtocolVersion(42), "2025-06-18");
});
