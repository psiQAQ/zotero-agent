# Sci-Hub / 灰色源 PDF 下载功能设计

- 日期：2026-07-06
- 基座：`zotero-mcp-plugin` v1.7.1（fork cookjohn/zotero-mcp）
- 目标环境：Zotero 9.0.4（目标 Zotero）
- 前置：上一轮已建 `manage_pdf_resolvers`（管 `findPDFs.resolvers`）+ `find_missing_pdfs`（`addAvailablePDF` 下载）

---

## 1. 背景与目标

给插件加「灰色源（Sci-Hub / Anna's Archive）PDF 下载」能力，三个触发入口共享**同一个 native 后端**：① 偏好面板开关 + 可增删源列表；② Zotero 自带右键 Find Available PDF（注册源后自动含灰色源）；③ MCP 工具（智能体触发）。MCP 路径下载完在 Zotero 里弹**自动消失**的提示窗。灰色源默认关闭、显式启用、合规自负。

## 2. 决策摘要（brainstorming 已拍板）

| 决策 | 选定 | 理由 |
|---|---|---|
| 下载机制 | **复用 Zotero 原生下载**（native resolver + `addAvailableFiles`/`addAvailablePDF`） | 零抓取代码；抓取/多镜像降级/落盘全交 Zotero 内核；和已有 `manage_pdf_resolvers`/`find_missing_pdfs` 无缝，一套后端三入口 |
| 触发时机 | **仅手动/工具触发**（`automatic:false`） | 决不后台静默访问 Sci-Hub；只在点右键/调工具时访问 |
| MCP 入口 | **复用现有工具 + 灰色源提醒** | 不新增下载工具；`manage_pdf_resolvers` 管开关/源，`find_missing_pdfs` 下载并提醒灰色源 |
| 右键入口 | **复用 Zotero 自带 Find Available PDF** | 注册 Sci-Hub 源后，Zotero 自带右键 Find Available PDF 自动含灰色源，零代码；不自建菜单（用户拍板选最省方案） |
| arXiv 处理 | **无需特殊处理**（Zotero 内置覆盖，天然优先） | 见 §5，已真机验证 |

## 3. 架构（单后端 + 三入口）

```
[scihub.sources  JSON pref — 用户配置的源列表，持久，增删改这个]
        │  scihub.enabled = ON 时同步（automatic:false, mcpManaged:true）
        ▼
[extensions.zotero.findPDFs.resolvers]  ──▶  Zotero 内核 Find Available PDF
        ▲                                     先试内置免费源(arXiv/Unpaywall OA)
   三入口都触发同一后端：                       → 没有才落我们的 Sci-Hub(automatic:false 兜底)
   ① 偏好面板：scihub.enabled 开关 + 可增删源列表
   ② Zotero 自带右键 Find Available PDF：注册 Sci-Hub 源后自动含灰色源（不写菜单代码）
   ③ MCP 工具：manage_pdf_resolvers(开关/源) + find_missing_pdfs(下载 + 灰色源提醒 + 弹提示)
```

**不变量**：源的「真相」是 `scihub.sources`（用户配置）；`findPDFs.resolvers` 是启用时的派生投影。禁用只从 resolvers 移除我们的条目，`scihub.sources` 配置不丢。

## 4. 组件详述

### 4.1 源后端（扩充 `src/modules/pdfResolvers.ts`）

- **预置源扩充**：从现有 4 个扩到汇总的 **9 个 Sci-Hub 域**（sci-hub.se/st/ru/ee/ren/red/box/su/usualwant.com）+ **2 个 Anna's Archive/SciDB**（annas-archive.se/scidb、annas-archive.gl/scidb）。
- **selector 宽松版**（合并各插件最鲁棒版）：Sci-Hub 用 `#pdf, embed[type="application/pdf"], embed[src*=".pdf"], iframe[src*=".pdf"], object[data*=".pdf"]`；Anna's Archive 用 `a[href$=".pdf"]`（attribute=`href`）。
- 全部 `automatic:false` + `mcpManaged:true`（决策②）。
- 复用已有 `parseResolvers`/`mergeResolvers`/`buildResolver`（含上一轮修的 undefined-clobber fix）。

### 4.2 双层存储与同步（新 `src/modules/scihubSources.ts`，纯函数为主）

- `scihub.sources`（pref，JSON 字符串）：`[{url, selector?, attribute?}]`——用户配置的源列表，只存精简字段；`name`/`automatic:false`/`mcpManaged:true` 由同步时 `buildResolver` 补全。默认值 = §4.1 的预置全集。
- `scihub.enabled`（pref，布尔，默认 `false`）。
- **同步函数** `syncScihubResolvers(enabled, sources, existingPref)`（纯函数，可单测）：`enabled` 时 = `sources → buildResolver(automatic:false) → mergeResolvers(existing, mine)`；`!enabled` 时 = `mergeResolvers(existing, [])`（移除我们的，保留 external + OA）。写回 `findPDFs.resolvers`（`true` 全局参数）。
- 开关切换、源增删、恢复默认，都调 `syncScihubResolvers` 重算写回——幂等，天然去重（沿用 mergeResolvers 语义）。

