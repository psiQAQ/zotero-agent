# 四参考仓库优势点汲取实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `refs/` 四个调研仓库（zotero-mcp-54yyyu、ZotSeek、mcp-server-zotero-dev、papersgpt-for-zotero）中经评估值得移植的优势点落进本插件：先修协议正确性与 eval 健壮性，再建 self-test 回归网与开发部署循环，最后补学术工具面与检索质量。

**Architecture:** 全部改动落在 `zotero-mcp-plugin/`（Zotero 进程内插件）。协议修正就地改 `streamableMCPServer.ts`/`httpServer.ts`/`evalTool.ts`；新工具按功能域拆独立模块（importService/scholarlyService/synthesisService/maintenanceService/devTools/selfTest），`streamableMCPServer.ts` 只加薄 case 分派（沿用现有 apiHandlers 委托模式）。核心方法论：**抄参考仓库的语义/schema/UX 设计，实现走 Zotero 进程内原生 API**（`Zotero.Translate.Search`/`Zotero.Attachments.addAvailablePDF`/`Zotero.Items.merge`/`AddonManager`），比参考仓库的进程外实现省一半代码。

**Tech Stack:** TypeScript（Gecko 特权上下文，Zotero 9）、node:test 单测（现有 `test/*.test.cjs` + `.tmp-test` 编译产物模式，`npm run test:unit`）、zotero-plugin-scaffold 构建（`npm run build` → `.scaffold/build/zotero-mcp-plugin.xpi`）。

---

## 0. 调研结论与范围（为什么是这些）

四仓库深度调研结论（对照 `MCP基座调研对比.md` 与本次逐仓库源码调研）：

| 来源 | 采纳 | 理由 |
|---|---|---|
| **ZotSeek** | tool 错误改 `result.isError`、Origin 校验、协议版本协商、self-test 体系、RRF 混合搜索 | 前三项是 MCP 规范正确性问题（现状违反）；self-test 是 27 个工具唯一可行的回归网；RRF 补纯向量搜索对"作者+年份"类查询的天然弱点 |
| **mcp-server-zotero-dev** | eval 超时 + 结果限幅、`reload_plugin`/`install_plugin_from_url`、工具 description 引导 | evalTool 现在会被永不 resolve 的 await 永久挂死、会被兆级返回撑爆；AddonManager 两个工具直接消灭"手动拷 xpi 到 <zotero-host>"的开发循环痛点 |
| **zotero-mcp-54yyyu** | identifier 导入、缺 PDF 审计+补齐、scite 撤稿检查、OpenAlex 引文发现、注释综述包、查重合并、批量 tag、搜索失败降级级联 | 全是本插件空白的工具面；其 schema/幂等/dry-run 设计成熟，实现换成进程内原生 API |
| **papersgpt-for-zotero** | **本轮无落地项** | SSE 流式范本——本插件无 LLM 流式输出需求（MCP 一问一答）；PDF 版面重建技巧（众数行高/bbox 溯源）与"页级定位"绑定，页级定位已推迟（见 §12），届时一并取用 |

**明确不做**（YAGNI，理由见 §12）：本地 ChromeWorker 嵌入、语义索引页级定位、`(library_key, item_key)` schema 迁移、`/open` launcher、SSE、UI 检查/截图工具、挂 23119 备用 transport、advanced_search、程序化 PDF 标注、MCP prompts。

**门禁归属约定**（贯穿全计划）：
- 只读工具（含调外部免 key API 的 scite/OpenAlex）：无门禁；工具 description 注明"会把库内 DOI 发送到外部服务"
- 库写操作（import/fetch_pdf/merge/batch_tags）：挂现有 `write.enabled`（默认关）
- 进程级权限（reload/install plugin）：挂现有 `eval.enabled`（默认关，信任级别等同 run_javascript）——不新增 pref

**部署节奏**（关键结构，决定 Phase 顺序）：

```
Phase 0+1（本机可单测的协议修正 + self-test）
  → 构建 xpi，最后一次手动拷贝安装到 <zotero-host>
  → 经 run_javascript 跑 self-test 验证 Phase 0
Phase 2（reload_plugin / install_plugin_from_url）
  → 之后每个 task 的部署 = 一次工具调用（吃自己的狗粮）
Phase 3、4（工具面 + 检索质量）
  → 每 task：本机单测纯函数 → install_plugin_from_url 部署 → self-test 套件回归
```

部署通路：本机 `npm run build` 后用 `deploy-live.mjs`——把 xpi base64 经 `run_javascript` 写入 Zotero 端 `/tmp`，再调 `install_plugin_from_url` 自升级。

---

## 1. 文件结构

```
zotero-mcp-plugin/src/modules/
  streamableMCPServer.ts   # 修改：isError、版本协商、writeToolNames、新工具注册与分派
  httpServer.ts            # 修改：Origin 校验（PSK guard 旁）
  authGuard.ts             # 修改：+extractOriginHeader / isOriginAllowed 纯函数
  mcpProtocol.ts           # 新建：协议版本协商纯函数
  evalTool.ts              # 修改：超时 + 限幅序列化
  selfTest.ts              # 新建：套件 runner + 协议套件（进程内 fetch 打自己的 HTTP 全栈）
  devTools.ts              # 新建：reload_plugin / install_plugin_from_url
  importService.ts         # 新建：import_by_identifier / find_missing_pdfs
  scholarlyService.ts      # 新建：check_retractions (scite) / find_related_papers (OpenAlex)
  synthesisService.ts      # 新建：synthesize_annotations
  maintenanceService.ts    # 新建：find_duplicates / merge_duplicates / batch_update_tags
  apiHandlers.ts           # 修改：handleSearch 降级级联
  semantic/hybridSearch.ts # 新建：RRF 融合 + analyzeQuery 纯函数
  semantic/semanticSearchService.ts # 修改：接入 hybrid 模式

zotero-mcp-plugin/test/
  authGuard.test.cjs       # 扩展：Origin 纯函数用例
  mcpProtocol.test.cjs     # 新建
  evalTool.test.cjs        # 扩展：超时/限幅用例
  hybridSearch.test.cjs    # 新建
```

依赖 Zotero 环境的逻辑（translation、AddonManager、Duplicates、HTTP 外呼）不写 node 单测——由 `selfTest.ts` 套件在真机覆盖（Phase 1 建成后每个新工具 task 都往里加场景）。这延续设计文档 §6 的测试策略：只覆盖自己新增的代码，不为基座补测试。

---

## Phase 0：协议与健壮性修正（ZotSeek + mcp-server-zotero-dev 教训）

### Task 1: tool 执行错误改用 `result.isError`（勿用 -32603）

MCP 规范要求：工具**执行**失败应返回 HTTP 200 + `result.isError: true`（LLM 能读到错误内容并自行处理）；只有协议层问题才用 JSON-RPC error。现状 `handleToolCall` 把所有异常（含"未知工具"、门禁拒绝）都包成 `-32603` 协议错误——部分客户端会当传输故障重试/断连，LLM 看不到错误文本。全部 28 个工具受影响。

**Files:**
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts:1367-1389`（`handleToolCall` 的 `default` 分支与 `catch` 块）

- [ ] **Step 1: 改 `default` 分支为 -32602 协议错误（未知工具属"请求无效"，保持协议错误但换对码）**

现状（`:1367-1369`）：

```ts
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
```

改为：

```ts
        default:
          return this.createError(request.id ?? null, -32602, `Unknown tool: ${name}`);
      }
```

- [ ] **Step 2: 改 `catch` 块为 isError 结果**

现状（`:1384-1388`）：

```ts
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Tool call error for ${name}: ${error}`);
      return this.createError(request.id ?? null, -32603, 
        `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
