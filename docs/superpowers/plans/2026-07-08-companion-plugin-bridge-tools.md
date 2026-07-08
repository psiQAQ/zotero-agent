# Companion Plugin Bridge Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 jasminum（中文元数据抓取）与 zotero-format-metadata（格式规范化）从 `run_javascript` 裸调升级为两个类型化、dry-run 安全的 MCP 工具：`fetch_chinese_metadata` 与 `lint_metadata`。

**Architecture:** 新增 `src/modules/companionBridge.ts` 承载"探测插件 → 解析其 API 面 → 安全调用"三层；`streamableMCPServer.ts` 只加工具 schema 与瘦 case handler。插件未安装/未启用时返回结构化 `{installed:false, hint}` 而非抛错，让 agent 能引导用户安装（README 已有安装 prompt 可引用）。

**Tech Stack:** TypeScript、Zotero AddonManager、目标插件挂在 `Zotero` 命名空间上的运行时 API（Task 1 侦察后固化）。

**风险前置：** 两个插件的内部 API 均未验证（README 措辞是 "if exposed"），且随上游版本可能变化。Task 1 的侦察产出是后续任务的输入——**先跑 Task 1，把探明的真实函数签名回填到本文件附录，再动工 Task 2+**。

---

### Task 1: 侦察两插件的运行时 API 面

**Files:**
- Modify: 本 plan 文件附录（回填侦察结果）

- [x] **Step 1: 确认目标 Zotero 已安装两插件**

通过 zotero MCP 的 `run_javascript` 执行：

```js
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const all = await AddonManager.getAllAddons();
return all.filter(a => /jasminum|format-metadata|linter/i.test(a.id + a.name))
  .map(a => ({ id: a.id, name: a.name, version: a.version, active: a.isActive }));
```

预期：返回两条记录，记下**确切 addon id**（如 `jasminum@linxzh.com`、`zotero-format-metadata@northword.cn`——以实际返回为准）。若缺失，先按 README「Let the agent install them for you」小节安装。

- [x] **Step 2: 探测 jasminum 暴露的命名空间与函数**

```js
const keys = Object.keys(Zotero).filter(k => /jasminum/i.test(k));
const ns = keys.length ? Zotero[keys[0]] : null;
return {
  namespaces: keys,
  api: ns ? Object.getOwnPropertyNames(ns).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(ns) ?? {})) : null,
};
```

若 `Zotero` 上无挂载，改查全局：`Object.keys(globalThis).filter(k => /jasminum/i.test(k))`；再不行读其源码（`refs/metadata-enrich/jasminum` submodule，`git submodule update --init refs/metadata-enrich/jasminum` 后看 `src/` 里 hooks 如何注册菜单命令——菜单命令处理函数即可编程调用的入口）。

- [x] **Step 3: 同法探测 zotero-format-metadata**

关注两点：(a) 有没有"对 items 数组跑全部/指定 lint 规则"的入口；(b) 规则清单能否枚举（用于工具的 `rules` 参数校验）。源码参考 `refs/metadata-enrich/zotero-format-metadata`。

- [ ] **Step 4: 用 1 个真实条目做最小调用验证**

选一个中文文献条目（或造一个 title 全小写的英文条目），分别真实调用一次抓取/lint，确认：调用方式、是否异步、改动落在哪些字段、失败时抛什么。

- [x] **Step 5: 回填附录**

把探明的 addon id、命名空间、函数签名、调用示例写进本文件末尾「附录：侦察结果」，commit：

```bash
git add docs/superpowers/plans/2026-07-08-companion-plugin-bridge-tools.md
git commit -m "docs: record companion plugin API reconnaissance results"
```

---

### Task 2: companionBridge 模块 + 单测

**Files:**
- Create: `src/modules/companionBridge.ts`
- Test: `test/companionBridge.test.cjs`

- [ ] **Step 1: 写失败单测（纯函数部分：缺插件时的结构化返回）**

