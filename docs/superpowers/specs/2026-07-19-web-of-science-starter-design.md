# Web of Science Starter API MCP 设计

## 目标

在 Zotero Agent 中增加只读工具 `search_web_of_science`。工具使用用户自己的 Clarivate Web of Science Starter API Key 检索文献，返回稳定、紧凑、可继续交给现有 `import_by_identifier` 使用的结构化结果。

## 已确认事实

- 固定端点为 `https://api.clarivate.com/apis/wos-starter/v1/documents`，认证 Header 为 `X-ApiKey`。
- `GET /documents` 单页最多返回 50 条，使用固定 `limit` 和递增 `page` 分页。
- Starter API 官方公开三种 plan：Free Trial（1 request/s、50 requests/day）、Free Institutional Member（5 requests/s、5,000 requests/day）和 Free Institutional Integration（5 requests/s、20,000 requests/day）。
- Free Trial 对没有 WoS 机构订阅的个人开放，但不返回 times-cited；机构 plan 受组织订阅和审批资格限制。
- 官方页面、OpenAPI 定义和官方生成客户端没有公开可依赖的 plan 查询端点或标准“剩余日额度”字段。因此不能由插件可靠自动识别 plan 或远端剩余额度。
- 当前仓库已有 `Zotero.HTTP.request`、集中式 MCP 工具注册、偏好绑定和 `import_by_identifier`，无需新增运行时依赖。

官方依据：

- <https://developer.clarivate.com/apis/wos-starter>
- <https://developer.clarivate.com/>
- <https://developer.clarivate.com/content/developer-portal-faq>
- <https://github.com/clarivate/wosstarter_python_client>

## 范围

### 本次实现

1. 新增 `search_web_of_science` MCP 工具和 `src/modules/wosService.ts`。
2. 在偏好面板增加启用开关、API Key、plan、默认数据库、单次结果上限、超时和测试连接。
3. 按用户选择的 plan 实施串行请求门、保守请求间隔、本地 UTC 日请求计数、日上限和单次安全上限。
4. 增加纯函数、分页、额度、限速、错误脱敏、工具显隐和连接测试验证。
5. 新增中英文独立指南，并从对应语言 README 链接。
6. 验证现有 `import_by_identifier` 对 DOI、PMID、ISBN 的通用兼容性；只有出现可复现的通用缺口才修改。

### 不在本次实现

- `get_web_of_science_record`：可先用 `UT=(...)` 查询，避免重复工具。
- WoS 专用导入工具：优先复用 `import_by_identifier`。
- XLSX/CSV 导出、Expanded API、引用记录列表、Related Records 数据抓取。
- Clarivate SDK、后台同步、缓存、任意 Base URL、自动重试。

## MCP 工具合同

工具名：`search_web_of_science`

| 参数 | 类型 | 默认值 | 约束与作用 |
| --- | --- | --- | --- |
| `query` | `string` | 无 | 必填；WoS 高级检索式，如 `TS=("graph neural network") AND PY=(2020-2026)` |
| `database` | `string` | preference `WOS` | 官方数据库枚举 |
| `maxResults` | `integer` | `50` | 1–1000，且受 preference 与 plan 安全上限共同约束 |
| `sort` | `string` | `relevance` | `relevance`、`publication_date_desc`、`times_cited_desc` |
| `detail` | `string` | `full` | `full` 或 `short` |

工具为只读、幂等、会访问 Clarivate 外部服务。描述须说明每 50 条至多需要一个 API 请求，并建议把 DOI、PMID 或 ISBN 交给 `import_by_identifier`。

## plan 与请求保护

| `wos.plan` | 官方速率 | 官方日额度 | times-cited | 插件请求间隔 | 插件单次安全上限 |
| --- | ---: | ---: | --- | ---: | ---: |
| `trial` | 1/s | 50 | 不返回 | 1100 ms | 50 records |
| `institutional-member` | 5/s | 5,000 | 返回 | 220 ms | 500 records |
| `institutional-integration` | 5/s | 20,000 | 返回 | 220 ms | 1,000 records |

插件单次安全上限是本项目的保护策略，不是 Clarivate 额外公布的限制。有效结果上限为：

