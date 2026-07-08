# External API Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给所有出站 API 调用（OpenAlex / CrossRef / doi.org / scite / OA PDF 源）一个统一出口层：默认超时、一次重试、按 host 的镜像重写表（pref 配置），把"部分网络环境下 scite.ai 等域名不可达导致工具直接失败"变成"可配置镜像 + 诚实的结构化 unreachable 报告"。

**Architecture:** 新增 `src/modules/externalFetch.ts`：`rewriteUrl(url, mirrors)` 纯函数（可单测）+ `fetchExternal(url, opts)` 包装（timeout via AbortController、retry、错误归一化）。现有约 14 处 `fetch(`/`Zotero.HTTP` 调用点分散在 `scholarlyService.ts`、`pdfProcessor.ts`、`importService.ts` 等 6 个文件——逐文件迁移到统一出口。镜像表存 pref `extensions.zotero.zotero-agent.network.mirrors`（JSON 字符串，`{"api.openalexorg": "..."}` 形状 host→host），空 = 无重写，行为与现状完全一致。

**Tech Stack:** TypeScript、AbortController、Zotero Prefs。

**Non-goals:** 不做代理支持（Zotero 自带全局代理设置，插件内 fetch 走同一网络栈，重复造轮子）；不做后台健康检查；偏好页 UI 本轮不做（pref 手改即可，UI 等有真实需求）。

---

### Task 1: rewriteUrl 纯函数 + 单测

**Files:**
- Create: `src/modules/externalFetch.ts`
- Test: `test/externalFetch.test.cjs`

- [ ] **Step 1: 写失败单测**

```js
// test/externalFetch.test.cjs（加载方式照抄 test/metadataMerge.test.cjs 约定）
const assert = require("node:assert");
const { rewriteUrl, parseMirrorPref } = require(/* 按现有约定 */);

// host 命中 → 替换 host，保留 path/query
assert.strictEqual(
  rewriteUrl("https://api.openalex.org/works?filter=doi:10.1/x", { "api.openalex.org": "openalex.example-mirror.org" }),
  "https://openalex.example-mirror.org/works?filter=doi:10.1/x",
);
// 未命中 → 原样
assert.strictEqual(rewriteUrl("https://doi.org/10.1/x", {}), "https://doi.org/10.1/x");
// 镜像值带协议 → 尊重之
assert.strictEqual(
  rewriteUrl("https://scite.ai/api/v1/x", { "scite.ai": "http://127.0.0.1:8080" }),
  "http://127.0.0.1:8080/api/v1/x",
);
// pref 解析：坏 JSON → 空表（不炸）
assert.deepStrictEqual(parseMirrorPref("not json"), {});
assert.deepStrictEqual(parseMirrorPref('{"a.com":"b.com"}'), { "a.com": "b.com" });
console.log("externalFetch: ok");
```

- [ ] **Step 2: 跑测试确认失败** → `npm run test:unit` FAIL

- [ ] **Step 3: 实现纯函数**

```ts
// src/modules/externalFetch.ts
// Single egress point for outbound API calls: timeout, one retry, per-host mirror rewrite.

export function parseMirrorPref(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

export function rewriteUrl(url: string, mirrors: Record<string, string>): string {
  try {
    const u = new URL(url);
    const target = mirrors[u.host];
    if (!target) return url;
    if (/^https?:\/\//i.test(target)) {
      const t = new URL(target);
      u.protocol = t.protocol; u.host = t.host;
    } else {
      u.host = target;
    }
    return u.toString();
  } catch {
    return url;
  }
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/externalFetch.ts test/externalFetch.test.cjs
git commit -m "feat: mirror rewrite + pref parsing for external fetch layer"
```

---

### Task 2: fetchExternal 包装

**Files:**
- Modify: `src/modules/externalFetch.ts`

- [ ] **Step 1: 实现（timeout + 1 次重试 + 归一化错误）**

