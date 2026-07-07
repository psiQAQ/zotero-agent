/**
 * Reciprocal-Rank-Fusion of semantic + keyword result lists (ZotSeek pattern, k=60).
 * Pure functions — no Zotero imports, unit-testable under Node.
 */

const RRF_K = 60;

export function rrfFuse(
  semantic: Array<{ itemKey: string }>,
  keyword: Array<{ itemKey: string }>,
  wSem: number,
  wKey: number,
): Array<{ itemKey: string; score: number; inSemantic: boolean; inKeyword: boolean }> {
  const scores = new Map<string, { score: number; inSemantic: boolean; inKeyword: boolean }>();
  semantic.forEach((r, rank) => {
    const e = scores.get(r.itemKey) ?? { score: 0, inSemantic: false, inKeyword: false };
    e.score += wSem / (RRF_K + rank + 1);
    e.inSemantic = true;
    scores.set(r.itemKey, e);
  });
  keyword.forEach((r, rank) => {
    const e = scores.get(r.itemKey) ?? { score: 0, inSemantic: false, inKeyword: false };
    e.score += wKey / (RRF_K + rank + 1);
    e.inKeyword = true;
    scores.set(r.itemKey, e);
  });
  return [...scores.entries()]
    .map(([itemKey, e]) => ({ itemKey, ...e }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Heuristic query analysis (ZotSeek analyzeQuery): exact-lookup signals boost keyword
 * weight, conceptual signals boost semantic. Weights clamp to [0.2, 0.8].
 */
export function analyzeQuery(q: string): { wSem: number; wKey: number; reason: string } {
  const query = String(q || "").trim();
  let wKey = 0.5;
  const reasons: string[] = [];

  if (/\b(19|20)\d{2}\b/.test(query)) {
    wKey += 0.15;
    reasons.push("year");
  }
  if (/"[^"]+"/.test(query)) {
    wKey += 0.2;
    reasons.push("quoted phrase");
  }
  if (/\b[A-Z]{2,6}\b/.test(query)) {
    wKey += 0.1;
    reasons.push("acronym");
  }
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    wKey += 0.15;
    reasons.push("short query");
  }
  if (words.length <= 3 && /^[A-Z][a-z]+/.test(words[0] ?? "")) {
    wKey += 0.1;
    reasons.push("name-like");
  }

  if (/^(how|what|why|which|when|compare|explain)\b/i.test(query)) {
    wKey -= 0.25;
    reasons.push("question form");
  }
  if (words.length >= 6) {
    wKey -= 0.15;
    reasons.push("long conceptual query");
  }

  wKey = Math.min(0.8, Math.max(0.2, wKey));
  // ponytail: clamp wSem too — 1-0.8 is 0.19999...96 in IEEE 754, not 0.2
  return { wSem: Math.min(0.8, Math.max(0.2, 1 - wKey)), wKey, reason: reasons.join(", ") || "neutral" };
}