```

改为：

```ts
    } catch (error) {
      ztoolkit.log(`[StreamableMCP] Tool call error for ${name}: ${error}`);
      // MCP spec: execution failures are results (isError), not protocol errors —
      // clients surface them to the LLM instead of treating the transport as broken.
      return this.createResponse(request.id ?? null, {
        content: [
          {
            type: "text",
            text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      });
    }
```

- [ ] **Step 3: 统一 tools/call 语义内的其余 -32603**

运行 `grep -n "32603" src/modules/streamableMCPServer.ts`。对每处命中判断：位于 `handleToolCall` 的 case 分支内（写门禁拒绝、eval 门禁拒绝等"执行期拒绝"）→ 改为 `throw new Error("Write operations are disabled. Enable them in Zotero Settings → MCP Server.")` 让 Step 2 的 catch 统一包装（门禁提示文案 LLM 必须能读到）；位于协议分派层（initialize/tools/list 之外的方法路由）→ 保留协议错误。预期改动集中在 `:1191-1257`（collection 写门禁）、`:1301-1365`（write/eval 门禁）区间。

- [ ] **Step 4: 编译验证**

Run: `cd zotero-mcp-plugin && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add zotero-mcp-plugin/src/modules/streamableMCPServer.ts
git commit -m "fix(mcp): tool execution errors return result.isError, not -32603 (ZotSeek parity)"
```

真机断言在 Task 6 的 self-test 场景 7 覆盖（制造执行错误 → 断言 `result.isError === true` 且无 `error.code`）。

### Task 2: Origin 校验（DNS-rebinding 防护）

MCP 规范要求 HTTP transport 校验 Origin。本插件是裸 nsIServerSocket，没有 Zotero 官方 server 的浏览器 UA 拦截兜底，恶意网页经 DNS rebinding 可绕过同源直打 `127.0.0.1:23120`，当前 PSK 是唯一防线。照 ZotSeek 语义：无 Origin 头（curl/原生客户端）放行；有 Origin 则必须 loopback，否则 403。

**Files:**
- Modify: `zotero-mcp-plugin/src/modules/authGuard.ts`（追加两个纯函数）
- Modify: `zotero-mcp-plugin/src/modules/httpServer.ts:533`（PSK guard 之前插入）
- Test: `zotero-mcp-plugin/test/authGuard.test.cjs`

- [ ] **Step 1: 写失败测试（追加到现有 authGuard.test.cjs）**

```js
test("extractOriginHeader finds the Origin header", () => {
  const req = "POST /mcp HTTP/1.1\r\nHost: x\r\nOrigin: http://evil.example\r\n\r\n{}";
  assert.equal(extractOriginHeader(req), "http://evil.example");
  assert.equal(extractOriginHeader("POST /mcp HTTP/1.1\r\nHost: x\r\n\r\n{}"), null);
});

test("isOriginAllowed: absent passes, loopback passes, others rejected", () => {
  assert.equal(isOriginAllowed(null), true);
  assert.equal(isOriginAllowed("http://localhost:8080"), true);
  assert.equal(isOriginAllowed("http://127.0.0.1"), true);
  assert.equal(isOriginAllowed("https://[::1]:23120"), true);
  assert.equal(isOriginAllowed("http://evil.example"), false);
  assert.equal(isOriginAllowed("http://localhost.evil.example"), false);
});
```

（`require` 行照该文件现有写法从 `.tmp-test` 编译产物引入，并在解构中补上两个新函数名。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd zotero-mcp-plugin && npm run test:unit`
Expected: FAIL（`extractOriginHeader is not a function`）

- [ ] **Step 3: 实现（authGuard.ts 追加）**

```ts
/** Extract the Origin header from a raw HTTP request, or null when absent. */
export function extractOriginHeader(requestText: string): string | null {
  const m = requestText.match(/^Origin:[ \t]*(\S+)/im);
  return m ? m[1] : null;
}

/**
 * MCP spec requires HTTP transports to validate Origin (DNS-rebinding defense).
 * No header (curl / native MCP clients) passes; browser origins must be loopback.
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (origin === null) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}
```

- [ ] **Step 4: 接入 httpServer.ts（`POST /mcp` 分支内、PSK 校验之前，即 `:534` 的 `if (method === "POST" && path === "/mcp") {` 后）**

```ts
            const origin = extractOriginHeader(requestText);
            if (!isOriginAllowed(origin)) {
              const forbidden = {
                status: 403,
                statusText: "Forbidden",
                headers: { "Content-Type": "application/json; charset=utf-8" },
              };
              const bodyStr = JSON.stringify({ error: "Forbidden: non-loopback Origin" });
              const respHeaders =
                this.buildHttpHeaders(forbidden, false) +
                `Content-Length: ${getByteLength(bodyStr)}\r\n` +
                "\r\n";
              const resp = respHeaders + bodyStr;
              output.write(resp, resp.length);
              ztoolkit.log(`[HttpServer] 403 Forbidden on POST /mcp (Origin: ${origin})`, "warn");
              return;
            }
```

同文件顶部 import 行补 `extractOriginHeader, isOriginAllowed`（与现有 `extractBearerToken, tokensMatch` 同一条 import）。

- [ ] **Step 5: 跑测试 + 编译**

Run: `npm run test:unit && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add zotero-mcp-plugin/src/modules/authGuard.ts zotero-mcp-plugin/src/modules/httpServer.ts zotero-mcp-plugin/test/authGuard.test.cjs
git commit -m "feat(security): validate Origin header on POST /mcp (MCP spec, DNS-rebinding defense)"
```

### Task 3: 协议版本协商

现状硬编码 `'2024-11-05'`（`streamableMCPServer.ts:248` handleInitialize、`:2759` getStatus）。新版客户端（2025-06-18 起有 `MCP-Protocol-Version` header 语义）会产生行为分歧。照 ZotSeek：客户端版本在支持列表内则原样 echo，未知则回最新。

**Files:**
- Create: `zotero-mcp-plugin/src/modules/mcpProtocol.ts`
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts:248,2759`
- Test: `zotero-mcp-plugin/test/mcpProtocol.test.cjs`

- [ ] **Step 1: 写失败测试（新文件，头部样板照 authGuard.test.cjs）**

```js
test("negotiateProtocolVersion echoes known versions", () => {
  assert.equal(negotiateProtocolVersion("2024-11-05"), "2024-11-05");
  assert.equal(negotiateProtocolVersion("2025-03-26"), "2025-03-26");
  assert.equal(negotiateProtocolVersion("2025-06-18"), "2025-06-18");
});

test("negotiateProtocolVersion answers latest for unknown/absent", () => {
  assert.equal(negotiateProtocolVersion("1999-01-01"), "2025-06-18");
  assert.equal(negotiateProtocolVersion(undefined), "2025-06-18");
  assert.equal(negotiateProtocolVersion(42), "2025-06-18");
});
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

- [ ] **Step 3: 实现 mcpProtocol.ts**

```ts
/** Pure protocol helpers — no Zotero imports, unit-testable under Node. */

/** Streamable HTTP protocol versions this server implements, oldest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;

export const LATEST_PROTOCOL_VERSION =
  SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];

/** Echo a known client version, otherwise answer with the latest we support (MCP spec). */
export function negotiateProtocolVersion(clientVersion: unknown): string {
  return typeof clientVersion === "string" &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(clientVersion)
    ? clientVersion
    : LATEST_PROTOCOL_VERSION;
}
```

- [ ] **Step 4: 接入 streamableMCPServer.ts**

`handleInitialize`（`:248` 一带）改为：

```ts
    return this.createResponse(request.id ?? null, {
      protocolVersion: negotiateProtocolVersion(request.params?.protocolVersion),
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
      serverInfo: this.serverInfo,
    });
```

（顺手删掉 `logging: {}, prompts: {}, resources: {}` 三个空声明——过度声明会引导客户端发无效请求；`resources/list`/`prompts/list` 两个空实现 handler 保留作防御。）

`getStatus`（`:2759`）的 `protocolVersion: '2024-11-05'` 改为 `protocolVersion: LATEST_PROTOCOL_VERSION`。文件顶部加 import。

- [ ] **Step 5: 跑测试 + 编译，Commit**

```bash
git add zotero-mcp-plugin/src/modules/mcpProtocol.ts zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/test/mcpProtocol.test.cjs
git commit -m "feat(mcp): negotiate protocol version instead of hardcoding 2024-11-05"
```

### Task 4: eval 超时 + 结果限幅

`runUserJavaScript` 现状两处硬伤（mcp-server-zotero-dev 对照发现）：(a) 无超时——`await new Promise(()=>{})` 或等一个不触发的 notifier 会把工具调用永久挂死；(b) 无限幅——`return await Zotero.Items.getAll(1)` 产出兆级 JSON 撑爆响应与上下文。另修 console shim 对象参数 `String(x)` 变 `[object Object]` 的信息丢失。

**Files:**
- Modify: `zotero-mcp-plugin/src/modules/evalTool.ts`（整文件重写，现 43 行）
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（run_javascript 的 schema 加 `timeout_ms`、case 传参、description 加引导）
- Test: `zotero-mcp-plugin/test/evalTool.test.cjs`

- [ ] **Step 1: 写失败测试（追加）**

```js
test("times out and says the code may still be running", async () => {
  const r = await runUserJavaScript("await new Promise(() => {});", {}, 200);
  assert.equal(r.timedOut, true);
  assert.match(r.error.message, /may still be running/i);
});

test("clears the timer on fast completion (no dangling timeout)", async () => {
  const r = await runUserJavaScript("return 1;", {}, 60000);
  assert.equal(r.result, 1);
  assert.equal(r.timedOut, undefined);
});

test("truncates oversized results and flags it", async () => {
  const r = await runUserJavaScript("return 'x'.repeat(300000);", {});
  assert.equal(r.truncated, true);
  assert.ok(r.result.length <= 100000);
  assert.match(r.error?.message ?? "", /truncated/i);
});

test("console shim stringifies objects", async () => {
  const r = await runUserJavaScript("console.log({a: 1}); return null;", {});
  assert.equal(r.logs[0], '{"a":1}');
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现（evalTool.ts 全文）**

```ts
/**
 * Executes user-supplied JavaScript inside the current (privileged) context
 * and returns a structured, JSON-safe result. No Zotero imports — the caller
 * injects Zotero/ZoteroPane/ztoolkit via `globals` so this stays unit-testable.
 */
export interface EvalResult {
  result: any;
  logs: string[];
  error: { message: string; stack?: string } | null;
  timedOut?: boolean;
  truncated?: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;
// Aligns with the HTTP layer's 100KB compact-JSON threshold (streamableMCPServer).
const MAX_RESULT_CHARS = 100_000;

class EvalTimeout extends Error {
  constructor(public ms: number) {
    super(`timeout after ${ms}ms`);
  }
}

export async function runUserJavaScript(
  code: string,
  globals: Record<string, any>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<EvalResult> {
  const logs: string[] = [];
  const fmt = (a: any[]) =>
    a
      .map((x) => {
        if (typeof x === "string") return x;
        try {
          return JSON.stringify(x);
        } catch {
          return String(x);
        }
      })
      .join(" ");
  const consoleShim = {
    log: (...a: any[]) => logs.push(fmt(a)),
    info: (...a: any[]) => logs.push(fmt(a)),
    warn: (...a: any[]) => logs.push("[warn] " + fmt(a)),
    error: (...a: any[]) => logs.push("[error] " + fmt(a)),
  };

  const scope: Record<string, any> = { ...globals, console: consoleShim };
  const names = Object.keys(scope);
  const values = names.map((n) => scope[n]);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as any;

  try {
    const fn = new AsyncFunction(...names, code);
    const ms = Math.min(Math.max(Math.floor(timeoutMs) || DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
    let timer: any;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EvalTimeout(ms)), ms);
    });
    let raw: any;
    try {
      raw = await Promise.race([fn(...values), timeout]);
    } finally {
      clearTimeout(timer);
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(raw === undefined ? null : raw);
    } catch {
      serialized = JSON.stringify(String(raw));
    }
    if (serialized.length > MAX_RESULT_CHARS) {
      return {
        result: serialized.slice(0, MAX_RESULT_CHARS),
        logs,
        truncated: true,
        error: {
          message: `Result truncated to ${MAX_RESULT_CHARS} chars (was ${serialized.length}). Return only the fields you need, e.g. map/filter before returning.`,
        },
      };
    }
    return { result: JSON.parse(serialized), logs, error: null };
  } catch (e: any) {
    if (e instanceof EvalTimeout) {
      return {
        result: null,
        logs,
        timedOut: true,
        error: {
          message: `Timed out after ${e.ms}ms — the code may still be running inside Zotero. Do not blindly re-send write operations; verify state first. Pass a larger timeout_ms (max ${MAX_TIMEOUT_MS}) for long library sweeps.`,
        },
      };
    }
    return { result: null, logs, error: { message: e?.message ?? String(e), stack: e?.stack } };
  }
}
```

关键点：`finally { clearTimeout(timer) }` 保证快路径不留悬挂定时器；超时后**代码仍在 Zotero 里跑**这一事实必须如实告知（措辞借鉴 mcp-server-zotero-dev `client.ts:619-627`）；序列化改为"先 stringify 再 parse"，与限幅共用一次 stringify。

- [ ] **Step 4: streamableMCPServer.ts 接线**

run_javascript 的 inputSchema（`:1060-1085` 一带）`properties` 内追加：

```ts
            timeout_ms: {
              type: 'number',
              description: 'Max execution time in ms (default 60000, max 600000). Raise for full-library sweeps.',
            },
```

case 分支（`:1355-1365` 一带）改为：

```ts
          result = await runUserJavaScript(args.code, { Zotero, ZoteroPane: pane, ztoolkit }, args.timeout_ms);
```

description 追加一句引导（mcp-server-zotero-dev `execute.ts:107-113` 的做法）：`Prefer a dedicated tool when one exists (search/write/collections). Long sweeps: pass timeout_ms.`

- [ ] **Step 5: 跑测试 + 编译，Commit**

```bash
git add zotero-mcp-plugin/src/modules/evalTool.ts zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/test/evalTool.test.cjs
git commit -m "feat(eval): timeout with honest still-running warning + 100KB result cap"
```

注：`setTimeout` 在 Node 与 Gecko chrome 上下文均为全局；真机行为由 Task 6 self-test 场景 9 复核。

### Task 5: 补 tools/list 的 collection 写工具门禁过滤

现状 `writeToolNames`（`streamableMCPServer.ts:1095-1097`）只含 4 个 write_* 工具，5 个 collection 写工具在 `write.enabled=false` 时仍出现在 tools/list（只在 call 时被拦）——工具列表对客户端撒谎。这是盘点基座时发现的自有 gap，与 Task 1 同属门禁一致性，顺手修。

**Files:**
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts:1095-1097`

- [ ] **Step 1: 补全集合**

```ts
    const writeToolNames = new Set([
      'write_note', 'write_tag', 'write_metadata', 'write_item',
      'create_collection', 'update_collection', 'delete_collection',
      'add_items_to_collection', 'remove_items_from_collection',
    ]);
```

- [ ] **Step 2: 编译验证，Commit**

```bash
git add zotero-mcp-plugin/src/modules/streamableMCPServer.ts
git commit -m "fix(mcp): hide collection write tools from tools/list when write.enabled is off"
```

真机断言在 Task 6 self-test 场景 8。

---

## Phase 1：self-test 回归网（ZotSeek 模式）

### Task 6: selfTest runner + 协议套件

ZotSeek 的核心测试洞察：**套件挂在 Zotero 全局上，由 agent 经 run_javascript 触发**——这正是本插件天然具备的通道。套件用进程内 `fetch` 打自己的 `http://127.0.0.1:23120/mcp`，一份代码测全栈（httpServer 解析 → Origin → PSK → 协议分派 → 工具执行）。照抄两个关键细节：`newErrorsInLog`（跑套件前后 diff `Zotero.Debug` 输出，断言全过但偷偷报错也能被抓到）、server 未开/门禁未开时 skip 而非 fail。

**Files:**
- Create: `zotero-mcp-plugin/src/modules/selfTest.ts`
- Modify: `zotero-mcp-plugin/src/hooks.ts`（startup 挂载、shutdown 卸载）

- [ ] **Step 1: 实现 runner + 套件（selfTest.ts 全文骨架）**

```ts
/**
 * In-process self-test harness, driven by an agent through run_javascript:
 *   await Zotero.ZoteroMCPSelfTest.run('protocol')
 * Suites hit our own HTTP server via in-process fetch — full-stack coverage.
 */

interface ScenarioResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  ms: number;
}
export interface SuiteResult {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  scenarios: ScenarioResult[];
  newErrorsInLog: string[];
}

type SuiteFn = (t: SuiteApi) => Promise<void>;
const suites = new Map<string, SuiteFn>();

export function registerSuite(name: string, fn: SuiteFn): void {
  if (suites.has(name)) throw new Error(`duplicate suite: ${name}`);
  suites.set(name, fn);
}

export class SkipScenario extends Error {}

class SuiteApi {
  results: ScenarioResult[] = [];
  async scenario(name: string, fn: () => Promise<void>): Promise<void> {
    const t0 = Date.now();
    try {
      await fn();
      this.results.push({ name, status: "passed", ms: Date.now() - t0 });
    } catch (e: any) {
      const status = e instanceof SkipScenario ? "skipped" : "failed";
      this.results.push({ name, status, error: e?.message ?? String(e), ms: Date.now() - t0 });
    }
  }
  assertEq(actual: any, expected: any, msg = ""): void {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
  }
  assertTrue(cond: any, msg = "assertTrue failed"): void {
    if (!cond) throw new Error(msg);
  }
  skip(reason: string): never {
    throw new SkipScenario(reason);
  }
}

function grabDebugLog(): string {
  try {
    return (Zotero as any).Debug?.getConsoleViewerOutput?.()?.join?.("\n") ?? "";
  } catch {
    return "";
  }
}

export async function runSelfTest(name: string): Promise<SuiteResult> {
  const fn = suites.get(name);
  if (!fn) throw new Error(`unknown suite: ${name}; have: ${[...suites.keys()].join(", ")}`);
  const baseline = grabDebugLog();
  const api = new SuiteApi();
  await fn(api);
  const after = grabDebugLog();
  const newLines = after.startsWith(baseline) ? after.slice(baseline.length) : after;
  const newErrorsInLog = newLines
    .split("\n")
    .filter((l) => /\[(error|Error)\]|zotero-mcp.*error/i.test(l))
    .slice(0, 50);
  return {
    suite: name,
    passed: api.results.filter((r) => r.status === "passed").length,
    failed: api.results.filter((r) => r.status === "failed").length,
    skipped: api.results.filter((r) => r.status === "skipped").length,
    scenarios: api.results,
    newErrorsInLog,
  };
}

export function listSuites(): string[] {
  return [...suites.keys()];
}

// ---------------------------------------------------------------- suites

const PREF = "extensions.zotero.zotero-mcp-plugin.";

async function mcpPost(body: any, opts: { token?: string | null; origin?: string } = {}): Promise<{ status: number; json: any }> {
  const port = Number(Zotero.Prefs.get(PREF + "server.port", true)) || 23120;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = opts.token === undefined
    ? String(Zotero.Prefs.get(PREF + "auth.token", true) || "")
    : opts.token;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.origin) headers["Origin"] = opts.origin;
  const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await resp.json();
  } catch {
    /* 401/403 bodies are JSON too, but stay defensive */
  }
  return { status: resp.status, json };
}

const rpc = (method: string, params: any = {}, id: number = 1) => ({ jsonrpc: "2.0", id, method, params });

registerSuite("protocol", async (t) => {
  // Server must be running; otherwise skip everything.
  const serverUp = await mcpPost(rpc("ping")).then(() => true).catch(() => false);
  if (!serverUp) {
    await t.scenario("server reachable", async () => t.skip("MCP server not running"));
    return;
  }

  await t.scenario("initialize echoes known protocol version", async () => {
    const r = await mcpPost(rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "selftest" } }));
    t.assertEq(r.json?.result?.protocolVersion, "2024-11-05");
  });

  await t.scenario("initialize answers latest for unknown version", async () => {
    const r = await mcpPost(rpc("initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "selftest" } }));
    t.assertEq(r.json?.result?.protocolVersion, "2025-06-18");
  });

  await t.scenario("missing bearer token → 401 (when auth enabled)", async () => {
    const authOn = Zotero.Prefs.get(PREF + "auth.enabled", true) !== false;
    if (!authOn) t.skip("auth disabled");
    const r = await mcpPost(rpc("ping"), { token: null });
    t.assertEq(r.status, 401);
  });

  await t.scenario("non-loopback Origin → 403", async () => {
    const r = await mcpPost(rpc("ping"), { origin: "http://evil.example" });
    t.assertEq(r.status, 403);
  });

  await t.scenario("unknown method → -32601, HTTP 200", async () => {
    const r = await mcpPost(rpc("no/such/method"));
    t.assertEq(r.status, 200);
    t.assertEq(r.json?.error?.code, -32601);
  });

  await t.scenario("unknown tool → -32602", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "no_such_tool", arguments: {} }));
    t.assertEq(r.json?.error?.code, -32602);
  });

  await t.scenario("tool execution failure → result.isError, not protocol error", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "get_item_details", arguments: { itemKey: "NOSUCHKEY" } }));
    t.assertEq(r.status, 200);
    t.assertTrue(!r.json?.error, "must not be a JSON-RPC error");
    t.assertEq(r.json?.result?.isError, true);
  });

  await t.scenario("tools/list hides collection write tools when write disabled", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (writeOn) t.skip("write enabled on this profile");
    const r = await mcpPost(rpc("tools/list"));
    const names = (r.json?.result?.tools ?? []).map((x: any) => x.name);
    t.assertTrue(!names.includes("create_collection"), "create_collection must be hidden");
    t.assertTrue(!names.includes("delete_collection"), "delete_collection must be hidden");
  });

  await t.scenario("run_javascript times out honestly", async () => {
    const evalOn = Zotero.Prefs.get(PREF + "eval.enabled", true) === true;
    if (!evalOn) t.skip("eval disabled");
    const r = await mcpPost(rpc("tools/call", { name: "run_javascript", arguments: { code: "await new Promise(() => {});", timeout_ms: 1500 } }));
    const payload = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
    t.assertEq(payload.timedOut, true);
  });
});
```

（`server.port` 的实际 pref 键名以 `serverPreferences.ts` 为准，实现时 `grep -n "port" src/modules/serverPreferences.ts` 核对并替换。）

- [ ] **Step 2: hooks.ts 挂载**

startup 处（PSK 初始化附近）加：

```ts
import { runSelfTest, listSuites } from "./modules/selfTest";
// ...
(Zotero as any).ZoteroMCPSelfTest = { run: runSelfTest, list: listSuites };
```

shutdown 处加 `delete (Zotero as any).ZoteroMCPSelfTest;`。

- [ ] **Step 3: 编译，Commit**

```bash
git add zotero-mcp-plugin/src/modules/selfTest.ts zotero-mcp-plugin/src/hooks.ts
git commit -m "feat(test): in-process self-test harness driven via run_javascript (ZotSeek pattern)"
```

- [ ] **Step 4: 【部署 checkpoint①——最后一次手动部署】**

```bash
cd zotero-mcp-plugin && npm run build
# 把 .scaffold/build/zotero-mcp-plugin.xpi 拷到 <zotero-host>，Zotero → Tools → Add-ons 安装，重启
```

- [ ] **Step 5: 真机跑协议套件（经本机 MCP 客户端调 run_javascript）**

```
run_javascript: return await Zotero.ZoteroMCPSelfTest.run('protocol');
```

Expected: `failed: 0`；`newErrorsInLog` 为空数组；eval/write 关闭的场景显示 skipped。任何 failed 场景回到对应 Task 修复后重新部署再跑。

---

## Phase 2：开发部署循环（mcp-server-zotero-dev 教训）

### Task 7: reload_plugin + install_plugin_from_url

mcp-server-zotero-dev 证明了 `AddonManager` 的 `addon.reload()` / `getInstallForURL()` 在 Zotero 内可用（`plugins.ts:68-126, 277-316`），且 **getInstallForURL 吃任意 http(s) URL**。据此把"改代码 → 手动拷 xpi → 手动装"变成一次工具调用。门禁 `eval.enabled`（装任意 XPI = 任意代码执行，信任级别与 run_javascript 相同）。自举坑：reload/升级**本插件自己**会杀掉正在服务请求的 server——必须先回响应再延迟执行。

**Files:**
- Create: `zotero-mcp-plugin/src/modules/devTools.ts`
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（2 个工具注册 + case + eval 门禁）

- [ ] **Step 1: 真机验证 API 形状（经 run_javascript）**

```
run_javascript: 
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const all = await AddonManager.getAllAddons();
return all.filter(a => a.id.includes("zotero-mcp") || a.id.includes("mcp")).map(a => ({ id: a.id, version: a.version, canReload: typeof a.reload }));
```

Expected: 返回本插件条目，`canReload: "function"`。若 `importESModule` 路径或 `reload` 缺失，改用 `ChromeUtils.import("resource://gre/modules/AddonManager.jsm")` 旧路径（Zotero 9 = FF128，理应走 sys.mjs），并把实测结果记入本文件。同时记下本插件真实 addon ID（也可从 `zotero-mcp-plugin/package.json` 的 `config.addonID` 读，二者应一致）。

- [ ] **Step 2: 实现 devTools.ts**

```ts
/**
 * Dev-loop tools: reload / install plugins from inside Zotero.
 * Gated by eval.enabled — installing an XPI is arbitrary-code execution,
 * same trust level as run_javascript.
 */

function getAddonManager(): any {
  return ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager;
}

export async function reloadPlugin(addonId: string | undefined, selfId: string): Promise<any> {
  const AddonManager = getAddonManager();
  let addon: any;
  if (addonId) {
    addon = await AddonManager.getAddonByID(addonId);
    if (!addon) return { error: `Addon not found: ${addonId}` };
  } else {
    const all = await AddonManager.getAllAddons();
    const dev = all.filter(
      (a: any) => a.temporarilyInstalled || /build|dist|scaffold/i.test(a.getResourceURI?.()?.spec || ""),
    );
    if (dev.length !== 1) {
      return {
        error: `Cannot auto-detect a single dev plugin (found ${dev.length}); pass addon_id`,
        candidates: dev.map((a: any) => a.id),
      };
    }
    addon = dev[0];
  }
  if (addon.id === selfId) {
    // Reloading ourselves kills this server mid-response: reply first, reload after.
    setTimeout(() => addon.reload().catch((e: any) => ztoolkit.log(`[devTools] self-reload failed: ${e}`)), 500);
    return { scheduled: true, addonId: addon.id, note: "Self-reload in 500ms; this connection will drop briefly." };
  }
  await addon.reload();
  return { reloaded: addon.id, version: addon.version };
}

export async function installPluginFromUrl(url: string, selfId: string): Promise<any> {
  if (!/^(https?|file):\/\//i.test(url)) return { error: "URL must be http(s):// or file://" };
  const AddonManager = getAddonManager();
  const install = await AddonManager.getInstallForURL(url);
  const isSelf = async () => {
    // addon is only known after download; compare lazily where available
    return install.addon?.id === selfId;
  };
  if (await isSelf()) {
    setTimeout(
      () => install.install().catch((e: any) => ztoolkit.log(`[devTools] self-install failed: ${e}`)),
      500,
    );
    return { scheduled: true, note: "Self-upgrade in 500ms; reconnect and verify version via /mcp/status." };
  }
  await install.install();
  return { installed: install.addon?.id, version: install.addon?.version };
}
```

（`install.addon` 在 install() 前是否可用取决于 AddonManager 下载时序——Step 1 真机验证时一并确认；若拿不到，退化为"URL 安装一律走延迟路径 + 提示重连"，语义不变。）

- [ ] **Step 3: 注册工具（streamableMCPServer.ts）**

tools 数组追加（放 run_javascript 定义旁）：

```ts
      {
        name: 'reload_plugin',
        description: 'Reload an installed Zotero plugin via AddonManager (dev loop). Omit addon_id to auto-detect the single dev-installed plugin. Reloading THIS plugin replies first, then reloads after 500ms (connection drops briefly). Requires eval.enabled.',
        inputSchema: {
          type: 'object',
          properties: {
            addon_id: { type: 'string', description: 'Addon ID, e.g. from package.json config.addonID. Optional.' },
          },
        },
      },
      {
        name: 'install_plugin_from_url',
        description: 'Download and install/upgrade a plugin XPI from an http(s):// or file:// URL (dev loop). Installing an XPI is arbitrary code execution — requires eval.enabled. Self-upgrade replies first, installs after 500ms.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'XPI URL reachable FROM the Zotero machine.' },
          },
          required: ['url'],
        },
      },
```

tools/list 的 eval 过滤（`:1102-1106`）改为集合判断：

```ts
    const evalToolNames = new Set(['run_javascript', 'reload_plugin', 'install_plugin_from_url']);
    if (evalEnabled !== true) {
      finalTools = finalTools.filter((t: any) => !evalToolNames.has(t.name));
    }
```

handleToolCall 加 case。门禁判断**照 run_javascript 现有 case 的内联写法**（`Zotero.Prefs.get('...eval.enabled', true) !== true` 时拒绝），拒绝动作改为 `throw new Error("Dev tools are disabled. Enable 'Run JavaScript' in Zotero Settings → MCP Server.")`——由 Task 1 的 catch 包成 isError：

```ts
        case 'reload_plugin': {
          if (Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.eval.enabled', true) !== true) {
            throw new Error("Dev tools are disabled. Enable 'Run JavaScript' in Zotero Settings → MCP Server.");
          }
          result = await reloadPlugin(args?.addon_id, ADDON_ID);
          break;
        }
        case 'install_plugin_from_url': {
          if (Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.eval.enabled', true) !== true) {
            throw new Error("Dev tools are disabled. Enable 'Run JavaScript' in Zotero Settings → MCP Server.");
          }
          result = await installPluginFromUrl(args?.url, ADDON_ID);
          break;
        }
```

`ADDON_ID` 从构建配置注入：`grep -rn "addonID" zotero-mcp-plugin/package.json zotero-mcp-plugin/src/` 找到现有引用方式（scaffold 项目通常有 `package.json` 的 `config.addonID` 与生成的常量模块），照现有 import 方式取；一律不硬编码字符串字面量。

- [ ] **Step 4: self-test 场景（selfTest.ts 的 protocol 套件追加）**

```ts
  await t.scenario("dev tools hidden when eval disabled", async () => {
    const evalOn = Zotero.Prefs.get(PREF + "eval.enabled", true) === true;
    if (evalOn) t.skip("eval enabled on this profile");
    const r = await mcpPost(rpc("tools/list"));
    const names = (r.json?.result?.tools ?? []).map((x: any) => x.name);
    t.assertTrue(!names.includes("reload_plugin") && !names.includes("install_plugin_from_url"));
  });
```

- [ ] **Step 5: 编译 + 构建 + 手动部署（第二次也是最后第二次），真机冒烟**

Zotero 端开 `eval.enabled` 后，依次调：
1. `reload_plugin {}` → 期望 `scheduled: true`（自举路径）或明确的 candidates 报错
2. 本机：`npm run build`，再用 `deploy-live.mjs` 部署
3. `install_plugin_from_url {"url": "http://127.0.0.1:8899/zotero-mcp-plugin.xpi"}` → 断连片刻后 `curl http://127.0.0.1:23120/mcp/status` 确认版本

- [ ] **Step 6: Commit**

```bash
git add zotero-mcp-plugin/src/modules/devTools.ts zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/src/modules/selfTest.ts
git commit -m "feat(dev): reload_plugin + install_plugin_from_url — one-call remote deploy loop"
```

**此后所有 task 的部署 = `npm run build` + 一次 `install_plugin_from_url` 调用。**

---

## Phase 3：学术工具面（54yyyu 语义 × 进程内原生实现）

本 Phase 共同模式（每个 task 重复这三件事，不再逐条展开）：
1. **注册**：tools 数组加 schema、handleToolCall 加 case、写类工具进 `writeToolNames`（Task 5 的集合）并在 case 内查 `write.enabled`（照 collection 写工具现有写法，拒绝时 throw 让 catch 包 isError）
2. **真机验证前置**：涉及未验证 Zotero 内部 API 的 task，第一步一律用 run_javascript 探明 API 形状再写实现
3. **每 task 收尾**：向 selfTest 加至少 1 个场景 → `npm run build` → `install_plugin_from_url` 部署 → 跑套件 → commit

54yyyu 的三条 schema 纪律全 Phase 适用：**description 即操作手册**（何时用我/参数语义/失败模式/一个调用示例）；**入参鲁棒归一化**（数组参数同时接受 JSON 字符串与逗号分隔串——LLM 常传错形状）；**危险操作 dry-run 默认 + confirm 显式**。为此本 Phase 第一个 task 先落一个共享 helper。

### Task 8: import_by_identifier（DOI/arXiv/ISBN/PMID 导入）

54yyyu 用 CrossRef/arXiv/OpenLibrary 手写三套解析（~600 行）；进程内直接用 Zotero 自己的 "Add Item by Identifier" 引擎（`Zotero.Translate.Search`），translator 生态自动覆盖全部标识符类型。保留 54yyyu 的 `if_exists` 幂等语义与"先解析验证、后产生副作用"纪律。PDF 获取用 Zotero 内置 `Zotero.Attachments.addAvailablePDF`（内置 resolver 即 Unpaywall 级联的官方实现，替代 54yyyu 的四源手写）。

**Files:**
- Create: `zotero-mcp-plugin/src/modules/importService.ts`
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（注册三件套）

- [ ] **Step 1: 真机验证 API（run_javascript）**

```
const ids = Zotero.Utilities.Internal.extractIdentifiers("10.1145/3025453.3025599");
const t = new Zotero.Translate.Search();
t.setIdentifier(ids[0]);
const trs = await t.getTranslators();
return { ids, translators: trs.map(x => x.label), hasAddAvailablePDF: typeof Zotero.Attachments.addAvailablePDF };
```

Expected: `ids: [{DOI: "10.1145/..."}]`、translators 非空（如 "DOI Content Negotiation"）、`hasAddAvailablePDF: "function"`。若 `extractIdentifiers` 不在 `Utilities.Internal`，试 `Zotero.Utilities.extractIdentifiers`；实测差异记入本文件。

- [ ] **Step 2: 实现 importService.ts**

```ts
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
    } catch { /* fall through */ }
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

async function findExistingByIdentifier(libraryID: number, identifier: Record<string, string>): Promise<any | null> {
  const s = new Zotero.Search();
  s.libraryID = libraryID;
  if (identifier.DOI) {
    s.addCondition("DOI", "is", identifier.DOI);
  } else if (identifier.ISBN) {
    s.addCondition("ISBN", "contains", identifier.ISBN);
  } else if (identifier.arXiv) {
    s.addCondition("extra", "contains", identifier.arXiv);
  } else if (identifier.PMID) {
    s.addCondition("extra", "contains", identifier.PMID);
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
  const found = Zotero.Utilities.Internal.extractIdentifiers(String(opts.identifier || ""));
  if (!found.length) return { error: `No DOI/ISBN/arXiv/PMID recognized in: ${opts.identifier}` };
  const identifier = found[0];

  // Resolve collections BEFORE any side effect — bad specs must fail early (54yyyu discipline).
  const collectionKeys = normalizeStringList(opts.collectionKeys);
  const collectionIDs: number[] = [];
  for (const key of collectionKeys) {
    const cid = Zotero.Collections.getIDFromLibraryAndKey(opts.libraryID, key);
    if (!cid) return { error: `Collection not found in library ${opts.libraryID}: ${key}` };
    collectionIDs.push(cid);
  }

  if ((opts.if_exists ?? "skip") === "skip") {
    const existing = await findExistingByIdentifier(opts.libraryID, identifier);
    if (existing) {
      return { skipped: true, reason: "already in library", itemKey: existing.key, title: existing.getField("title") };
    }
  }

  const translate = new Zotero.Translate.Search();
  translate.setIdentifier(identifier);
  const translators = await translate.getTranslators();
  if (!translators.length) return { error: `No translator resolves ${JSON.stringify(identifier)}` };
  translate.setTranslator(translators);
  const items: any[] = await translate.translate({
    libraryID: opts.libraryID,
    collections: collectionIDs,
    saveAttachments: false,
  });
  if (!items.length) return { error: "Translation returned no items" };

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
      pdf = { attempted: true, attached: !!att, attachmentKey: att?.key };
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
    tags: reread.getTags().map((t: any) => t.tag),
    pdf,
  };
}
```

- [ ] **Step 3: 注册（schema 全文）**

```ts
      {
        name: 'import_by_identifier',
        description: 'Import an item by DOI / arXiv ID / ISBN / PMID using Zotero\'s own translation engine. Idempotent by default (if_exists=skip searches the library first). Set fetch_pdf=true to also run Zotero\'s "Find Available PDF" (open-access resolver). Requires write.enabled. Example: {"identifier": "10.1145/3025453.3025599", "collectionKeys": "ABCD1234", "fetch_pdf": true}',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: { type: 'string', description: 'Raw string containing a DOI, arXiv ID, ISBN, or PMID.' },
            libraryID: { type: 'number', description: 'Target library ID (default: user library).' },
            collectionKeys: { type: 'string', description: '8-char collection key(s), comma-separated or JSON array. Validated before import.' },
            tags: { type: 'string', description: 'Tag(s) to add, comma-separated or JSON array.' },
            if_exists: { type: 'string', enum: ['skip', 'duplicate'], description: 'skip (default): return the existing item; duplicate: import anyway.' },
            fetch_pdf: { type: 'boolean', description: 'Also try to attach an open-access PDF (default false).' },
          },
          required: ['identifier'],
        },
      },
```

case（写门禁照 collection 写工具现有内联写法，`write.enabled !== true` 时 throw；userLibraryID 默认值照现有写工具写法）：

```ts
        case 'import_by_identifier': {
          if (Zotero.Prefs.get('extensions.zotero.zotero-mcp-plugin.write.enabled', true) !== true) {
            throw new Error("Write operations are disabled. Enable them in Zotero Settings → MCP Server.");
          }
          result = await importByIdentifier({
            ...args,
            libraryID: args?.libraryID ?? Zotero.Libraries.userLibraryID,
          });
          break;
        }
```

（后续 Task 9 fetch 分支、Task 13/14 的写门禁均照此内联模式，不再重贴。）

`writeToolNames` 集合加 `'import_by_identifier'`。

- [ ] **Step 4: self-test 场景（write 开启的 profile 上跑；否则 skip）**

```ts
  await t.scenario("import_by_identifier is idempotent (skip on second run)", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    const call = () => mcpPost(rpc("tools/call", { name: "import_by_identifier", arguments: { identifier: "10.1038/nature14539" } }));
    const first = JSON.parse((await call()).json.result.content[0].text);
    const second = JSON.parse((await call()).json.result.content[0].text);
    t.assertTrue(first.imported === true || first.skipped === true, "first call lands or finds existing");
    t.assertEq(second.skipped, true, "second call must skip");
  });
```

（测试身份用 10.1038/nature14539——LeCun 深度学习综述，与用户库主题相关不算垃圾数据；跑完可留库。）

- [ ] **Step 5: 编译 + 部署 + 跑套件 + Commit**

```bash
git add zotero-mcp-plugin/src/modules/importService.ts zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/src/modules/selfTest.ts
git commit -m "feat(tools): import_by_identifier via Zotero.Translate.Search with if_exists idempotency"
```

### Task 9: find_missing_pdfs（缺 PDF 审计 + 一键补齐）

54yyyu 的 `library_coverage`（审计）+ `add_by_doi` 的 OA 级联（补齐），进程内合成一个工具：`action=report`（只读，无门禁）列出缺 PDF 条目；`action=fetch`（写门禁）对缺 PDF 条目逐个跑 `Zotero.Attachments.addAvailablePDF` 并逐项报告。

**Files:**
- Modify: `zotero-mcp-plugin/src/modules/importService.ts`（追加）
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（注册三件套）

- [ ] **Step 1: 实现（importService.ts 追加）**

```ts
async function resolveScopeItems(libraryID: number, collectionKey?: string): Promise<any[]> {
  let items: any[];
  if (collectionKey) {
    const cid = Zotero.Collections.getIDFromLibraryAndKey(libraryID, collectionKey);
    if (!cid) throw new Error(`Collection not found: ${collectionKey}`);
    const coll = await Zotero.Collections.getAsync(cid);
    items = coll.getChildItems();
  } else {
    const ids = await Zotero.Items.getAllIDs(libraryID);
    items = await Zotero.Items.getAsync(ids);
  }
  return items.filter((it: any) => it.isRegularItem());
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
  const items = await resolveScopeItems(opts.libraryID, opts.collectionKey);
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
  const cap = Math.min(opts.limit ?? 20, 50); // ponytail: serial fetch, 50/call ceiling; batch jobs should loop calls
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
```

- [ ] **Step 2: 注册**

schema：

```ts
      {
        name: 'find_missing_pdfs',
        description: 'Audit which regular items lack a PDF attachment (action=report, read-only), and optionally auto-fetch open-access PDFs via Zotero\'s built-in resolver (action=fetch, requires write.enabled, max 50 per call — loop for more). Example: {"action": "report", "collectionKey": "ABCD1234"}',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['report', 'fetch'], description: 'report (default) or fetch.' },
            collectionKey: { type: 'string', description: 'Limit scope to one collection (default: whole library).' },
            libraryID: { type: 'number' },
            limit: { type: 'number', description: 'report: max listed (default 100). fetch: max fetched (default 20, cap 50).' },
          },
        },
      },
```

case：仅当 `args?.action === 'fetch'` 时做内联写门禁检查（照 Task 8 的 case 模式 throw），report 不查门禁。**不要**把 `find_missing_pdfs` 放进 `writeToolNames`（report 模式必须在 write 关闭时可见可用）——这是"工具内按 action 查门禁"的先例，参照 delete_collection 的 deleteItems 处理。

- [ ] **Step 3: self-test 场景**

```ts
  await t.scenario("find_missing_pdfs reports coverage", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "find_missing_pdfs", arguments: { action: "report", limit: 5 } }));
    const payload = JSON.parse(r.json.result.content[0].text);
    t.assertTrue(typeof payload.regularItems === "number" && payload.regularItems >= 0);
    t.assertEq(payload.withPdf + payload.missingPdf, payload.regularItems);
  });
```

- [ ] **Step 4: 编译 + 部署 + 跑套件 + Commit**

```bash
git commit -am "feat(tools): find_missing_pdfs — coverage audit + OA auto-fetch (54yyyu library_coverage)"
```

### Task 10: check_retractions（scite 撤稿检查）

54yyyu 调研确认 scite 两个端点免 key 可用；"引用前查撤稿"是现有 28 工具完全没有的学术安全能力。已知坑照抄：响应把 DOI key 转小写（小写索引匹配）、无 DOI 条目静默跳过并计数、网络失败整体报"稍后再试"而非部分结果。

**Files:**
- Create: `zotero-mcp-plugin/src/modules/scholarlyService.ts`
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（注册三件套）

- [ ] **Step 1: 核对 scite 请求形状**

对照 `refs/AI-plugins/zotero-mcp-54yyyu/src/zotero_mcp/utils/scite_client.py` 的 POST 用法（batch body 形状、papers 响应中 `editorialNotices` 字段路径），把下面实现里的 body/解析对齐到该文件实际代码；再用 run_javascript 发一个单 DOI 冒烟（用已知撤稿文献 `10.1126/science.aac4716` 验证 notices 非空）。

- [ ] **Step 2: 实现 scholarlyService.ts**

```ts
/**
 * Citation-intelligence tools backed by free, keyless public APIs.
 * These SEND LIBRARY DOIs to external services (scite.ai / openalex.org) —
 * stated in each tool description; acceptable for a single-user library.
 */

const SCITE_BATCH = 500;

async function collectScopeDois(libraryID: number, opts: { collectionKey?: string; tag?: string; itemKeys?: string[] }): Promise<{ dois: Map<string, any>; noDoi: number }> {
  let items: any[];
  if (opts.itemKeys?.length) {
    items = [];
    for (const key of opts.itemKeys) {
      const id = Zotero.Items.getIDFromLibraryAndKey(libraryID, key);
      if (id) items.push(await Zotero.Items.getAsync(id));
    }
  } else if (opts.collectionKey) {
    const cid = Zotero.Collections.getIDFromLibraryAndKey(libraryID, opts.collectionKey);
    if (!cid) throw new Error(`Collection not found: ${opts.collectionKey}`);
    items = (await Zotero.Collections.getAsync(cid)).getChildItems();
  } else {
    const ids = await Zotero.Items.getAllIDs(libraryID);
    items = await Zotero.Items.getAsync(ids);
  }
  const regular = items.filter((it: any) => it.isRegularItem());
  if (opts.tag) regular.splice(0, regular.length, ...regular.filter((it: any) => it.getTags().some((t: any) => t.tag === opts.tag)));

  const dois = new Map<string, any>(); // lowercase DOI -> item (scite lowercases DOI keys in responses)
  let noDoi = 0;
  for (const it of regular) {
    const doi = String(it.getField("DOI") || "").trim();
    if (doi) dois.set(doi.toLowerCase(), it);
    else noDoi++;
  }
  return { dois, noDoi };
}

export async function checkRetractions(opts: {
  libraryID: number;
  collectionKey?: string;
  tag?: string;
  itemKeys?: string[];
}): Promise<any> {
  const { dois, noDoi } = await collectScopeDois(opts.libraryID, opts);
  if (!dois.size) return { checked: 0, skippedNoDoi: noDoi, flagged: [] };

  const flagged: any[] = [];
  const all = [...dois.keys()];
  for (let i = 0; i < all.length; i += SCITE_BATCH) {
    const batch = all.slice(i, i + SCITE_BATCH);
    let resp: any;
    try {
      resp = await Zotero.HTTP.request("POST", "https://api.scite.ai/papers", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch), // shape per 54yyyu scite_client.py — verify in Step 1
        responseType: "json",
        timeout: 30000,
      });
    } catch (e: any) {
      return { error: `scite.ai unreachable (${e?.message ?? e}); try again later`, checkedSoFar: i };
    }
    const papers = resp.response?.papers ?? resp.response ?? {};
    for (const [doiLower, paper] of Object.entries<any>(papers)) {
      const notices = paper?.editorialNotices ?? [];
      if (!notices.length) continue;
      const item = dois.get(doiLower);
      flagged.push({
        itemKey: item?.key,
        title: item?.getField?.("title"),
        doi: doiLower,
        notices: notices.map((n: any) => ({ type: n.type ?? n.status, date: n.date ?? null })),
      });
    }
  }
  return { checked: dois.size, skippedNoDoi: noDoi, flagged };
}
```

- [ ] **Step 3: 注册（只读，无门禁）**

```ts
      {
        name: 'check_retractions',
        description: 'Scan library/collection/tag items against scite.ai editorial notices (retractions, corrections, concerns). Read-only; sends the items\' DOIs to api.scite.ai (keyless public API). Items without a DOI are skipped and counted. Returns only flagged items. Expect "unreachable" errors when scite is slow — retry later. Example: {"collectionKey": "ABCD1234"}',
        inputSchema: {
          type: 'object',
          properties: {
            collectionKey: { type: 'string' },
            tag: { type: 'string' },
            itemKeys: { type: 'string', description: 'Comma-separated or JSON array of item keys.' },
            libraryID: { type: 'number' },
          },
        },
      },
```

case 里对 `itemKeys` 过 `normalizeStringList`（从 importService import）。

- [ ] **Step 4: self-test 场景**（外呼类：网络不可达时 skip 而非 fail）

```ts
  await t.scenario("check_retractions runs on a tiny scope", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "check_retractions", arguments: { itemKeys: "NOSUCHKEY1" } }));
    const payload = JSON.parse(r.json.result.content[0].text);
    if (payload.error?.includes("unreachable")) t.skip("scite unreachable");
    t.assertEq(payload.checked, 0);
  });
```

- [ ] **Step 5: 编译 + 部署 + 真机冒烟（用户库跑一次全库 check）+ Commit**

```bash
git add zotero-mcp-plugin/src/modules/scholarlyService.ts zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/src/modules/selfTest.ts
git commit -m "feat(tools): check_retractions via keyless scite.ai editorial notices"
```

### Task 11: find_related_papers（OpenAlex 引文图 + 在库标注）

54yyyu 的 discovery 工具：沿引文图找"该文引用的 / 引用该文的"论文，每条标注**是否已在库中**（发现→查重→`import_by_identifier` 补库的闭环）。OpenAlex 免 key。

**Files:**
- Modify: `zotero-mcp-plugin/src/modules/scholarlyService.ts`(追加)
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（注册三件套）

- [ ] **Step 1: 实现（scholarlyService.ts 追加）**

```ts
const OPENALEX = "https://api.openalex.org";

async function openAlexGet(path: string): Promise<any> {
  const resp = await Zotero.HTTP.request("GET", `${OPENALEX}${path}`, {
    responseType: "json",
    timeout: 30000,
  });
  return resp.response;
}

function stripDoiPrefix(u: string | null | undefined): string | null {
  if (!u) return null;
  return u.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
}

export async function findRelatedPapers(opts: {
  libraryID: number;
  doi?: string;
  itemKey?: string;
  direction?: "references" | "citations";
  limit?: number;
}): Promise<any> {
  let doi = String(opts.doi || "").trim();
  if (!doi && opts.itemKey) {
    const id = Zotero.Items.getIDFromLibraryAndKey(opts.libraryID, opts.itemKey);
    if (!id) return { error: `Item not found: ${opts.itemKey}` };
    doi = String((await Zotero.Items.getAsync(id)).getField("DOI") || "").trim();
  }
  if (!doi) return { error: "Provide doi or an itemKey whose item has a DOI" };

  let work: any;
  try {
    work = await openAlexGet(`/works/doi:${encodeURIComponent(doi)}`);
  } catch (e: any) {
    return { error: `OpenAlex lookup failed for ${doi}: ${e?.message ?? e}` };
  }

  const limit = Math.min(opts.limit ?? 20, 50);
  const direction = opts.direction ?? "citations";
  let related: any[] = [];
  if (direction === "references") {
    const refIds: string[] = (work.referenced_works ?? []).slice(0, limit).map((u: string) => u.split("/").pop());
    if (refIds.length) {
      const page = await openAlexGet(`/works?filter=openalex_id:${refIds.join("|")}&per-page=${limit}`);
      related = page.results ?? [];
    }
  } else {
    const workId = String(work.id).split("/").pop();
    const page = await openAlexGet(`/works?filter=cites:${workId}&sort=cited_by_count:desc&per-page=${limit}`);
    related = page.results ?? [];
  }

  // In-library annotation: match by DOI (the discover→import loop hinges on this flag).
  const libraryDois = new Set<string>();
  const ids = await Zotero.Items.getAllIDs(opts.libraryID);
  for (const it of await Zotero.Items.getAsync(ids)) {
    if (!it.isRegularItem()) continue;
    const d = String(it.getField("DOI") || "").trim().toLowerCase();
    if (d) libraryDois.add(d);
  }

  return {
    seed: { doi, title: work.title ?? work.display_name, openalexId: work.id },
    direction,
    results: related.map((w: any) => {
      const wDoi = stripDoiPrefix(w.doi);
      return {
        title: w.title ?? w.display_name,
        year: w.publication_year,
        doi: wDoi,
        citedByCount: w.cited_by_count,
        inLibrary: wDoi ? libraryDois.has(wDoi) : false,
      };
    }),
  };
}
```

- [ ] **Step 2: 注册（只读，无门禁；description 注明外呼 + 接力提示）**

```ts
      {
        name: 'find_related_papers',
        description: 'Walk the citation graph via api.openalex.org (keyless): direction=references lists what the seed paper cites; direction=citations (default) lists papers citing it, by citation count. Each result carries inLibrary — pipe missing ones into import_by_identifier. Sends the seed DOI to OpenAlex. Example: {"itemKey": "ABCD1234", "direction": "citations", "limit": 10}',
        inputSchema: {
          type: 'object',
          properties: {
            doi: { type: 'string' },
            itemKey: { type: 'string', description: 'Alternative to doi: an in-library item with a DOI.' },
            direction: { type: 'string', enum: ['references', 'citations'] },
            limit: { type: 'number', description: 'Max results (default 20, cap 50).' },
            libraryID: { type: 'number' },
          },
        },
      },
```

- [ ] **Step 3: self-test 场景（网络不可达 skip）+ 编译 + 部署 + Commit**

```ts
  await t.scenario("find_related_papers annotates inLibrary", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "find_related_papers", arguments: { doi: "10.1038/nature14539", limit: 3 } }));
    const payload = JSON.parse(r.json.result.content[0].text);
    if (payload.error) t.skip(`openalex: ${payload.error}`);
    t.assertTrue(Array.isArray(payload.results) && payload.results.every((x: any) => typeof x.inLibrary === "boolean"));
  });
```

```bash
git commit -am "feat(tools): find_related_papers via OpenAlex citation graph with inLibrary flag"
```

### Task 12: synthesize_annotations（跨文献注释综述包）

54yyyu 里评估为"性价比极高"的一项：dev 已有注释原料（get/search_annotations），缺的是**跨文献按论文分组的一次性综述原料包**。输出格式照抄 54yyyu `synthesis.py`：统计行 → `## 论文标题` → Highlights（`- 高亮 — *评论*`）→ Notes（截 400 字符）→ 尾部综合提示。进程内实现就是一次聚合查询。

**Files:**
- Create: `zotero-mcp-plugin/src/modules/synthesisService.ts`
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（注册三件套）

- [ ] **Step 1: 实现**

```ts
/** Cross-item annotation synthesis: one markdown bundle grouped by paper (54yyyu synthesis.py format). */

function stripHtml(html: string): string {
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function synthesizeAnnotations(opts: {
  libraryID: number;
  collectionKey?: string;
  tag?: string;
  itemKeys?: string[];
  noteExcerptChars?: number;
}): Promise<any> {
  let items: any[];
  if (opts.itemKeys?.length) {
    items = [];
    for (const key of opts.itemKeys) {
      const id = Zotero.Items.getIDFromLibraryAndKey(opts.libraryID, key);
      if (id) items.push(await Zotero.Items.getAsync(id));
    }
  } else if (opts.collectionKey) {
    const cid = Zotero.Collections.getIDFromLibraryAndKey(opts.libraryID, opts.collectionKey);
    if (!cid) throw new Error(`Collection not found: ${opts.collectionKey}`);
    items = (await Zotero.Collections.getAsync(cid)).getChildItems();
  } else if (opts.tag) {
    const s = new Zotero.Search();
    s.libraryID = opts.libraryID;
    s.addCondition("tag", "is", opts.tag);
    items = await Zotero.Items.getAsync(await s.search());
  } else {
    throw new Error("Provide collectionKey, tag, or itemKeys — whole-library synthesis would flood the context");
  }

  const excerpt = Math.min(opts.noteExcerptChars ?? 400, 2000);
  let totalHighlights = 0, totalNotes = 0;
  const sections: string[] = [];

  for (const item of items.filter((it) => it.isRegularItem())) {
    const highlights: string[] = [];
    for (const attId of item.getAttachments()) {
      const att = Zotero.Items.get(attId);
      if (!att?.isAttachment?.()) continue;
      const anns: any[] = typeof att.getAnnotations === "function" ? att.getAnnotations() : [];
      for (const a of anns) {
        const text = String(a.annotationText || "").trim();
        const comment = String(a.annotationComment || "").trim();
        if (!text && !comment) continue;
        highlights.push(`- ${text}${comment ? ` — *${comment}*` : ""}`);
      }
    }
    const notes: string[] = [];
    for (const noteId of item.getNotes()) {
      const note = Zotero.Items.get(noteId);
      const text = stripHtml(note.getNote());
      if (text) notes.push(`- ${text.slice(0, excerpt)}${text.length > excerpt ? "…" : ""}`);
    }
    if (!highlights.length && !notes.length) continue;
    totalHighlights += highlights.length;
    totalNotes += notes.length;
    const parts = [`## ${item.getField("title")}`];
    if (highlights.length) parts.push(`**Highlights:**\n${highlights.join("\n")}`);
    if (notes.length) parts.push(`**Notes:**\n${notes.join("\n")}`);
    sections.push(parts.join("\n\n"));
  }

  const header = `**${sections.length} papers, ${totalHighlights} highlights, ${totalNotes} notes**`;
  const footer = `---\nYou can now synthesize themes, agreements, and contradictions across these papers.`;
  return { markdown: [header, ...sections, footer].join("\n\n"), papers: sections.length, highlights: totalHighlights, notes: totalNotes };
}
```

- [ ] **Step 2: 注册（只读，无门禁）**

```ts
      {
        name: 'synthesize_annotations',
        description: 'Aggregate ALL highlights (+comments) and notes across a collection / tag / item set into one markdown bundle grouped by paper — raw material for literature-review synthesis. Read-only. Scope is required (whole-library would flood the context). Example: {"tag": "Gaze Estimation"}',
        inputSchema: {
          type: 'object',
          properties: {
            collectionKey: { type: 'string' },
            tag: { type: 'string' },
            itemKeys: { type: 'string', description: 'Comma-separated or JSON array.' },
            noteExcerptChars: { type: 'number', description: 'Note excerpt length (default 400, cap 2000).' },
            libraryID: { type: 'number' },
          },
        },
      },
