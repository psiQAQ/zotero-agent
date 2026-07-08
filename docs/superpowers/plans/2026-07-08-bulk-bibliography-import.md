# Bulk Bibliography Import (BibTeX / RIS / CSL-JSON) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新工具 `import_bibliography`：吃一段 BibTeX / RIS / CSL-JSON 文本（或本地文件路径），批量导入条目到指定集合，带幂等查重（已存在则跳过）与 dry-run 预览。

**Architecture:** 核心走 Zotero 进程内自带的 translation 架构——`Zotero.Translate.Import` 会自动识别格式（BibTeX/RIS/CSL-JSON 的 import translators 是 Zotero 内置的），无需自己写 parser。dry-run 的关键技术点：`translate({ libraryID: false })` 返回解析出的 item JSON 数组而**不写库**（Zotero translation 架构的公开行为），拿它做预览与查重比对。查重复用 `import_by_identifier` 已有的幂等思路（`importService.ts:47` 的 skip 逻辑）：DOI 精确匹配优先，无 DOI 用标题相似度（`titleSimilarity.ts` 既有函数）。

**Tech Stack:** TypeScript、`Zotero.Translate.Import`、既有 `importService.ts` / `titleSimilarity.ts`。

**Non-goals:** 不做 URL 抓取导入（那是 web translator 的领域）；不做附件下载（导入后可另跑 `find_missing_pdfs`）。

---

### Task 1: 侦察 translation API 的确切行为

- [ ] **Step 1: 真机验证 Import translator 的 dry-run 路径**

经 `run_javascript` 跑（3 条 BibTeX 样例）：

```js
const bib = `@article{a1, title={Sample One}, author={Doe, John}, year={2024}, doi={10.1234/s1}}
@inproceedings{a2, title={Sample Two}, author={Roe, Jane}, year={2023}}`;
const tr = new Zotero.Translate.Import();
tr.setString(bib);
const translators = await tr.getTranslators();
if (!translators.length) return { error: "no translator matched" };
tr.setTranslator(translators[0]);
const items = await tr.translate({ libraryID: false });  // 关键：false = 不写库
return { translator: translators[0].label, count: items.length, first: items[0] };
```

Expected: `translator: "BibTeX"`, `count: 2`，`first` 含 title/creators/DOI 字段。**记录返回 item JSON 的字段形状**（后续查重与写库都依赖它）。同法验证 RIS 与 CSL-JSON 各一小段。

- [ ] **Step 2: 验证真写路径**

同上但 `translate({ libraryID: Zotero.Libraries.userLibraryID, collections: [<某测试集合 id>] })`，确认条目落库落集合；测完把测试条目移入回收站。

- [ ] **Step 3: 把两步确认的行为差异记进 commit message 或本文件，Commit**

```bash
git add docs/superpowers/plans/2026-07-08-bulk-bibliography-import.md
git commit -m "docs: record Zotero.Translate.Import behavior probe results"
```

---

### Task 2: 幂等查重纯函数 + 单测

**Files:**
- Modify: `src/modules/importService.ts`
- Test: `test/importDedup.test.cjs`

- [ ] **Step 1: 写失败单测**

```js
// test/importDedup.test.cjs（加载方式照抄 test/metadataMerge.test.cjs 约定）
const assert = require("node:assert");
const { classifyIncoming } = require(/* 按现有约定 */);

const existing = [
  { key: "K1", doi: "10.1234/s1", title: "Sample One" },
  { key: "K2", doi: "", title: "An Existing Paper About Gaze" },
];
// DOI 精确命中 → skip
assert.deepStrictEqual(
  classifyIncoming({ doi: "10.1234/S1", title: "whatever" }, existing),
  { action: "skip", reason: "doi-match", existingKey: "K1" },
);
// 无 DOI、标题高相似 → skip（阈值复用 find_doi 的 0.86）
assert.strictEqual(classifyIncoming({ doi: "", title: "An Existing Paper about Gaze" }, existing).action, "skip");
// 全新 → import
assert.strictEqual(classifyIncoming({ doi: "10.9/new", title: "Brand New Work" }, existing).action, "import");
console.log("importDedup: ok");
```

- [ ] **Step 2: 跑测试确认失败** → `npm run test:unit` FAIL

- [ ] **Step 3: 实现 classifyIncoming（放 importService.ts；标题相似度 import 自 titleSimilarity.ts 的既有导出——先打开该文件确认函数名与签名再引用）**

```ts
export interface ExistingRef { key: string; doi: string; title: string; }
export function classifyIncoming(
  incoming: { doi: string; title: string },
  existing: ExistingRef[],
): { action: "skip" | "import"; reason?: string; existingKey?: string } {
  const doi = (incoming.doi || "").trim().toLowerCase();
  if (doi) {
    const hit = existing.find(e => e.doi.trim().toLowerCase() === doi);
    if (hit) return { action: "skip", reason: "doi-match", existingKey: hit.key };
  }
  const best = existing
    .map(e => ({ e, s: titleSimilarity(incoming.title, e.title) }))
    .sort((a, b) => b.s - a.s)[0];
  if (best && best.s >= 0.86) return { action: "skip", reason: "title-match", existingKey: best.e.key };
  return { action: "import" };
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/importService.ts test/importDedup.test.cjs
git commit -m "feat: incoming-item dedup classifier for bulk import"
```

---

### Task 3: importBibliography 服务函数

**Files:**
- Modify: `src/modules/importService.ts`

