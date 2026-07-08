/**
 * Bridge to optional companion plugins (jasminum / zotero-format-metadata).
 * Detect → resolve API → call. Missing plugin is a structured result, not an error.
 *
 * Pure helpers (shape gates, rule-id validation) take plain values so the unit
 * suite can load this module in Node. Zotero globals are only touched inside
 * the impure functions, and are declared module-locally (pdfService.ts
 * precedent) so the standalone unit-test tsc compile succeeds.
 */

declare const Zotero: any;
declare const ChromeUtils: any;
declare const Services: any;

export const JASMINUM_ADDON_ID = "jasminum@linxzh.com";
export const LINTER_ADDON_ID = "zotero-format-metadata@northword.cn";

export interface CompanionStatus {
  installed: boolean;
  active?: boolean;
  version?: string;
  plugin: string;
  addonId: string;
  hint?: string;
}

export function missingCompanionResult(plugin: string, addonId: string) {
  return {
    installed: false,
    plugin,
    addonId,
    hint: 'Install it first — see README "Recommended Companion Plugins" (the agent can install it via run_javascript + AddonManager).',
  };
}

export async function detectCompanion(plugin: string, addonId: string): Promise<CompanionStatus> {
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const addon = await AddonManager.getAddonByID(addonId);
  if (!addon) return missingCompanionResult(plugin, addonId);
  return { installed: true, active: !!addon.isActive, version: addon.version, plugin, addonId };
}

// ---------------------------------------------------------------- jasminum

/**
 * Verbatim copy of jasminum v1.1.37 CHINESE_FILENAME_REGEX (src/utils/detect.ts):
 * ≥3 Han chars anywhere in the name + extension pdf/caj/kdh/nh (case-insensitive).
 * (Upstream's second lookahead is redundant but kept for exact parity.)
 */
const CHINESE_FILENAME_REGEX =
  /^(?=(.*?\p{Unified_Ideograph}){3})(?=(.*\p{Unified_Ideograph}){3}).+\.(pdf|caj|kdh|nh)$/iu;

export function isChineseAttachmentFilename(filename: string): boolean {
  return CHINESE_FILENAME_REGEX.test(String(filename ?? ""));
}

/** jasminum's CNKI snapshot marker (detect.ts isChinsesSnapshot). */
export function isCnkiSnapshotTitle(title: string): boolean {
  return String(title ?? "").includes("- 中国知网");
}

export interface JasminumCandidate {
  item: any;
  key: string;
  type: "attachment" | "snapshot";
  label: string;
}

export interface JasminumVerdict {
  eligible: boolean;
  /** present when eligible */
  type?: "attachment" | "snapshot";
  label?: string;
  /** present when ineligible */
  reason?: string;
}

/**
 * Mirror of jasminum's menu gate (menu.ts:18-30): eligible iff
 * isChineseTopAttachment (→ type "attachment") or isChinsesSnapshot (→ "snapshot").
 * Everything else gets an agent-actionable reason.
 */
export function classifyJasminumCandidate(item: any): JasminumVerdict {
  const isAttachment = typeof item.isAttachment === "function" && item.isAttachment();
  const isTopLevel = typeof item.isTopLevelItem === "function" && item.isTopLevelItem();
  const title = String(item.getField?.("title") ?? "");

  if (isAttachment && isTopLevel && isChineseAttachmentFilename(item.attachmentFilename)) {
    return { eligible: true, type: "attachment", label: String(item.attachmentFilename ?? "") };
  }
  const isSnapshot = typeof item.isSnapshotAttachment === "function" && item.isSnapshotAttachment();
  if ((isSnapshot || (isTopLevel && item.itemType === "webpage")) && isCnkiSnapshotTitle(title)) {
    return { eligible: true, type: "snapshot", label: title };
  }

  if (isAttachment && !isTopLevel) {
    return { eligible: false, reason: "attachment already has a parent item — jasminum only scrapes TOP-LEVEL attachments" };
  }
  if (isAttachment) {
    return {
      eligible: false,
      reason: `top-level attachment, but the filename needs ≥3 Chinese characters and extension pdf/caj/kdh/nh (got: ${item.attachmentFilename || "?"})`,
    };
  }
  if (item.itemType === "webpage") {
    return { eligible: false, reason: 'webpage item whose title lacks the "- 中国知网" CNKI marker' };
  }
  if (typeof item.isRegularItem === "function" && item.isRegularItem()) {
    return {
      eligible: false,
      reason: `regular ${item.itemType} item — jasminum scrapes top-level Chinese attachment items (pdf/caj/kdh/nh) or CNKI snapshots, not regular items (use enrich_item_metadata / lint_metadata instead)`,
    };
  }
  return { eligible: false, reason: `not an attachment or webpage item (${item.itemType ?? "unknown type"})` };
}

