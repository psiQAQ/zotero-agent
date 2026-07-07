/**
 * Duplicate detection + merge on Zotero's native engines. Merge semantics follow
 * 54yyyu: dry-run by default, confirm to execute, losers go to trash
 * (Items.merge does this), never hard-delete.
 */

import { resolveScopeItems } from "./importService";

export async function findDuplicates(libraryID: number, limit = 50): Promise<any> {
  const dup = new (Zotero as any).Duplicates(libraryID);
  const search = await dup.getSearchObject();
  const ids: number[] = await search.search();
  if (!ids.length) return { totalGroups: 0, returned: 0, groups: [] };

  // Group via Duplicates' own set API (verified present on the live target).
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const set: number[] = dup.getSetItemsByItemID(id) || [];
    const group = set.length ? set : [id];
    group.forEach((x) => seen.add(x));
    if (group.length > 1) groups.push(group);
  }

  const out: any[] = [];
  for (const group of groups.slice(0, limit)) {
    const items: any[] = await (Zotero.Items as any).getAsync(group);
    out.push(
      items.map((it: any) => ({
        itemKey: it.key,
        title: it.getField("title"),
        year: it.getField("date")?.slice(0, 4) || null,
        doi: it.getField("DOI") || null,
        dateAdded: it.dateAdded,
        attachments: it.getAttachments().length,
      })),
    );
  }
  return {
    totalGroups: groups.length,
    returned: out.length,
    groups: out,
    nextStep: "Merge one group with merge_duplicates {masterKey, otherKeys} — dry-run first, then confirm: true.",
  };
}

export async function mergeDuplicates(opts: {
  libraryID: number;
  masterKey: string;
  otherKeys: string[];
  confirm?: boolean;
}): Promise<any> {
  const masterId = Zotero.Items.getIDFromLibraryAndKey(opts.libraryID, opts.masterKey);
  if (!masterId) throw new Error(`Master item not found: ${opts.masterKey}`);
  const master: any = await Zotero.Items.getAsync(masterId);
  const others: any[] = [];
  for (const key of opts.otherKeys) {
    const id = Zotero.Items.getIDFromLibraryAndKey(opts.libraryID, key);
    if (!id) throw new Error(`Item not found: ${key} — aborting before any merge`);
    others.push(await Zotero.Items.getAsync(id));
  }
  if (!others.length) throw new Error("otherKeys is empty");

  const plan = {
    master: { itemKey: master.key, title: master.getField("title") },
    merging: others.map((o: any) => ({ itemKey: o.key, title: o.getField("title") })),
    note: "Merged items keep master's metadata; losers move to trash (recoverable).",
  };
  if (!opts.confirm) return { dryRun: true, ...plan, executeWith: "same call + confirm: true" };

  await (Zotero as any).Items.merge(master, others);

  // Write-then-verify: losers must be in trash, master must survive.
  const masterAfter: any = await Zotero.Items.getAsync(masterId);
  const losersInTrash: any[] = [];
  for (const o of others) {
    const after: any = await Zotero.Items.getAsync(o.id).catch(() => null);
    losersInTrash.push({ itemKey: o.key, deleted: !!after?.deleted });
  }
  return { merged: true, masterKey: masterAfter.key, losersInTrash, ...plan };
}

export async function batchUpdateTags(opts: {
  libraryID: number;
  scope?: { collectionKey?: string; tag?: string };
  add?: string[];
  remove?: string[];
  rename?: { from: string; to: string };
  confirm?: boolean;
}): Promise<any> {
  const add = opts.add ?? [];
  const remove = opts.remove ?? [];
  const rename = opts.rename;
  if (!add.length && !remove.length && !rename) {
    throw new Error("Nothing to do: provide add, remove, and/or rename");
  }
  if (rename && (!rename.from || !rename.to)) {
    throw new Error("rename requires both from and to");
  }

  // rename is library-global and needs no scope; add/remove need one to avoid
  // accidental whole-library writes.
  if ((add.length || remove.length) && !opts.scope?.collectionKey && !opts.scope?.tag) {
    throw new Error(
      "add/remove require a scope (collectionKey or tag) — whole-library tagging must be explicit via scope.tag",
    );
  }

  let items: any[] = [];
  if (add.length || remove.length) {
    items = await resolveScopeItems(opts.libraryID, opts.scope ?? {});
  }

  let renameAffects: number | null = null;
  if (rename) {
    const s = new Zotero.Search();
    (s as any).libraryID = opts.libraryID;
    s.addCondition("tag", "is", rename.from);
    renameAffects = (await s.search()).length;
  }

  const plan = {
    scope: opts.scope ?? "library-wide (rename only)",
    matchedItems: items.length,
    renameAffects,
    add,
    remove,
    rename: rename ?? null,
  };
  if (!opts.confirm) return { dryRun: true, ...plan, executeWith: "same call + confirm: true" };

  const counters: Record<string, number> = {};
  for (const item of items) {
    let dirty = false;
    for (const tag of add) {
      if (!item.hasTag(tag)) {
        item.addTag(tag);
        counters[`+${tag}`] = (counters[`+${tag}`] ?? 0) + 1;
        dirty = true;
      }
    }
    for (const tag of remove) {
      if (item.hasTag(tag)) {
        item.removeTag(tag);
        counters[`-${tag}`] = (counters[`-${tag}`] ?? 0) + 1;
        dirty = true;
      }
    }
    if (dirty) await item.saveTx();
  }

  let renamed: any = null;
  if (rename) {
    // Zotero.Tags.rename keeps item associations and auto-merges same-name tags —
    // never implement rename as remove+add (repo CLAUDE.md lesson).
    await (Zotero as any).Tags.rename(opts.libraryID, rename.from, rename.to);
    renamed = { from: rename.from, to: rename.to };
  }

  return { executed: true, ...plan, counters, renamed };
}
