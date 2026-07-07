# Sci-Hub / 灰色源 PDF 下载 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 zotero-mcp-plugin 加「灰色源（Sci-Hub / Anna's Archive）PDF 下载」能力——偏好面板开关 + 可增删源列表、MCP 工具触发（含灰色源提醒 + 自动消失提示）、右键复用 Zotero 自带 Find Available PDF（零代码）。

**Architecture:** native 单后端——源真相存 `scihub.sources`（JSON pref），启用时投影到 `extensions.zotero.findPDFs.resolvers`（`automatic:false`, `mcpManaged:true`），下载全靠 Zotero 内核（`addAvailablePDF`/自带右键）。设计见 `docs/superpowers/specs/2026-07-06-scihub-download-design.md`。

**Tech Stack:** TypeScript（Gecko 特权上下文，Zotero 9）、node:test 单测（`test/*.test.cjs` + `.tmp-test`，`npm run test:unit`）、偏好面板 HTML+手动 JS 绑定、zotero-plugin-scaffold 构建、`deploy-live.mjs` 部署。

**前置事实（已真机验证）：** Zotero 端装了 `Sci-PDF v8.0.4`（`scipdf@ytshen.com`），是 `findPDFs.resolvers` 里 7 条 `automatic:true` Sci-Hub 的来源。Zotero 自带 Find Available PDF 已覆盖 arXiv（`addAvailablePDF` 下到 `arxiv.org/pdf`），无需特殊处理。偏好面板模式：`bindHtmlCheckbox(doc, selector, prefKey)`、`updateServerDependentUI(doc, enabled)` 级联 `style.display`、`doc.createElement` 动态建节点。提示窗：`hooks.ts` 的 `showNotification`（`ProgressWindow` + `startCloseTimer(3000)`）。

---

## Phase 0：卸载干扰插件 + 清理残留

### Task 1: 卸载 Sci-PDF 并清理其残留 resolver（真机一次性）

**这是真机操作**（连接通 + eval.enabled 开），经 `mcp__zotero__run_javascript` 执行；无代码文件改动。

- [ ] **Step 1: 卸载前快照 resolver pref（留证据）**

```js
return { before: Zotero.Prefs.get("extensions.zotero.findPDFs.resolvers", true) };
```

- [ ] **Step 2: 卸载 Sci-PDF + 清理它残留的无 mcpManaged 标记的 sci-hub 条目**

```js
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const addon = await AddonManager.getAddonByID("scipdf@ytshen.com");
let uninstalled = false;
if (addon) { await addon.uninstall(); uninstalled = true; }
// 清理 findPDFs.resolvers 里 scipdf 残留（无 mcpManaged 标记的 sci-hub.* / annas-archive 条目），保留 OA 与其它 external
const KEY = "extensions.zotero.findPDFs.resolvers";
let arr = [];
try { arr = JSON.parse(Zotero.Prefs.get(KEY, true) || "[]"); } catch (e) {}
const kept = (Array.isArray(arr) ? arr : []).filter((r) => r?.mcpManaged || !/sci-hub|scihub|annas-archive/i.test(String(r?.url || "")));
Zotero.Prefs.set(KEY, JSON.stringify(kept), true);
return { uninstalled, removedCount: (Array.isArray(arr) ? arr.length : 0) - kept.length, after: kept };
```

Expected: `uninstalled: true`，`removedCount: 7`（scipdf 的 7 条），`after` 不再含无标记的 sci-hub 条目。

- [ ] **Step 3: 提示用户重启 Zotero**（卸载插件需重启生效）。记录结果，无 commit（无文件改动）。

---

## Phase 1：源后端 selector 更新

### Task 2: pdfResolvers.ts 的 SCIHUB_SELECTOR 换宽松版

**Files:** Modify `zotero-mcp-plugin/src/modules/pdfResolvers.ts:17`

- [ ] **Step 1: 更新 selector 常量**

