# Server Modularization & Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `streamableMCPServer.ts`（继承基座时已近 2900 行，现约 3700+）拆成「协议层 + 工具定义表 + 按域 handler」，删掉与 selfTest 功能重叠的历史模块 `mcpTest.ts`。纯重构：**行为零变化，selfTest 全绿是唯一验收标准**。

**Architecture:** 三步走：(1) 工具定义（tools 数组的 `{name, description, inputSchema}` 大块纯数据）抽到 `src/modules/toolDefinitions.ts`；(2) `case` handler 按域拆到 `src/modules/handlers/`（search / collections / write / scholarly / pdf / dev 六个文件），主文件保留协议层（initialize、认证、路由、结果封装）+ 一个 `name → handler` 查找表；(3) 删除死模块。参考 54yyyu 仓库 `tools/` 按域分文件的组织方式。

**⚠️ 执行定序约束：本 plan 与其他四份 2026-07-08 plan 全部冲突（它们都往 streamableMCPServer.ts 加工具）。必须最后执行——等功能 plan 全部合并进 main 后再动工，否则 rebase 地狱。**

**Tech Stack:** TypeScript（纯移动代码，无新依赖）。

---

### Task 1: 删除 mcpTest.ts 死模块

**Files:**
- Delete: `src/modules/mcpTest.ts`

- [ ] **Step 1: 确认无引用**

Run: `grep -rn "mcpTest\|testMCPIntegration" src/ addon/ --include="*.ts" --include="*.js" | grep -v "modules/mcpTest.ts"`
Expected: 0 行（若有引用——大概率在偏好页或菜单注册——先看引用处：菜单入口若指向它，把入口改指 `Zotero.ZoteroAgentSelfTest.run` 或一并删除该菜单项，删除理由写进 commit）。

- [ ] **Step 2: 删除 + build + 单测**