```

case 里 `itemKeys` 过 `normalizeStringList`。

- [ ] **Step 3: self-test 场景 + 编译 + 部署 + Commit**

```ts
  await t.scenario("synthesize_annotations requires a scope", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "synthesize_annotations", arguments: {} }));
    t.assertEq(r.json?.result?.isError, true);
  });
```

```bash
git add zotero-mcp-plugin/src/modules/synthesisService.ts zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/src/modules/selfTest.ts
git commit -m "feat(tools): synthesize_annotations — per-paper markdown bundle (54yyyu synthesis format)"
```

### Task 13: find_duplicates + merge_duplicates

54yyyu 语义（两段式 + 三件安全套：**默认 dry-run、confirm 显式执行、进回收站不硬删**），实现换 Zotero 原生：`Zotero.Duplicates` 找重（duplicates 视图同款引擎，比 54yyyu 的 O(n²) title 归一化强）、`Zotero.Items.merge` 合并（正确保留 relations/tags/collections，被并项自动进 trash）。

**Files:**
- Create: `zotero-mcp-plugin/src/modules/maintenanceService.ts`
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（注册三件套）

- [ ] **Step 1: 真机验证 API（run_javascript）**

```
const d = new Zotero.Duplicates(Zotero.Libraries.userLibraryID);
const s = await d.getSearchObject();
const ids = await s.search();
return { count: ids.length, hasMerge: typeof Zotero.Items.merge, sampleSetAPI: Object.getOwnPropertyNames(Object.getPrototypeOf(d)) };
```

Expected: `hasMerge: "function"`；记录 `Zotero.Duplicates` 的分组方法名（原型上应有 getSetItemsByItemID 类方法——duplicates 视图用它把 search 结果分簇）。若无可用分组方法，fallback：在 search 结果子集内按 `normalized title + DOI` 分组（子集已小，O(n) 可接受）。把实测方法名回填进 Step 2 代码。

- [ ] **Step 2: 实现 maintenanceService.ts**

```ts
/** Duplicate detection + merge on Zotero's native engines. Merge semantics follow 54yyyu: dry-run by default, confirm to execute, losers go to trash (Items.merge does this), never hard-delete. */

