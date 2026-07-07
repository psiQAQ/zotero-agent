const test = require('node:test');
const assert = require('node:assert');
const { findHeaderEnd, parseContentLength } = require('../.tmp-test/httpByteReader.js');

const b = (s) => Buffer.from(s, 'utf8'); // Buffer is a Uint8Array — passes straight through

test('findHeaderEnd returns index after CRLFCRLF found mid-buffer', () => {
  const buf = b('GET / HTTP/1.1\r\nHost: x\r\n\r\nBODY');
  const end = findHeaderEnd(buf);
  assert.strictEqual(buf.slice(0, end).toString(), 'GET / HTTP/1.1\r\nHost: x\r\n\r\n');
  assert.strictEqual(buf.slice(end).toString(), 'BODY');
});

test('findHeaderEnd returns -1 when terminator absent', () => {
  assert.strictEqual(findHeaderEnd(b('GET / HTTP/1.1\r\nHost: x\r\n')), -1);
});

test('findHeaderEnd handles terminator exactly at end of buffer', () => {
  const buf = b('POST /mcp HTTP/1.1\r\n\r\n');
  assert.strictEqual(findHeaderEnd(buf), buf.length);
});

test('findHeaderEnd returns -1 on partial terminator (\\r\\n\\r, no final \\n)', () => {
  assert.strictEqual(findHeaderEnd(b('A\r\n\r')), -1);
});

test('findHeaderEnd returns first terminator when body also contains CRLFCRLF', () => {
  const buf = b('H\r\n\r\na\r\n\r\nb'); // first \r\n\r\n ends at index 5 ("H\r\n\r\n".length)
  assert.strictEqual(findHeaderEnd(buf), 5);
});

test('parseContentLength reads the declared value', () => {
  assert.strictEqual(parseContentLength('POST /mcp HTTP/1.1\r\nContent-Length: 42\r\n'), 42);
});

test('parseContentLength is case-insensitive', () => {
  assert.strictEqual(parseContentLength('content-length: 7'), 7);
});

test('parseContentLength returns 0 when absent', () => {
  assert.strictEqual(parseContentLength('POST /mcp HTTP/1.1\r\nHost: x\r\n'), 0);
});
