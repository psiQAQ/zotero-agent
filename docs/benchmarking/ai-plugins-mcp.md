# Zotero 生态 AI / MCP 集成方案技术对比

> 对象：`refs/AI-plugins/` 下 5 个开源仓库。目标：从架构、读写能力、认证、工具集、技术栈等维度做客观技术对比，为「让 AI 助手 / MCP 客户端访问 Zotero 库」这一需求提供选型参考。
>
> 数据基于各仓库 submodule 当前 pin 的提交（截至 2026-06 下旬）。仓库随上游演进，数字可能变化；下文标注了各自读到的版本号与提交日期。

对比对象一览：

| 仓库 | 类型 | 当前版本 | 最后提交 |
|---|---|---|---|
| `introfini/ZotSeek` | 语义搜索插件（内嵌只读 MCP） | 1.16.1 | 2026-06-11 |
| `introfini/mcp-server-zotero-dev` | 插件开发/调试工具链（插件 + 外部 Node MCP over RDP） | server 1.1.2 / plugin 1.0.3 | 2026-06-25 |
| `papersgpt/papersgpt-for-zotero` | AI 读论文插件（对外宣称 MCP，实现在外部项目） | manifest 0.0.16（分发版 0.5.4） | 2026-06-16 |
| `54yyyu/zotero-mcp` | 纯外部 Python MCP server | 0.6.0 | 2026-06-21 |
| `cookjohn/zotero-mcp` | 插件内嵌完整 MCP server | 1.5.0 | 2026-06-11 |

---

## 1. 概述

### 1.1 这类方案解决什么问题

Zotero 是本地文献管理器，数据存在本机 SQLite（`zotero.sqlite`）+ 附件目录里。「AI / MCP 集成」这类方案要解决的是：**让外部 AI 助手（Claude、ChatGPT、Cursor 等）或遵循 MCP（Model Context Protocol）的客户端，能读、能搜、乃至能改用户的 Zotero 库**——搜索文献、抽取全文/注释、语义检索、批量改标签集合、导入条目等，把 LLM 接进文献工作流。

### 1.2 一个决定性的技术事实：写操作取决于 server 跑在哪

Zotero 桌面端在 `127.0.0.1:23119` 上开了一个**官方本地 HTTP API**，但它是为浏览器 Connector 插件设计的**只读通道**：`GET` 能用，`POST/PATCH/DELETE` 一律返回 `HTTP 501 Not Implemented`。这不是 bug，是官方刻意的安全设计。

由此推出本领域最关键的架构分野——**能不能写，取决于代码跑在 Zotero 进程外还是进程内**：

- **进程外**（独立 Python/Node server，经官方 23119 或 pyzotero 访问）：天然只能读；要写只能改走 Zotero **云端 Web API**（`api.zotero.org`，需 API key，联网、非本地库）。
- **进程内**（Zotero 插件，代码在 Zotero 特权上下文里跑）：可直接调用 Zotero 内部 DataObject API（`Zotero.Items/Collections/Tags` 的 `saveTx()`/`eraseTx()`，直连 SQLite），**本地库读写全通**。

### 1.3 整体分型

按「代码在哪跑 + 怎么对 AI 客户端暴露」，5 个仓库分四型：

| 型 | 代码位置 | 对外暴露方式 | 本仓库代表 |
|---|---|---|---|
| **A. 纯外部 server** | Zotero 进程外独立进程 | 自身即 MCP server（stdio / HTTP），经官方 API 或 pyzotero 读库 | `54yyyu/zotero-mcp` |
| **B. 插件 + 外部 server 桥接** | 插件在进程内开调试通道，外部 Node server 经桥接协议连入 | 外部 server 对客户端说 MCP，内部经 Firefox RDP 调进程 | `mcp-server-zotero-dev` |
| **C. 插件内嵌 MCP server** | 完全在 Zotero 进程内 | 插件自开端口 / 挂官方 endpoint，直接说 MCP | `cookjohn/zotero-mcp`、`ZotSeek` |
| **D. AI 应用型插件** | 插件内 + 外部闭源 sidecar | 主要面向插件内 UI；MCP 能力挂在外部项目 | `papersgpt-for-zotero` |

型 C 又分两支：**自开独立端口**（cookjohn 走手写 `nsIServerSocket`，端口 23120）vs **挂官方内建 server**（ZotSeek 注册到 `Zotero.Server.Endpoints`，复用 23119）。前者绕开官方拒写策略且不与 Connector 抢端口，后者省掉传输层但受官方 server 约束。

---

## 2. 对比表格