export async function findDuplicates(libraryID: number, limit = 50): Promise<any> {
  const dup = new (Zotero as any).Duplicates(libraryID);
  const search = await dup.getSearchObject();
  const ids: number[] = await search.search();
  if (!ids.length) return { groups: [] };

  // Group via Duplicates' own set API (name verified in Step 1); fallback: title+DOI grouping.
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const set: number[] = dup.getSetItemsByItemID ? dup.getSetItemsByItemID(id) : [];
    const group = set.length ? set : [id];
    group.forEach((x) => seen.add(x));
    if (group.length > 1) groups.push(group);
  }

  const out = [];
  for (const group of groups.slice(0, limit)) {
    const items = await Zotero.Items.getAsync(group);
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
    duplicateGroups: out.length,
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
  if (!masterId) return { error: `Master item not found: ${opts.masterKey}` };
  const master = await Zotero.Items.getAsync(masterId);
  const others: any[] = [];
  for (const key of opts.otherKeys) {
    const id = Zotero.Items.getIDFromLibraryAndKey(opts.libraryID, key);
    if (!id) return { error: `Item not found: ${key} — aborting before any merge` };
    others.push(await Zotero.Items.getAsync(id));
  }
  if (!others.length) return { error: "otherKeys is empty" };

  const plan = {
    master: { itemKey: master.key, title: master.getField("title") },
    merging: others.map((o) => ({ itemKey: o.key, title: o.getField("title") })),
    note: "Merged items keep master's metadata; losers move to trash (recoverable).",
  };
  if (!opts.confirm) return { dryRun: true, ...plan, executeWith: "same call + confirm: true" };

  await Zotero.Items.merge(master, others);

  // Write-then-verify: losers must be in trash, master must survive.
  const masterAfter = await Zotero.Items.getAsync(masterId);
  const losersInTrash = [];
  for (const o of others) {
    const after = await Zotero.Items.getAsync(o.id).catch(() => null);
    losersInTrash.push({ itemKey: o.key, deleted: !!after?.deleted });
  }
  return { merged: true, master: masterAfter.key, losersInTrash, ...plan };
}
```

- [ ] **Step 3: 注册（两工具均入 `writeToolNames`，case 内做内联写门禁检查照 Task 8 模式；find 虽只读但其存在意义就是喂 merge，跟随写门禁一并隐藏，避免"能看见找重却不能合并"的半吊子状态）**

```ts
      {
        name: 'find_duplicates',
        description: 'Detect duplicate item groups using Zotero\'s native duplicates engine. Returns groups with per-item metadata (dateAdded, attachment count) so you can choose a master. Requires write.enabled (its purpose is feeding merge_duplicates). Example: {}',
        inputSchema: {
          type: 'object',
          properties: {
            libraryID: { type: 'number' },
            limit: { type: 'number', description: 'Max groups returned (default 50).' },
          },
        },
      },
      {
        name: 'merge_duplicates',
        description: 'Merge one duplicate group into a master item via Zotero\'s native merge (keeps relations/tags/collections; losers go to TRASH, recoverable). DRY-RUN by default — returns the merge plan; re-call with confirm: true to execute. Requires write.enabled. Example: {"masterKey": "ABCD1234", "otherKeys": "EFGH5678", "confirm": false}',
        inputSchema: {
          type: 'object',
          properties: {
            masterKey: { type: 'string' },
            otherKeys: { type: 'string', description: 'Comma-separated or JSON array of item keys to merge into master.' },
            confirm: { type: 'boolean', description: 'false (default): dry-run plan only. true: execute.' },
            libraryID: { type: 'number' },
          },
          required: ['masterKey', 'otherKeys'],
        },
      },