```ts
const PREF_MIRRORS = "extensions.zotero.zotero-agent.network.mirrors";
const DEFAULT_TIMEOUT_MS = 15000;

export interface ExternalFetchResult {
  ok: boolean;
  status?: number;
  json?: any;
  text?: string;
  unreachable?: { host: string; reason: string; hint: string };
}

export async function fetchExternal(url: string, opts: {
  method?: string; headers?: Record<string, string>; body?: string;
  timeoutMs?: number; parse?: "json" | "text" | "none"; redirect?: RequestRedirect;
} = {}): Promise<ExternalFetchResult> {
  const mirrors = parseMirrorPref(Zotero.Prefs.get(PREF_MIRRORS, true));
  const target = rewriteUrl(url, mirrors);
  const attempt = async (): Promise<ExternalFetchResult> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const resp = await fetch(target, {
        method: opts.method ?? "GET", headers: opts.headers, body: opts.body,
        redirect: opts.redirect, signal: ctl.signal,
      });
      const out: ExternalFetchResult = { ok: resp.ok, status: resp.status };
      if (opts.parse === "json") out.json = await resp.json().catch(() => null);
      else if (opts.parse === "text") out.text = await resp.text().catch(() => "");
      return out;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch {
    try {
      return await attempt(); // ponytail: one blind retry; backoff/jitter if flakiness shows up in practice
    } catch (e: any) {
      const host = (() => { try { return new URL(target).host; } catch { return target; } })();
      return { ok: false, unreachable: {
        host, reason: e?.name === "AbortError" ? `timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` : (e?.message ?? String(e)),
        hint: `Host unreachable from this network. You can map it to a mirror via the ${PREF_MIRRORS} pref (JSON: {"${host}": "mirror.host"}).`,
      }};
    }
  }
}
```

- [ ] **Step 2: build** → `npm run build` 零错误

- [ ] **Step 3: Commit**

```bash
git add src/modules/externalFetch.ts
git commit -m "feat: fetchExternal wrapper (timeout, retry, structured unreachable)"
```

---

### Task 3: 迁移现有调用点

**Files:**
- Modify: `src/modules/scholarlyService.ts`（scite / OpenAlex，`checkRetractions`:35、`findRelatedPapers`:96）
- Modify: `src/modules/streamableMCPServer.ts`（`case 'enrich_item_metadata'` 的 doi.org / OpenAlex 调用、`case 'find_doi'` 的 CrossRef 调用）
- Modify: `src/modules/pdfProcessor.ts`、`src/modules/importService.ts`（先 `grep -n "fetch(\|Zotero.HTTP" src/modules/` 列全清单，逐个改）

- [ ] **Step 1: 列出全部出站调用点**

Run: `grep -rn "fetch(\|Zotero.HTTP" src/modules/ --include="*.ts" | grep -v externalFetch`
把清单贴进 commit message（迁移完后此命令的非注释结果应为 0 行——`semantic/embeddingService.ts` 的本地模型下载调用除外，逐条判断后豁免要注明理由）。

- [ ] **Step 2: 逐文件替换**

模式：`const resp = await fetch(url, {...})` → `const r = await fetchExternal(url, { parse: "json", ... })`；调用方原有的"网络失败 → 报 unreachable"分支（`check_retractions` 已有诚实报告模式）改为直接透传 `r.unreachable`。每改完一个文件跑一次 `npm run build` 保持绿。

- [ ] **Step 3: 单测回归** → `npm run test:unit` 全 PASS（scihubProxy/pdfResolvers 等既有测试不得破坏；若它们 mock 了 fetch，按其 mock 方式适配 fetchExternal 的注入点——必要时给 fetchExternal 加一个仅测试用的 `_fetchImpl` 参数）

- [ ] **Step 4: Commit**

```bash
git add src/modules/
git commit -m "refactor: route all outbound API calls through fetchExternal"
```

---

### Task 4: 真机验证 + selfTest + 文档

**Files:**
- Modify: `src/modules/selfTest.ts`、`README.md`

- [ ] **Step 1: 部署后真机三连**

`npm run build && node scripts/deploy-live.mjs`，然后：
1. `find_related_papers`（OpenAlex 可达路径）→ 正常返回；
2. `check_retractions` 小范围 → 可达则正常，不可达则返回带 `hint`（含 pref 名）的 unreachable——比之前多出镜像指引；
3. 经 `run_javascript` 设置 mirrors pref 指向一个不存在的 host（如 `{"api.openalex.org":"127.0.0.1:1"}`），再跑 `find_related_papers` 应快速返回 unreachable（验证 rewrite 生效 + timeout 生效），**测完清掉 pref**。

- [ ] **Step 2: selfTest 场景**

```ts
await t.scenario("external API failures surface as structured unreachable with mirror hint", async () => {
  // 复用 Step 1.3 的思路：临时设 mirrors pref → 调工具 → 断言 unreachable.hint 含 pref 名 → finally 恢复 pref
});
```

- [ ] **Step 3: 全量回归** → `Zotero.ZoteroAgentSelfTest.run('protocol')` 全 passed

- [ ] **Step 4: README 增补「Network & Mirrors」小节（pref 名、JSON 形状、示例）。Commit**

```bash
git add src/modules/selfTest.ts README.md
git commit -m "feat: selfTest + docs for external API resilience layer"
```
