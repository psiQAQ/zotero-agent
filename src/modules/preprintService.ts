/**
 * Preprint detection + published-version lookup (upgrade_preprints tool),
 * plus the DOI-liveness classifier shared with find_doi mode:"repair".
 * Pure decision logic is Zotero-free and node-testable; only
 * findPublishedVersion does HTTP (fetch, runs inside Zotero).
 */

import { titleSimilarity, MATCH_THRESHOLD } from "./titleSimilarity";

export interface ItemFacts {
  itemType: string;
  url: string;
  extra: string;
  DOI: string;
}

const ARXIV_PATTERNS = [
  /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i,
  /^arxiv:(\d{4}\.\d{4,5})(?:v\d+)?$/i,
  /10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i,
];

export function extractArxivId(s: string): string | null {
  for (const re of ARXIV_PATTERNS) {
    const m = (s || "").match(re);
    if (m) return m[1];
  }
  return null;
}

export function isPreprintCandidate(f: ItemFacts): boolean {
  if (f.itemType === "preprint") return true;
  return !!(extractArxivId(f.DOI) || extractArxivId(f.url) || extractArxivId(f.extra));
}

// ------------------------------------------- OpenAlex published-version lookup

export interface PublishedVersion {
  doi: string;
  venue: string;
  year: string;
  openalexId: string;
}

/**
 * Pick the published version out of an OpenAlex title-search result page.
 * Recon 2026-07-08 (live Zotero fetch): querying by arXiv DOI is a dead end —
 * OpenAlex returns 404 or an isolated preprint work with no pointer to the
 * publisher version (primary_location.version:"submittedVersion",
 * source.type:"repository", no publishedVersion in locations[]). Title search
 * DOES surface the publisher work as a separate result, shaped like:
 *   { doi:"https://doi.org/10.1109/tpami.2024.3393571", publication_year:2024,
 *     primary_location:{ version:"publishedVersion",
 *       source:{ display_name:"IEEE Transactions on ...", type:"journal" } } }
 * Criteria: publishedVersion + non-repository source + non-arXiv DOI +
 * title similarity >= MATCH_THRESHOLD (title.search is fuzzy — guard mismatches).
 */
export function pickPublishedVersion(results: any[], title: string): PublishedVersion | null {
  for (const w of results || []) {
    const loc = w?.primary_location;
    if (loc?.version !== "publishedVersion") continue;
    if (!loc?.source || loc.source.type === "repository") continue;
    const doi = String(w?.doi || "").replace(/^https?:\/\/doi\.org\//i, "");
    if (!doi || /10\.48550\/arxiv/i.test(doi)) continue;
    if (titleSimilarity(title, String(w?.title || "")) < MATCH_THRESHOLD) continue;
    return {
      doi,
      venue: String(loc.source.display_name || ""),
      year: String(w?.publication_year || ""),
      openalexId: String(w?.id || ""),
    };
  }
  return null;
}

/**
 * Find the published (journal/conference) version of a preprint by title
 * search on OpenAlex. arxivId is informational (title drives the search;
 * the arXiv-DOI filter in pickPublishedVersion already excludes self-matches).
 * Returns null when no published version passes the criteria; throws on
 * network failure so callers can distinguish "no version" from "unreachable".
 */
export async function findPublishedVersion(
  title: string,
  arxivId: string,
): Promise<PublishedVersion | null> {
  // Commas/colons are filter-syntax metacharacters in OpenAlex filter values;
  // title.search is fuzzy, so replacing them with spaces is lossless enough.
  const safeTitle = String(title || "").replace(/[,:]/g, " ").replace(/\s+/g, " ").trim();
  if (!safeTitle) return null;
  void arxivId; // kept in the signature for callers' logging/traceability
  const params = new URLSearchParams({
    filter: `title.search:${safeTitle}`,
    "per-page": "5",
    select: "id,doi,title,type,publication_year,primary_location",
  });
  const resp = await fetch(`https://api.openalex.org/works?${params.toString()}`);
  if (!resp.ok) throw new Error(`OpenAlex title search failed: HTTP ${resp.status}`);
  const page: any = await resp.json();
  return pickPublishedVersion(page?.results ?? [], title);
}