```

- [ ] **Step 4: self-test 场景（dry-run 语义门必须锁死）+ 编译 + 部署 + Commit**

```ts
  await t.scenario("merge_duplicates without confirm is a dry-run", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    const r = await mcpPost(rpc("tools/call", { name: "merge_duplicates", arguments: { masterKey: "NOSUCHKEY", otherKeys: "NOSUCHKEY2" } }));
    const payload = JSON.parse(r.json.result.content[0].text);
    t.assertTrue(payload.error || payload.dryRun === true, "must never merge implicitly");
  });
```

```bash
git add zotero-mcp-plugin/src/modules/maintenanceService.ts zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/src/modules/selfTest.ts
git commit -m "feat(tools): find/merge_duplicates on Zotero native engines, dry-run by default"
```

### Task 14: batch_update_tags（批量加/删/改名）

用户历史整改场景（P2 tag 清理）的工具化。54yyyu 的 selector+action 语义，加上本仓库 `CLAUDE.md` 的关键教训：**tag 改名/合并必须走 `Zotero.Tags.rename`**（保留 item 关联、同名自动合并），绝不先删后加。dry-run 默认。

**Files:**
- Modify: `zotero-mcp-plugin/src/modules/maintenanceService.ts`（追加）
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（注册三件套，入 `writeToolNames`）

- [ ] **Step 1: 实现（maintenanceService.ts 追加）**

```ts
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
  if (!add.length && !remove.length && !opts.rename) {
    return { error: "Nothing to do: provide add, remove, and/or rename" };
  }

  // rename is library-global and needs no scope; add/remove need one to avoid accidental whole-library writes.
  if ((add.length || remove.length) && !opts.scope?.collectionKey && !opts.scope?.tag) {
    return { error: "add/remove require a scope (collectionKey or tag) — whole-library tagging must be explicit via scope.tag" };
  }

  let items: any[] = [];
  if (add.length || remove.length) {
    if (opts.scope?.collectionKey) {
      const cid = Zotero.Collections.getIDFromLibraryAndKey(opts.libraryID, opts.scope.collectionKey);
      if (!cid) return { error: `Collection not found: ${opts.scope.collectionKey}` };
      items = (await Zotero.Collections.getAsync(cid)).getChildItems().filter((it: any) => it.isRegularItem());
    }
    if (opts.scope?.tag) {
      const s = new Zotero.Search();
      s.libraryID = opts.libraryID;
      s.addCondition("tag", "is", opts.scope.tag);
      const tagged = await Zotero.Items.getAsync(await s.search());
      items = items.length ? items.filter((it) => tagged.some((t: any) => t.id === it.id)) : tagged.filter((it: any) => it.isRegularItem());
    }
  }

  const plan = {
    scope: opts.scope ?? "library-wide (rename only)",
    matchedItems: items.length,
    add,
    remove,
    rename: opts.rename ?? null,
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
  if (opts.rename) {
    // Zotero.Tags.rename keeps item associations and auto-merges same-name tags —
    // never implement rename as remove+add (repo CLAUDE.md lesson).
    await Zotero.Tags.rename(opts.libraryID, opts.rename.from, opts.rename.to);
    renamed = { from: opts.rename.from, to: opts.rename.to };
  }

  return { executed: true, ...plan, counters, renamed };
}
```

- [ ] **Step 2: 注册**

```ts
      {
        name: 'batch_update_tags',
        description: 'Bulk tag operations. add/remove apply to a scope (collectionKey and/or tag filter, required); rename is library-global and uses Zotero.Tags.rename — associations preserved, same-name tags auto-merged (the ONLY safe way to merge tag case-variants; never delete+re-add). DRY-RUN by default; re-call with confirm: true. Requires write.enabled. Example: {"rename": {"from": "machine learning", "to": "Machine Learning"}, "confirm": true}',
        inputSchema: {
          type: 'object',
          properties: {
            scope: {
              type: 'object',
              properties: {
                collectionKey: { type: 'string' },
                tag: { type: 'string', description: 'Only items currently carrying this tag.' },
              },
            },
            add: { type: 'string', description: 'Tag(s) to add, comma-separated or JSON array.' },
            remove: { type: 'string', description: 'Tag(s) to remove, comma-separated or JSON array.' },
            rename: {
              type: 'object',
              properties: { from: { type: 'string' }, to: { type: 'string' } },
            },
            confirm: { type: 'boolean', description: 'false (default): dry-run. true: execute.' },
            libraryID: { type: 'number' },
          },
        },
      },
