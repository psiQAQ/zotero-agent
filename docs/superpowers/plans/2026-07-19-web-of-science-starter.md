# Web of Science Starter API MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Zotero Agent 中增加一个安全、只读、可配置的 `search_web_of_science` MCP 工具，通过 Clarivate Web of Science Starter API 检索并规范化文献记录。

**Architecture:** 新建单一 `wosService.ts`，直接复用 `Zotero.HTTP.request` 和 Zotero preferences，不引入 SDK。`streamableMCPServer.ts` 只负责工具 schema、显隐和分派；偏好面板复用现有 HTML 绑定函数；现有 `import_by_identifier` 只做兼容性验证，默认零修改。

**Tech Stack:** TypeScript 5.9、Zotero Plugin API、`Zotero.HTTP.request`、Node.js `node:test`、现有 zotero-plugin-scaffold。

## Global Constraints

- Starter API Base URL 固定为 `https://api.clarivate.com/apis/wos-starter/v1`，不得开放用户配置。
- API Key 只能放在 `X-ApiKey` Header，不得进入 URL、日志、返回值或异常文本。
- 不新增 npm 依赖，不安装 Clarivate SDK，不实现 XLSX、Expanded API、UID 详情工具、缓存或自动重试。
- `search_web_of_science` 是只读工具；关闭 `wos.enabled` 时从 `tools/list` 隐藏。
- Starter API 每页最多 50 条；同一次查询的所有页面必须使用固定 `limit`。
- `import_by_identifier` 默认不修改；只有通用标识符入口出现可复现缺口时才能扩展，且不得添加 WoS 特判。
- 所有生产逻辑遵循测试先行；配置标记和静态 XHTML 使用构建与实际 UI 验证。

---

### Task 1: WoS service、规范化和分页

**Files:**

- Create: `src/modules/wosService.ts`
- Create: `test/wosService.test.cjs`
- Modify: `scripts/unit-test.mjs`

**Interfaces:**

- Consumes: `Zotero.Prefs.get(prefKey, true)`、`Zotero.HTTP.request(method, url, options)`。
- Produces: `searchWebOfScience(options): Promise<WosSearchResult>`、`testWosConnection(): Promise<{database:string; total:number}>`、`WOS_DATABASES`、`WOS_SORTS`。

- [ ] **Step 1: 写失败单测**

创建 `test/wosService.test.cjs`：

```js
const test = require("node:test");
const assert = require("node:assert");

const PREF = "extensions.zotero.zotero-agent.";
let prefs;
let calls;
let pages;
let requestError;

function installZoteroMock() {
  global.Zotero = {
    Prefs: {
      get(key) {
        return prefs[key];
      },
    },
    HTTP: {
      async request(method, url, options) {
        calls.push({ method, url, options });
        if (requestError) throw requestError;
        return { response: pages.shift() };
      },
    },
  };
}

function hit(i) {
  return {
    uid: `WOS:${String(i).padStart(15, "0")}`,
    title: `Paper ${i}`,
    types: ["Article"],
    source: {
      sourceTitle: "Journal",
      publishYear: 2025,
      volume: "3",
      issue: "2",
      pages: { range: "10-20" },
    },
    names: {
      authors: [
        {
          displayName: "Ada Lovelace",
          wosStandard: "Lovelace, Ada",
          researcherId: "RID-1",
        },
      ],
    },
    identifiers: {
      doi: `10.1000/${i}`,
      pmid: String(1000 + i),
      issn: "1234-5678",
    },
    keywords: { authorKeywords: ["MCP"] },
    citations: [{ db: "WOS", count: i }],
    links: {
      record: `https://www.webofscience.com/wos/woscc/full-record/WOS:${i}`,
    },
  };
}

prefs = {
  [PREF + "wos.apiKey"]: "secret-key",
  [PREF + "wos.database"]: "WOS",
  [PREF + "wos.maxRecords"]: 100,
  [PREF + "wos.timeoutSeconds"]: 30,
};
calls = [];
pages = [];
requestError = null;
installZoteroMock();

const {
  searchWebOfScience,
  testWosConnection,
} = require("../.tmp-test/wosService.js");

test.beforeEach(() => {
  prefs[PREF + "wos.apiKey"] = "secret-key";
  prefs[PREF + "wos.database"] = "WOS";
  prefs[PREF + "wos.maxRecords"] = 100;
  prefs[PREF + "wos.timeoutSeconds"] = 30;
  calls = [];
  pages = [];
  requestError = null;
});