/**
 * Resolve the tool scope WITHOUT the regular-item filter (jasminum's targets are
 * attachments/webpages, so importService.resolveScopeItems would drop them all),
 * then classify each into eligible/ineligible.
 */
export async function jasminumPlanScrape(
  libraryID: number,
  scope: { itemKeys?: string[]; collectionKey?: string },
): Promise<{ eligible: JasminumCandidate[]; ineligible: Array<{ key: string; reason: string }> }> {
  const items: any[] = [];
  const ineligible: Array<{ key: string; reason: string }> = [];
  if (scope.itemKeys?.length) {
    for (const key of scope.itemKeys) {
      const id = Zotero.Items.getIDFromLibraryAndKey(libraryID, key);
      if (!id) {
        ineligible.push({ key, reason: `item not found in library ${libraryID}` });
        continue;
      }
      items.push(await Zotero.Items.getAsync(id));
    }
  } else if (scope.collectionKey) {
    const cid = Zotero.Collections.getIDFromLibraryAndKey(libraryID, scope.collectionKey);
    if (!cid) throw new Error(`Collection not found: ${scope.collectionKey}`);
    const coll = await Zotero.Collections.getAsync(cid);
    items.push(...coll.getChildItems());
  } else {
    throw new Error("Provide itemKeys or collectionKey — refusing to scan the whole library.");
  }

  const eligible: JasminumCandidate[] = [];
  for (const item of items) {
    const verdict = classifyJasminumCandidate(item);
    if (verdict.eligible) eligible.push({ item, key: item.key, type: verdict.type!, label: verdict.label ?? "" });
    else ineligible.push({ key: item.key, reason: verdict.reason ?? "ineligible" });
  }
  return { eligible, ineligible };
}