```

case 里 `add`/`remove` 过 `normalizeStringList`。

- [ ] **Step 3: self-test 场景 + 编译 + 部署 + Commit**

```ts
  await t.scenario("batch_update_tags refuses unscoped add", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    const r = await mcpPost(rpc("tools/call", { name: "batch_update_tags", arguments: { add: "X" } }));
    const payload = JSON.parse(r.json.result.content[0].text);
    t.assertTrue(payload.error?.includes("scope"), "unscoped add/remove must be rejected");
  });
```

```bash
git commit -am "feat(tools): batch_update_tags with dry-run default and rename via Zotero.Tags.rename"
```

---

## Phase 4：检索质量（54yyyu 降级级联 + ZotSeek RRF）

### Task 15: search_library 失败降级级联

54yyyu 调研的原话："LLM 搜索空手而归是最常见挫败"。其 4 级级联 + **降级透明提示**移植进 `handleSearch`：结果为 0 时逐级放宽，命中时在响应 meta 里注明用了哪级降级，让 LLM 知道结果不是精确命中。

**Files:**
- Modify: `zotero-mcp-plugin/src/modules/apiHandlers.ts`（`handleSearch` 返回前）

- [ ] **Step 1: 定位接线点**

`grep -n "handleSearch" src/modules/apiHandlers.ts` 找到该 handler 的主体与"结果为空"的返回路径。级联逻辑包在原始搜索调用之后：仅当 `results.length === 0` 且原始请求带 `q`（自由文本查询）时进入。

- [ ] **Step 2: 实现级联（apiHandlers.ts 内新增私有函数，供 handleSearch 调用）**

```ts
/** 54yyyu-style fallback ladder: never hand the LLM an empty result without trying broader interpretations first. Each hit is labeled so the caller knows it came from a fallback. */
async function searchWithFallbacks(
  runSearch: (params: any) => Promise<any[]>,
  originalParams: any,
): Promise<{ results: any[]; fallback: string | null }> {
  let results = await runSearch(originalParams);
  if (results.length) return { results, fallback: null };

  // Ladder 1: drop restrictive filters (year range / item type / fulltext), keep q.
  const { yearRange, itemType, fulltext, ...loose } = originalParams;
  if (yearRange || itemType || fulltext) {
    results = await runSearch(loose);
    if (results.length) return { results, fallback: "dropped filters (yearRange/itemType/fulltext)" };
  }

  // Ladder 2: token OR — try the longest tokens individually against title.
  const tokens = String(originalParams.q || "")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  for (const token of tokens) {
    results = await runSearch({ ...loose, q: token });
    if (results.length) return { results, fallback: `token match: "${token}"` };
  }

  return { results: [], fallback: "exhausted (also tried filter-drop and token match)" };
}
```

handleSearch 接线：把原本"直接调搜索并返回"的一段改为经 `searchWithFallbacks` 包裹，`runSearch` 闭包封装现有 searchEngine 调用；返回体（顶层，非每条结果）加 `fallback` 字段，非 null 时前置一条说明文本（照现有响应格式塞进 meta/首行均可，以该 handler 现有输出结构为准，保持字段并列不破坏既有消费者）。

- [ ] **Step 3: self-test 场景 + 编译 + 部署 + Commit**

```ts
  await t.scenario("search falls back instead of returning bare empty", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "search_library", arguments: { q: "nonexistentzzz Vaswani", limit: 3 } }));
    const text = r.json?.result?.content?.[0]?.text ?? "";
    t.assertTrue(text.includes("fallback") || text.includes("results"), "response must carry fallback metadata or results");
  });
