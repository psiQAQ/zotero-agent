/**
 * Title similarity — doi-fix-style fusion scoring (token overlap + Jaccard + Levenshtein)
 * with subtitle heuristics. NFKD diacritic folding added over doi-fix original.
 * Pure functions, no Zotero imports.
 */

export const MATCH_THRESHOLD = 0.86;

export function normalizeTitle(s: string): string {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")    // fold diacritics (doi-fix lacked this)
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")            // strip HTML tags
    .replace(/&[a-z]+;/g, " ")           // strip HTML entities
    .replace(/[^\p{L}\p{N}\s]/gu, " ")   // remove punctuation / special chars
    .replace(/\s+/g, " ")               // collapse whitespace
    .trim();
}

function tokens(s: string): string[] {
  return normalizeTitle(s).split(" ").filter((t) => t.length > 1);
}

// Two-row DP, O(min(m,n)) space. Inputs should be pre-capped by caller.
function levenshtein(a: string, b: string): number {
  if (!a) return b.length;
  if (!b) return a.length;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a]; // s is shorter
  const m = s.length, n = t.length;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let curr = new Array<number>(m + 1);
  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      curr[i] = s[i - 1] === t[j - 1]
        ? prev[i - 1]
        : 1 + Math.min(prev[i - 1], prev[i], curr[i - 1]);
    }
    [prev, curr] = [curr, prev]; // swap rows
  }
  return prev[m];
}

export function titleSimilarity(t1: string, t2: string): number {
  const n1 = normalizeTitle(t1), n2 = normalizeTitle(t2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1;
  const a = tokens(t1), b = tokens(t2);
  const setA = new Set(a), setB = new Set(b);
  // edge: all tokens were single-char — fall back to lev only
  if (!setA.size || !setB.size) {
    return Math.max(0, 1 - levenshtein(n1.slice(0, 300), n2.slice(0, 300)) / Math.max(n1.length, n2.length));
  }
  const common = [...setA].filter((x) => setB.has(x)).length;
  const overlap = common / Math.min(setA.size, setB.size);
  const jaccard = common / new Set([...a, ...b]).size;
  // subtitle / extension heuristic: shorter title fully contained in longer
  if (overlap === 1 && Math.min(setA.size, setB.size) >= 3) {
    // ponytail: >=3 guard — 2-token titles (e.g. "deep learning") fall back to fusion scoring (~0.44–0.57); 3+ tokens needed to score 0.900 so a common 2-word phrase can't auto-match a longer unrelated title
    if (Math.abs(a.length - b.length) <= 2) return Math.max(0.94, jaccard);
    return Math.max(0.9, jaccard);
  }
  const levSim = 1 - levenshtein(n1.slice(0, 300), n2.slice(0, 300)) / Math.max(n1.length, n2.length);
  const prec = common / setA.size, rec = common / setB.size;
  const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
  return Math.max(levSim, f1, jaccard);
}