`src/modules/pdfResolvers.ts:17` 现为：
```ts
const SCIHUB_SELECTOR = '#pdf, embed[src*=".pdf"], iframe[src*=".pdf"]';
```
改为（合并各插件最鲁棒版）：
```ts
const SCIHUB_SELECTOR = '#pdf, embed[type="application/pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], object[data*=".pdf"]';
```

- [ ] **Step 2: 编译 + 单测（现有 pdfResolvers 测试不断）**

Run: `cd zotero-mcp-plugin && npx tsc --noEmit && npm run test:unit`
Expected: 59/59 pass（selector 是 preset 内部值，测试不断言具体 selector 字符串）。

- [ ] **Step 3: Commit**

```bash
git add zotero-mcp-plugin/src/modules/pdfResolvers.ts
git commit -m "feat(download): broaden Sci-Hub PDF selector for mirror DOM variance"
```

---

## Phase 2：scihubSources 纯函数（源配置 ↔ resolver 同步）

### Task 3: scihubSources.ts + 单测

**Files:**
- Create: `zotero-mcp-plugin/src/modules/scihubSources.ts`
- Test: `zotero-mcp-plugin/test/scihubSources.test.cjs`（注册进 `scripts/unit-test.mjs`）

- [ ] **Step 1: 写失败测试 `test/scihubSources.test.cjs`**（照 `test/pdfResolvers.test.cjs` 样板，require 从 `../.tmp-test/...`）

```js
test("DEFAULT_SCIHUB_SOURCES has 9 Sci-Hub + 2 Anna's Archive", () => {
  assert.equal(DEFAULT_SCIHUB_SOURCES.length, 11);
  assert.equal(DEFAULT_SCIHUB_SOURCES.filter((s) => s.url.includes("sci-hub")).length, 9);
  assert.equal(DEFAULT_SCIHUB_SOURCES.filter((s) => s.url.includes("annas-archive")).length, 2);
});
test("parseSources handles junk and JSON", () => {
  assert.deepEqual(parseSources('[{"url":"https://x/{doi}"}]'), [{ url: "https://x/{doi}" }]);
  assert.deepEqual(parseSources("not json"), []);
  assert.deepEqual(parseSources(null), []);
});
test("syncScihubResolvers enabled = our sources (automatic:false) + external", () => {
  const existing = [{ name: "Foreign", url: "y", mcpManaged: false }];
  const out = syncScihubResolvers(true, [{ url: "https://sci-hub.se/{doi}" }], JSON.stringify(existing));
  assert.equal(out.length, 2); // 1 mine + 1 external
  const mine = out.find((r) => r.mcpManaged);
  assert.equal(mine.automatic, false);
  assert.ok(mine.selector.includes("#pdf"));
  assert.ok(out.some((r) => r.name === "Foreign"));
});
test("syncScihubResolvers disabled = external only (our sources removed)", () => {
  const existing = [{ name: "Sci-Hub", url: "https://sci-hub.se/{doi}", automatic: false, mcpManaged: true }, { name: "Foreign", url: "y", mcpManaged: false }];
  const out = syncScihubResolvers(false, [{ url: "https://sci-hub.se/{doi}" }], JSON.stringify(existing));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Foreign");
});
test("Anna's Archive source gets href selector/attribute", () => {
  const out = syncScihubResolvers(true, [{ url: "https://annas-archive.se/scidb/{doi}/" }], "[]");
  const r = out[0];
  assert.equal(r.attribute, "href");
  assert.ok(r.selector.includes("href"));
});
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

Run: `cd zotero-mcp-plugin && npm run test:unit`
Expected: FAIL

- [ ] **Step 3: 实现 `src/modules/scihubSources.ts`**

```ts
/**
 * Sci-Hub / Anna's Archive source config ↔ findPDFs.resolvers synchronization.
 * Source of truth is scihub.sources (user config); resolvers is the enabled-time projection.
 * Pure functions — no Zotero imports.
 */
import { buildResolver, mergeResolvers, parseResolvers, Resolver } from "./pdfResolvers";

