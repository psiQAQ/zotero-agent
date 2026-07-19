# Web of Science Starter API 指南

本文说明 Zotero Agent 的 Web of Science Starter API 集成、个人申请资格、API Key 获取步骤、plan 限制和插件的额度保护策略。

## 非高校人员能否申请？

可以。Clarivate 明确说明 **Free Trial Plan 对任何人开放，即使所在组织没有订阅 Web of Science**。因此非高校人员、独立研究者和个人开发者可以申请试用 plan。

需要注意：

- Free Trial 仅适合个人使用和评估，每日最多 50 次请求，且不返回 times-cited。
- Clarivate FAQ 强烈建议使用机构、单位或自有域名邮箱；Gmail、Yahoo 等匿名/通用邮箱的申请可能被拒绝。这是审批风险，不等于“非高校人员不能申请”。
- Free Institutional Member 需要申请人属于已订阅 Web of Science 的组织。
- Free Institutional Integration 面向机构内部系统，审批限该组织的 administrative staff。
- 审批可能需要数天，最终资格以 Clarivate 审核为准。

官方说明：[Web of Science Starter API](https://developer.clarivate.com/apis/wos-starter)、[Developer Portal FAQ](https://developer.clarivate.com/content/developer-portal-faq)。

## plan 对比

| plan | 谁可以申请 | 官方速率 | 官方日额度 | times-cited | 插件单次安全上限 |
| --- | --- | ---: | ---: | --- | ---: |
| Free Trial | 任何人；无需所在组织订阅 WoS | 1 request/s | 50 | 不返回 | 50 records |
| Free Institutional Member | 已订阅 WoS 的组织成员 | 5 requests/s | 5,000 | 返回 | 500 records |
| Free Institutional Integration | 机构 administrative staff，需审批 | 5 requests/s | 20,000 | 返回 | 1,000 records |

“插件单次安全上限”是 Zotero Agent 为避免一次调用消耗过多日额度而设置的保护，不是 Clarivate 新增的官方限制。Starter API 每页最多 50 条，因此 50、500、1,000 条分别最多需要 1、10、20 次请求。

## 获取 API Key

### 注册 application 时如何选择 Client Type

对当前 Zotero Agent 集成，请选择 **`Public: Native/Mobile Application (Android/iOS app)`**。Clarivate 的标签虽然举了 Android/iOS 作为例子，但其官方说明明确把安装在用户 PC、手机或平板上的应用都归入这一类。Zotero Agent 随 Zotero 安装在用户电脑上，代码和本地配置可被用户检查，无法替应用开发者保守一个共享的 `client secret`，因此属于 public native client。

| Client Type | 适用场景 | 判断依据 | 本项目是否选择 |
| --- | --- | --- | --- |
| `Public: Single Page Application (browser based app)` | React、Vue 等完全运行在浏览器标签页中的前端应用 | API 请求由浏览器 JavaScript 发出；源码和凭据可被用户查看；没有可信后端代存 secret | 否；Zotero Agent 不是网页 SPA |
| `Public: Native/Mobile Application (Android/iOS app)` | 安装在用户 PC、手机或平板上的 desktop/native/mobile 应用 | 软件交付到用户设备，不能可靠保守共享 `client secret` | **是；选择这一项** |
| `Confidential: Server side application, can keep secrets confidential` | 由开发者控制的后端、daemon 或 server-side web application | 所有携带 secret 的请求都在受控服务器发出，secret 从不下发到浏览器、插件或用户电脑 | 否；当前插件直接从用户本机请求 Clarivate |

**`This application will use OAuth2.0 Flows (other than the Client Credentials flow, i.e. using redirects)` 不要勾选。** 该选项仅用于需要把用户重定向到 Authorization Server，再通过 callback/redirect URI 接收 authorization code 或 access token 的 OAuth2 应用。当前集成没有登录跳转、redirect URI、authorization code、PKCE、access token 或 refresh token，只用 `X-ApiKey` 直接请求 Starter API。

不要因为 API Key 输入框使用 password 样式，就选择 `Confidential`。password 输入框只避免界面直接显示 Key，不能让安装在用户电脑上的程序成为能保守应用级 secret 的服务器端环境。只有以后改成“插件只调用开发者自建后端，由后端保存 Clarivate 凭据并代发全部请求”的架构时，后端 application 才应考虑 `Confidential`。

Starter API 使用 `X-ApiKey`，不是 OAuth Client Credentials。Portal 的 Client Type 是 application 的客户端环境分类；它不会改变本插件的请求头，也不会要求把 OAuth `client secret` 填入 Zotero。官方说明：[Clarivate Client Types](https://developer.clarivate.com/help/client_types)、[Accessing using an API Key](https://developer.clarivate.com/help/api-access)。

1. 打开 [Clarivate Developer Portal](https://developer.clarivate.com/) 并注册或登录账号。已有 Clarivate 产品账号时可能可以直接使用。
2. 在 Portal 注册一个 application，Client Type 选择 `Public: Native/Mobile Application`，**不要勾选 OAuth2.0 Flows**，并填写该应用的用途。本插件使用时应为自己的 Zotero 集成注册独立 application，不要复用他人或公开共享的 Key。
3. 打开 [Web of Science Starter API](https://developer.clarivate.com/apis/wos-starter)，为该 application 选择并订阅符合资格的 plan。
4. 等待凭据发放或人工审批。部分 plan 可较快发放，其他 plan 可能需要数天。
5. 在 Zotero 中打开 `Settings → Zotero Agent → Web of Science`，选择准确 plan，把 Key 写入 password 输入框，然后点击“测试连接”。
6. 测试成功后启用 Web of Science 工具。测试连接本身会消耗 1 次请求。

不要把 Key 发到聊天、Issue、日志或截图中，也不要写入仓库。插件使用 Zotero Preferences 保存 Key；它便于本地使用，但不应视为操作系统级凭据保险箱。

## 为什么需要手动选择 plan？

Clarivate 当前公开文档、OpenAPI 定义和官方生成客户端没有提供可依赖的 plan 查询端点，也没有承诺统一返回“今日剩余额度”。插件因此不能可靠自动判断 Key 属于哪个 plan。

用户选择的 plan 决定：

- 请求间隔：Trial 至少 1100 ms，机构 plan 至少 220 ms；
- 本地日请求上限：50、5,000 或 20,000；
- 单次结果安全上限；
- UI 对 times-cited 可用性的说明。

请选择真实 plan。把 Trial 错选成机构 plan 可能导致请求过快或超出额度；把机构 plan 错选成 Trial 只会让插件更保守。

## 本地额度策略的边界

插件按 UTC 日期记录自己发出的 WoS 请求，并在达到所选 plan 日上限后停止。请求发出前即计数，因为失败请求也可能由服务端计入额度。多个同时到达的 MCP 调用会串行执行，避免合计超过每秒速率。

本地计数不是 Clarivate 的权威剩余额度：

- 同一 Key 被其他程序使用时，插件无法看到其消耗；
- Clarivate 没有在公开 Starter 文档中承诺额度重置时区或剩余量 Header；
- 服务端返回 HTTP 429 时，插件立即停止且不自动重试。

## 本次更新

| 内容 | 能力 | 限制 |
| --- | --- | --- |
| `search_web_of_science` | 执行 WoS 高级检索，返回基础题录、标识符、作者、来源、关键词、链接和可用的 times-cited | 只读；受 Key 权限、plan、数据库和额度限制 |
| plan 感知保护 | 串行限速、本地 UTC 日计数、单次安全上限、429 停止 | 不能读取其他客户端消耗或远端剩余额度 |
| 偏好面板 | 配置 Key、plan、数据库、结果上限、超时并测试连接 | Key 由用户自行申请和保管 |
| 导入衔接 | 把结果中的 DOI、PMID 或 ISBN 交给 `import_by_identifier` | 不新增 WoS UID 专用导入；无标识符记录暂不直接导入 |

本次不包含 Expanded API、XLSX/CSV 导出、引用网络抓取或后台同步。

## MCP 使用示例

```json
{
  "query": "TS=(\"graph neural network\") AND PY=(2020-2026)",
  "maxResults": 20,
  "sort": "relevance"
}
```

每条结果优先使用 `identifiers.doi`，其次使用 PMID 或 ISBN 调用 `import_by_identifier`。`uid` 可用于后续 `UT=(...)` 精确查询，但当前不作为 Zotero 导入标识符。

## 开发与验证状态

| 项目 | 状态 |
| --- | --- |
| 官方资格与 plan 调查 | 已完成 |
| 设计与实施计划 | 已更新 |
| service、MCP 工具和偏好面板 | 本地实现完成 |
| 单测与构建 | Passed（100/100；build Passed） |
| XPI 部署与 Zotero selfTest | Passed（29 passed，0 failed，3 skipped） |
| 真实 Starter API | 待用户在面板配置 Key 后执行 |

全仓 `npm run lint:check` 当前受既有 Prettier 基线阻塞：86 个文件不符合当前格式配置，其中包含大量无关历史文档和源码。本功能的单测、TypeScript 构建、XPI 部署、偏好面板运行态 DOM 检查和 protocol selfTest 已分别通过。
