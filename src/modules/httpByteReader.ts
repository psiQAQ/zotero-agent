/**
 * Pure helpers for the hand-written HTTP read layer (httpServer.ts).
 * Kept dependency-free so they can be unit-tested under plain Node.
 */

/**
 * Find the end of the HTTP header block (index AFTER the terminating
 * \r\n\r\n) in a byte sequence, or -1 if the terminator is not present.
 * Returns on the FIRST match, so cost is O(index-of-terminator), not O(n).
 */
export function findHeaderEnd(bytes: Uint8Array): number {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return i + 4;
    }
  }
  return -1;
}

/** Parse Content-Length from a decoded header block; 0 when absent. */
export function parseContentLength(headerText: string): number {
  const m = headerText.match(/Content-Length:\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}
