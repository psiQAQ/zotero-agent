/**
 * Pure helpers for the MCP endpoint's pre-shared-key (PSK) auth guard.
 * No Zotero/Gecko imports — unit-testable under plain Node.
 */

/** Extract the token from an `Authorization: Bearer <token>` header line in a raw HTTP request. */
export function extractBearerToken(requestText: string): string | null {
  const m = requestText.match(/^Authorization:[ \t]*Bearer[ \t]+(\S+)/im);
  return m ? m[1] : null;
}

/** Length-checked constant-time string compare (defense-in-depth over loopback). */
export function tokensMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 32-byte random token, base64url without padding. `crypto`/`btoa` are globals in Gecko chrome and Node 16+. */
export function generateAuthToken(): string {
  const bytes = new Uint8Array(32);
  (globalThis as any).crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return (globalThis as any)
    .btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Extract the Origin header from a raw HTTP request, or null when absent. */
export function extractOriginHeader(requestText: string): string | null {
  const m = requestText.match(/^Origin:[ \t]*(\S+)/im);
  return m ? m[1] : null;
}

/**
 * MCP spec requires HTTP transports to validate Origin (DNS-rebinding defense).
 * No header (curl / native MCP clients) passes; browser origins must be loopback.
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (origin === null) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}
