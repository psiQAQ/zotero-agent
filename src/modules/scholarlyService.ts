/**
 * Citation-intelligence tools backed by free, keyless public APIs.
 * These SEND LIBRARY DOIs to external services (scite.ai) —
 * stated in each tool description; acceptable for a single-user library.
 *
 * Step 0 verified against refs/zotero-mcp-54yyyu/src/zotero_mcp/scite_client.py:
 *   endpoint  POST https://api.scite.ai/papers
 *   body      bare JSON array of DOIs (not {dois:[...]})
 *   response  {papers: {doiLower: {editorialNotices: [...], ...}}}
 *   batch     ≤500 DOIs; scite lowercases DOI keys in responses
 */

import { resolveScopeItems } from "./importService";

const SCITE_BATCH = 500;

async function collectScopeDois(
  libraryID: number,
  opts: { collectionKey?: string; tag?: string; itemKeys?: string[] },
): Promise<{ dois: Map<string, any>; noDoi: number }> {
  const regular = await resolveScopeItems(libraryID, opts);

  // ponytail: scite lowercases DOI keys in responses — index by lowercase so
  // original-case DOIs still match (see scite_client.py confirmed comment).
  const dois = new Map<string, any>();
  let noDoi = 0;
  for (const it of regular) {
    const doi = String(it.getField("DOI") || "").trim();
    if (doi) dois.set(doi.toLowerCase(), it);
    else noDoi++;
  }
  return { dois, noDoi };
}

export async function checkRetractions(opts: {
  libraryID: number;
  collectionKey?: string;
  tag?: string;
  itemKeys?: string[];
}): Promise<any> {
  const { dois, noDoi } = await collectScopeDois(opts.libraryID, opts);
  if (!dois.size) return { checked: 0, skippedNoDoi: noDoi, flagged: [] };

  const flagged: any[] = [];
  const all = [...dois.keys()];
  for (let i = 0; i < all.length; i += SCITE_BATCH) {
    const batch = all.slice(i, i + SCITE_BATCH);
    let resp: any;
    try {
      resp = await Zotero.HTTP.request("POST", "https://api.scite.ai/papers", {
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(batch), // bare array of DOIs per scite_client.py
        responseType: "json",
        timeout: 30000,
      });
    } catch (e: any) {
      throw new Error(
        `scite.ai unreachable (${e?.message ?? e}) — try again later` +
        (i > 0 ? ` (checked ${i} of ${all.length} DOIs so far, results discarded)` : ""),
      );
    }
    // resp.response is the parsed JSON; .papers is the DOI→paper map
    const papers = resp.response?.papers ?? {};
    for (const [doiLower, paper] of Object.entries<any>(papers)) {
      const notices = paper?.editorialNotices ?? [];
      if (!notices.length) continue;
      const item = dois.get(doiLower);
      flagged.push({
        itemKey: item?.key,
        title: item?.getField?.("title"),
        doi: doiLower,
        notices: notices.map((n: any) => ({ type: n.type ?? n.editorialNoticeType ?? "notice", date: n.date ?? null })),
      });
    }
  }
  return { checked: dois.size, skippedNoDoi: noDoi, flagged };
}

// ---------------------------------------------------------------- OpenAlex

const OPENALEX = "https://api.openalex.org";

async function openAlexGet(path: string): Promise<any> {
  const resp = await Zotero.HTTP.request("GET", `${OPENALEX}${path}`, {
    responseType: "json",
    timeout: 30000,
  });
  return resp.response;
}

function stripDoiPrefix(u: string | null | undefined): string | null {
  if (!u) return null;
  return u.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
}

export async function findRelatedPapers(opts: {
  libraryID: number;
  doi?: string;
  itemKey?: string;
  direction?: "references" | "citations";
  limit?: number;
}): Promise<any> {
  let doi = String(opts.doi || "").trim();
  if (!doi && opts.itemKey) {
    const id = Zotero.Items.getIDFromLibraryAndKey(opts.libraryID, opts.itemKey);
    if (!id) throw new Error(`Item not found: ${opts.itemKey}`);
    doi = String((await Zotero.Items.getAsync(id)).getField("DOI") || "").trim();
  }
  if (!doi) throw new Error("Provide doi, or an itemKey whose item has a DOI");

  let work: any;
  try {
    work = await openAlexGet(`/works/doi:${encodeURIComponent(doi)}`);
  } catch (e: any) {
    throw new Error(`OpenAlex lookup failed for ${doi} (${e?.message ?? e}) — try again later`);
  }

  const limit = Math.min(opts.limit ?? 20, 50);
  const direction = opts.direction ?? "citations";
  let related: any[] = [];
  if (direction === "references") {
    const refIds: string[] = (work.referenced_works ?? [])
      .slice(0, limit)
      .map((u: string) => u.split("/").pop());
    if (refIds.length) {
      const page = await openAlexGet(`/works?filter=openalex_id:${refIds.join("|")}&per-page=${limit}`);
      related = page.results ?? [];
    }
  } else {
    const workId = String(work.id).split("/").pop();
    const page = await openAlexGet(`/works?filter=cites:${workId}&sort=cited_by_count:desc&per-page=${limit}`);
    related = page.results ?? [];
  }

  // In-library annotation by DOI — the discover→import loop hinges on this flag.
  const libraryDois = new Set<string>();
  const ids = await Zotero.Items.getAllIDs(opts.libraryID);
  for (const it of await Zotero.Items.getAsync(ids)) {
    if (!it.isRegularItem()) continue;
    const d = String(it.getField("DOI") || "").trim().toLowerCase();
    if (d) libraryDois.add(d);
  }

  return {
    seed: { doi, title: work.title ?? work.display_name, openalexId: work.id },
    direction,
    results: related.map((w: any) => {
      const wDoi = stripDoiPrefix(w.doi);
      return {
        title: w.title ?? w.display_name,
        year: w.publication_year,
        doi: wDoi,
        citedByCount: w.cited_by_count,
        inLibrary: wDoi ? libraryDois.has(wDoi) : false,
      };
    }),
  };
}