const SCIHUB_SELECTOR =
  '#pdf, embed[type="application/pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], object[data*=".pdf"]';
const ANNAS_SELECTOR = 'a[href$=".pdf"]';

export interface ScihubSource {
  url: string;
  selector?: string;
  attribute?: string;
}

/** Aggregated mirrors from scipdf/sanfy008/scidb/pdferret (9 Sci-Hub + 2 Anna's Archive). */
export const DEFAULT_SCIHUB_SOURCES: ScihubSource[] = [
  { url: "https://sci-hub.se/{doi}" },
  { url: "https://sci-hub.st/{doi}" },
  { url: "https://sci-hub.ru/{doi}" },
  { url: "https://sci-hub.ee/{doi}" },
  { url: "https://sci-hub.ren/{doi}" },
  { url: "https://sci-hub.red/{doi}" },
  { url: "https://sci-hub.box/{doi}" },
  { url: "https://sci-hub.su/{doi}" },
  { url: "https://sci-hub.usualwant.com/{doi}" },
  { url: "https://annas-archive.se/scidb/{doi}/", selector: ANNAS_SELECTOR, attribute: "href" },
  { url: "https://annas-archive.gl/scidb/{doi}/", selector: ANNAS_SELECTOR, attribute: "href" },
];

/** Parse the scihub.sources pref defensively. */
export function parseSources(raw: unknown): ScihubSource[] {
  if (Array.isArray(raw)) return raw.filter((s) => s && typeof s.url === "string");
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((s) => s && typeof s.url === "string") : [];
  } catch {
    return [];
  }
}

/** One source → a full resolver (fills grey-source defaults: automatic:false, mcpManaged:true). */
function sourceToResolver(s: ScihubSource): Resolver {
  const isAnnas = /annas-archive/i.test(s.url);
  return buildResolver({
    name: isAnnas ? "Anna's Archive" : "Sci-Hub",
    url: s.url,
    selector: s.selector ?? (isAnnas ? ANNAS_SELECTOR : SCIHUB_SELECTOR),
    attribute: s.attribute ?? (isAnnas ? "href" : "src"),
    automatic: false,
  });
}

/**
 * Compute the findPDFs.resolvers value: enabled → our sources + external; disabled → external only.
 * Never touches foreign (non-mcpManaged) resolvers.
 */
export function syncScihubResolvers(enabled: boolean, sources: ScihubSource[], existingRaw: unknown): any[] {
  const existing = parseResolvers(existingRaw);
  const mine = enabled ? sources.map(sourceToResolver) : [];
  return mergeResolvers(existing, mine);
}
```

- [ ] **Step 4: 注册进 `scripts/unit-test.mjs`**（编译列表加 `scihubSources.ts`，运行列表加 `scihubSources.test.cjs`，照 pdfResolvers 的注册方式）。

- [ ] **Step 5: 跑测试 + 编译**

Run: `cd zotero-mcp-plugin && npm run test:unit && npx tsc --noEmit`
Expected: 64/64 pass（59 + 5 新）

- [ ] **Step 6: Commit**

```bash
git add zotero-mcp-plugin/src/modules/scihubSources.ts zotero-mcp-plugin/test/scihubSources.test.cjs zotero-mcp-plugin/scripts/unit-test.mjs
git commit -m "feat(download): scihubSources — config↔resolver sync, 11 default mirrors (pure)"
```

---

## Phase 3：MCP 工具扩展

### Task 4: manage_pdf_resolvers 加 enable/disable + list 返回 scihubEnabled

**Files:** Modify `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（schema + case）、`zotero-mcp-plugin/src/modules/selfTest.ts`

- [ ] **Step 1: schema 加 enable/disable action**

找到 `manage_pdf_resolvers` 的 inputSchema，`action` 的 enum 从 `['list','add','remove','set_automatic']` 改为 `['list','add','remove','set_automatic','enable','disable']`，并在 description 补一句：`enable/disable 切换 Sci-Hub 灰色源总开关（scihub.enabled）并同步源列表到 resolver pref。`