```js
// test/companionBridge.test.cjs
const assert = require("node:assert");
const { missingCompanionResult } = require("../.scaffold/build/addon/content/scripts/__test__/companionBridge.cjs"); // 按现有 test/*.cjs 的加载约定调整——见 test/metadataMerge.test.cjs 头部怎么引模块，保持一致

assert.deepStrictEqual(
  missingCompanionResult("jasminum", "jasminum@linxzh.com"),
  {
    installed: false,
    plugin: "jasminum",
    addonId: "jasminum@linxzh.com",
    hint: "Install it first — see README \"Recommended Companion Plugins\" (the agent can install it via run_javascript + AddonManager).",
  },
);
console.log("companionBridge: ok");
```

> 注意：先打开 `test/metadataMerge.test.cjs` 看本仓库单测怎么 require 被测源码（现有约定优先），照抄其加载方式；上面的 require 路径仅为占位示意，**以现有测试的实际约定为准**。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit`
Expected: FAIL（companionBridge 模块不存在）

- [ ] **Step 3: 实现 companionBridge.ts**

```ts
// src/modules/companionBridge.ts
// Bridge to optional companion plugins (jasminum / zotero-format-metadata).
// Detect → resolve API → call. Missing plugin is a structured result, not an error.

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

// Task 1 侦察后在此补两个薄封装（签名以附录为准）：
// export async function jasminumFetchMetadata(items: Zotero.Item[]): Promise<...>
// export async function formatMetadataLint(items: Zotero.Item[], rules?: string[]): Promise<...>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit`
Expected: PASS（新增 companionBridge 断言全绿）

- [ ] **Step 5: Commit**

```bash
git add src/modules/companionBridge.ts test/companionBridge.test.cjs
git commit -m "feat: companion plugin bridge module (detect + structured missing result)"
```

---

### Task 3: `fetch_chinese_metadata` 工具

**Files:**
- Modify: `src/modules/streamableMCPServer.ts`（tools 数组 + case handler；工具定义区参考现有 `run_javascript` 定义的写法，handler 区参考 `case 'enrich_item_metadata'` 的 scope/dry-run 形状）
- Modify: `src/modules/companionBridge.ts`

- [ ] **Step 1: 加工具 schema（tools 数组）**

```ts
{
  name: 'fetch_chinese_metadata',
  description: 'Scrape Chinese-database metadata (CNKI / Wanfang / VIP) for items via the jasminum companion plugin. Complements enrich_item_metadata (which covers Western sources). Dry-run by default: reports which items would be scraped; confirm:true performs the scrape (requires write.enabled). Returns {installed:false, hint} if jasminum is not installed.',
  inputSchema: {
    type: 'object',
    properties: {
      itemKeys: { type: 'array', items: { type: 'string' }, description: 'Item keys to scrape (Chinese-language items with incomplete fields)' },
      collectionKey: { type: 'string', description: 'Alternative scope: all top-level items in this collection' },
      confirm: { type: 'boolean', description: 'false (default) = dry-run preview; true = actually scrape and write fields' },
      libraryID: { type: 'number', description: 'Library ID (defaults to user library)' },
    },
  },
},
```

- [ ] **Step 2: 写 handler（case 分支）**

```ts
case 'fetch_chinese_metadata': {
  const status = await detectCompanion('jasminum', JASMINUM_ADDON_ID); // 常量值来自 Task 1 附录
  if (!status.installed) { result = status; break; }
  const scopeItems = await resolveScopeItems(/* 复用 importService.resolveScopeItems 的签名，见其 JSDoc */);
  if (args?.confirm !== true) {
    result = { dryRun: true, wouldScrape: scopeItems.map(i => ({ key: i.key, title: i.getField('title') })) };
    break;
  }
  const writeOn = Zotero.Prefs.get('extensions.zotero.zotero-agent.write.enabled', true);
  if (writeOn !== true) throw new Error('Write operations are disabled. Enable "Write Operations" in the plugin preferences.');
  result = await jasminumFetchMetadata(scopeItems); // per-item {key, ok, fieldsUpdated | error}，写后回读
  break;
}
```

- [ ] **Step 3: build 验证类型**

Run: `npm run build`
Expected: 编译零错误，xpi 生成

- [ ] **Step 4: 部署到真机验证**

Run: `node scripts/deploy-live.mjs`，然后经 MCP 调 `fetch_chinese_metadata`（先不带 confirm）对 1 个中文条目验证 dry-run 输出；再 `confirm:true` 验证字段真实回填并回读。