### 4.3 偏好面板（`addon/content/preferences.xhtml` + `src/modules/preferenceScript.ts` + ftl + `addon/prefs.js`）

- **启用开关**：`.zmp-tog` + `<html:input type="checkbox" id="...-scihub-enabled">`，`bindHtmlCheckbox` 绑 `scihub.enabled`；`change` 时调 `syncScihubResolvers` + 级联显隐源列表区（照 `updateServerDependentUI` 模式）。
- **源列表 UI**（pdferret 式动态列表，用基座 `.zmp-*` 样式 + `doc.createElement`）：
  - 容器 `<div id="...-scihub-list">`（动态填充）：每行一个源 URL + 删除按钮（`.zmp-b .zmp-bd`）。
  - 底部添加：URL 输入框 + 「添加」按钮（`.zmp-b .zmp-bp`）；校验含 `{doi}` 占位或自动补。
  - 「恢复默认源」按钮：重置 `scihub.sources` 为预置全集。
  - 渲染逻辑：清空→读 `scihub.sources`→遍历建行→绑删除→增删后重渲染 + 调 `syncScihubResolvers`。
- **文案**（en/zh ftl）：开关标题「查找全文时也用 Sci-Hub / Anna's Archive（灰色源）」+ 副文案标注合规风险自负 + 「仅手动触发，不后台自动访问」。

### 4.4 右键下载（复用 Zotero 自带 Find Available PDF，零代码）

用户拍板：**不自建右键菜单**。native 机制下，一旦 Sci-Hub 源注册进 `findPDFs.resolvers`（`scihub.enabled=ON`），Zotero 自带的右键 **Find Available PDF**（选中条目 → 右键）就自动包含我们的 Sci-Hub 源；Zotero 先试免费源（arXiv/OA）再落 Sci-Hub `automatic:false` 兜底。

- **零代码**：不写菜单注册/清理/onCommand，不碰 `hooks.ts` 的菜单部分。
- **提示**：右键路径用 Zotero 自带的进度提示（非我们的自动消失提示窗——那个只在 MCP 工具路径用，见 §4.6）。
- **差异**：未启用 Sci-Hub 时，Zotero 自带 Find Available PDF 只走免费源；启用后自动含 Sci-Hub。

### 4.5 MCP 工具（扩展 `src/modules/streamableMCPServer.ts`）

- `manage_pdf_resolvers`：加 `action: enable`/`disable`（读写 `scihub.enabled` + 调 `syncScihubResolvers`）；`list` 额外返回 `scihubEnabled` 状态。
- `find_missing_pdfs` 的 `action=fetch`：检测 `scihub.enabled` 为真时，返回体加 `greySourceWarning: "⚠️ 正在使用灰色源 Sci-Hub/Anna's Archive，请确认合规"`；下载完在 Zotero 进程内调 `showNotification` 弹自动消失提示（满足「两入口都有提示」——工具跑在 Zotero 进程内）。

### 4.6 提示窗（复用 `src/hooks.ts` `showNotification`）

- `new Zotero.ProgressWindow({closeOnClick:true})` + `changeHeadline` + `addDescription` + `show()` + `startCloseTimer(3000)`——3 秒自动消失，无需手动关。
- MCP 路径：完成一次提示 + 返回体文字提醒。（右键路径用 Zotero 自带进度提示，见 §4.4。）

## 5. arXiv 与开放源（无需特殊处理，已验证）

**真机验证**（2026-07-06）：对无 PDF 的 arXiv 条目 `DHGIGX6F`（Attention is all you need，`10.48550/arXiv.1706.03762`）调 `addAvailablePDF`，下到 `http://arxiv.org/pdf/1706.03762v7`——**直接来自 arxiv.org,非 Sci-Hub**。库内 19 篇 arXiv 中 18 篇导入即带 PDF，佐证 Zotero 对 arXiv 处理成熟。

**结论**：Zotero 的 Find Available PDF **原生内置 arXiv 支持**（识别 arXiv DOI/url/archiveID → arxiv.org/pdf）。三入口都调此机制，arXiv **天然优先于 Sci-Hub**（免费源先试，Sci-Hub 是 automatic:false 兜底）。**不加任何 arXiv resolver 或专门路径**（YAGNI）。

## 6. `scihub.enabled` 开关语义