const JASMINUM_PER_ITEM_TIMEOUT_MS = 90_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scrape metadata for pre-classified candidates via jasminum's TaskRunner
 * (serial — addTask awaits runTask, so each await = that item finished).
 *
 * Recon addendum hazard: silent=true only presets resultIndex; when a search
 * returns >1 results the task still parks on a user-selection deferred. The
 * watchdog below auto-resumes it with the first result (silent's intent).
 */
export async function jasminumFetchMetadata(candidates: JasminumCandidate[]): Promise<any[]> {
  const runner = Zotero?.Jasminum?.taskRunner;
  if (!runner || typeof runner.createAndAddTask !== "function") {
    throw new Error(
      "jasminum is installed but its taskRunner API is missing — incompatible plugin version (bridge built against v1.1.x; see recon appendix).",
    );
  }
  const results: any[] = [];
  for (const { item, key, type } of candidates) {
    // jasminum de-dupes tasks by md5(item.id) per session: addTask would silently
    // skip a leftover task, so report that instead of pretending to scrape.
    const prior = (runner.tasks ?? []).find((t: any) => t?.item?.id === item.id);
    if (prior) {
      results.push({
        key,
        ok: false,
        skipped: true,
        status: prior.status,
        reason: "jasminum already has a task for this item in this session (it de-dupes by item id) — check its progress window, or restart Zotero to re-scrape",
      });
      continue;
    }

    let settled = false;
    let failure: any = null;
    runner.createAndAddTask(item, type, true).then(
      () => { settled = true; },
      (e: any) => { settled = true; failure = e; },
    );
    const t0 = Date.now();
    while (!settled && Date.now() - t0 < JASMINUM_PER_ITEM_TIMEOUT_MS) {
      await sleep(300);
      try {
        const t = (runner.tasks ?? []).find((x: any) => x?.item?.id === item.id);
        if (t && t.status === "multiple_results" && t.deferred) runner.resumeTask(t.id, 0);
      } catch { /* watchdog is best-effort */ }
    }

    const task = (runner.tasks ?? []).find((x: any) => x?.item?.id === item.id);
    if (!settled) {
      results.push({
        key,
        ok: false,
        status: task?.status ?? "unknown",
        error: `timed out after ${JASMINUM_PER_ITEM_TIMEOUT_MS}ms — the task may still be running; check the jasminum progress window on the Zotero machine`,
      });
      continue;
    }
    if (failure) {
      results.push({ key, ok: false, status: task?.status ?? "unknown", error: failure?.message ?? String(failure) });
      continue;
    }

    const status = task?.status ?? "unknown";
    const entry: any = { key, ok: status === "success", status };
    if (task?.message) entry.taskLog = String(task.message).slice(0, 500);
    // Write-then-verify: read back where the metadata landed. Attachment scrapes
    // reparent the file under a new regular item; top-level webpages are rewritten in place.
    try {
      const fresh = Zotero.Items.get(item.id);
      const parent = fresh?.parentItem;
      if (parent) {
        entry.parentKey = parent.key;
        entry.parentTitle = parent.getField("title");
        entry.parentItemType = parent.itemType;
      } else if (fresh) {
        entry.title = fresh.getField?.("title");
        entry.itemType = fresh.itemType;
      }
    } catch { /* readback is best-effort */ }
    results.push(entry);
  }
  return results;
}

// ---------------------------------------------------------------- zotero-format-metadata (Linter)

/**
 * Rule ids as of v3.3.0 (recon appendix; register array in src/modules/rules/index.ts).
 * Some ids mix camelCase into kebab-case — copied verbatim, do not "normalize".
 */
export const LINT_STANDARD_RULE_IDS = [
  "correct-bookTitle-sentence-case",
  "correct-conference-abbr",
  "correct-creators-case",
  "correct-creators-pinyin",
  "correct-creators-punctuation",
  "correct-date-format",
  "correct-doi-long",
  "correct-edition-numeral",
  "correct-extra-order",
  "correct-filing-date-format",
  "correct-issue-date-format",
  "correct-pages-connector",
  "correct-pages-range",
  "correct-priority-date-format",
  "correct-proceedingsTitle-sentence-case",
  "correct-publication-title-alias",
  "correct-publication-title-case",
  "correct-shortTitle-sentence-case",
  "correct-thesis-type",
  "correct-title-chemical-formula",
  "correct-title-punctuation",
  "correct-title-sentence-case",
  "correct-university-punctuation",
  "correct-volume-numeral",
  "no-article-webpage",
  "no-doi-prefix",
  "no-field-misuse",
  "no-issue-extra-zeros",
  "no-item-duplication",
  "no-journal-preprint",
  "no-pages-extra-zeros",
  "no-title-trailing-dot",
  "no-value-nullish",
  "no-volume-extra-zeros",
  "require-creators",
  "require-doi",
  "require-journal-abbr",
  "require-language",
  "require-short-title",
  "require-university-place",
];

/** Never included in "standard" — must be requested explicitly by id. */
export const LINT_TOOL_RULE_IDS = [
  "tool-clean-extra",
  "tool-creators-ext",
  "tool-csl-helper",
  "tool-get-short-doi",
  "tool-set-language",
  "tool-title-guillemet",
  "tool-update-metadata",
];

/**
 * Validate requested rule ids against the known set (plus runtime-enumerated
 * extras so upstream additions keep working). "standard" is always valid.
 * Unknown ids must be rejected before calling the plugin: its internal
 * `Rules.getByID(id)!` yields undefined and crashes the batch with a TypeError.
 */
export function validateLintRules(
  requested: string[],
  extraKnown: string[] = [],
): { ok: string[]; unknown: string[] } {
  const known = new Set<string>(["standard", ...LINT_STANDARD_RULE_IDS, ...LINT_TOOL_RULE_IDS, ...extraKnown]);
  const ok: string[] = [];
  const unknown: string[] = [];
  for (const id of requested) (known.has(id) ? ok : unknown).push(id);
  return { ok, unknown };
}

/**
 * Enumerate rule ids the installed Linter actually knows, from its pref branch
 * (`rule.<id>` keys; sub-options like `rule.require-journal-abbr.usefull` are
 * skipped). Best-effort: returns [] when the branch is unavailable.
 */
export function enumerateLinterRules(): Array<{ id: string; enabled: boolean }> {
  try {
    const branch = Services.prefs.getBranch("extensions.zotero.formatmetadata.");
    const keys: string[] = branch.getChildList("");
    const out: Array<{ id: string; enabled: boolean }> = [];
    for (const k of keys) {
      if (!k.startsWith("rule.")) continue;
      const id = k.slice("rule.".length);
      if (id.includes(".")) continue;
      let enabled = false;
      try { enabled = branch.getBoolPref(k) === true; } catch { /* non-bool pref */ }
      out.push({ id, enabled });
    }
    return out;
  } catch {
    return [];
  }
}

const LINT_DEFAULT_TIMEOUT_MS = 120_000;
const LINT_MAX_TIMEOUT_MS = 600_000;

/**
 * Run the Linter over items via hooks.onLintInBatch. Recon addendum semantics:
 * the promise resolves when the WHOLE batch completes (runner.add awaits its
 * concurrent queue), but finish() resets runner.stats to zero right before that
 * — so progress is sampled concurrently and the last non-empty snapshot is
 * returned. There is no preview API; rules mutate fields directly.
 */
export async function formatMetadataLint(
  items: any[],
  rules: string[] | undefined,
  opts: { timeoutMs?: number } = {},
): Promise<any> {
  const linter = Zotero?.Linter;
  const hooks = linter?.hooks;
  if (!hooks || typeof hooks.onLintInBatch !== "function") {
    throw new Error(
      "zotero-format-metadata is installed but hooks.onLintInBatch is missing — incompatible plugin version (bridge built against v3.3.x; see recon appendix).",
    );
  }
  const ruleIDs: string[] | string = rules?.length ? rules : "standard";
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || LINT_DEFAULT_TIMEOUT_MS, 1000), LINT_MAX_TIMEOUT_MS);

  const readStats = (): any | null => {
    try {
      const s = linter?.runner?.stats;
      if (!s || typeof s.total !== "number") return null;
      return {
        total: s.total,
        current: s.current,
        pass: s.pass,
        error: s.error,
        records: Array.isArray(s.records)
          ? s.records.slice(0, 50).map((r: any) => ({ level: r.level, message: r.message, title: r.title, ruleID: r.ruleID }))
          : [],
      };
    } catch {
      return null;
    }
  };

  let settled = false;
  let failure: any = null;
  hooks.onLintInBatch(ruleIDs, items).then(
    () => { settled = true; },
    (e: any) => { settled = true; failure = e; },
  );

  let lastStats: any = null;
  const t0 = Date.now();
  while (!settled && Date.now() - t0 < timeoutMs) {
    await sleep(250);
    const s = readStats();
    if (s && (s.total > 0 || s.records.length > 0)) lastStats = s;
  }

  if (!settled) {
    return {
      submitted: true,
      completed: false,
      items: items.length,
      rules: ruleIDs,
      timedOutAfterMs: timeoutMs,
      statsSnapshot: lastStats ?? undefined,
      note: "Lint batch still running in Zotero — some tool-* rules open dialogs on the Zotero machine that block the batch until answered. Re-check progress via run_javascript: Zotero.Linter.runner.stats",
    };
  }
  if (failure) {
    throw new Error(`Linter batch failed: ${failure?.message ?? String(failure)}`);
  }
  return {
    submitted: true,
    completed: true,
    items: items.length,
    rules: ruleIDs,
    statsSnapshot: lastStats ?? undefined,
    note: "statsSnapshot is the last progress observed before the plugin reset its counters (sampled every 250ms) — counts may slightly lag the final state. The Linter has no preview/diff API; changes were applied directly.",
  };
}