> ✅ 具备可直接用｜⚠️ 部分/有条件｜✗ 缺失或不适用。工具数为读到的实际实现数。

| 维度 | `ZotSeek` | `mcp-server-zotero-dev` | `papersgpt-for-zotero` | `54yyyu/zotero-mcp` | `cookjohn/zotero-mcp` |
|---|---|---|---|---|---|
| **分型** | C（插件内嵌，挂 23119） | B（插件 + 外部 Node，RDP 桥接） | D（AI 应用插件 + 外部 MCP） | A（纯外部 Python server） | C（插件内嵌，自开端口） |
| **实现/传输** | 进程内；MCP Streamable HTTP 挂 `Zotero.Server` 端口 23119 | 外部 Node ↔ 客户端 stdio；↔ Zotero 经 Firefox RDP（TCP 6100） | 插件内 + macOS 闭源 sidecar（embeddings 9080）；MCP 在外部 `docsagent` 项目 | 外部进程；MCP **stdio**；pyzotero → 23119（本地）或 `api.zotero.org`（web） | 进程内；手写 `nsIServerSocket` HTTP，MCP Streamable HTTP，**自开端口 23120** |
| **读能力** | ⚠️ 语义/关键词搜索为主（3 工具） | ⚠️ 面向调试（DB 只读查询、DOM、日志、截图） | ⚠️ 插件内 RAG 读；对外读依赖 `docsagent` | ✅✅ 最全（搜索/全文/注释/元数据/引用图/审计） | ✅ 全面（搜索/全文/注释/集合/语义，18 读工具） |
| **写能力** | ✗ 刻意只读（索引写仅 UI 内部用） | ⚠️ 靠 `execute_js` **任意 eval** 间接写；无文献 CRUD 工具 | ⚠️ 插件内经 BetterNotes 写笔记；无对外写工具 | ⚠️ **仅 web 模式**（需 API key）；本地模式写撞 501 | ✅ 9 个写工具直调 `saveTx/eraseTx`（本地库真写） |
| **认证机制** | Origin 校验 + loopback + opt-in pref | ✗ 无（RDP 无认证扩展点），仅 loopback | LLM API key（用户配）；MCP 认证在外部项目 | 本地无需；web 模式用 Zotero API key（stdio 无网络认证面） | 无（本基座仅 loopback；"None required for local"） |
| **JS eval 通道** | ✗（仅 `/open` 有限启动器） | ✅ `zotero_execute_js` 完整（项目核心） | ⚠️ `window.eval` 跑用户模板片段（无沙箱） | ✗（外部进程进不去 Zotero） | ✗（基座无 `run_javascript`） |
| **工具数量** | 3 MCP 工具（全读）+ 4 REST GET | 28 工具 + 5 prompts（开发/调试类） | **0**（对外 MCP 工具在 `docsagent`） | **62** 个 `@mcp.tool`（约 43 读 + 19 写）+ 资源/prompt | 27（18 读 + 9 写） |
| **语言/技术栈** | TS；Transformers.js（nomic-embed）+ ChromeWorker + ONNX/WASM + SQLite 向量库 | TS/Node 20+；`@modelcontextprotocol/sdk` + Firefox RDP + `node:net` | TS 插件 + 闭源 macOS 二进制；LangChain；多 LLM | Python 3.10+；FastMCP + pyzotero + chromadb + sentence-transformers | TS；zotero-plugin-toolkit + `nsIServerSocket`；可选 SQLite-vec + OpenAI/Ollama |
| **Zotero 版本** | 7.999 – 9.* | 6.999 – 10.* | 6.999 – **7.0.***（开源 manifest；README 称闭源版支持 8/9） | 版本无关（HTTP 客户端；需 7+ 才有本地 API） | 6.999 – 10.99.99 |
| **许可证** | MIT | MIT | **AGPL-3.0-or-later** | MIT | MIT |
| **维护活跃度** | 高（1.16.1 / 2026-06） | 高（1.1.2 / 2026-06） | 文档活跃、开源码滞后（manifest 0.0.16，实际分发闭源 0.5.4） | 高（0.6.0 / 2026-06） | 高（1.5.0 / 2026-06） |

---

## 3. 逐仓库分析

### 3.1 `introfini/ZotSeek` —— 本地语义搜索，只读 MCP

**定位**：100% 本地运行的语义搜索插件，同时把搜索能力以只读 MCP + REST 暴露给 AI 客户端。