```bash
git rm src/modules/mcpTest.ts
npm run build && npm run test:unit
```
Expected: 编译零错误、单测全绿。

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: drop mcpTest.ts (superseded by selfTest.ts)"
```

---

### Task 2: 基线快照（重构安全网）

- [ ] **Step 1: 记录当前行为基线**

```bash
# 行数基线
wc -l src/modules/streamableMCPServer.ts
```
经 MCP 调 `tools/list` 保存完整工具清单 JSON 到本地（工具数、每个工具的 name+schema hash）；部署当前 main 版本跑一次 `Zotero.ZoteroAgentSelfTest.run('protocol')` 记录 passed 数。这三样是重构后的对照物。

- [ ] **Step 2: 无 commit（只是记录，贴进后续 commit message）**

---

### Task 3: 抽出工具定义表

**Files:**
- Create: `src/modules/toolDefinitions.ts`
- Modify: `src/modules/streamableMCPServer.ts`

- [ ] **Step 1: 机械移动 tools 数组**

`streamableMCPServer.ts` 里 `tools/list` handler 返回的那个大数组（每项 `{name, description, inputSchema}`，从第一个工具到最后一个）整体剪切到新文件：

```ts
// src/modules/toolDefinitions.ts
// Pure data: MCP tool declarations. Handlers live in ./handlers/*; keep the two in sync by name.
export const TOOL_DEFINITIONS: any[] = [
  /* 原数组原样粘贴，零改动 */
];
```

主文件 `import { TOOL_DEFINITIONS } from "./toolDefinitions";` 原位替换。**注意**：若数组内有运行时条件过滤（write disabled 时隐藏写工具——selfTest 有此场景，说明过滤逻辑存在），过滤逻辑留在主文件，只移纯数据。

- [ ] **Step 2: 验证零变化**

```bash
npm run build && npm run test:unit
```
再 diff 工具清单：部署后调 `tools/list`，与 Task 2 基线逐 name 比对一致（数量、顺序、schema）。

- [ ] **Step 3: Commit**

```bash
git add src/modules/toolDefinitions.ts src/modules/streamableMCPServer.ts
git commit -m "refactor: extract tool definitions to toolDefinitions.ts (pure move)"
```

---

### Task 4: handler 按域拆分（六批，每批一 commit）

**Files:**
- Create: `src/modules/handlers/searchHandlers.ts`（search_library / search_libraries / search_annotations / search_fulltext / semantic_search / find_similar / semantic_status / fulltext_database / get_item_abstract / get_content / get_item_details / get_annotations / get_libraries）
- Create: `src/modules/handlers/collectionHandlers.ts`（get/search/create/update/delete_collection、get_collection_* / get_subcollections / add_items_to_collection / remove_items_from_collection）
- Create: `src/modules/handlers/writeHandlers.ts`（write_note / write_tag / write_metadata / write_item / batch_update_tags / find_duplicates / merge_duplicates）
- Create: `src/modules/handlers/scholarlyHandlers.ts`（import_by_identifier / import_bibliography / enrich_item_metadata / find_doi / check_retractions / find_related_papers / synthesize_annotations / upgrade_preprints / extract_identifier_from_pdf）
- Create: `src/modules/handlers/pdfHandlers.ts`（find_missing_pdfs / manage_pdf_resolvers）
- Create: `src/modules/handlers/devHandlers.ts`（run_javascript / reload_plugin / install_plugin_from_url / fetch_chinese_metadata / lint_metadata）
- Modify: `src/modules/streamableMCPServer.ts`

> 工具归属清单以拆分时的实际工具集为准（上面按 47 工具的预期写；若某功能 plan 未合并，对应工具顺延）。

- [ ] **Step 1: 定 handler 统一签名**

```ts
// src/modules/handlers/types.ts
export interface HandlerCtx {
  args: any;
  // 主文件现在 case 块里用到的共享依赖逐一显式传入（Zotero 是全局不用传；
  // 动手前先通读 case 块，把用到的闭包变量列全——如 ztoolkit、config、pane 获取逻辑）
  ztoolkit: any;
  config: { addonID: string };
}
export type ToolHandler = (ctx: HandlerCtx) => Promise<any>;
```

- [ ] **Step 2-7: 每批一个域：机械搬运 case 块 → 该域文件导出 `export const searchHandlers: Record<string, ToolHandler>`；主文件 switch 里删除对应 case，改由查找表分发：**

```ts
const HANDLERS: Record<string, ToolHandler> = { ...searchHandlers, ...collectionHandlers, ...writeHandlers, ...scholarlyHandlers, ...pdfHandlers, ...devHandlers };
// switch default 前：
const h = HANDLERS[name];
if (h) { result = await h({ args, ztoolkit, config }); break; }
```

每完成一个域：`npm run build && npm run test:unit` 绿 → commit（`refactor: move <domain> handlers out of streamableMCPServer`）。**搬运纪律**：不改逻辑、不改错误消息文案（selfTest 断言依赖它们）、不顺手优化。

- [ ] **Step 8: 收尾验证主文件只剩协议层**

Run: `wc -l src/modules/streamableMCPServer.ts src/modules/toolDefinitions.ts src/modules/handlers/*.ts`
Expected: 主文件显著缩减（目标 <1200 行：HTTP/session/认证/路由/封装）；总行数 ≈ 基线（纯移动）。

---

### Task 5: 全量回归 + 文档

- [ ] **Step 1: 部署 + selfTest 对照基线**

`npm run build && node scripts/deploy-live.mjs` → `Zotero.ZoteroAgentSelfTest.run('protocol')`
Expected: passed 数 = Task 2 基线，0 failed；`tools/list` 与基线一致。

- [ ] **Step 2: 更新 CLAUDE.md §2 仓库结构（handlers/ 目录）与 §7。Commit**

```bash
git add CLAUDE.md
git commit -m "refactor: modularization complete — docs updated"
```