- [ ] **Step 5: Commit**

```bash
git add src/modules/streamableMCPServer.ts src/modules/companionBridge.ts
git commit -m "feat: fetch_chinese_metadata tool bridging jasminum"
```

---

### Task 4: `lint_metadata` 工具

**Files:**
- Modify: `src/modules/streamableMCPServer.ts`
- Modify: `src/modules/companionBridge.ts`

- [ ] **Step 1: 加工具 schema**

```ts
{
  name: 'lint_metadata',
  description: 'Run zotero-format-metadata (Linter) rules over items: title case, date/pages normalization, journal abbreviations (LTWA), Chinese name splitting, etc. Natural follow-up to enrich_item_metadata (fill fields → normalize format). Dry-run by default; confirm:true applies (requires write.enabled). Returns {installed:false, hint} if the Linter plugin is not installed.',
  inputSchema: {
    type: 'object',
    properties: {
      itemKeys: { type: 'array', items: { type: 'string' } },
      collectionKey: { type: 'string' },
      rules: { type: 'array', items: { type: 'string' }, description: 'Rule ids to run; omit = plugin default set. (Enumerable set recorded in the recon appendix.)' },
      confirm: { type: 'boolean', description: 'false (default) = dry-run preview; true = apply' },
      libraryID: { type: 'number' },
    },
  },
},
```

- [ ] **Step 2: handler + companionBridge 封装**

与 Task 3 同形：detect → scope → dry-run 预览（列出将跑的规则与条目数）→ confirm 才调 `formatMetadataLint(items, rules)`。
**dry-run 语义注意**：若插件只提供"就地修改"入口而无 preview API（以附录为准），dry-run 就退化为"报告将处理的条目与规则清单"，并在 description 里写明 preview 不含逐字段 diff——诚实优于伪造。

- [ ] **Step 3: build + 部署 + 真机验证**

同 Task 3 Step 3-4：对一个 title 全小写的测试条目跑 `rules:["titleCase"]`（规则 id 以附录为准），确认字段修正。

- [ ] **Step 4: Commit**

```bash
git add src/modules/streamableMCPServer.ts src/modules/companionBridge.ts
git commit -m "feat: lint_metadata tool bridging zotero-format-metadata"
```

---

### Task 5: selfTest 场景 + 文档收尾

**Files:**
- Modify: `src/modules/selfTest.ts`
- Modify: `README.md`（§3 表格 TODO 列打勾）、`CLAUDE.md`（工具数 42→44）

- [ ] **Step 1: 加 selfTest 场景（插件缺失路径必测——CI 环境无伴生插件也能跑）**

```ts
await t.scenario("companion bridge reports missing plugin as structured result", async () => {
  const r = await call("tools/call", { name: "fetch_chinese_metadata", arguments: { itemKeys: ["AAAAAAAA"] } });
  const body = JSON.parse(r.result.content[0].text);
  if (body.installed === false) {
    if (!body.hint) throw new Error("missing hint on installed:false");
  } else {
    if (typeof body.dryRun !== "boolean" && !Array.isArray(body.wouldScrape)) throw new Error("unexpected shape");
  }
});
```

（`call` 为 selfTest.ts 既有的请求辅助函数——打开该文件顶部确认实际名字与签名，保持一致。）

- [ ] **Step 2: 部署 + 全量回归**

Run: `npm run build && node scripts/deploy-live.mjs`，然后 `run_javascript`: `return await Zotero.ZoteroAgentSelfTest.run('protocol')`
Expected: 全部 passed（含新场景），0 failed

- [ ] **Step 3: 更新 README §3 表格与 CLAUDE.md 工具数，Commit**

```bash
git add src/modules/selfTest.ts README.md CLAUDE.md
git commit -m "feat: selfTest + docs for companion bridge tools"
```

---

## 附录：侦察结果（2026-07-08 真机 Zotero 9.0.4 运行时探测 + refs submodule 源码核对；未做真实调用——只读侦察）

### jasminum