- [ ] **Step 2: case 加 enable/disable 分支**

在 `case 'manage_pdf_resolvers'` 里，`list` 分支返回对象加 `scihubEnabled`；在写门禁之后加 enable/disable。用 `syncScihubResolvers` + `parseSources` + `DEFAULT_SCIHUB_SOURCES`。`list` 分支改为：

```ts
          if (act === 'list') {
            const all = readAll();
            const scihubEnabled = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.scihub.enabled', true) === true;
            result = { resolvers: all, mcpManaged: all.filter((r: any) => r?.mcpManaged), presets: Object.keys(RESOLVER_PRESETS), scihubEnabled };
            break;
          }
```

在写门禁（`if (Zotero.Prefs.get('...write.enabled'...) !== true) throw`）之后、`add` 分支之前插入：

```ts
          if (act === 'enable' || act === 'disable') {
            const enabled = act === 'enable';
            Zotero.Prefs.set('extensions.zotero.zotero-mcp-plugin.scihub.enabled', enabled, true);
            const srcRaw = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.scihub.sources', true);
            let sources = parseSources(srcRaw);
            if (!sources.length) { sources = DEFAULT_SCIHUB_SOURCES; Zotero.Prefs.set('extensions.zotero.zotero-mcp-plugin.scihub.sources', JSON.stringify(sources), true); }
            const next = syncScihubResolvers(enabled, sources, Zotero.Prefs.get(PREF_KEY, true));
            Zotero.Prefs.set(PREF_KEY, JSON.stringify(next), true);
            result = { scihubEnabled: enabled, sourceCount: sources.length, greySourceWarning: enabled ? "⚠️ Sci-Hub / Anna's Archive 是灰色源，请确认你所在辖区的合规性" : undefined };
            break;
          }
```

`PREF_KEY` 已在该 case 内定义（`extensions.zotero.findPDFs.resolvers`）。文件顶部 import 补 `syncScihubResolvers, parseSources, DEFAULT_SCIHUB_SOURCES` from `./scihubSources`。

- [ ] **Step 3: selfTest 场景**（append 到 protocol 套件）

```ts
  await t.scenario("manage_pdf_resolvers enable/disable toggles scihub sources", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    const en = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "enable" } }))).json.result.content[0].text);
    const listed = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "list" } }))).json.result.content[0].text);
    const hasScihub = (listed.mcpManaged ?? []).some((r) => /sci-hub/.test(r.url));
    const dis = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "disable" } }))).json.result.content[0].text);
    const listed2 = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "list" } }))).json.result.content[0].text);
    const noScihub = !(listed2.mcpManaged ?? []).some((r) => /sci-hub/.test(r.url));
    t.assertEq(en.scihubEnabled, true, "enable reports enabled");
    t.assertTrue(hasScihub, "sci-hub present after enable");
    t.assertTrue(!!en.greySourceWarning, "enable returns grey-source warning");
    t.assertTrue(noScihub, "sci-hub gone after disable (external kept)");
  });
```

- [ ] **Step 4: 编译 + 单测（不断）+ Commit**

```bash
cd zotero-mcp-plugin && npx tsc --noEmit && npm run test:unit
git add zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/src/modules/selfTest.ts
git commit -m "feat(download): manage_pdf_resolvers enable/disable — toggle Sci-Hub + sync sources"
```

### Task 5: find_missing_pdfs fetch 加灰色源提醒 + Zotero 提示窗