test("searchWebOfScience keeps a fixed 50-record page and truncates to maxResults", async () => {
  pages = [
    {
      metadata: { total: 60, page: 1, limit: 50 },
      hits: Array.from({ length: 50 }, (_, i) => hit(i + 1)),
    },
    {
      metadata: { total: 60, page: 2, limit: 50 },
      hits: Array.from({ length: 10 }, (_, i) => hit(i + 51)),
    },
  ];

  const result = await searchWebOfScience({
    query: 'TS=("graph neural network") AND PY=(2020-2026)',
    maxResults: 55,
    sort: "times_cited_desc",
  });

  assert.strictEqual(result.total, 60);
  assert.strictEqual(result.returned, 55);
  assert.strictEqual(result.requestsUsed, 2);
  assert.strictEqual(result.records[0].authors[0].researcherId, "RID-1");
  assert.strictEqual(result.records[0].source.pages, "10-20");
  assert.strictEqual(result.records[0].identifiers.doi, "10.1000/1");
  assert.strictEqual(result.records[0].timesCited, 1);
  assert.match(calls[0].url, /limit=50/);
  assert.match(calls[1].url, /limit=50/);
  assert.match(calls[0].url, /sortField=TC%2BD/);
  assert.ok(!calls[0].url.includes("secret-key"));
  assert.strictEqual(calls[0].options.headers["X-ApiKey"], "secret-key");
  assert.ok(!JSON.stringify(result).includes("secret-key"));
});

test("searchWebOfScience applies the configured hard cap", async () => {
  prefs[PREF + "wos.maxRecords"] = 12;
  pages = [
    {
      metadata: { total: 99, page: 1, limit: 12 },
      hits: Array.from({ length: 12 }, (_, i) => hit(i + 1)),
    },
  ];
  const result = await searchWebOfScience({ query: "PY=2025", maxResults: 99 });
  assert.strictEqual(result.returned, 12);
  assert.match(calls[0].url, /limit=12/);
});

test("searchWebOfScience maps HTTP failures without exposing request details", async () => {
  for (const [status, expected] of [
    [401, "API Key is missing or invalid"],
    [403, "subscription does not permit"],
    [429, "rate limit or request quota"],
    [503, "temporarily unavailable"],
  ]) {
    requestError = { status, message: "secret-key https://example.invalid" };
    await assert.rejects(
      () => searchWebOfScience({ query: "PY=2025" }),
      (error) =>
        error.message.includes(expected) &&
        !error.message.includes("secret-key"),
    );
  }
});