- **addon id**: `jasminum@linxzh.com`，v1.1.37，active。挂载点 `Zotero.Jasminum`（zotero-plugin-template addon 实例：`{data, hooks, api, taskRunner}`）。
- **批量抓取入口**：`Zotero.Jasminum.taskRunner.createAndAddTask(item, type, silent) => Promise<taskId>`。TaskRunner 顺序执行且 `addTask` 内部直接 `await runTask(task)`——**await resolve 时该条抓取已执行完**（成功或 `status:"fail"`），无需另行轮询。
  - `type`: `"attachment"` | `"snapshot"` → 元数据抓取（metaScraper，即本工具要的）；`"local"` | `"remote"` → 附件查找（attachmentScraper，与本工具无关）。
  - 菜单「抓取期刊元数据」handler 原样（源码 `refs/metadata-enrich/jasminum/src/modules/menu.ts:24`）：
    ```js
    for (const item of Zotero.getActiveZoteroPane().getSelectedItems()) {
      await addon.taskRunner.createAndAddTask(item, isChineseTopAttachment(item) ? "attachment" : "snapshot");
    }
    ```
  - **适用对象不是 regular item**（`src/utils/detect.ts`）：`isChineseTopAttachment` = `item.isAttachment() && item.isTopLevelItem() && 文件名含≥3汉字且扩展名 pdf/caj/kdh/nh`；`isChinsesSnapshot` = snapshot 附件或 webpage 条目且标题含「- 中国知网」。bridge 的 scope 筛选必须按这个形状（普通中文 journalArticle 条目不走此路径）。
  - `silent` 传 truthy 时 `task.resultIndex = 0`（多搜索结果自动取第一个，不弹选择框）——编程调用应传 `true`。上游 TS 签名标 `silent?: false` 是类型标注错误，运行时逻辑是 truthy 检查。
  - 状态回读：`taskRunner.getTaskById(id).status`（`"fail"` / `"multiple_results"` / 成功态）。
- `Zotero.Jasminum.api` 只有 `getOutlineFromPDF / requestDocument / HeadlessBrowserService / createHeadlessBrowser` 等，与元数据抓取无关。`mergeName / splitName / updateCNKICite` 在打包闭包内，运行时不可直接调用（只能经菜单 DOM 触发，不建议依赖）。
- 本次侦察只读，未做 Step 4 的真实调用验证——留给 Task 3 Step 4 真机验证时一并做。dry-run 语义建议：报告 scope 内符合「可抓取形状」（顶层中文附件/知网 snapshot）的条目清单。

### zotero-format-metadata (Linter)

- **addon id**: `zotero-format-metadata@northword.cn`，v3.3.0，active。挂载点 `Zotero.Linter`（`data.config.addonInstance === "Linter"`，prefsPrefix `extensions.zotero.formatmetadata`）。
- **lint 入口**：`Zotero.Linter.hooks.onLintInBatch(ruleIDs, items)`（真机 toString 与源码 `hooks.ts:148` 一致）：
  - `ruleIDs: Arrayable<ID | "standard">`——`"standard"` = 全部**已启用**的标准规则（`Rules.getEnabledStandard()`，按 pref `rule.<id>` 过滤）；显式 id 走 `Rules.getByID(id)`，**tool-* 规则只能显式按 id 调**（永不含在 standard 内）。
  - `items: Zotero.Item[] | "item" | "collection"`——传 items 数组即可编程调用（不依赖 UI 选中）；内部自动 `filter(isRegularItem)`。
  - `onUpdateInBatch` 是 deprecated 别名（`hooks.ts:184`: `const onUpdateInBatch = onLintInBatch`），勿用。
  - **返回 void（fire-and-forget）**：内部 `runner.add({items, rules})` 进并发队列；进度/结果在 `Zotero.Linter.runner.stats`（`{total, current, pass, error, records}`）。bridge 若要同步返回结果需轮询 stats（total 达标且 current===total），或诚实返回「已入队」。
  - **无 preview API**：规则直接改字段。`lint_metadata` 的 dry-run 只能退化为「报告将处理的条目×规则清单」（与 Task 4 Step 2 预案一致）。