**架构要点**：
- 把 MCP endpoint 注册到 Zotero 内建 server（`Zotero.Server.Endpoints`），端口即官方 23119，**不自开端口**——传输层几乎零成本，但也受官方 server 约束。
- MCP 走 Streamable HTTP（JSON-RPC 2.0，POST 无状态，无 SSE/session），由 `zotseek.mcpServer.enabled` pref 控制开关，pref observer 支持热切换。
- 语义栈全本地：Transformers.js 加载 `nomic-embed-text-v1.5`，跑在 ChromeWorker（隔离线程，避免阻塞 UI）+ WASM/ONNX 推理；向量以 `ATTACH DATABASE` 挂到独立 SQLite，与 `Zotero.DB` 解耦。
- 检索用 RRF（Reciprocal Rank Fusion）融合语义 + 关键词两路，支持 hybrid/semantic/keyword 三模式与 passage 粒度。

**优势**：
- 隐私第一——推理、索引、检索全在本机，无云 API、无数据外泄。
- 嵌入模型质量好（nomic-embed-v1.5，8K 上下文、Matryoshka 可截断维度），中长文档语义检索优于旧 512-token 模型。
- MCP 层协议细节（无状态、Origin 校验、loopback）都踩平，是「进程内挂官方 server 的只读 MCP」的干净参考实现。
- 崩溃弹性（checkpoint 续跑）、item tree 索引状态列等工程细节完善。

**局限**：
- **刻意只读**：MCP/REST 无任何写工具，仅 3 个读工具（`search` / `find_similar` / `index_status`）；`/open` 只是「选中条目 / 打开 PDF 到某页」的有限启动器，非通用能力。
- 不自开端口，传输层能力受限于官方 server；无 PSK，仅靠 Origin + loopback + opt-in。
- 嵌入模型偏英文优化；bundle 体积大（模型 ~131MB）；WebGPU 加速受 Firefox 版本限制暂未就绪。

**适合**：想给 AI 一个「本地、隐私、高质量语义检索」入口，且**不需要写库**的场景。

---

### 3.2 `introfini/mcp-server-zotero-dev` —— 插件开发/调试工具链，eval 现成

**定位**：面向 **Zotero 插件开发者** 的调试工具链，让 AI 助手能对运行中的 Zotero 执行 JS、查 DOM、看日志、截图、热重载插件——**不是文献管理工具**。

**架构要点**：
- 二部件：轻量 Zotero 插件（在进程内启动 Firefox DevTools 的 `DevToolsServer`）+ 外部 Node/TS MCP server。
- 桥接协议是 **Firefox RDP**（Remote Debugging Protocol，TCP 6100，帧格式 `<字节长度>:<json>`）：Node server 经 Root → listProcesses → consoleActor → `evaluateJSAsync` 在 Zotero 特权上下文跑代码，结果以 GRIP 编码回传再反序列化。
- 对客户端说标准 MCP（stdio）；对 Zotero 说 RDP。
- 可靠性工程成熟：actor 缓存 TTL 30s、30s 保活、3 次自动重连、长度前缀分包重组、GRIP 递归解码。

**优势**：
- **`zotero_execute_js` 是一条完整、修完坑的任意 JS 执行通道**——这是全领域少见的现成实现，等价于「万能读写兜底」。
- 复用 Firefox 内建 DevTools 设施（actors/eval/DOM/截图/console），随 Firefox/Zotero 升级自动受益，自身维护面小。
- 装插件即用、跨平台一致；28 工具覆盖插件开发全周期（scaffold build/serve/lint、DOM 检查、日志流、插件热重载/安装）。

**局限**：
- **没有任何文献管理工具**：28 个工具全是开发/调试类（截图、DOM、日志、pref、scaffold、插件管理），要读写文献只能自己写 eval 代码。
- **认证结构性无解**：RDP 协议无认证握手扩展点，只能靠 loopback，无法加 PSK/Bearer。
- 依赖 Firefox 内部 RDP 私有 API（`resource://devtools/...`），无稳定性承诺；30s 超时 + FIFO 串行不适合全库遍历长任务；原生模态弹窗会阻塞 eval 线程。

**适合**：开发 Zotero 插件时让 AI 辅助调试；或作为「进程内 eval 通道」的工程参考。**不适合**直接当文献 MCP 用。

---

### 3.3 `papersgpt/papersgpt-for-zotero` —— AI 读论文插件，MCP 能力在外部

**定位**：面向终端用户的「和 PDF 对话」AI 阅读助手插件，支持大量 LLM 供应商；近期 README 宣称支持 MCP，但**对外 MCP 实现不在本仓库**。