test("testWosConnection uses one short record", async () => {
  pages = [{ metadata: { total: 123, page: 1, limit: 1 }, hits: [hit(1)] }];
  const result = await testWosConnection();
  assert.deepStrictEqual(result, { database: "WOS", total: 123 });
  assert.match(calls[0].url, /q=PY%3D2020/);
  assert.match(calls[0].url, /limit=1/);
  assert.match(calls[0].url, /detail=short/);
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
node --test test/wosService.test.cjs
```

Expected: FAIL，错误包含 `Cannot find module '../.tmp-test/wosService.js'`，因为 service 尚不存在。

- [ ] **Step 3: 实现最小 service**

创建 `src/modules/wosService.ts`。实现必须包含以下常量、类型和行为；保持一个文件，不建立 client class 或 provider interface：

```ts
const BASE = "https://api.clarivate.com/apis/wos-starter/v1";
const PREF = "extensions.zotero.zotero-agent.";

export const WOS_DATABASES = [
  "WOS",
  "BIOABS",
  "BCI",
  "BIOSIS",
  "CCC",
  "DIIDW",
  "DRCI",
  "MEDLINE",
  "ZOOREC",
  "PPRN",
  "WOK",
] as const;

export const WOS_SORTS = {
  relevance: "RS+D",
  publication_date_desc: "PY+D",
  times_cited_desc: "TC+D",
} as const;

export type WosSearchOptions = {
  query: string;
  database?: string;
  maxResults?: number;
  sort?: keyof typeof WOS_SORTS;
  detail?: "full" | "short";
};

export type WosSearchResult = {
  total: number;
  returned: number;
  requestsUsed: number;
  database: string;
  records: any[];
};

function pref(name: string): unknown {
  return Zotero.Prefs.get(PREF + name, true);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const number = Number(value);
  return Number.isInteger(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

function pagesOf(source: any): string | undefined {
  const pages = source?.pages;
  if (pages?.range) return String(pages.range);
  if (pages?.begin && pages?.end) return `${pages.begin}-${pages.end}`;
  return pages?.begin ? String(pages.begin) : undefined;
}

function normalizeDocument(raw: any, database: string): any {
  const source = raw?.source ?? {};
  const citations = Array.isArray(raw?.citations) ? raw.citations : [];
  const citation =
    citations.find(
      (item: any) => String(item?.db).toUpperCase() === database,
    ) ??
    citations.find((item: any) => String(item?.db).toUpperCase() === "WOS");
  return {
    uid: String(raw?.uid ?? ""),
    title: raw?.title ? String(raw.title) : null,
    documentTypes: Array.isArray(raw?.types) ? raw.types.map(String) : [],
    authors: (Array.isArray(raw?.names?.authors) ? raw.names.authors : [])
      .filter((author: any) => author?.displayName)
      .map((author: any) => ({
        displayName: String(author.displayName),
        wosStandard: author.wosStandard
          ? String(author.wosStandard)
          : undefined,
        researcherId: author.researcherId
          ? String(author.researcherId)
          : undefined,
      })),
    source: {
      title: source.sourceTitle ? String(source.sourceTitle) : undefined,
      year: Number.isInteger(source.publishYear)
        ? source.publishYear
        : undefined,
      month: source.publishMonth ? String(source.publishMonth) : undefined,
      volume: source.volume ? String(source.volume) : undefined,
      issue: source.issue ? String(source.issue) : undefined,
      articleNumber: source.articleNumber
        ? String(source.articleNumber)
        : undefined,
      pages: pagesOf(source),
    },
    identifiers: Object.fromEntries(
      ["doi", "pmid", "issn", "eissn", "isbn", "eisbn"]
        .filter((key) => raw?.identifiers?.[key])
        .map((key) => [key, String(raw.identifiers[key])]),
    ),
    keywords: Array.isArray(raw?.keywords?.authorKeywords)
      ? raw.keywords.authorKeywords.map(String)
      : [],
    timesCited: Number.isInteger(citation?.count) ? citation.count : null,
    links: Object.fromEntries(
      ["record", "citingArticles", "references", "related"]
        .filter((key) => raw?.links?.[key])
        .map((key) => [key, String(raw.links[key])]),
    ),
  };
}

function mappedError(error: any): Error {
  const status = Number(error?.status ?? error?.xmlhttp?.status ?? 0);
  if (status === 400) return new Error("Web of Science rejected the query");
  if (status === 401)
    return new Error("Web of Science API Key is missing or invalid");
  if (status === 403)
    return new Error(
      "Web of Science subscription does not permit this request",
    );
  if (status === 404) return new Error("Web of Science resource was not found");
  if (status === 429)
    return new Error("Web of Science rate limit or request quota was exceeded");
  if (status >= 500)
    return new Error("Web of Science service is temporarily unavailable");
  return new Error("Web of Science request failed or timed out");
}

export async function searchWebOfScience(
  options: WosSearchOptions,
): Promise<WosSearchResult> {
  const query = String(options?.query ?? "").trim();
  if (!query) throw new Error("query is required");

  const apiKey = String(pref("wos.apiKey") ?? "").trim();
  if (!apiKey) throw new Error("Web of Science API Key is not configured");

  const database = String(
    options.database ?? pref("wos.database") ?? "WOS",
  ).toUpperCase();
  if (!(WOS_DATABASES as readonly string[]).includes(database)) {
    throw new Error(`Unsupported Web of Science database: ${database}`);
  }
  const sort = options.sort ?? "relevance";
  if (!(sort in WOS_SORTS))
    throw new Error(`Unsupported Web of Science sort: ${sort}`);
  if (
    options.detail &&
    options.detail !== "full" &&
    options.detail !== "short"
  ) {
    throw new Error(`Unsupported Web of Science detail: ${options.detail}`);
  }
  if (
    options.maxResults !== undefined &&
    (!Number.isInteger(options.maxResults) || options.maxResults < 1)
  ) {
    throw new Error("maxResults must be a positive integer");
  }

  const hardCap = boundedInteger(pref("wos.maxRecords"), 100, 1, 1000);
  const wanted = Math.min(options.maxResults ?? 50, hardCap);
  const pageSize = Math.min(50, wanted);
  const timeout = boundedInteger(pref("wos.timeoutSeconds"), 30, 5, 600) * 1000;
  const records: any[] = [];
  let total = 0;
  let requestsUsed = 0;

  for (let page = 1; records.length < wanted; page++) {
    const params = new URLSearchParams({
      q: query,
      db: database,
      limit: String(pageSize),
      page: String(page),
      sortField: WOS_SORTS[sort],
    });
    if (options.detail === "short") params.set("detail", "short");

    let body: any;
    try {
      const response = await Zotero.HTTP.request(
        "GET",
        `${BASE}/documents?${params}`,
        {
          headers: { Accept: "application/json", "X-ApiKey": apiKey },
          responseType: "json",
          timeout,
        },
      );
      requestsUsed++;
      body = response.response ?? {};
    } catch (error) {
      throw mappedError(error);
    }

    const hits = Array.isArray(body.hits) ? body.hits : [];
    if (page === 1) total = Number(body?.metadata?.total ?? hits.length) || 0;
    records.push(...hits.map((hit: any) => normalizeDocument(hit, database)));
    if (!hits.length || hits.length < pageSize || records.length >= total)
      break;
  }

  const limited = records.slice(0, wanted);
  return {
    total,
    returned: limited.length,
    requestsUsed,
    database,
    records: limited,
  };
}

export async function testWosConnection(): Promise<{
  database: string;
  total: number;
}> {
  const result = await searchWebOfScience({
    query: "PY=2020",
    maxResults: 1,
    detail: "short",
  });
  return { database: result.database, total: result.total };
}
```

- [ ] **Step 4: 把新模块加入现有单测 runner**

在 `scripts/unit-test.mjs` 的 `tsc` 文件列表加入 `src/modules/wosService.ts`，在 `node --test` 文件列表加入 `test/wosService.test.cjs`。不创建第二个 runner。

- [ ] **Step 5: 运行测试确认 GREEN**

Run:

```powershell
npm run test:unit
```

Expected: 既有 91 个测试与新增 4 个测试全部 PASS，共 95 个测试、0 failed。

- [ ] **Step 6: Commit**

```powershell
git add src/modules/wosService.ts test/wosService.test.cjs scripts/unit-test.mjs
git commit -m "feat: add Web of Science Starter service"
```

---

### Task 2: 注册 MCP 工具并验证显隐

**Files:**

- Modify: `src/modules/streamableMCPServer.ts`
- Modify: `src/modules/selfTest.ts`

**Interfaces:**

- Consumes: `searchWebOfScience(WosSearchOptions)`、preference `extensions.zotero.zotero-agent.wos.enabled`。
- Produces: MCP tool `search_web_of_science`，关闭时隐藏、开启时可调用。

- [ ] **Step 1: 先加入失败的 selfTest 场景**

在 `src/modules/selfTest.ts` 的 `protocol` suite 中加入：

```ts
await t.scenario(
  "Web of Science tool follows its enabled preference",
  async () => {
    const key = PREF + "wos.enabled";
    const original = Zotero.Prefs.get(key, true);
    try {
      Zotero.Prefs.set(key, false, true);
      const hidden = await mcpPost(rpc("tools/list"));
      const hiddenNames = (hidden.json?.result?.tools ?? []).map(
        (tool: any) => tool.name,
      );
      t.assertTrue(
        !hiddenNames.includes("search_web_of_science"),
        "disabled tool must be hidden",
      );

      Zotero.Prefs.set(key, true, true);
      const visible = await mcpPost(rpc("tools/list"));
      const visibleNames = (visible.json?.result?.tools ?? []).map(
        (tool: any) => tool.name,
      );
      t.assertTrue(
        visibleNames.includes("search_web_of_science"),
        "enabled tool must be listed",
      );
    } finally {
      if (original === undefined || original === null)
        Zotero.Prefs.clear(key, true);
      else Zotero.Prefs.set(key, original, true);
    }
  },
);
```

- [ ] **Step 2: 构建、部署并确认 RED**

Run:

```powershell
npm run build
node scripts/deploy-live.mjs
```

随后通过现有 `run_javascript` 调用：

```js
return await Zotero.ZoteroAgentSelfTest.run("protocol");
```

Expected: 新场景 FAIL，消息包含 `enabled tool must be listed`。

- [ ] **Step 3: 注册工具 schema 和调用分支**

在 `streamableMCPServer.ts` 导入：

```ts
import { searchWebOfScience, WOS_DATABASES } from "./wosService";
```

在 `const tools = [` 中加入：

```ts
{
  name: "search_web_of_science",
  description: "Search Clarivate Web of Science Starter API with a WoS advanced query. The query is sent to Clarivate; each page retrieves at most 50 records and consumes one API request. Returns normalized bibliographic metadata and DOI/PMID/ISBN values that can be passed to import_by_identifier. Requires Web of Science to be enabled and configured in Zotero Agent preferences.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: 'WoS advanced query, e.g. TS=("graph neural network") AND PY=(2020-2026).' },
      database: { type: "string", enum: [...WOS_DATABASES], description: "WoS product database; defaults to the configured database." },
      maxResults: { type: "integer", minimum: 1, maximum: 1000, description: "Maximum records; additionally capped by the configured wos.maxRecords value (default cap 100)." },
      sort: { type: "string", enum: ["relevance", "publication_date_desc", "times_cited_desc"] },
      detail: { type: "string", enum: ["full", "short"], description: "Starter record detail; default full." },
    },
    required: ["query"],
  },
},
```

在现有 eval 过滤之后、`return` 之前加入：

```ts
const wosEnabled =
  Zotero.Prefs.get("extensions.zotero.zotero-agent.wos.enabled", true) === true;
if (!wosEnabled) {
  finalTools = finalTools.filter(
    (tool: any) => tool.name !== "search_web_of_science",
  );
}
```

在 `handleToolCall` switch 中加入：

```ts
case "search_web_of_science":
  result = await searchWebOfScience(args);
  break;
```

不要把该工具加入 write/eval tool sets；它是只读外部检索。

- [ ] **Step 4: 重新构建、部署并确认 GREEN**

Run:

```powershell
npm run build
node scripts/deploy-live.mjs
```

再次运行：

```js
return await Zotero.ZoteroAgentSelfTest.run("protocol");
```

Expected: 新场景 PASS，并且 `finally` 后原始 `wos.enabled` 值恢复；完整 protocol suite 无失败。

- [ ] **Step 5: Commit**

```powershell
git add src/modules/streamableMCPServer.ts src/modules/selfTest.ts
git commit -m "feat: expose Web of Science search MCP tool"
```

---

### Task 3: 偏好设置和测试连接

**Files:**

- Modify: `addon/prefs.js`
- Modify: `typings/prefs.d.ts`
- Modify: `addon/content/preferences.xhtml`
- Modify: `src/modules/preferenceScript.ts`
- Modify: `addon/locale/en-US/preferences.ftl`
- Modify: `addon/locale/zh-CN/preferences.ftl`
- Generated by build: `typings/i10n.d.ts`

**Interfaces:**

- Consumes: `testWosConnection()`、现有 `bindHtmlCheckbox`、`bindHtmlInput`、`bindHtmlSelect`、`getString`。
- Produces: 五个 preferences、启用联动、密码输入和一次最小连接测试。

- [ ] **Step 1: 声明 defaults 和类型**

在 `addon/prefs.js` 加入：

```js
pref("wos.enabled", false);
pref("wos.apiKey", "");
pref("wos.database", "WOS");
pref("wos.maxRecords", 100);
pref("wos.timeoutSeconds", 30);
```

在 `typings/prefs.d.ts` 的 `PluginPrefsMap` 加入：

```ts
"wos.enabled": boolean;
"wos.apiKey": string;
"wos.database": string;
"wos.maxRecords": number;
"wos.timeoutSeconds": number;
```

- [ ] **Step 2: 增加偏好声明和面板**

在 `preferences.xhtml` 顶部 `<preferences>` 加入：

```xml
<preference id="extensions.zotero.zotero-agent.wos.enabled" name="extensions.zotero.zotero-agent.wos.enabled" type="bool" />
<preference id="extensions.zotero.zotero-agent.wos.apiKey" name="extensions.zotero.zotero-agent.wos.apiKey" type="string" />
<preference id="extensions.zotero.zotero-agent.wos.database" name="extensions.zotero.zotero-agent.wos.database" type="string" />
<preference id="extensions.zotero.zotero-agent.wos.maxRecords" name="extensions.zotero.zotero-agent.wos.maxRecords" type="int" />
<preference id="extensions.zotero.zotero-agent.wos.timeoutSeconds" name="extensions.zotero.zotero-agent.wos.timeoutSeconds" type="int" />
```

在客户端配置与语义搜索之间加入：

```xml
<html:div class="zmp-s">
  <html:div class="zmp-s-title" data-l10n-id="pref-wos-title"></html:div>
  <html:div class="zmp-s-desc" data-l10n-id="pref-wos-description"></html:div>
  <html:div class="zmp-sw">
    <html:div>
      <html:div class="zmp-sw-text" data-l10n-id="pref-wos-enable-text"></html:div>
      <html:div class="zmp-sw-sub" data-l10n-id="pref-wos-enable-sub"></html:div>
    </html:div>
    <html:label class="zmp-tog">
      <html:input type="checkbox" id="zotero-prefpane-__addonRef__-wos-enabled"
        preference="extensions.zotero.zotero-agent.wos.enabled" />
      <html:span class="zmp-tog-track"></html:span>
    </html:label>
  </html:div>
  <html:div id="wos-settings-container">
    <html:div class="zmp-fg">
      <html:label class="zmp-fl" data-l10n-id="pref-wos-api-key-label"></html:label>
      <html:input type="password" class="zmp-fi zmp-fi-l zmp-fi-mono"
        id="zotero-prefpane-__addonRef__-wos-api-key"
        preference="extensions.zotero.zotero-agent.wos.apiKey" />
    </html:div>
    <html:div class="zmp-f2">
      <html:div class="zmp-fg">
        <html:label class="zmp-fl" data-l10n-id="pref-wos-database-label"></html:label>
        <html:select class="zmp-fi" id="zotero-prefpane-__addonRef__-wos-database"
          preference="extensions.zotero.zotero-agent.wos.database">
          <html:option value="WOS">WOS</html:option>
          <html:option value="BIOABS">BIOABS</html:option>
          <html:option value="BCI">BCI</html:option>
          <html:option value="BIOSIS">BIOSIS</html:option>
          <html:option value="CCC">CCC</html:option>
          <html:option value="DIIDW">DIIDW</html:option>
          <html:option value="DRCI">DRCI</html:option>
          <html:option value="MEDLINE">MEDLINE</html:option>
          <html:option value="ZOOREC">ZOOREC</html:option>
          <html:option value="PPRN">PPRN</html:option>
          <html:option value="WOK">WOK</html:option>
        </html:select>
      </html:div>
      <html:div class="zmp-fg">
        <html:label class="zmp-fl" data-l10n-id="pref-wos-max-records-label"></html:label>
        <html:input type="number" class="zmp-fi zmp-fi-s"
          id="zotero-prefpane-__addonRef__-wos-max-records"
          preference="extensions.zotero.zotero-agent.wos.maxRecords" min="1" max="1000" />
      </html:div>
    </html:div>
    <html:div class="zmp-fg">
      <html:label class="zmp-fl" data-l10n-id="pref-wos-timeout-label"></html:label>
      <html:input type="number" class="zmp-fi zmp-fi-s"
        id="zotero-prefpane-__addonRef__-wos-timeout"
        preference="extensions.zotero.zotero-agent.wos.timeoutSeconds" min="5" max="600" />
    </html:div>
    <html:div class="zmp-bg">
      <html:button class="zmp-b" id="test-wos-button" data-l10n-id="pref-wos-test-button"></html:button>
      <html:span id="wos-test-result" style="font-size:12px; line-height:30px"></html:span>
    </html:div>
    <html:div class="zmp-fh" data-l10n-id="pref-wos-data-notice"></html:div>
  </html:div>
</html:div>
```

- [ ] **Step 3: 绑定 preference 和连接测试**

在 `preferenceScript.ts` 导入 `testWosConnection`，在 `bindPrefEvents()` 调用 `bindWosPanel(doc)`。新增：

```ts
function bindWosPanel(doc: Document) {
  const enabledSelector = `#zotero-prefpane-${config.addonRef}-wos-enabled`;
  bindHtmlCheckbox(
    doc,
    enabledSelector,
    "extensions.zotero.zotero-agent.wos.enabled",
  );
  bindHtmlInput(
    doc,
    `#zotero-prefpane-${config.addonRef}-wos-api-key`,
    "extensions.zotero.zotero-agent.wos.apiKey",
  );
  bindHtmlSelect(
    doc,
    `#zotero-prefpane-${config.addonRef}-wos-database`,
    "extensions.zotero.zotero-agent.wos.database",
  );
  bindHtmlInput(
    doc,
    `#zotero-prefpane-${config.addonRef}-wos-max-records`,
    "extensions.zotero.zotero-agent.wos.maxRecords",
    true,
  );
  bindHtmlInput(
    doc,
    `#zotero-prefpane-${config.addonRef}-wos-timeout`,
    "extensions.zotero.zotero-agent.wos.timeoutSeconds",
    true,
  );

  const enabled = doc.querySelector(enabledSelector) as HTMLInputElement | null;
  const settings = doc.querySelector(
    "#wos-settings-container",
  ) as HTMLElement | null;
  const button = doc.querySelector(
    "#test-wos-button",
  ) as HTMLButtonElement | null;
  const result = doc.querySelector(
    "#wos-test-result",
  ) as HTMLSpanElement | null;
  const refresh = () => {
    if (settings) settings.style.opacity = enabled?.checked ? "1" : "0.65";
  };
  enabled?.addEventListener("change", refresh);
  refresh();

  button?.addEventListener("click", async () => {
    if (!result || !button) return;
    button.disabled = true;
    result.textContent = getString("pref-wos-testing" as any);
    try {
      const status = await testWosConnection();
      result.textContent = getString("pref-wos-test-success" as any, {
        args: { database: status.database, total: status.total },
      });
    } catch (error: any) {
      result.textContent = getString("pref-wos-test-failed" as any, {
        args: { message: error?.message ?? String(error) },
      });
    } finally {
      button.disabled = false;
    }
  });
}
```

不要记录输入框值或异常对象。

- [ ] **Step 4: 增加英文和中文 Fluent 文案**

`addon/locale/en-US/preferences.ftl`：

```ftl
pref-wos-title = Web of Science
pref-wos-description = Search bibliographic metadata through the Clarivate Web of Science Starter API.
pref-wos-enable-text = Enable Web of Science search
pref-wos-enable-sub = Adds search_web_of_science to the MCP tool list.
pref-wos-api-key-label = API Key
pref-wos-database-label = Default database
pref-wos-max-records-label = Maximum records per call
pref-wos-timeout-label = Request timeout (seconds)
pref-wos-test-button = Test Connection
pref-wos-testing = Testing...
pref-wos-test-success = Connection successful — { $database }, { $total } matching records
pref-wos-test-failed = Connection failed — { $message }
pref-wos-data-notice = Search queries are sent to Clarivate. The API Key is used only with api.clarivate.com.
```

`addon/locale/zh-CN/preferences.ftl`：

```ftl
pref-wos-title = Web of Science
pref-wos-description = 通过 Clarivate Web of Science Starter API 检索基础题录元数据。
pref-wos-enable-text = 启用 Web of Science 检索
pref-wos-enable-sub = 在 MCP 工具列表中提供 search_web_of_science。
pref-wos-api-key-label = API Key
pref-wos-database-label = 默认数据库
pref-wos-max-records-label = 单次最大记录数
pref-wos-timeout-label = 请求超时（秒）
pref-wos-test-button = 测试连接
pref-wos-testing = 正在测试...
pref-wos-test-success = 连接成功 — { $database }，命中 { $total } 条
pref-wos-test-failed = 连接失败 — { $message }
pref-wos-data-notice = 检索表达式会发送给 Clarivate；API Key 仅用于访问 api.clarivate.com。
```

其他 locale 本次使用 en-US fallback，不复制未经人工校对的机器翻译。

- [ ] **Step 5: 构建并实际检查偏好面板**

Run:

```powershell
npm run build
node scripts/deploy-live.mjs
```

Verify:

- 面板默认关闭；关闭时 WoS 工具隐藏。
- API Key 输入为 password，关闭/重新打开面板后值仍保存但不明文展示。
- database、maxRecords、timeout 改动后重新打开面板仍一致。
- 没有 Key 时测试连接显示 `Web of Science API Key is not configured`，不产生未处理异常。
- `typings/i10n.d.ts` 由 build 生成并包含 13 个 `pref-wos-*` key。

- [ ] **Step 6: Commit**

```powershell
git add addon/prefs.js typings/prefs.d.ts addon/content/preferences.xhtml src/modules/preferenceScript.ts addon/locale/en-US/preferences.ftl addon/locale/zh-CN/preferences.ftl typings/i10n.d.ts
git commit -m "feat: configure Web of Science in preferences"
```

---

### Task 4: 验证导入兼容性并更新用户文档

**Files:**

- Verify only: `src/modules/importService.ts`
- Modify: `README.md`
- Modify: `README-zh.md`
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: WoS 返回的 `identifiers.doi`、`identifiers.pmid`、`identifiers.isbn`。
- Produces: 文档化的 `search_web_of_science → import_by_identifier` 工作流；正常预期下不产生 import 代码 diff。

- [ ] **Step 1: 用 Zotero 原生解析器验证三类标识符**

通过现有 `run_javascript` 只读执行：

```js
const samples = ["10.1038/nature14539", "PMID: 26017442", "9780262046305"];
return samples.map((value) => ({
  value,
  parsed: Zotero.Utilities.extractIdentifiers(value),
}));
```

Expected: 三项的 `parsed` 都非空，分别包含 DOI、PMID、ISBN。满足时不修改 `src/modules/importService.ts`。如果真实 WoS 返回值不能被该入口识别，先为该原始字符串新增失败测试，再只扩展通用输入规范化；禁止加入 `if (source === "wos")` 或 UID 导入分支。

- [ ] **Step 2: 更新英文和中文 README**

完成以下精确变更：

- 工具总数 `46` → `47`。
- MCP Tools 表新增：

```markdown
| `search_web_of_science` | Search Clarivate Web of Science Starter API with advanced WoS queries; returns normalized metadata and identifiers for `import_by_identifier`. Requires the user's API Key. |
```

```markdown
| `search_web_of_science` | 使用 WoS 高级检索式查询 Clarivate Web of Science Starter API，返回可继续交给 `import_by_identifier` 的规范化元数据和标识符；需要用户自己的 API Key。 |
```

- 配置章节说明：在 Zotero Agent preferences 中启用 WoS、填入 Key、测试连接；查询发送至 Clarivate；每 50 条最多消耗一次请求。
- 示例工作流：

```text
search_web_of_science
  → choose DOI / PMID / ISBN
  → import_by_identifier
```

- [ ] **Step 3: 更新 CHANGELOG 和 AGENTS.md**

在 `CHANGELOG.md` 的 `[Unreleased]` 添加：

```markdown
### Added

- **`search_web_of_science`**: search the Clarivate Web of Science Starter API with advanced WoS queries, fixed-size pagination, normalized bibliographic metadata, preference-based request caps, and API-key-safe errors.

### Changed

- selfTest: 31 → 32 scenarios; unit tests: 91 → 95 cases.
```

在 `AGENTS.md` 更新：

- `当前 v2.1.0，46 工具` → `当前开发分支，47 工具`。
- selfTest 约 31 → 32 场景。
- 工具列表加入 `search_web_of_science`，并注明 Key 由用户提供、查询发送至 Clarivate。

- [ ] **Step 4: 验证 importService 未发生 WoS 专用修改**

Run:

```powershell
git diff -- src/modules/importService.ts src/modules/importDedup.ts
rg -n "wos|web.of.science|clarivate" src/modules/importService.ts src/modules/importDedup.ts
```

Expected: `git diff` 为空；`rg` 无匹配。

- [ ] **Step 5: Commit**

```powershell
git add README.md README-zh.md CHANGELOG.md AGENTS.md
git commit -m "docs: document Web of Science search workflow"
```

---

### Task 5: 全量验证和真实 API 证据

**Files:**

- Verify: all files changed by Tasks 1–4

**Interfaces:**

- Consumes: 完整 feature branch。
- Produces: 可审计的 Passed/Failed/Not Run 验证记录；不新增功能。

- [ ] **Step 1: 运行自动化验证**

```powershell
npm run test:unit
npm run build
npm run lint:check
git diff --check main...HEAD
```

Expected:

- `test:unit`: 95 tests、0 failed。
- `build`: exit code 0，TypeScript 无错误。
- `lint:check`: exit code 0。
- `git diff --check`: 无输出。

- [ ] **Step 2: 部署并运行 protocol selfTest**

```powershell
node scripts/deploy-live.mjs
```

通过 `run_javascript`：

```js
return await Zotero.ZoteroAgentSelfTest.run("protocol");
```

Expected: 32 个场景均为 PASS 或有明确环境原因的 SKIP，0 failed；WoS preference 场景不得改变用户原始设置。

- [ ] **Step 3: 有 Key 时验证真实 Starter API**

如果用户已在偏好面板配置有效 Key，调用：

```json
{
  "query": "TS=(\"graph neural network\") AND PY=(2024-2026)",
  "database": "WOS",
  "maxResults": 3,
  "detail": "short"
}
```

Verify:

- `returned <= 3`、`requestsUsed == 1`。
- 每条都有 `uid`，并且 API Key 不出现在响应。
- 至少一条有 DOI/PMID/ISBN 时，将标识符传给现有 `import_by_identifier`；只有用户明确允许写入且 `write.enabled=true` 时才执行真实导入。

若没有有效 Key，将真实 API 验证记为 `Not Run — no user-provided Clarivate API Key`；不得使用开发者共享 Key或把 mock 结果称为真实验证。

- [ ] **Step 4: 检查最终 Git 状态和提交边界**

```powershell
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Expected: 工作区干净；包含设计/计划和四个逻辑实现提交；没有依赖文件变化、XPI、API Key 或 `.env`。

如果 Step 1–3 暴露实现缺陷，停止完成声明，按 `systematic-debugging` 和 TDD 流程复现、修正并重新执行本任务；没有缺陷时不创建空提交。