```text
min(tool maxResults, wos.maxRecords, selected plan safety cap)
```

所有 WoS 请求经过模块级串行请求门，避免并发 MCP 调用合计超过速率。每次实际发起 HTTP 请求前更新 `wos.requestsToday`；`wos.usageDateUtc` 与当前 UTC 日期不同时先归零。达到所选 plan 日上限后在本地拒绝继续请求。

本地计数只是保守估计：它看不到同一 Key 被其他程序消耗的请求，也不代表 Clarivate 服务器确认的剩余额度。测试连接同样消耗并记录一次请求。HTTP 429 立即返回错误，不自动重试；若响应带 `Retry-After`，只可在错误提示中报告等待建议，不据此推断 plan。

## 返回结构

```ts
interface WosSearchResult {
  total: number;
  returned: number;
  requestsUsed: number;
  database: string;
  usage: {
    plan: "trial" | "institutional-member" | "institutional-integration";
    localRequestsToday: number;
    localDailyLimit: number;
  };
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

响应不得包含 API Key、完整 preference 对象、请求 Header 或 Clarivate 原始响应。Free Trial 缺少 times-cited 时规范化为 `null`。

## 分页

`pageSize = min(50, effectiveMaxResults)`，后续页面保持相同 `pageSize`。循环在达到有效上限、达到 `metadata.total`、空页或短页时停止，最终执行 `slice(0, effectiveMaxResults)`。

## 偏好设置

| Preference | 默认值 | UI | 说明 |
| --- | --- | --- | --- |
| `wos.enabled` | `false` | checkbox | 关闭时从 `tools/list` 隐藏工具 |
| `wos.apiKey` | `""` | password | 用户自己的 Key |
| `wos.plan` | `"trial"` | select | 用户声明实际订阅 plan |
| `wos.database` | `"WOS"` | select | 默认数据库 |
| `wos.maxRecords` | `100` | number，1–1000 | 用户上限，仍受 plan 安全上限约束 |
| `wos.timeoutSeconds` | `30` | number，5–600 | 每个请求超时 |
| `wos.usageDateUtc` | `""` | hidden | 本地计数日期 |
| `wos.requestsToday` | `0` | hidden | 本地当日请求计数 |

Base URL、Header 名、API 版本和日额度不允许用户自行填写。测试连接执行一次 `PY=2020`、`limit=1`、`detail=short` 的最小查询；它允许在工具开关关闭时运行，以便先验证配置。

## `import_by_identifier` 决策

现有实现调用 `Zotero.Utilities.extractIdentifiers`，支持 DOI、ISBN、arXiv 和 PMID。WoS 结果中的 DOI、PMID、ISBN 均作为普通字符串返回，所以默认不修改该工具。若部署后的真实结果暴露通用格式缺口，只在通用标识符入口修复并增加独立回归测试，不增加 WoS 分支或 UID 特判。

## 错误与安全

| 情况 | 对外行为 |
| --- | --- |
| 未填 API Key | `Web of Science API Key is not configured` |
| 空 query | `query is required` |
| 本地日额度用尽 | 报告 plan 和本地计数，要求等待 UTC 次日或核对 plan |
| HTTP 400 | 查询被拒绝 |
| HTTP 401 | Key 缺失或无效 |
| HTTP 403 | 当前订阅不允许该请求 |
| HTTP 429 | 速率或远端额度已超出，不自动重试 |
| HTTP 5xx | 服务暂时不可用 |
| 网络/超时 | 请求失败或超时 |

错误映射只依据 HTTP status，不回传异常对象、URL、Header 或 response dump。日志不得记录 Key。

## 验证

- Node 单测：plan 策略、有效上限、UTC 计数重置、串行间隔、分页、规范化、错误映射和脱敏。
- Zotero selfTest：工具开关显隐及 preference 恢复。
- 静态验证：`npm run test:unit`、`npm run build`、`npm run lint:check`。
- 部署验证：MCP 自升级安装 XPI、Add-on 状态、`tools/list`、protocol selfTest。
- 真实 API：由用户把 Key 填入 Zotero 面板后测试连接，再执行一次最多 1 条的查询；没有 Key 时明确记为 Not Run。
