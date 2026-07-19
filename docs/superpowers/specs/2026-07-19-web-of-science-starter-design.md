# Web of Science Starter API MCP 设计

## 目标

在 Zotero Agent 中增加一个只读 MCP 工具 `search_web_of_science`，使用用户自己的 Clarivate Web of Science Starter API Key 检索文献，并返回稳定、紧凑、可继续交给现有 `import_by_identifier` 使用的结构化结果。

## 已确认事实

- 官方端点固定为 `https://api.clarivate.com/apis/wos-starter/v1/documents`。
- 认证使用 HTTP Header `X-ApiKey`。
- `GET /documents` 单页最多返回 50 条，使用 `page` 和固定 `limit` 分页。
- Starter API 返回基础题录、标识符、作者、来源、关键词、分库被引次数和 WoS 链接；它不等同于 Expanded API 的完整记录。
- 当前仓库已有 `Zotero.HTTP.request`、集中式 MCP 工具注册、HTML preference 绑定和 `import_by_identifier`，无需增加运行时依赖。

官方依据：

- <https://developer.clarivate.com/apis/wos-starter>
- <https://developer.clarivate.com/help/api-access>
- <https://github.com/clarivate/wosstarter_python_client>

## 范围

### 本次实现

1. 新增 `search_web_of_science` MCP 工具。
2. 新增 `src/modules/wosService.ts`，负责配置读取、输入约束、分页请求、错误归一化和响应规范化。
3. 在偏好面板增加 WoS 启用开关、API Key、默认数据库、单次结果硬上限、超时和测试连接按钮。
4. 为纯数据映射、URL 参数、分页、额度上限、错误脱敏和工具显隐增加自动化验证。
5. 更新中英文 README、CHANGELOG 和 AGENTS.md 中的工具数及使用说明。

### 不在本次实现

- `get_web_of_science_record`：已知 UID 可以通过 `UT=(...)` 查询完成，暂不增加重复工具。
- WoS 专用导入工具：优先复用 `import_by_identifier`。
- XLSX/CSV 导出：MCP 返回 JSON；不增加表格依赖。
- Expanded API、引用记录列表、被引参考文献列表和 Related Records 数据抓取。
- Clarivate JavaScript/Python SDK、后台同步、缓存、自动重试和任意 API Base URL。

自动重试暂不实现：429 通常代表额度或速率限制，隐藏重试会继续消耗请求；5xx/网络错误直接返回可操作错误，由调用方决定何时重试。

## MCP 工具合同

工具名：`search_web_of_science`

| 参数         | 类型     | 默认值           | 约束与作用                                                                                                   |
| ------------ | -------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `query`      | `string` | 无               | 必填；WoS Starter 支持的高级检索表达式，例如 `TS=("graph neural network") AND PY=(2020-2026)`                |
| `database`   | `string` | preference `WOS` | 官方数据库枚举：`WOS`、`BIOABS`、`BCI`、`BIOSIS`、`CCC`、`DIIDW`、`DRCI`、`MEDLINE`、`ZOOREC`、`PPRN`、`WOK` |
| `maxResults` | `number` | `50`             | 最少 1；不得超过 preference `wos.maxRecords`，默认硬上限 100                                                 |
| `sort`       | `string` | `relevance`      | `relevance` → `RS+D`，`publication_date_desc` → `PY+D`，`times_cited_desc` → `TC+D`                          |
| `detail`     | `string` | `full`           | `full` 或 `short`；`full` 使用服务端默认，不发送多余参数                                                     |

工具描述必须明确：查询会发送到 Clarivate；每 50 条至多需要一个 API 请求；结果可把 DOI、PMID 或 ISBN 交给 `import_by_identifier`。

## 返回结构

```ts
interface WosSearchResult {
  total: number;
  returned: number;
  requestsUsed: number;
  database: string;
  records: Array<{
    uid: string;
    title: string | null;
    documentTypes: string[];
    authors: Array<{
      displayName: string;
      wosStandard?: string;
      researcherId?: string;
    }>;
    source: {
      title?: string;
      year?: number;
      month?: string;
      volume?: string;
      issue?: string;
      articleNumber?: string;
      pages?: string;
    };
    identifiers: {
      doi?: string;
      pmid?: string;
      issn?: string;
      eissn?: string;
      isbn?: string;
      eisbn?: string;
    };
    keywords: string[];
    timesCited: number | null;
    links: {
      record?: string;
      citingArticles?: string;
      references?: string;
      related?: string;
    };
  }>;
}
```

`timesCited` 优先选择与当前 `database` 同名的 `citations` 项；没有时选择 `WOS` 项；仍没有时返回 `null`，不对不同数据库计数求和。

`pages` 优先使用官方 `source.pages.range`，否则在 `begin` 和 `end` 都存在时拼成 `begin-end`，只有 `begin` 时返回 `begin`。

响应不得包含 API Key、完整 preference 对象、请求 Header 或 Clarivate 原始响应。

## 分页与上限

`pageSize = min(50, effectiveMaxResults)`，后续页面始终使用相同 `pageSize`，避免改变 `limit` 后 `page` 偏移重新计算造成重复记录。

循环在以下任一条件满足时停止：

