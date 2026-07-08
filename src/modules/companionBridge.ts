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