| 状态 | findPDFs.resolvers | Zotero 自带右键 Find Available PDF | MCP find_missing_pdfs fetch |
|---|---|---|---|
| **ON** | 我们的 Sci-Hub 源(automatic:false)写入 | 可用，Zotero 先免费源后 Sci-Hub 兜底 | 走全部源含 Sci-Hub，返回带灰色源提醒 |
| **OFF**（默认） | 移除我们的 Sci-Hub（保留 external + OA） | 仍可用，但只走免费源（arXiv/OA） | 只走免费源，无灰色源提醒 |

配置（`scihub.sources`）在 OFF 时保留不丢。

## 7. 卸载 Sci-PDF + 清理（实现第一步）

- Zotero 端装了 `Sci-PDF v8.0.4`（`scipdf@ytshen.com`）——就是 `findPDFs.resolvers` 里 7 条 `automatic:true` Sci-Hub 的来源（scipdf 卸载不清理 resolver，是干扰源）。
- **步骤**：① 经 `AddonManager` 卸载 `scipdf@ytshen.com`；② 清理 `findPDFs.resolvers` 里 scipdf 残留的无 `mcpManaged` 标记的 sci-hub.* 条目（保留其它 external + OA）；③ 我们用 `automatic:false` 版接管。
- 保留不动：Green Frog（影响因子）、Jasminum（知网）、Translate、插件市场、Google Scholar Citation——非 Sci-Hub 干扰，是用户在用的工具。

## 8. 数据流

**右键**：Zotero 自带 Find Available PDF（注册源后自动含 Sci-Hub），我们不介入——Zotero 自身下载 + 进度提示。

**MCP**：find_missing_pdfs fetch → (scihub.enabled?) addAvailablePDF（含 Sci-Hub resolver）→ 返回 {fetched, results, greySourceWarning?} + 进程内 showNotification。

**面板**：改开关/源 → syncScihubResolvers(enabled, sources) → 写 findPDFs.resolvers。

## 9. 安全与合规

- **灰色源三重明示**：偏好面板副文案 + MCP 工具 description/返回 `greySourceWarning` + 下载提示窗。合规自负（用户辖区法律）。
- **automatic:false**：决不后台静默访问 Sci-Hub；仅手动/工具触发。
- **无自建抓取 → SSRF 面小**：下载走 Zotero 内核，URL 由 Zotero 处理（对比 zotadata 自建下载的 SSRF 反面教材）。
- **默认关闭**：`scihub.enabled` 默认 `false`，显式启用。

## 10. 不做（YAGNI）

- ✗ 不自建抓取（决策①选 native，零抓取代码）——需要验证码兜底/自定义进度时再评估 scipdf 的 SciHubFetcher。
- ✗ 不做 arXiv 专门 resolver/路径（§5，Zotero 内置已覆盖）。
- ✗ 不自建右键菜单（用户拍板复用 Zotero 自带 Find Available PDF，注册源后自动含 Sci-Hub，零代码）。
- ✗ 不做「下载中」逐条进度条（showNotification 够用）。
- ✗ 不做 LibGen/Semantic Scholar 备选源（Sci-Hub + Anna's Archive 够；用户可在源列表自加）。
- ✗ 不做验证码自动跳浏览器。

## 11. 测试策略

- **纯函数单测**（本机）：`syncScihubResolvers`（enabled/disabled 派生正确、保留 external、去重）、预置源全集构造、buildResolver 对新源。
- **selfTest 真机场景**：`manage_pdf_resolvers` enable→list 含 Sci-Hub→disable→list 不含（保留 external）；`find_missing_pdfs` fetch 在 enabled 时返回带 greySourceWarning。
- **手动真机验证**（部署后）：偏好面板开关/源增删/恢复默认；启用 Sci-Hub 后用 Zotero 自带右键 Find Available PDF 对一个无 PDF 条目触发（确认走到 Sci-Hub）；卸载 scipdf 后 resolver 清理正确。

## 12. 文件清单

- 改 `src/modules/pdfResolvers.ts`（预置源扩充 + selector）
- 新 `src/modules/scihubSources.ts`（`syncScihubResolvers` 等纯函数 + 单测）
- 改 `src/modules/streamableMCPServer.ts`（manage_pdf_resolvers enable/disable + find_missing_pdfs 灰色源提醒 + showNotification）
- （不改 `src/hooks.ts` 右键——复用已有 `showNotification` 供 MCP 路径提示，无需新增右键菜单）
- 改 `src/modules/preferenceScript.ts`（开关绑定 + 源列表渲染/增删 + 恢复默认）
- 改 `addon/content/preferences.xhtml`（开关 + 源列表容器 + 添加表单）
- 改 `addon/locale/{en-US,zh-CN}/preferences.ftl`（文案）
- 改 `addon/prefs.js`（`scihub.enabled=false`）
- 新 `test/scihubSources.test.cjs`（syncScihubResolvers 单测）
- 卸载 `scipdf@ytshen.com` + 清理其残留 resolver（部署脚本或首次启动一次性）