1. 已收集 `effectiveMaxResults` 条；
2. 已达到 `metadata.total`；
3. 当前页面 `hits` 为空；
4. 当前页面返回条数少于 `pageSize`。

最终对记录数组执行 `slice(0, effectiveMaxResults)`，并返回实际 `requestsUsed`。

## 偏好设置

| Preference           | 默认值  | UI             | 说明                                         |
| -------------------- | ------- | -------------- | -------------------------------------------- |
| `wos.enabled`        | `false` | checkbox       | 关闭时从 `tools/list` 隐藏工具               |
| `wos.apiKey`         | `""`    | password       | 用户在 Clarivate Developer Portal 申请的 Key |
| `wos.database`       | `"WOS"` | select         | 默认数据库                                   |
| `wos.maxRecords`     | `100`   | number，1–1000 | 单次调用硬上限，不代表用户额度               |
| `wos.timeoutSeconds` | `30`    | number，5–600  | 每个 HTTP 请求的超时                         |

Base URL、认证 Header 名、API 版本、额度和订阅计划不开放配置。固定官方 HTTPS 域名可避免 Key 被发送到任意服务器。

测试连接按钮调用同一个 service，使用 `PY=2020`、`limit=1`、`detail=short` 执行一次最小查询。测试允许在工具开关关闭时运行，便于用户先验证 Key 再启用工具。

## 数据流

```text
MCP tools/call
  → streamableMCPServer 校验 query 和工具开关
  → wosService 读取 Key、默认数据库、硬上限和超时
  → URLSearchParams 构造固定 Clarivate URL
  → Zotero.HTTP.request 分页请求
  → wosService 规范化 metadata/hits
  → MCP content 返回 JSON
  → 可选：调用现有 import_by_identifier 导入 DOI/PMID/ISBN
```

## `import_by_identifier` 决策

当前实现已经调用 `Zotero.Utilities.extractIdentifiers`，支持 DOI、ISBN、arXiv 和 PMID；WoS Starter 的 `identifiers.doi`、`identifiers.pmid`、`identifiers.isbn` 均是字符串。因此本次默认不修改 `import_by_identifier`。

只有部署后真实 WoS 响应出现以下证据时才允许扩展：

- 官方返回的有效 DOI/PMID/ISBN 形式被 `extractIdentifiers` 拒绝；或
- 通用标识符规范化存在与 WoS 无关、可用独立测试复现的缺口。

扩展必须发生在通用标识符入口，不能增加 WoS 分支、WoS UID 特判或第二套导入逻辑。批量导入不在本次范围；Agent 可以逐条调用现有工具。

## 错误与安全

| 情况                   | 对外行为                                                   |
| ---------------------- | ---------------------------------------------------------- |
| 未填写 API Key         | `Web of Science API Key is not configured`                 |
| 空 `query`             | `query is required`                                        |
| 不支持的数据库或排序值 | 输入校验错误，列出允许值                                   |
| HTTP 400               | `Web of Science rejected the query`                        |
| HTTP 401               | `Web of Science API Key is missing or invalid`             |
| HTTP 403               | `Web of Science subscription does not permit this request` |
| HTTP 404               | `Web of Science resource was not found`                    |
| HTTP 429               | `Web of Science rate limit or request quota was exceeded`  |
| HTTP 5xx               | `Web of Science service is temporarily unavailable`        |
| 网络/超时              | `Web of Science request failed or timed out`               |

错误映射只依据 HTTP status；不回传异常对象、请求 URL、Header 或 response dump。日志只允许记录工具名、页码、返回数量和错误类别，不能记录 Key。

## 测试策略

### Node 单元测试

使用现有 `scripts/unit-test.mjs` 把 `wosService.ts` 编译到 `.tmp-test`，通过 mock `global.Zotero.Prefs` 和 `global.Zotero.HTTP.request` 验证：

- 查询参数编码和排序映射；
- 50 条固定页大小和多页截断；
- preference 硬上限；
- 官方 camelCase 响应字段规范化；
- 当前数据库的被引次数选择；
- 401/403/429/5xx/网络错误映射；
- API Key 只出现在 `X-ApiKey` Header，不出现在 URL、返回值和错误消息。

### Zotero selfTest

不依赖真实 Clarivate Key，只验证：

- `wos.enabled=false` 时工具隐藏；
- 临时设为 `true` 时工具出现；
- 测试结束后 `finally` 恢复原 preference。

### 构建与人工验证

- `npm run test:unit`
- `npm run build`
- `npm run lint:check`
- 有可用 API Key 时，在偏好面板测试连接并调用一次 `search_web_of_science`；没有 Key 时记录为 `Not Run`，不能把 mock 测试描述为真实 API 验证。

## 验收标准

1. 未启用时工具不出现在 `tools/list`；启用后出现。
2. 有效 Key 能以 WoS 高级查询取得规范化记录，并遵守硬上限。
3. 多页查询不重复、不超过上限，并报告 `requestsUsed`。
4. API Key 不出现在 URL、日志、MCP 响应或错误消息。
5. `import_by_identifier` 保持现有通用行为；除非出现可复现缺口，否则零修改。
6. 单元测试、构建和 lint 通过；真实 API 验证结果单独报告。
