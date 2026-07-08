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
