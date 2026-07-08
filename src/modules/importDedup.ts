/**
 * Dedup classifier for bulk bibliography import: DOI exact match first,
 * then title similarity against a library snapshot.
 * Pure functions, no Zotero imports — unit-testable (see scripts/unit-test.mjs).
 */

import { titleSimilarity, MATCH_THRESHOLD } from "./titleSimilarity";

export interface ExistingRef {
  key: string;
  doi: string;
  title: string;
}

export function classifyIncoming(
  incoming: { doi: string; title: string },
  existing: ExistingRef[],
): { action: "skip" | "import"; reason?: string; existingKey?: string } {
  const doi = (incoming.doi || "").trim().toLowerCase();
  if (doi) {
    const hit = existing.find((e) => (e.doi || "").trim().toLowerCase() === doi);
    if (hit) return { action: "skip", reason: "doi-match", existingKey: hit.key };
  }
  let best: { e: ExistingRef; s: number } | null = null;
  for (const e of existing) {
    const s = titleSimilarity(incoming.title || "", e.title);
    if (!best || s > best.s) best = { e, s };
  }
  if (best && best.s >= MATCH_THRESHOLD) {
    return { action: "skip", reason: "title-match", existingKey: best.e.key };
  }
  return { action: "import" };
}