**Files:** Modify `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（find_missing_pdfs case）、`zotero-mcp-plugin/src/modules/selfTest.ts`

- [ ] **Step 1: fetch 返回加灰色源提醒 + 进程内提示窗**

在 `case 'find_missing_pdfs'` 的 `action === 'fetch'` 分支，构造返回结果后（`findMissingPdfs` 返回的 `result` 之上）加：检测 `scihub.enabled`，为真则加 `greySourceWarning` 并弹 Zotero 提示。找到 fetch 分支返回 result 的位置，改为：

```ts
          const fetchResult = await findMissingPdfs({ ...args, libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID });
          const scihubOn = Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.scihub.enabled', true) === true;
          if (scihubOn) {
            (fetchResult as any).greySourceWarning = "⚠️ 已启用 Sci-Hub / Anna's Archive 灰色源，下载可能来自这些源，请确认合规";
          }
          try {
            const win = (typeof ZoteroPane !== 'undefined' && ZoteroPane?.document?.defaultView) || (Zotero.getMainWindow && Zotero.getMainWindow());
            if (win) {
              const pw = new (Zotero as any).ProgressWindow({ closeOnClick: true });
              pw.changeHeadline('Zotero MCP');
              pw.addDescription(`查找全文完成：下载 ${(fetchResult as any).fetched ?? 0} 篇${scihubOn ? '（含灰色源）' : ''}`);
              pw.show();
              pw.startCloseTimer(3000);
            }
          } catch (e) { /* 提示窗尽力而为 */ }
          result = fetchResult;
```

（若 fetch 分支现有结构不同，调整为在 `findMissingPdfs` 结果赋给 `result` 之前插入 warning + 提示窗；`ProgressWindow`/`getMainWindow` 是 Zotero 全局，工具跑在进程内可用。）

- [ ] **Step 2: find_missing_pdfs 的 description 补一句灰色源说明**

在 `find_missing_pdfs` 工具 description 末尾追加：` 若已启用 Sci-Hub（manage_pdf_resolvers action=enable），fetch 可能经灰色源下载并在返回 greySourceWarning 提醒。`

- [ ] **Step 3: selfTest 场景**

```ts
  await t.scenario("find_missing_pdfs warns when scihub enabled", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "enable" } }));
    const r = JSON.parse((await mcpPost(rpc("tools/call", { name: "find_missing_pdfs", arguments: { action: "fetch", limit: 1 } }))).json.result.content[0].text);
    await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "disable" } })); // cleanup
    t.assertTrue(!!r.greySourceWarning, "fetch must warn when scihub enabled");
  });
```

- [ ] **Step 4: 编译 + 单测 + Commit**

```bash
cd zotero-mcp-plugin && npx tsc --noEmit && npm run test:unit
git add zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/src/modules/selfTest.ts
git commit -m "feat(download): find_missing_pdfs grey-source warning + auto-dismiss notification"
```

---

## Phase 4：偏好面板（开关 + 可增删源列表）

### Task 6: prefs 默认值 + ftl 文案

**Files:** Modify `zotero-mcp-plugin/addon/prefs.js`、`addon/locale/en-US/preferences.ftl`、`addon/locale/zh-CN/preferences.ftl`

- [ ] **Step 1: prefs.js 加默认值**（前缀 `config.prefsPrefix` 自动补全）

`addon/prefs.js` 末尾追加：
```js
pref("scihub.enabled", false);
pref("scihub.sources", "");
```

- [ ] **Step 2: ftl 文案**（en-US 与 zh-CN 各加）

`addon/locale/zh-CN/preferences.ftl` 追加：
```
pref-scihub-enable-text = 查找全文时也用 Sci-Hub / Anna's Archive（灰色源）
pref-scihub-enable-sub = 启用后，Zotero 的「查找可用 PDF」（右键 / MCP 工具）在免费源找不到时会尝试这些源。仅手动触发，不后台自动访问。灰色源合规风险由你自行承担。
pref-scihub-sources-label = Sci-Hub / Anna's Archive 源列表
pref-scihub-add = 添加源
pref-scihub-reset = 恢复默认源
pref-scihub-remove = 删除
```

`addon/locale/en-US/preferences.ftl` 追加：
```
pref-scihub-enable-text = Also use Sci-Hub / Anna's Archive (grey sources) for full-text
pref-scihub-enable-sub = When enabled, Zotero's "Find Available PDF" (right-click / MCP tool) falls back to these sources if free sources have nothing. Manual-only, never accessed in the background. Legal compliance is your responsibility.
pref-scihub-sources-label = Sci-Hub / Anna's Archive source list
pref-scihub-add = Add source
pref-scihub-reset = Restore defaults
pref-scihub-remove = Remove
```

- [ ] **Step 3: Commit**（`addon/` 被 gitignore，用 `-f`）

```bash
git add -f zotero-mcp-plugin/addon/prefs.js zotero-mcp-plugin/addon/locale/en-US/preferences.ftl zotero-mcp-plugin/addon/locale/zh-CN/preferences.ftl
git commit -m "feat(download): scihub prefs defaults + panel locale strings"
```

### Task 7: preferences.xhtml 加开关 + 源列表区

**Files:** Modify `zotero-mcp-plugin/addon/content/preferences.xhtml`

- [ ] **Step 1: 在合适位置（如 eval/write 开关那组之后）插入 Sci-Hub 区块**

参照现有 `.zmp-tog` 开关 + `.zmp-sw` 行结构，插入：
```html
<html:div class="zmp-sw">
  <html:label class="zmp-tog">
    <html:input type="checkbox" id="zotero-mcp-scihub-enabled"/>
    <html:span data-l10n-id="pref-scihub-enable-text"/>
  </html:label>
  <html:div class="zmp-sub" data-l10n-id="pref-scihub-enable-sub"/>