- **规则 id 清单**（v3.3.0，源码 `rules/index.ts` register 数组 + 各规则文件 `id:` 字段，与真机 pref 枝 `extensions.zotero.formatmetadata.rule.*` 互相印证；40 standard + 7 tool）：
  - correct-*（24）：`correct-bookTitle-sentence-case`, `correct-conference-abbr`, `correct-creators-case`, `correct-creators-pinyin`, `correct-creators-punctuation`, `correct-date-format`, `correct-doi-long`, `correct-edition-numeral`, `correct-extra-order`, `correct-filing-date-format`, `correct-issue-date-format`, `correct-pages-connector`, `correct-pages-range`, `correct-priority-date-format`, `correct-proceedingsTitle-sentence-case`, `correct-publication-title-alias`, `correct-publication-title-case`, `correct-shortTitle-sentence-case`, `correct-thesis-type`, `correct-title-chemical-formula`, `correct-title-punctuation`, `correct-title-sentence-case`, `correct-university-punctuation`, `correct-volume-numeral`（注意部分 id 是 camelCase 混 kebab，如 `correct-bookTitle-sentence-case`——照抄勿"规范化"）
  - no-*（10）：`no-article-webpage`, `no-doi-prefix`, `no-field-misuse`, `no-issue-extra-zeros`, `no-item-duplication`, `no-journal-preprint`, `no-pages-extra-zeros`, `no-title-trailing-dot`, `no-value-nullish`, `no-volume-extra-zeros`
  - require-*（6）：`require-creators`, `require-doi`, `require-journal-abbr`, `require-language`, `require-short-title`, `require-university-place`
  - tool-*（7，只能显式调）：`tool-clean-extra`, `tool-creators-ext`, `tool-csl-helper`（文件名是 tool-csl-extra-helper，id 以此为准）, `tool-get-short-doi`, `tool-set-language`, `tool-title-guillemet`, `tool-update-metadata`
  - 运行时枚举 standard 规则的途径：`Services.prefs.getBranch("extensions.zotero.formatmetadata.").getChildList("")` 里 `rule.<id>` 键（剔除含二级点号的子选项，如 `rule.require-journal-abbr.usefull`）。

### 实现期补充侦察（2026-07-08，refs submodule 源码逐行核对；对上文两处结论的修正）

- **jasminum `silent` 并不能阻止 multiple_results 挂起**：`createTask` 里 `if (silent) task.resultIndex = 0` 只是预设索引；但 `metaSearch`（`services/index.ts:207`）在过滤后结果 >1 时**无条件** `task.status = "multiple_results"`，随后 `runScrapeTask`（`task.ts:236-238`）无条件 `task.resultIndex = await task.deferred?.promise`——deferred 只能由 `taskRunner.resumeTask(taskID, index)`（进度窗用户点选）resolve。**编程调用必须自带 watchdog**：轮询 `runner.tasks` 中本条目的 task，见 `status === "multiple_results"` 即代调 `resumeTask(id, 0)`（自动取首个，等价 silent 的本意），并加 per-item 超时保底。成功态为 `status === "success"`；attachment 型成功后 `task.item.parentID = 新条目.id`（回读看 parent），顶层 webpage 型是就地 `fromJSON` 覆写。另：task id = `md5(item.id)`，同一 Zotero 会话内重抓同条目会命中 `addTask` 的去重分支（静默跳过 + 弹窗），bridge 需预检 `runner.tasks` 并如实报告 skipped。
- **Linter `onLintInBatch` 其实等到整批完成才 resolve**：`hooks.onLintInBatch` 是 async 且 `await addon.runner.add(tasks)`，而 `LintRunner.add` 末尾 `await this.caller.wait().then(() => this.finish())`——promise resolve 即批处理完成（并非纯 fire-and-forget）。但 `finish()` 会**重置 stats 为零**，完成后再读 `runner.stats` 拿不到结果；要拿 pass/error/records 必须在 await 期间并发采样（stats 是 TS-private，运行时可读）。另外部分 tool-* 规则的 `prepare()` 会开对话框（如 `tool-update-metadata`），批处理会阻塞在 Zotero 机器的 UI 上——bridge 的 await 必须带超时，超时后如实返回 `completed:false`。传入未知规则 id 时 `Rules.getByID(id)!` 返回 undefined → prepare 阶段 TypeError → add() reject，故 bridge 侧要先校验规则 id。