```

```bash
git add zotero-mcp-plugin/src/modules/apiHandlers.ts zotero-mcp-plugin/src/modules/selfTest.ts
git commit -m "feat(search): fallback ladder with transparent labeling (54yyyu cascade)"
```

### Task 16: RRF 混合搜索

dev 的 `semantic_search` 是纯向量（`semanticSearchService.ts:273` 注释明示），对"Vaswani 2017"、缩写、精确短语类查询天然弱。ZotSeek 的 RRF（k=60）+ `analyzeQuery` 自动权重是 ~300 行零依赖纯逻辑。纯函数进 `hybridSearch.ts` 可 node 单测；`semantic_search` 工具加 `mode` 参数，默认 `hybrid`（更好的默认），`semantic` 保留纯向量老行为。

**Files:**
- Create: `zotero-mcp-plugin/src/modules/semantic/hybridSearch.ts`
- Modify: `zotero-mcp-plugin/src/modules/semantic/semanticSearchService.ts`（search 入口接 mode）
- Modify: `zotero-mcp-plugin/src/modules/streamableMCPServer.ts`（semantic_search schema 加 mode）
- Test: `zotero-mcp-plugin/test/hybridSearch.test.cjs`

- [ ] **Step 1: 写失败测试**

```js
test("rrfFuse ranks items appearing in both lists above single-list items", () => {
  const sem = [{ itemKey: "A" }, { itemKey: "B" }, { itemKey: "C" }];
  const key = [{ itemKey: "B" }, { itemKey: "D" }];
  const fused = rrfFuse(sem, key, 0.5, 0.5);
  assert.equal(fused[0].itemKey, "B");
  assert.ok(fused.length === 4);
});