</html:div>
<html:div id="scihub-sources-section" style="display:none">
  <html:div class="zmp-sub" data-l10n-id="pref-scihub-sources-label"/>
  <html:div id="scihub-sources-list"></html:div>
  <html:div class="zmp-bg">
    <html:input type="text" id="scihub-add-url" class="zmp-fi" placeholder="https://sci-hub.xx/{doi}"/>
    <html:button class="zmp-b zmp-bp" id="scihub-add-btn" data-l10n-id="pref-scihub-add"/>
    <html:button class="zmp-b" id="scihub-reset-btn" data-l10n-id="pref-scihub-reset"/>
  </html:div>
</html:div>
```
（class 名以文件现有为准——`grep -n 'zmp-' addon/content/preferences.xhtml` 核对 `.zmp-sw/.zmp-tog/.zmp-sub/.zmp-bg/.zmp-b/.zmp-bp/.zmp-fi` 实际存在的类，用现有的。）

- [ ] **Step 2: Commit**

```bash
git add -f zotero-mcp-plugin/addon/content/preferences.xhtml
git commit -m "feat(download): scihub enable toggle + source list UI in preferences panel"
```

### Task 8: preferenceScript.ts 绑定 + 源列表渲染 + 增删 + 恢复默认

**Files:** Modify `zotero-mcp-plugin/src/modules/preferenceScript.ts`

- [ ] **Step 1: 在 `registerPrefsScripts` 里挂 Sci-Hub 绑定**

找到 `bindHtmlCheckbox(...)` 挂载区（现有 eval/write 那一串），加一行调用 `bindScihubPanel(doc)`（新函数）。

- [ ] **Step 2: 实现 `bindScihubPanel` + 渲染/增删（append 到 preferenceScript.ts，用文件现有的 `Zotero.Prefs`/`doc.createElement` 风格）**

```ts
const SCIHUB_ENABLED_KEY = "extensions.zotero.zotero-mcp-plugin.scihub.enabled";
const SCIHUB_SOURCES_KEY = "extensions.zotero.zotero-mcp-plugin.scihub.sources";
const FINDPDFS_KEY = "extensions.zotero.findPDFs.resolvers";