**架构要点**：
- 插件本体是标准 Zotero 扩展（TypeScript + zotero-plugin-toolkit），在进程内经 BetterNotes API 读笔记/PDF 选区、向笔记插入 AI 响应；RAG 用 LangChain `Document` + 本地向量缓存 + `compute-cosine-similarity`。
- LLM 覆盖极广：OpenAI / Claude / Gemini / DeepSeek / Qwen / Kimi / Grok 等商业模型 + Llama/Mistral/Gemma/Ollama 等本地模型。
- macOS 上自动下载启动**闭源二进制 sidecar**（`ChatPDFLocal.dmg`）跑本地 LLM/embeddings（监听 9080）；Windows/Linux 依赖第三方 API。
- 有 `window.eval`，但用途是执行用户在「prompt 模板标签」里嵌的 JS 片段，**无沙箱**。

**优势**：
- 面向用户的成品体验好：多 LLM 统一配置、笔记内直接插入回答、AutoPilot 批量跑 prompt。
- LLM 供应商覆盖是 5 个仓库里最广的。
- macOS 上可全本地（sidecar + 本地模型），PDF 不出机。

**局限（作为 MCP 集成方案）**：
- **本仓库对外 MCP 工具数 = 0**：README 里的 MCP 能力指向独立项目 `docsagent`，工具定义/认证/端点都不在此仓库，文档与实现割裂。
- **开源码滞后于分发版**：仓库 manifest 停在 `0.0.16` 且 `strict_max_version` 锁死 `7.0.*`（Zotero 7），而 README 指向的实际分发版是闭源 `0.5.4`；git 提交虽近（2026-06）但多为文档/下载链接更新，**功能源码更像滞后快照**。
- 闭源 macOS sidecar 是黑盒（供应链不可审计、平台碎片化）；`window.eval` 用户模板无沙箱。
- **AGPL-3.0-or-later**——5 个里唯一的强 copyleft，二次开发/分发约束最重。

**适合**：想要开箱即用的「Zotero 内 AI 读论文」终端体验。**不适合**当作可二次开发的 MCP 基座（0 对外工具 + 闭源 sidecar + AGPL）。

---

### 3.4 `54yyyu/zotero-mcp` —— 工具最全的纯外部 Python server

**定位**：纯外部 Python MCP server（FastMCP），经 pyzotero 访问本地或云端 Zotero，工具集最完整，覆盖搜索→读取→注释→写入→发现→审计全链路。

**架构要点**：
- **不是 Zotero 插件**（无 manifest.json/bootstrap.js），是 pip/uv 包，`zotero-mcp serve` 起 **stdio** MCP，任意 MCP 客户端可连。
- 三种连接模式：**local**（`ZOTERO_LOCAL=true`，pyzotero → 23119，读快、离线）/ **web**（`api.zotero.org` + API key，可写）/ **混合**（本地读 + web 写）。
- `tools/` 模块化：search / retrieval / annotations / write / synthesis / scite / connectors / discovery 各自成文件。全局 RLock 串行化所有 Zotero API 调用（保护单线程 23119）。
- 语义搜索：chromadb + 可换嵌入后端（本地 sentence-transformers 免费 / OpenAI / Gemini / Ollama），支持 passage 级分块、OpenAI Batch API 大库异步索引、后台自动同步。

**优势**：
- **工具最全**：读到 62 个 `@mcp.tool`——多格式导入（DOI/ISBN/URL/BibTeX/CSL-JSON）、OA PDF 自动级联补齐（Unpaywall→arXiv→Semantic Scholar→PMC）、OpenAlex 引文图扩展、Scite 引用/撤稿审计、注释合成、文献综述 prompt 等。
- 纯 Python、`uv tool install` 即用、跨平台、不吃 Zotero 版本；读/分析场景开箱即用。
- 写工具 **dry-run 默认**（`confirm=false`），破坏性操作前有校验。

**局限**：
- **本地库写不了**：local 模式经 pyzotero → 23119 撞 501；要写必须切 web 模式（需 Zotero API key、联网、操作的是云端库而非纯本地库）。单机纯离线用户无法改本地库。
- 全局 RLock 是并发瓶颈，大批量遍历（如全库重建索引）会串行排队。
- Scite/OpenAlex 等外部 API 无本地兜底，网络不稳时功能失效（代码有降级提示）。

**适合**：以**读、检索、分析、云端库写**为主的科研工作流，尤其看重工具广度与语义/引用增强。**不适合**要求「本地库可写」且不想用云端 API key 的场景。

---

### 3.5 `cookjohn/zotero-mcp` —— 插件内嵌完整 MCP server

**定位**：单体 Zotero 插件，进程内自开端口跑完整 MCP server，读写直调内部 API——本领域「本地库可写」这条路的产品化实现。

