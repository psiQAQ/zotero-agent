/**
 * Sci-Hub / Anna's Archive source config ↔ findPDFs.resolvers synchronization.
 * Source of truth is scihub.sources (user config); resolvers is the enabled-time projection.
 * Pure functions — no Zotero imports.
 */
import { buildResolver, mergeResolvers, parseResolvers, Resolver, SCIHUB_SELECTOR, ANNAS_SELECTOR } from "./pdfResolvers";

export interface ScihubSource {
  url: string;
  selector?: string;
  attribute?: string;
}

/** Aggregated mirrors from scipdf/sanfy008/scidb/pdferret (9 Sci-Hub + 2 Anna's Archive). */
// https://www.sci-hub.shop/
// Deprecated:
//   { url: "https://sci-hub.se/{doi}" },
//   { url: "https://sci-hub.st/{doi}" },
//   { url: "https://sci-hub.su/{doi}" },

export const DEFAULT_SCIHUB_SOURCES: ScihubSource[] = [
  { url: "https://sci-hub.mk/{doi}" },
  { url: "https://sci-hub.al/{doi}" },
  { url: "https://sci-hub.ee/{doi}" },
  { url: "https://sci-hub.vg/{doi}" },
  { url: "https://sci-hub.in/{doi}" },
  { url: "https://sci-hub.ren/{doi}" },
  { url: "https://sci-hub.ru/{doi}" },
  { url: "https://sci-hub.red/{doi}" },
  { url: "https://sci-hub.box/{doi}" },
  { url: "https://www.tesble.com/{doi}" },
  { url: "https://www.wellesu.com/{doi}" },
  { url: "https://www.pismin.com/{doi}" },
  { url: "https://sci-hub.usualwant.com/{doi}" },
  { url: "https://annas-archive.se/scidb/{doi}/", selector: ANNAS_SELECTOR, attribute: "href" },
  { url: "https://annas-archive.gl/scidb/{doi}/", selector: ANNAS_SELECTOR, attribute: "href" },
];

/** Parse the scihub.sources pref defensively. */
export function parseSources(raw: unknown): ScihubSource[] {
  if (Array.isArray(raw)) return raw.filter((s) => s && typeof s.url === "string");
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((s) => s && typeof s.url === "string") : [];
  } catch {
    return [];
  }
}

/** One source → a full resolver (fills grey-source defaults: automatic:false, mcpManaged:true). */
function sourceToResolver(s: ScihubSource): Resolver {
  const isAnnas = /annas-archive/i.test(s.url);
  return buildResolver({
    name: isAnnas ? "Anna's Archive" : "Sci-Hub",
    url: s.url,
    selector: s.selector ?? (isAnnas ? ANNAS_SELECTOR : SCIHUB_SELECTOR),
    attribute: s.attribute ?? (isAnnas ? "href" : "src"),
    automatic: false,
  });
}

/**
 * Compute the findPDFs.resolvers value: enabled → our sources + external; disabled → external only.
 * Never touches foreign (non-mcpManaged) resolvers.
 */
export function syncScihubResolvers(enabled: boolean, sources: ScihubSource[], existingRaw: unknown): any[] {
  const existing = parseResolvers(existingRaw);
  const mine = enabled ? sources.map(sourceToResolver) : [];
  return mergeResolvers(existing, mine);
}
