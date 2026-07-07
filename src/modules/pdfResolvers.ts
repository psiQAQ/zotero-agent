/**
 * PDF resolver management — writes extensions.zotero.findPDFs.resolvers pref;
 * actual download is Zotero-native (addAvailablePDF). Pure functions, no Zotero imports.
 */

export interface Resolver {
  name: string;
  method: "GET";
  url: string;
  mode: "html" | "json";
  selector: string;
  attribute?: string;
  automatic: boolean;
  mcpManaged: true;
}

export const SCIHUB_SELECTOR = '#pdf, embed[type="application/pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], object[data*=".pdf"]';
export const ANNAS_SELECTOR = 'a[href$=".pdf"]';

/** Built-in grey-source templates. automatic defaults to false (manual-only). */
export const RESOLVER_PRESETS: Record<string, Omit<Resolver, "automatic">> = {
  "scihub-se": { name: "Sci-Hub", method: "GET", url: "https://sci-hub.se/{doi}", mode: "html", selector: SCIHUB_SELECTOR, attribute: "src", mcpManaged: true },
  "scihub-st": { name: "Sci-Hub", method: "GET", url: "https://sci-hub.st/{doi}", mode: "html", selector: SCIHUB_SELECTOR, attribute: "src", mcpManaged: true },
  "scihub-ru": { name: "Sci-Hub", method: "GET", url: "https://sci-hub.ru/{doi}", mode: "html", selector: SCIHUB_SELECTOR, attribute: "src", mcpManaged: true },
  "annas-scidb": { name: "Anna's Archive SciDB", method: "GET", url: "https://annas-archive.gl/scidb/{doi}/", mode: "html", selector: ANNAS_SELECTOR, attribute: "href", mcpManaged: true },
};

/** Parse the pref value defensively (string→array; single object→[obj]; junk→[]). */
export function parseResolvers(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : p ? [p] : [];
  } catch {
    return [];
  }
}

/** Merge our managed resolvers with foreign ones — never touch external, dedupe ours by name+url. */
export function mergeResolvers(existing: any[], mine: Resolver[]): any[] {
  const external = existing.filter((r) => !r?.mcpManaged);
  const seen = new Set<string>();
  const deduped = mine.filter((r) => {
    const k = r.name + "\n" + r.url;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return [...deduped, ...external];
}

/** Build a resolver from a preset key or a full custom config; automatic defaults false. */
export function buildResolver(cfg: Partial<Resolver> & { preset?: string; automatic?: boolean }): Resolver {
  const base = cfg.preset ? RESOLVER_PRESETS[cfg.preset] : null;
  if (cfg.preset && !base) throw new Error(`Unknown preset: ${cfg.preset}. Known: ${Object.keys(RESOLVER_PRESETS).join(", ")}`);
  const cleanCfg: any = {};
  for (const [k, v] of Object.entries(cfg)) if (v !== undefined) cleanCfg[k] = v;
  const merged: any = { method: "GET", mode: "html", attribute: "src", ...base, ...cleanCfg, mcpManaged: true };
  delete merged.preset;
  if (!merged.name || !merged.url || !merged.selector) throw new Error("resolver requires name, url, selector");
  if (!merged.url.includes("{doi}")) throw new Error("url must contain {doi} placeholder");
  merged.automatic = cfg.automatic === true; // ponytail: grey sources default OFF — omitted = false
  return merged as Resolver;
}
