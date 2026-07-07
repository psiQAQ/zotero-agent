/**
 * Extract DOI / arXiv identifiers from PDF fulltext.
 * Pure — no Zotero imports; caller supplies the text string.
 */

// g flag required for matchAll; i for case-insensitive DOI suffixes.
const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;

// Handles new-style (YYMM.NNNNN[vN]) and old-style (category[.SUB]/NNNNNNN).
// Full-width colon ： supported in the optional arXiv: prefix.
const ARXIV_RE =
  /\b(?:arxiv\s*(?:id)?\s*[:：]\s*)?((?:[a-z-]+(?:\.[A-Z]{2,3})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)\b/i;

function cleanDoi(d: string): string {
  return d.replace(/[.,;:)]+$/, "");
}

export function extractIdentifiers(
  text: string
): { doi: string | null; arxiv: string | null } {
  const t = String(text || "");

  // DOI: frequency vote — the true DOI recurs in headers/footers;
  // the first hit is often a reference-list DOI (ZotMeta's known weakness).
  const counts = new Map<string, number>();
  for (const m of t.matchAll(DOI_RE)) {
    const d = cleanDoi(m[0]);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let doi: string | null = null,
    best = 0;
  for (const [d, c] of counts) if (c > best) { best = c; doi = d; }

  const am = t.match(ARXIV_RE);
  return { doi, arxiv: am ? am[1] : null };
}