function readScihubSources(): { url: string; selector?: string; attribute?: string }[] {
  const raw = Zotero.Prefs.get(SCIHUB_SOURCES_KEY, true);
  try { const a = JSON.parse(String(raw || "[]")); return Array.isArray(a) ? a : []; } catch { return []; }
}
function writeScihubSourcesAndSync(doc: Document, sources: { url: string }[]) {
  Zotero.Prefs.set(SCIHUB_SOURCES_KEY, JSON.stringify(sources), true);
  syncScihubToResolvers();
  renderScihubList(doc);
}
function syncScihubToResolvers() {
  // 复用 scihubSources 纯函数，避免面板与 MCP 两套逻辑漂移
  const enabled = Zotero.Prefs.get(SCIHUB_ENABLED_KEY, true) === true;
  const sources = readScihubSources();
  const next = syncScihubResolvers(enabled, sources, Zotero.Prefs.get(FINDPDFS_KEY, true));
  Zotero.Prefs.set(FINDPDFS_KEY, JSON.stringify(next), true);
}
function renderScihubList(doc: Document) {
  const list = doc.querySelector("#scihub-sources-list") as HTMLElement;
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
  const sources = readScihubSources();
  if (!sources.length) {
    const empty = doc.createElement("div");
    empty.textContent = "（无源，点「恢复默认源」加载预置）";
    empty.style.opacity = "0.6";
    list.appendChild(empty);
    return;
  }
  sources.forEach((s, i) => {
    const row = doc.createElement("div");
    row.className = "zmp-sw";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    const urlSpan = doc.createElement("span");
    urlSpan.textContent = s.url;
    urlSpan.style.flex = "1";
    urlSpan.style.fontSize = "12px";
    const del = doc.createElement("button");
    del.className = "zmp-b zmp-bd";
    del.textContent = "×";
    del.addEventListener("click", () => {
      const cur = readScihubSources();
      cur.splice(i, 1);
      writeScihubSourcesAndSync(doc, cur);
    });
    row.appendChild(urlSpan);
    row.appendChild(del);
    list.appendChild(row);
  });
}
function updateScihubUI(doc: Document, enabled: boolean) {
  const section = doc.querySelector("#scihub-sources-section") as HTMLElement;
  if (section) section.style.display = enabled ? "" : "none";
}
export function bindScihubPanel(doc: Document) {
  const toggle = doc.querySelector("#zotero-mcp-scihub-enabled") as HTMLInputElement;
  if (toggle) {
    toggle.checked = Zotero.Prefs.get(SCIHUB_ENABLED_KEY, true) === true;
    updateScihubUI(doc, toggle.checked);
    toggle.addEventListener("change", () => {
      Zotero.Prefs.set(SCIHUB_ENABLED_KEY, toggle.checked, true);
      // 首次启用且无源 → 灌默认
      if (toggle.checked && !readScihubSources().length) {
        Zotero.Prefs.set(SCIHUB_SOURCES_KEY, JSON.stringify(DEFAULT_SCIHUB_SOURCES), true);
      }
      syncScihubToResolvers();
      updateScihubUI(doc, toggle.checked);
      renderScihubList(doc);
    });
  }
  const addBtn = doc.querySelector("#scihub-add-btn") as HTMLElement;
  const addUrl = doc.querySelector("#scihub-add-url") as HTMLInputElement;
  if (addBtn && addUrl) {
    addBtn.addEventListener("click", () => {
      let url = addUrl.value.trim();
      if (!url) return;
      if (!url.includes("{doi}")) url = url.replace(/\/?$/, "/") + "{doi}"; // 缺占位自动补
      const cur = readScihubSources();
      if (!cur.some((s) => s.url === url)) cur.push({ url });
      addUrl.value = "";
      writeScihubSourcesAndSync(doc, cur);
    });
  }
  const resetBtn = doc.querySelector("#scihub-reset-btn") as HTMLElement;
  if (resetBtn) {
    resetBtn.addEventListener("click", () => writeScihubSourcesAndSync(doc, DEFAULT_SCIHUB_SOURCES.slice()));
  }
  renderScihubList(doc);
}
```

文件顶部 import 补 `import { syncScihubResolvers, DEFAULT_SCIHUB_SOURCES } from "./scihubSources";`。`Zotero` 是 ambient global（文件已在用）。

- [ ] **Step 3: 编译**

Run: `cd zotero-mcp-plugin && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add zotero-mcp-plugin/src/modules/preferenceScript.ts
git commit -m "feat(download): scihub panel — toggle sync + add/remove/reset source list"
```

---

## Phase 5：收尾（构建 + 部署 + 真机验证）

### Task 9: version bump + build + 部署 + selfTest + 手动 UI 验证

**Files:** Modify `zotero-mcp-plugin/package.json`

- [ ] **Step 1: version bump 1.7.1 → 1.8.0**

`zotero-mcp-plugin/package.json` line 4 `"version": "1.7.1"` → `"1.8.0"`。

- [ ] **Step 2: 全量单测 + 构建**

Run: `cd zotero-mcp-plugin && npm run test:unit && npm run build`
Expected: 64/64 pass；`Build finished`，无 tsc 错误、无 i18n WARN。

- [ ] **Step 3: Commit**

```bash
git add zotero-mcp-plugin/package.json
git commit -m "chore: v1.8.0 — Sci-Hub grey-source download (panel + MCP + native right-click)"
```

- [ ] **Step 4: 部署**（Phase 0 已卸载 scipdf 并重启）

Run: `node %TEMP%/deploy-xpi.mjs`，再 `mcp__zotero__install_plugin_from_url { url: "file:///tmp/zotero-mcp-plugin-1.6.1.xpi", self_upgrade: true }`；等重启，`run_javascript` 查 AddonManager 版本 = 1.8.0。

- [ ] **Step 5: selfTest 全量回归**

```
run_javascript: return await Zotero.ZoteroMCPSelfTest.run('protocol');
```
Expected: `failed: 0`；新增 2 场景（enable/disable、find_missing_pdfs warn）passed。

- [ ] **Step 6: 手动 UI 真机验证**（用户在目标 Zotero 操作，或经 run_javascript 模拟 pref）
  1. 偏好面板出现「查找全文时也用 Sci-Hub」开关；勾选 → 源列表区显示 11 个默认源。
  2. 添加一个源 URL → 列表多一行 + `findPDFs.resolvers` 同步含之；删除 → 移除。「恢复默认源」→ 回到 11 个。
  3. 取消勾选 → 源列表区隐藏 + `findPDFs.resolvers` 移除我们的 Sci-Hub（external/OA 保留）。
  4. 启用后对一个无 PDF 条目用 Zotero 自带右键「查找可用 PDF」→ 确认能走到 Sci-Hub（免费源没有时）。
  5. 验证：`run_javascript` 读 `findPDFs.resolvers`，确认无 scipdf 残留、我们的源 `automatic:false`。

- [ ] **Step 7: 文档同步 + Commit**
  - 仓库根 `CLAUDE.md` §4 工具/功能描述加「Sci-Hub 灰色源下载（面板开关 + 源列表 + MCP enable/disable + 右键复用 Zotero 自带）」。
  - README 工具/功能清单同步。

```bash
git add zotero-mcp-plugin/README.md zotero-mcp-plugin/README-zh.md ../CLAUDE.md
git commit -m "docs: sync Sci-Hub grey-source download feature"
```

---

## 自测清单（写完计划的 self-review）

- **Spec 覆盖**：源后端(Task2)、双层存储/同步(Task3)、偏好面板开关+列表(Task6-8)、右键=Zotero 自带(无 task，零代码，spec §4.4)、MCP enable/disable+提醒(Task4-5)、arXiv(无需处理，spec §5)、卸载 scipdf(Task1)、提示窗(Task5) — 全覆盖。
- **类型一致**：`ScihubSource`/`syncScihubResolvers`/`parseSources`/`DEFAULT_SCIHUB_SOURCES` 在 Task3 定义，Task4/5/8 引用一致；`buildResolver`/`mergeResolvers`/`parseResolvers` 复用 Task2 前已存在的 pdfResolvers 导出。
- **无占位**：所有代码块完整；class 名/fetch 分支结构标注「以文件现有为准，grep 核对」是因基座 UI class 需现场确认，非占位。
- **YAGNI**：不自建右键菜单、不自建抓取、不做 arXiv 专门路径、不做逐条进度条。
