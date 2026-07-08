const test = require('node:test');
const assert = require('node:assert');
const {
  missingCompanionResult,
  isChineseAttachmentFilename,
  isCnkiSnapshotTitle,
  validateLintRules,
  LINT_STANDARD_RULE_IDS,
  LINT_TOOL_RULE_IDS,
  JASMINUM_ADDON_ID,
  LINTER_ADDON_ID,
} = require('../.tmp-test/companionBridge.js');

test("missingCompanionResult returns the structured not-installed shape", () => {
  assert.deepStrictEqual(
    missingCompanionResult("jasminum", "jasminum@linxzh.com"),
    {
      installed: false,
      plugin: "jasminum",
      addonId: "jasminum@linxzh.com",
      hint: "Install it first — see README \"Recommended Companion Plugins\" (the agent can install it via run_javascript + AddonManager).",
    },
  );
});

test("addon id constants match the recon appendix", () => {
  assert.equal(JASMINUM_ADDON_ID, "jasminum@linxzh.com");
  assert.equal(LINTER_ADDON_ID, "zotero-format-metadata@northword.cn");
});

test("isChineseAttachmentFilename: ≥3 Han chars + pdf/caj/kdh/nh (jasminum detect.ts parity)", () => {
  assert.equal(isChineseAttachmentFilename("基于深度学习的凝视估计研究.pdf"), true);
  assert.equal(isChineseAttachmentFilename("凝视估计研究.caj"), true);
  assert.equal(isChineseAttachmentFilename("凝视估计_王某某.KDH"), true); // extension case-insensitive
  assert.equal(isChineseAttachmentFilename("学位论文.nh"), true);
  assert.equal(isChineseAttachmentFilename("凝视.pdf"), false); // only 2 Han chars
  assert.equal(isChineseAttachmentFilename("deep learning survey.pdf"), false);
  assert.equal(isChineseAttachmentFilename("凝视估计研究.docx"), false); // wrong extension
  assert.equal(isChineseAttachmentFilename(""), false);
});

test("isCnkiSnapshotTitle: matches jasminum's CNKI marker", () => {
  assert.equal(isCnkiSnapshotTitle("基于视线追踪的人机交互 - 中国知网"), true);
  assert.equal(isCnkiSnapshotTitle("Gaze Estimation Survey"), false);
  assert.equal(isCnkiSnapshotTitle(""), false);
});

test("rule id constants match recon counts (40 standard + 7 tool)", () => {
  assert.equal(LINT_STANDARD_RULE_IDS.length, 40);
  assert.equal(LINT_TOOL_RULE_IDS.length, 7);
  // spot-check camelCase-mixed-kebab ids copied verbatim from upstream
  assert.ok(LINT_STANDARD_RULE_IDS.includes("correct-bookTitle-sentence-case"));
  assert.ok(LINT_STANDARD_RULE_IDS.includes("correct-shortTitle-sentence-case"));
  assert.ok(LINT_TOOL_RULE_IDS.includes("tool-csl-helper"));
});

test("validateLintRules: standard + known ids pass, unknown ids reported", () => {
  assert.deepStrictEqual(validateLintRules(["standard"]), { ok: ["standard"], unknown: [] });
  assert.deepStrictEqual(
    validateLintRules(["correct-title-sentence-case", "tool-clean-extra"]),
    { ok: ["correct-title-sentence-case", "tool-clean-extra"], unknown: [] },
  );
  assert.deepStrictEqual(validateLintRules(["titleCase"]).unknown, ["titleCase"]);
  // ids enumerated at runtime (future upstream additions) are accepted via extraKnown
  assert.deepStrictEqual(validateLintRules(["future-rule"], ["future-rule"]).unknown, []);
  assert.deepStrictEqual(validateLintRules([]), { ok: [], unknown: [] });
});
