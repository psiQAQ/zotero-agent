/** Pure protocol helpers — no Zotero imports, unit-testable under Node. */

/** Streamable HTTP protocol versions this server implements, oldest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;

export const LATEST_PROTOCOL_VERSION =
  SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];

/** Echo a known client version, otherwise answer with the latest we support (MCP spec). */
export function negotiateProtocolVersion(clientVersion: unknown): string {
  return typeof clientVersion === "string" &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(clientVersion)
    ? clientVersion
    : LATEST_PROTOCOL_VERSION;
}
