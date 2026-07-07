/** Identifier-based import using Zotero's own translation engine (same path as the UI's "Add Item by Identifier"). */

/** LLMs pass arrays as JSON strings or comma-joined strings; accept all shapes (54yyyu lesson). */
export function normalizeStringList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  const s = String(v).trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    } catch {
      // fall through to comma-split
    }
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

async function findExistingByIdentifier(
  libraryID: number,
  identifier: Record<string, string>,
): Promise<any | null> {
  const s = new Zotero.Search();
  (s as any).libraryID = libraryID;
  if (identifier.DOI) {
    // 'is' is a case-sensitive binary compare and ignores Extra-stored DOIs
    // (thesis/report item types) — contains is LIKE-based, case-insensitive.
    (s as any).addCondition("joinMode", "any", null as any);
    s.addCondition("DOI", "contains", identifier.DOI);
    s.addCondition("extra", "contains", identifier.DOI);
  } else if (identifier.ISBN) {
    s.addCondition("ISBN", "contains", identifier.ISBN);
  } else if (identifier.arXiv) {
    s.addCondition("extra", "contains", identifier.arXiv);
  } else if (identifier.PMID) {
    s.addCondition("extra", "contains", identifier.PMID);
  } else if ((identifier as any).adsBibcode) {
    s.addCondition("extra", "contains", (identifier as any).adsBibcode);
  } else {
    return null;
  }
  const ids = await s.search();
  return ids.length ? await Zotero.Items.getAsync(ids[0]) : null;
}

export async function importByIdentifier(opts: {
  identifier: string;
  libraryID: number;
  collectionKeys?: unknown;
  tags?: unknown;
  if_exists?: "skip" | "duplicate";
  fetch_pdf?: boolean;
}): Promise<any> {
  const found = (Zotero.Utilities as any).extractIdentifiers(String(opts.identifier || ""));
  if (!found.length) throw new Error(`No DOI/ISBN/arXiv/PMID recognized in: ${opts.identifier}`);
  const identifier = found[0];

  // Resolve collections BEFORE any side effect — bad specs must fail early (54yyyu discipline).
  const collectionKeys = normalizeStringList(opts.collectionKeys);
  const collectionIDs: number[] = [];
  for (const key of collectionKeys) {
    const cid = Zotero.Collections.getIDFromLibraryAndKey(opts.libraryID, key);
    if (!cid) throw new Error(`Collection not found in library ${opts.libraryID}: ${key}`);
    collectionIDs.push(cid);
  }

  if ((opts.if_exists ?? "skip") === "skip") {
    const existing = await findExistingByIdentifier(opts.libraryID, identifier);
    if (existing) {
      return {
        skipped: true,
        reason: "already in library",
        itemKey: existing.key,
        title: existing.getField("title"),
      };
    }
  }

  const translate = new Zotero.Translate.Search();
  translate.setIdentifier(identifier);
  const translators = await translate.getTranslators();
  if (!translators.length) throw new Error(`No translator resolves ${JSON.stringify(identifier)}`);
  translate.setTranslator(translators);
  const items: any[] = await translate.translate({
    libraryID: opts.libraryID,
    collections: collectionIDs,
    saveAttachments: false,
  });
  if (!items.length) throw new Error("Translation returned no items");

  const item = items[0];
  const tags = normalizeStringList(opts.tags);
  if (tags.length) {
    for (const tag of tags) item.addTag(tag);
    await item.saveTx();
  }

  let pdf: any = { attempted: false };
  if (opts.fetch_pdf) {
    try {
      const att = await Zotero.Attachments.addAvailablePDF(item);
      pdf = { attempted: true, attached: !!att, attachmentKey: att ? (att as any).key : undefined };
    } catch (e: any) {
      pdf = { attempted: true, attached: false, error: e?.message ?? String(e) };
    }
  }

  // Write-then-verify (repo lesson: never trust saveTx alone).
  const reread = await Zotero.Items.getAsync(item.id);
  return {
    imported: true,
    itemKey: reread.key,
    itemType: Zotero.ItemTypes.getName(reread.itemTypeID),
    title: reread.getField("title"),
    collections: reread.getCollections().length,
    collectionsVerified: collectionIDs.every((id: number) => reread.getCollections().includes(id)),
    tags: reread.getTags().map((t: any) => t.tag),
    pdf,
  };
}

/** Resolve a tool's scope argument to loaded regular items. Shared across scholarly tools. */
export async function resolveScopeItems(
  libraryID: number,
  scope: { collectionKey?: string; tag?: string; itemKeys?: string[] } = {},
): Promise<any[]> {
  let items: any[];
  if (scope.itemKeys?.length) {
    items = [];
    for (const key of scope.itemKeys) {
      const id = Zotero.Items.getIDFromLibraryAndKey(libraryID, key);
      if (id) items.push(await Zotero.Items.getAsync(id));
    }
  } else if (scope.collectionKey) {
    const cid = Zotero.Collections.getIDFromLibraryAndKey(libraryID, scope.collectionKey);
    if (!cid) throw new Error(`Collection not found: ${scope.collectionKey}`);
    const coll = await Zotero.Collections.getAsync(cid);
    items = coll.getChildItems();
  } else {
    const ids = await Zotero.Items.getAllIDs(libraryID);
    items = await Zotero.Items.getAsync(ids);
  }
  let regular = items.filter((it: any) => it.isRegularItem());
  if (scope.tag) regular = regular.filter((it: any) => it.getTags().some((t: any) => t.tag === scope.tag));
  return regular;
}

function hasPdfAttachment(item: any): boolean {
  const attIDs: number[] = item.getAttachments();
  for (const id of attIDs) {
    const att = Zotero.Items.get(id);
    if (att && att.attachmentContentType === "application/pdf") return true;
  }
  return false;
}

export async function findMissingPdfs(opts: {
  libraryID: number;
  collectionKey?: string;
  action?: "report" | "fetch";
  limit?: number;
}): Promise<any> {
  const items = await resolveScopeItems(opts.libraryID, { collectionKey: opts.collectionKey });
  const missing = items.filter((it) => !hasPdfAttachment(it));
  const summary = {
    scope: opts.collectionKey ?? "whole library",
    regularItems: items.length,
    withPdf: items.length - missing.length,
    missingPdf: missing.length,
  };

  if ((opts.action ?? "report") === "report") {
    return {
      ...summary,
      items: missing.slice(0, opts.limit ?? 100).map((it) => ({
        itemKey: it.key,
        title: it.getField("title"),
        doi: it.getField("DOI") || null,
        year: it.getField("date")?.slice(0, 4) || null,
      })),
    };
  }

  // action=fetch — write-gated by the caller.
  const cap = Math.min(opts.limit ?? 5, 50); // ponytail: serial fetch; each OA resolve can take tens of seconds — default low, loop calls for more
  const results: any[] = [];
  for (const it of missing.slice(0, cap)) {
    try {
      const att = await Zotero.Attachments.addAvailablePDF(it);
      results.push({ itemKey: it.key, attached: !!att });
    } catch (e: any) {
      results.push({ itemKey: it.key, attached: false, error: e?.message ?? String(e) });
    }
  }
  return { ...summary, fetched: results.filter((r) => r.attached).length, results };
}
