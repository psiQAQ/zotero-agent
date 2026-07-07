/**
 * Field-level merge for enriching an EXISTING item from a canonical record.
 * Pure — operates on plain object snapshots. No Zotero imports.
 * Ported from metadata-hunter merge rules + OpenAlex inverted-index reconstruction.
 */

export const FILL_MISSING_FIELDS = [
  "publicationTitle", "proceedingsTitle", "conferenceName", "publisher",
  "place", "volume", "issue", "pages", "ISSN", "ISBN", "language",
  "url", "series", "seriesTitle", "seriesNumber",
];

/** Rebuild abstract from OpenAlex abstract_inverted_index {word: [positions]}. */
export function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string | null {
  if (!inv) return null;
  const words: string[] = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) words[p] = w;
  const s = words.filter((x) => x != null).join(" ").trim();
  return s || null;
}

/** metadata-hunter rule: replace abstract only if empty OR (<200 chars AND incoming is longer). */
export function shouldReplaceAbstract(existing: string, incoming: string): boolean {
  if (!incoming) return false;
  if (!existing) return true;
  return existing.length < 200 && incoming.length > existing.length;
}

/** metadata-hunter rule: replace creators only if incoming strictly longer AND ≥1 shared surname (or existing <2). */
export function shouldReplaceCreators(existing: any[], incoming: any[]): boolean {
  if (!incoming?.length) return false;
  if ((existing?.length ?? 0) < 2) return true;
  if (incoming.length <= existing.length) return false;
  const surn = (c: any) => String(c.lastName || c.name || "").toLowerCase();
  const exSet = new Set(existing.map(surn));
  return incoming.some((c) => exSet.has(surn(c)));
}

/** date rule: fill when existing has no 4-digit year; upgrade bare year to full date. */
export function shouldUpdateDate(existing: string, incoming: string): boolean {
  if (!incoming) return false;
  if (!/\d{4}/.test(existing || "")) return true;
  return /^\d{4}$/.test(existing) && /\d{4}-\d{2}/.test(incoming);
}

/** Map a CSL-JSON record (from doi.org) to Zotero field names. Pure. */
export function cslToZoteroFields(csl: any): Record<string, any> {
  const f: Record<string, any> = {};
  const ct = csl?.["container-title"];
  if (ct) f.publicationTitle = Array.isArray(ct) ? ct[0] : ct;
  if (csl?.volume) f.volume = String(csl.volume);
  if (csl?.issue) f.issue = String(csl.issue);
  if (csl?.page) f.pages = String(csl.page);
  if (csl?.ISSN) f.ISSN = Array.isArray(csl.ISSN) ? csl.ISSN[0] : csl.ISSN;
  if (csl?.publisher) f.publisher = csl.publisher;
  if (csl?.abstract) f.abstractNote = String(csl.abstract).replace(/<[^>]+>/g, "").trim();
  if (csl?.URL) f.url = csl.URL;
  const dp = csl?.issued?.["date-parts"]?.[0];
  if (Array.isArray(dp) && dp.length) f.date = dp.map((n: any, i: number) => (i === 0 ? String(n) : String(n).padStart(2, "0"))).join("-");
  const authors = Array.isArray(csl?.author) ? csl.author : [];
  if (authors.length) f.creators = authors.map((a: any) => ({ creatorType: "author", lastName: a.family || a.name || "", firstName: a.given || "" }));
  return f;
}

/** Compute the field-level patch (does NOT mutate; caller applies via setField after isValidForType). */
export function computeEnrichPatch(
  existing: Record<string, any>,
  incoming: Record<string, any>,
): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const f of FILL_MISSING_FIELDS) {
    if (!existing[f] && incoming[f]) patch[f] = incoming[f];
  }
  if (incoming.abstractNote && shouldReplaceAbstract(existing.abstractNote || "", incoming.abstractNote)) {
    patch.abstractNote = incoming.abstractNote;
  }
  if (incoming.date && shouldUpdateDate(existing.date || "", incoming.date)) {
    patch.date = incoming.date;
  }
  return patch;
}