- [ ] **Step 1: 实现（骨架，Task 1 探明的字段形状代入）**

```ts
export async function importBibliography(opts: {
  content?: string;          // 二选一：文本
  filePath?: string;         // 二选一：本地文件（IOUtils.readUTF8）
  collectionKey?: string;
  confirm: boolean;          // false = dry-run
  libraryID: number;
}): Promise<any> {
  const text = opts.content ?? (await IOUtils.readUTF8(opts.filePath!));
  const tr = new Zotero.Translate.Import();
  tr.setString(text);
  const translators = await tr.getTranslators();
  if (!translators.length) return { error: "unrecognized format", hint: "Supported: BibTeX / RIS / CSL-JSON" };
  tr.setTranslator(translators[0]);
  const parsed = await tr.translate({ libraryID: false });           // 只解析
  const existing = await snapshotExistingRefs(opts.libraryID);       // {key,doi,title}[]，全库 regular items 一次拉取
  const plan = parsed.map((p: any) => ({
    title: p.title, doi: p.DOI || "",
    ...classifyIncoming({ doi: p.DOI || "", title: p.title || "" }, existing),
  }));
  const toImport = plan.filter((p: any) => p.action === "import");
  if (!opts.confirm) return { dryRun: true, format: translators[0].label, parsed: parsed.length, willImport: toImport.length, willSkip: plan.length - toImport.length, plan };
  // 真写：重新 translate 到真实 libraryID + collection（对 skip 项：Zotero.Translate 不支持部分导入，
  // Task 1 若证实如此，则改为「全量导入到临时状态再删 skip 项」或「把 toImport 的 JSON 经 CSL-JSON translator 再导」
  // ——以侦察结果选定其一，并在此步注释记录决策）
  ...
  // 写后回读：统计实际新增 keys，返回 {imported: keys[], skipped: [...]}
}
```

**部分导入的实现决策**是本任务唯一硬点：优先尝试「把 `toImport` 子集序列化为 CSL-JSON 字符串 → 再走一次 Import translator 真写」（干净、无删除操作）；若 CSL-JSON 往返丢字段严重（Task 1 可验），退化为全量导入后移 skip 项进回收站（`deleted=true`，非 eraseTx）。

- [ ] **Step 2: build** → `npm run build` 零错误

- [ ] **Step 3: Commit**

```bash
git add src/modules/importService.ts
git commit -m "feat: importBibliography service (parse, dedup-plan, confirm-write)"
```

---

### Task 4: 工具 schema + handler + 真机验证

**Files:**
- Modify: `src/modules/streamableMCPServer.ts`

- [ ] **Step 1: schema**

```ts
{
  name: 'import_bibliography',
  description: 'Bulk-import references from BibTeX / RIS / CSL-JSON (pasted text or a local file path). Format auto-detected via Zotero import translators. Idempotent: items already in the library (DOI match, or title similarity ≥0.86) are skipped. Dry-run by default — returns a per-entry plan (import/skip + reason); confirm:true performs the import (requires write.enabled). Follow up with find_missing_pdfs to fetch PDFs.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Bibliography text (BibTeX / RIS / CSL-JSON). Mutually exclusive with filePath.' },
      filePath: { type: 'string', description: 'Absolute path to a .bib / .ris / .json file on the Zotero machine.' },
      collectionKey: { type: 'string', description: 'Target collection for imported items' },
      confirm: { type: 'boolean', description: 'false (default) = dry-run plan; true = import' },
      libraryID: { type: 'number' },
    },
  },
},
```

- [ ] **Step 2: handler：write.enabled 门禁（confirm 分支）照抄 `case 'import_by_identifier'`（1614 行附近）开头；参数互斥校验（content XOR filePath）**

- [ ] **Step 3: 部署 + 端到端验证**

`npm run build && node scripts/deploy-live.mjs`。用一段含 3 条目（其中 1 条是库里已有 DOI）的 BibTeX：dry-run 应报 `willImport:2, willSkip:1`；confirm 后回读确认 2 条落库入集合、skip 项未重复；再跑一次同样输入应 `willImport:0`（幂等）。测试条目移入回收站清理。

- [ ] **Step 4: Commit**

```bash
git add src/modules/streamableMCPServer.ts
git commit -m "feat: import_bibliography tool (BibTeX/RIS/CSL-JSON, idempotent, dry-run default)"
```

---

### Task 5: selfTest + 文档收尾

**Files:**
- Modify: `src/modules/selfTest.ts`、`README.md`、`CLAUDE.md`

- [ ] **Step 1: selfTest 场景（dry-run，无网络依赖，最稳的一类场景）**

```ts
await t.scenario("import_bibliography dry-run parses and plans without writing", async () => {
  const bib = "@article{x1, title={SelfTest Sample}, author={Test, A}, year={2024}}";
  const r = await call("tools/call", { name: "import_bibliography", arguments: { content: bib } });
  const body = JSON.parse(r.result.content[0].text);
  if (body.dryRun !== true || body.parsed !== 1) throw new Error(`unexpected: ${JSON.stringify(body)}`);
});
```

- [ ] **Step 2: 全量回归** → deploy + `Zotero.ZoteroAgentSelfTest.run('protocol')` 全 passed

- [ ] **Step 3: README 工具表 + §2 表格（54yyyu TODO 的 BibTeX/CSL import 打勾）+ CLAUDE.md 工具数。Commit**

```bash
git add src/modules/selfTest.ts README.md CLAUDE.md
git commit -m "feat: selfTest + docs for import_bibliography"
```