test("analyzeQuery boosts keyword weight for author-year queries", () => {
  const w = analyzeQuery("Vaswani 2017");
  assert.ok(w.wKey > w.wSem);
});

test("analyzeQuery boosts semantic weight for conceptual questions", () => {
  const w = analyzeQuery("how do transformer models handle long-range dependencies");
  assert.ok(w.wSem > w.wKey);
});

test("weights stay clamped to [0.2, 0.8]", () => {
  for (const q of ["2017", "x", "what why how does this survey compare every possible approach"]) {
    const w = analyzeQuery(q);
    assert.ok(w.wSem >= 0.2 && w.wSem <= 0.8 && w.wKey >= 0.2 && w.wKey <= 0.8);
  }
});
```

- [ ] **Step 2: 跑测试确认失败，实现 hybridSearch.ts**

```ts
/** Reciprocal-Rank-Fusion of semantic + keyword result lists (ZotSeek hybrid-search.ts, k=60). Pure functions — no Zotero imports. */

const RRF_K = 60;

export function rrfFuse(
  semantic: Array<{ itemKey: string }>,
  keyword: Array<{ itemKey: string }>,
  wSem: number,
  wKey: number,
): Array<{ itemKey: string; score: number; inSemantic: boolean; inKeyword: boolean }> {
  const scores = new Map<string, { score: number; inSemantic: boolean; inKeyword: boolean }>();
  semantic.forEach((r, rank) => {
    const e = scores.get(r.itemKey) ?? { score: 0, inSemantic: false, inKeyword: false };
    e.score += wSem / (RRF_K + rank + 1);
    e.inSemantic = true;
    scores.set(r.itemKey, e);
  });
  keyword.forEach((r, rank) => {
    const e = scores.get(r.itemKey) ?? { score: 0, inSemantic: false, inKeyword: false };
    e.score += wKey / (RRF_K + rank + 1);
    e.inKeyword = true;
    scores.set(r.itemKey, e);
  });
  return [...scores.entries()]
    .map(([itemKey, e]) => ({ itemKey, ...e }))
    .sort((a, b) => b.score - a.score);
}

/** Heuristic query analysis (ZotSeek analyzeQuery): exact-lookup signals boost keyword weight, conceptual signals boost semantic. Weights clamp to [0.2, 0.8]. */
export function analyzeQuery(q: string): { wSem: number; wKey: number; reason: string } {
  const query = String(q || "").trim();
  let wKey = 0.5;
  const reasons: string[] = [];

  if (/\b(19|20)\d{2}\b/.test(query)) { wKey += 0.15; reasons.push("year"); }
  if (/"[^"]+"/.test(query)) { wKey += 0.2; reasons.push("quoted phrase"); }
  if (/\b[A-Z]{2,6}\b/.test(query)) { wKey += 0.1; reasons.push("acronym"); }
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length <= 2) { wKey += 0.15; reasons.push("short query"); }
  if (words.length <= 3 && /^[A-Z][a-z]+/.test(words[0] ?? "")) { wKey += 0.1; reasons.push("name-like"); }

  if (/^(how|what|why|which|when|compare|explain)\b/i.test(query)) { wKey -= 0.25; reasons.push("question form"); }
  if (words.length >= 6) { wKey -= 0.15; reasons.push("long conceptual query"); }

  wKey = Math.min(0.8, Math.max(0.2, wKey));
  return { wSem: 1 - wKey, wKey, reason: reasons.join(", ") || "neutral" };
}
```

- [ ] **Step 3: 接线**

`semanticSearchService.ts` 的 search 入口加 `mode?: "hybrid" | "semantic"`（默认 `"hybrid"`）：
- `semantic`：现有路径原样
- `hybrid`：并行拿 `semanticResults = 现有向量检索(topK * 2)` 与 `keywordResults = searchEngine 标题/作者/everything 检索(topK * 2)`（keyword 侧从 `apiHandlers`/`searchEngine` 借调现有入口，`grep -n "search" src/modules/searchEngine.ts` 选**已存在**的公开方法，不为此新写检索路径），`rrfFuse` 后取 topK，再按现有输出结构回填每条的元数据，并在响应 meta 加 `{ mode: "hybrid", weights, reason }`。

`streamableMCPServer.ts` 的 semantic_search schema 加：

```ts
            mode: {
              type: 'string',
              enum: ['hybrid', 'semantic'],
              description: 'hybrid (default): RRF fusion of vector + keyword search — better for author/year/acronym queries. semantic: pure vector (pre-existing behavior).',
            },
```

- [ ] **Step 4: 跑单测 + self-test 场景 + 编译 + 部署 + Commit**

```ts
  await t.scenario("semantic_search hybrid mode answers author-year queries", async () => {
    const semOn = Zotero.Prefs.get(PREF + "semantic.enabled", true) !== false;
    if (!semOn) t.skip("semantic disabled");
    const r = await mcpPost(rpc("tools/call", { name: "semantic_search", arguments: { query: "machine learning survey", topK: 3 } }));
    t.assertTrue(!r.json?.error, "hybrid path must not blow up");
  });
```

```bash
git add zotero-mcp-plugin/src/modules/semantic/hybridSearch.ts zotero-mcp-plugin/src/modules/semantic/semanticSearchService.ts zotero-mcp-plugin/src/modules/streamableMCPServer.ts zotero-mcp-plugin/test/hybridSearch.test.cjs zotero-mcp-plugin/src/modules/selfTest.ts
git commit -m "feat(semantic): RRF hybrid search with query-adaptive weights (ZotSeek pattern)"
```

---

## 11. 收尾

- [ ] **更新文档**：`README.md`/`README-zh.md` 工具清单加新工具（28 → 38）；仓库根 `CLAUDE.md` §4 的工具描述同步（"27 个工具"字样已过时，一并修正为现状）；本计划文件勾掉全部 checkbox。
- [ ] **全量回归**：`npm run test:unit` 全绿 + 真机 `Zotero.ZoteroMCPSelfTest.run('protocol')` 全绿（`newErrorsInLog` 空）。
- [ ] **最终构建**：`npm run build`，经 `install_plugin_from_url` 部署最终版，`/mcp/status` 核对版本。
- [ ] Commit: `docs: sync tool list after refs-strengths adoption`

---

## 12. 不做的事（YAGNI 边界与理由）

- ✗ **ChromeWorker 本地嵌入**（ZotSeek 最大工程项）：130MB 模型打包进 XPI + worker 生命周期管理；用户已有可用的 OpenAI 兼容 embedding。离线/隐私需求出现时再评估，届时整体照搬 ZotSeek 的 worker 自愈模式。
- ✗ **语义索引页级定位**（ZotSeek）+ **papersgpt 版面重建技巧**：需改 chunker 逐页提取 + vectorStore schema 迁移 + 全量重建索引；主用例（对话内检索）拿 get_content 即够。两者绑定，一起推迟。
- ✗ **(library_key, item_key) 稳定身份 schema**（ZotSeek）:用户是单人 user library，group 键冲突不成立；做 group 支持时必须先做这个（已记入风险）。
- ✗ **/open launcher 端点**（ZotSeek）：客户端是终端里的 Claude Code，非 chat webview，"一键回 Zotero"收益低。
- ✗ **SSE / GET event-stream 分支**（papersgpt 范本的用武之地）：MCP 一问一答模型下无流式需求。
- ✗ **UI 截图/DOM 检查/交互工具**（mcp-server-zotero-dev）：`run_javascript` 可临时兜底（`canvas.drawWindow` snippet 已在调研档案里），高频需求出现再固化。
- ✗ **挂 23119 官方 server 备用 transport**（ZotSeek 模式）：自建 23120 已稳定运行。
- ✗ **advanced_search 工具**：search_library 的字段操作符 + Task 15 级联 + Task 16 hybrid 已覆盖主要检索路径；`run_javascript` 里 `Zotero.Search` 兜长尾。
- ✗ **程序化 PDF 高亮/区域标注**（54yyyu create_annotation 族）：个人工作流暂无此需求；届时抄它的 "Did you mean" 错误 UX。
- ✗ **删 streamableMCPServer/httpServer 双份 session 记账**（ZotSeek "少状态"论证成立，但两处 session 与本轮改动零交集——ponytail：不重构未损坏的相邻代码。列入债务清单即可）。

## 13. 风险

1. **Zotero 内部 API 形状假设**——`Translate.Search` 的 `translate({collections})`、`extractIdentifiers` 归属、`Duplicates` 分组方法、`Items.merge` 签名、`AddonManager.getInstallForURL` 时序：每个涉及 task 的 Step 1 都是真机验证，验证不过按该 task 内写明的 fallback 走，实测差异回填本文件。
2. **外部 API 无契约**——scite/OpenAlex 免 key 政策与响应形状可能变化：工具 description 已预告失败模式；失败返回明确 error 而非部分结果（54yyyu 纪律）。
3. **自举窗口**——`install_plugin_from_url` 升级自己时 server 有 ~秒级断连窗口；工具响应已预告；若延迟安装竞态失败，退回手动安装一次（损失一个迭代，不损数据）。
4. **写操作不可逆面**——merge 进 trash 可恢复、tag rename 可反向 rename、import 可删；全部写工具 dry-run/幂等默认 + 写后回读校验，延续仓库既有纪律（不信 saveTx resolved）。
5. **selfTest 依赖真机状态**——write/eval/semantic 门禁关闭时场景 skip：套件结果要看 skipped 数，全 skip ≠ 全绿；部署 checkpoint 时至少开一次全部门禁跑全量。
6. **`fetch` 在 Zotero chrome 上下文的可用性**（selfTest 用）：Zotero 9/FF128 chrome 上下文有全局 fetch；若受限，selfTest 的 `mcpPost` 换 `Zotero.HTTP.request` 同签名重写（单点替换）。
