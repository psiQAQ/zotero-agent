/**
 * PAC-based proxy for grey-source downloads only. Pure helpers; the caller
 * applies via network.proxy.* prefs. No Zotero imports.
 */

const GREY_HOST_PATTERNS = '"*sci-hub*") || shExpMatch(host, "*annas-archive*"';

/**
 * Build a data: URL PAC that routes ONLY sci-hub/annas-archive through
 * host:port, everything else DIRECT.
 */
export function buildProxyPacDataUrl(host: string, port: number | string): string {
  const h = String(host || "localhost").trim();
  const p = String(port || 7890).trim();
  const pac =
    `function FindProxyForURL(url, host) { ` +
    `if (shExpMatch(host, ${GREY_HOST_PATTERNS})) ` +
    `return "PROXY ${h}:${p}; SOCKS5 ${h}:${p}"; ` +
    `return "DIRECT"; }`;
  return "data:text/plain," + encodeURIComponent(pac);
}

/** Whether the proxy host is loopback (Gecko needs allow_hijacking_localhost for these). */
export function isLocalhostHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(String(host || "").trim());
}