**架构要点**：
- 插件在 Zotero 进程内用**手写 `nsIServerSocket`** 起 HTTP server，默认端口 **23120**、只绑 `127.0.0.1`，直接说 MCP Streamable HTTP；AI 客户端一行 `claude mcp add` 即可接入，无外部常驻进程。
- 9 个写工具直调进程内 `saveTx()`/`eraseTx()`（本地 SQLite 真写），受 `write.enabled` pref 门禁。
- 主要文件：`httpServer.ts`（~1142 行）+ `streamableMCPServer.ts`（~2859 行，单体巨型文件）。
- 手写 HTTP 层专门处理了 CJK/多字节：UTF-8 字节计数、代理对不截断、`Content-Length` 按字节而非字符、Gecko converter stream 缓冲边界。

**优势**：
- **是「本地库可写」的干净路径**：27 工具（18 读 + 9 写）覆盖 search/get/collections/tag/note/metadata/item，写为真写（直连 DataObject API）。
- 零外部进程、接入最简单；loopback + `write.enabled` 默认关的分层防御。
- 手写 HTTP 层的 CJK/流读取坑已付学费，对中日韩标题/标签兼容好。
- MIT、活跃、`strict_max_version` 到 `10.99.99` 覆盖面广。

**局限**：
- 基座**无认证（无 PSK/Bearer，仅 loopback）**、**无 `run_javascript` eval 通道**——长尾操作需自己补工具。
- 零自动化测试；`streamableMCPServer.ts` 近 2900 行单体文件，维护性一般。
- 手写 HTTP 不如成熟 http 库健壮（每连接一请求、请求体上限硬编码），高并发下开销大；pipelining 未完整处理。

**适合**：需要 **AI 直接读写本地 Zotero 库**、且希望零外部进程的场景；也是「进程内可写 MCP」二次开发的理想基座。

> 补充：本仓库（`zotero-agent`）即从此基座 fork 二次开发，在其上补齐了 Bearer PSK 认证与 `run_javascript` eval 工具（详见本仓库 `CHANGELOG.md`）。

---

## 4. 选型建议 / 适用场景

先按「要不要写本地库」和「能不能装插件」两个问题分流，是最快的决策路径：

| 你的需求 | 推荐 | 理由 |
|---|---|---|
| 只读 + 只做本地语义检索，隐私优先 | **ZotSeek** | 全本地嵌入、干净只读 MCP、零外部进程 |
| 工具广度最大化，读/分析为主，可接受云端 API key 做写 | **54yyyu/zotero-mcp** | 62 工具、导入/引文图/审计最全；纯 Python 易装、不吃版本 |
| 要 **AI 直接读写本地库**，零外部进程 | **cookjohn/zotero-mcp** | 进程内直调 `saveTx/eraseTx`，本地库真写；宜作二次开发基座 |
| 开发 Zotero 插件、要 AI 辅助调试 / 需要进程内任意 eval | **mcp-server-zotero-dev** | 完整 RDP eval 通道 + DevTools 工具；非文献 MCP |
| 要面向用户的「Zotero 内 AI 读论文」成品体验 | **papersgpt** | 多 LLM 覆盖最广、笔记内直插；但非可二次开发的 MCP 基座 |

关键权衡提示：

- **写本地库是硬约束**：只有进程内插件（cookjohn 一类）能真写本地库；外部 server（54yyyu）想写就得上云端 Web API（key + 联网 + 操作云端库）。这是选型第一分水岭。
- **工具广度 vs 写能力可以组合**：外部 server（如 54yyyu）工具最全但本地写受限；进程内插件（如 cookjohn）写通但工具偏少——补一个进程内 eval 工具（参考 mcp-server-zotero-dev 的做法），即可用「结构化工具 + 任意 JS 兜底」同时拿到两者。
- **认证要看部署面**：都只绑 loopback 时，本机安全边界够用；一旦经 SSH 隧道/端口转发跨机访问，务必要 PSK/Bearer（基座 cookjohn/ZotSeek/mcp-dev 均无原生 PSK，需自行加装；RDP 型（mcp-dev）协议层加不了）。
- **许可证**：4 个 MIT 可自由二次开发/分发；**papersgpt 为 AGPL-3.0-or-later**，二次开发与分发受强 copyleft 约束，选型前需评估合规成本。
- **版本兼容**：papersgpt 开源 manifest 锁死 Zotero 7（`7.0.*`）需注意；其余对 Zotero 8/9 兼容良好（cookjohn/mcp-dev 上限到 10.*）。
