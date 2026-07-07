# Zotero Agent

> [English](./README.md) | **中文**

**Zotero Agent** 是一个内嵌 MCP (Model Context Protocol) 服务器的 Zotero 插件，把你本地的 Zotero 库变成 AI 智能体可以**全面操作**（而不只是读取）的工作区。

它提供 **42 个工具**，覆盖文献检索、元数据补全、按标识符导入（DOI / arXiv / ISBN / PMID）、灰色源 PDF 下载（Sci-Hub / Anna's Archive）、查重与合并、批量打标签、引文图扩展、注释综述——外加一个兜底的 `run_javascript`，可在 Zotero 进程内执行内置工具之外的任意自动化。

实际使用时，对接本服务器的 AI 助手（Claude、Codex 等）可以用自然语言检索你的文献库、批量清理元数据与标签、导入并去重论文、补齐缺失的 PDF、沿引文图扩展某个主题、综述你的注释——每个写操作默认 dry-run，安全可控。

## 使用方法

### 第一步：安装 Zotero 插件

1. 从 [Releases 页面](https://github.com/psiQAQ/zotero-agent/releases/) 下载最新的 `zotero-agent.xpi`
2. 在 Zotero 中通过 `工具 -> [齿轮图标] -> 从文件安装插件...` 安装
3. 打开 `编辑 -> 设置 -> Zotero Agent`，启用以下权限：
   1. 允许远程访问 (Allow Remote Access)
   2. 启用写操作 (Enable Write Operations)
   3. 运行 JavaScript (Run JavaScript / eval)

> 注意：`运行 JavaScript (eval)` 用于在 Zotero 内部执行 JavaScript，以处理内置 MCP 工具之外的任务。仅在需要时启用。

### 第二步：配置你的 AI 客户端

从 `Zotero -> 编辑 -> 设置 -> Zotero Agent -> PSK` 获取你的 token。

#### Codex App

进入 `设置 -> MCP Servers -> Add server`，使用如下配置：

| 字段 | 值 |
| --- | --- |
| MCP server name | `zotero-mcp` |
| Transport | `Streamable HTTP` |
| URL | `http://127.0.0.1:23120/mcp` |
| Header Key: `Authorization` | `Bearer <YOUR_PSK>` |
| Header Key: `Content-Type` | `application/json` |

#### Codex CLI

编辑 `%USERPROFILE%/.codex/config.toml` 或 `~/.codex/config.toml`：

```toml
[mcp_servers.zotero-mcp]
enabled = true
url = "http://127.0.0.1:23120/mcp"
http_headers = { Authorization = "Bearer <YOUR_PSK>", "Content-Type" = "application/json" }
```

#### Claude Code

```powershell
$env:ZOTERO_MCP_BEARER_TOKEN = "YOUR TOKEN"

claude mcp add --transport http zotero-mcp http://127.0.0.1:23120/mcp `
  --scope user `
  --header "Authorization: Bearer $env:ZOTERO_MCP_BEARER_TOKEN" `
  --header "Content-Type: application/json"
```

> 注意：如果你在本项目内安装并从本项目目录运行，则不要使用 `--scope user`。

### 第三步（可选）：推荐安装的联动插件

这些插件与 Zotero Agent **并行**运行 —— 它们不并入本插件，但安装后，AI agent 可经 `run_javascript` 工具驱动它们（Zotero 特权上下文能触及任何已装插件的 API）。按你的工作流按需安装：

| 插件 | 作用 | 与本插件 / agent 的配合方式 |
| --- | --- | --- |
| [jasminum 茉莉花](https://github.com/l0o0/jasminum) | 为字段残缺的中文文献抓取中文数据库元数据（知网 / 万方 / 维普）。 | 本插件内置的元数据补全面向西文源（CrossRef / OpenAlex），jasminum 补上中文这块。导入中文 PDF 后，agent 可经 `run_javascript` 触发它的抓取 / 文件名匹配。 |
| [zotero-updateifsE 绿青蛙](https://github.com/redleafnew/zotero-updateifsE) | 把影响因子、JCR / 中科院分区等期刊指标写入条目。 | 在 `import_by_identifier` / `enrich_item_metadata` 补齐核心元数据后，agent 可经 `run_javascript` 按分类批量更新指标。 |
| [zotero-format-metadata](https://github.com/northword/zotero-format-metadata) | 50+ 元数据 linter：标题大小写、日期、页码、LTWA 期刊缩写、中文姓名 / 拼音清洗。 | 与 `enrich_item_metadata`（补字段）互补做格式规范化 —— agent 可在补全后调它的 lint 规则做清洗收尾。 |
| [zotero-zotadata](https://github.com/ydeng11/zotero-zotadata) | 多源元数据补全 + 多提供方 PDF 检索（Unpaywall / arXiv / CORE / …）。 | 需要更广 PDF 源时，作为 `find_missing_pdfs` 的重型替代；agent 可经 `run_javascript` 调它的检索流水线。 |

**让 agent 帮你安装。** 开启 `run_javascript`（eval）后，粘贴类似这样的提示词 —— 按需删减列表：

> 请用 `run_javascript` 安装这些 Zotero 联动插件。对每个仓库：`fetch` `https://api.github.com/repos/<repo>/releases/latest`，取名字以 `.xpi` 结尾的资源，用 `AddonManager.getInstallForURL(url)` 再 `install.install()` 安装，然后报告各插件的 id / 版本 / 是否激活。不需要的我会删掉：
> - jasminum（中文元数据：知网 / 万方 / 维普）—— `l0o0/jasminum`
> - Green Frog / updateifsE（影响因子与分区）—— `redleafnew/zotero-updateifsE`
> - Linter / format-metadata（格式清洗与期刊缩写）—— `northword/zotero-format-metadata`
> - Zotadata（多源补全 + PDF 检索）—— `ydeng11/zotero-zotadata`

部分插件可能需要重启 Zotero 才完全激活。另：其中多数也能在社区 [Zotero 插件市场](https://github.com/syt2/zotero-addons) 插件里搜到（如 `format-metadata` 在其中名为 **“Linter for Zotero”**）；少数（如 `zotadata`）仅 GitHub release 提供。

> 各插件当前如何调用、以及计划提升为专用 MCP 工具的方向，见下方 **站在开源之上 —— 集成情况与路线图** 章节。

## 灰色源 PDF 下载 (Sci-Hub / Anna's Archive)

在 Zotero 内置的开放获取 (open-access) 解析器之外，插件还可以把 Sci-Hub / Anna's Archive 作为兜底的 PDF 下载源。

**在偏好面板启用。** 在 `编辑 -> 设置 -> Zotero Agent` 中打开 Sci-Hub / Anna's Archive 开关。开启后会出现一个源列表，已预填合理的默认值（多个 Sci-Hub 镜像 + Anna's Archive）；你可以增删源，或恢复默认。这些源注册为**仅手动触发**的解析器——只在你显式触发下载时才使用，绝不在后台自动访问。所有功能默认关闭。

**下载。** 启用后，Zotero 自带的右键 **查找可用 PDF (Find Available PDF)** 会自动包含这些源：Zotero 先尝试免费源（arXiv / 开放获取），只有在需要时才回落到灰色源。你也可以通过 MCP 工具 `manage_pdf_resolvers`（启用/禁用、管理源列表）和 `find_missing_pdfs`（审计缺 PDF 的条目并下载）来驱动。

**合规。** Sci-Hub / Anna's Archive 属于灰色地带来源。你所在辖区的合规性由你自行负责。

## 开发设置

克隆仓库：

```bash
git clone https://github.com/psiQAQ/zotero-agent.git
cd zotero-agent
```

搭建插件开发环境：

```bash
npm install
npm run build
```

在 Zotero 中加载插件：

```bash
# 开发模式（自动重载）
npm run start

# 或手动安装构建好的 .xpi 文件
# xpi 文件会生成在 "./.scaffold/build/zotero-agent.xpi"
npm run build
```

## MCP 工具

下表基于 `src/modules/streamableMCPServer.ts` 中实际的工具定义。

| 工具名 | 用途 |
| --- | --- |
| `get_libraries` | 列出当前客户端可用的 Zotero 库。 |
| `search_library` | 用标题、年份、全文、条目类型、相关度评分等过滤条件搜索 Zotero 库。 |
| `search_libraries` | 按库名搜索库。 |
| `search_annotations` | 按查询词、颜色、标签或条目范围搜索高亮、笔记和评论。 |
| `get_item_details` | 获取指定 Zotero 条目的详细元数据。 |
| `get_annotations` | 获取指定条目或注释 ID 的注释和笔记。 |
| `get_content` | 读取 PDF、附件、笔记和摘要的全文内容。 |
| `get_collections` | 列出库中的分类，需要时可递归输出整棵树。 |
| `search_collections` | 按名称搜索分类。 |
| `get_collection_details` | 获取指定分类的详细信息。 |
| `get_collection_items` | 列出指定分类下的条目。 |
| `get_subcollections` | 获取指定分类下的子分类。 |
| `create_collection` | 创建新分类，可选择置于某父分类下。 |
| `update_collection` | 重命名或移动已有分类。 |
| `delete_collection` | 删除分类，可选连带删除条目。 |
| `add_items_to_collection` | 把一个或多个条目加入分类。 |
| `remove_items_from_collection` | 把一个或多个条目移出分类（不从库中删除）。 |
| `search_fulltext` | 在缓存的全文文档内容中搜索并返回匹配段落。 |
| `get_item_abstract` | 获取指定条目的摘要。 |
| `semantic_search` | 基于向量嵌入的语义搜索，找出概念上相关的内容。 |
| `find_similar` | 查找与给定条目语义相似的条目。 |
| `semantic_status` | 显示语义搜索服务的状态与索引统计。 |
| `fulltext_database` | 访问缓存全文数据库，支持 list、search、get、stats 等操作。 |
| `write_note` | 创建、更新或追加 Zotero 笔记。 |
| `write_tag` | 为 Zotero 条目添加、删除或替换标签。 |
| `write_metadata` | 更新条目元数据，如标题、摘要、DOI、日期或作者。 |
| `write_item` | 创建条目、重挂附件，或把本地文件作为附件导入。 |
| `run_javascript` | 在 Zotero 进程内执行 JavaScript，用于高级自动化。 |
| `reload_plugin` | 为开发流程重载已安装的 Zotero 插件。 |
| `install_plugin_from_url` | 从可达的 URL 或文件路径安装/升级插件 XPI。 |
| `import_by_identifier` | 通过 DOI、arXiv ID、ISBN 或 PMID 导入条目。 |
| `find_missing_pdfs` | 报告缺少 PDF 的条目，或为它们获取开放获取 PDF。 |
| `manage_pdf_resolvers` | 把 Sci-Hub / Anna's Archive 注册进 Zotero 原生 PDF 解析器（灰色源默认 automatic=false，仅手动）；实际下载经 find_missing_pdfs。 |
| `extract_identifier_from_pdf` | 用频率投票从 PDF 全文缓存中挖取 DOI 或 arXiv ID。只读。 |
| `find_doi` | 经 CrossRef 标题相似度（≥0.86 阈值）反查 DOI；默认 dry-run，confirm 写入需开启 write.enabled。 |
| `enrich_item_metadata` | 用 doi.org CSL-JSON + OpenAlex 从 DOI 补全缺失字段（摘要/刊名/卷/期/页/ISSN/出版社/日期）；默认 dry-run，confirm 写入需开启 write.enabled。 |
| `check_retractions` | 对照 scite.ai 的编辑通告（撤稿、更正等）检查条目。 |
| `find_related_papers` | 经 OpenAlex 遍历引文图，查找引用/被引论文。 |
| `synthesize_annotations` | 把高亮和笔记聚合为面向文献综述的 markdown 汇总包。 |
| `find_duplicates` | 用 Zotero 原生查重引擎检测重复条目。 |
| `merge_duplicates` | 把重复条目合并到选定的主条目。 |
| `batch_update_tags` | 批量标签操作，如添加、删除或重命名。 |

## 站在开源之上 —— 集成情况与路线图

本插件建立在多个开源项目之上：它 fork 了一个可写的进程内 MCP 基座，并吸收了约 17 个参考项目的优点（以只读子模块存于 `refs/`）。完整技术对比见：

- [AI / MCP 集成方案对比](./docs/benchmarking/ai-plugins-mcp.md) —— 5 个项目
- [元数据增强插件对比](./docs/benchmarking/metadata-enrichment.md) —— 8 个项目
- [PDF 下载方案对比](./docs/benchmarking/pdf-download.md) —— 4 个项目

### 1. 相对基座的改进与新增

fork 自 [cookjohn/zotero-mcp](https://github.com/cookjohn/zotero-mcp) —— 一个干净的、进程内、本地可写的 MCP server（27 工具，直调 `saveTx`/`eraseTx`）。本仓库在其上新增：

| 方面 | cookjohn 基座 | 本 fork 新增 |
| --- | --- | --- |
| 认证 | 仅 loopback | **PSK Bearer** 认证 + `Origin` 校验（DNS 重绑定防御） |
| Eval | 无 | **`run_javascript`** 特权 eval 工具（超时 + 100 KB 限幅） |
| 工具 | 27 | **42** —— 新增 15 个（标识符导入、缺 PDF 审计、引文图、查重、批量标签、元数据补全、DOI 反查、灰色源下载 等） |
| 搜索 | 关键词 | + RRF **混合**语义搜索、0 结果**降级级联** |
| 测试 | 无 | 26 场景进程内 **selfTest** + node 单测 |
| 部署 | 手动 | 一键 **`deploy-live`**（base64 传输 + 自升级）+ `reload_plugin` / `install_plugin_from_url` |
| 多语言 | zh / en | + de / es / fr / ja |
| 中日韩 | — | 字节级 HTTP 读取修复（密集 CJK 不再乱码） |

### 2. 已从参考项目吸收的能力（已集成）

以下能力被**重新实现**（而非直接搬运）为原生工具：

**AI / MCP** —— 见[对比文档](./docs/benchmarking/ai-plugins-mcp.md)

| 来源 | 吸收为 | 状态 | TODO |
| --- | --- | --- | --- |
| [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp) | `import_by_identifier`、`find_missing_pdfs`、`find_related_papers`（OpenAlex）、`check_retractions`（scite）、`synthesize_annotations` | ✅ | 移植其 62 工具中更多能力（BibTeX / CSL 导入、批量 OA 索引） |
| [introfini/ZotSeek](https://github.com/introfini/ZotSeek) | RRF 混合 `semantic_search` | ✅ | WebGPU 加速；Matryoshka 维度截断 |
| [introfini/mcp-server-zotero-dev](https://github.com/introfini/mcp-server-zotero-dev) | `run_javascript`、`reload_plugin`、`install_plugin_from_url` | ✅ | 截图 / DOM 检查工具用于 UI 调试 |

**元数据** —— 见[对比文档](./docs/benchmarking/metadata-enrichment.md)

| 来源 | 吸收为 | 状态 | TODO |
| --- | --- | --- | --- |
| [zotero-metadata-hunter](https://github.com/federicotorrielli/zotero-metadata-hunter) | `enrich_item_metadata`（从 DOI CSL-JSON + OpenAlex 补字段） | ✅ | 预印本 → 正式发表版升级 |
| [zotero-doi-fix](https://github.com/pandaAIGC/zotero-doi-fix) | `find_doi`（标题相似度融合）、`extract_identifier_from_pdf` | ✅ | DOI **修复**（坏 → 重验 → 替换并备份），不止反查 |

**PDF** —— 见[对比文档](./docs/benchmarking/pdf-download.md)

| 来源 | 吸收为 | 状态 | TODO |
| --- | --- | --- | --- |
| [pdferret](https://github.com/urschrei/pdferret)、[zotero-scipdf](https://github.com/syt2/zotero-scipdf) | `manage_pdf_resolvers`（读写原生 `findPDFs.resolvers`）+ 灰色源下载 | ✅ | 多镜像轮询；更强 DOI 提取（scipdf 的 5 正则 + 附件刮取） |

### 3. 不集成、但可经 `run_javascript` 调用（互动边界与路线图）

这些插件不并入本插件，但用户**安装它们**后，AI agent 可经 **`run_javascript`** 驱动它们 —— 该工具在 Zotero 特权上下文运行，能触及任何已装插件暴露的 API。当前边界与未来的专用工具方向：

| 插件 | 能力 | 当前 agent 边界（经 `run_javascript`） | TODO（专用工具） |
| --- | --- | --- | --- |
| [jasminum 茉莉花](https://github.com/l0o0/jasminum) | 中文元数据抓取（知网 / 万方 / 维普） | 若 `Zotero.Jasminum` 命名空间暴露，可调其抓取 / 文件名匹配函数 | 封装 `fetch_chinese_metadata(itemKey)` —— 一次调用完成抓取 + 回填知网字段 |
| [zotero-updateifsE 绿青蛙](https://github.com/redleafnew/zotero-updateifsE) | 影响因子 / JCR 与中科院分区 | 逐条目调其 easyScholar 更新路径 | `update_journal_metrics(scope)` 工具 |
| [zotero-format-metadata](https://github.com/northword/zotero-format-metadata) | 50+ 格式 linter、LTWA 期刊缩写 | 程序化触发其 lint 规则 | `lint_metadata(scope, rules)` 工具 |
| [zotero-zotadata](https://github.com/ydeng11/zotero-zotadata) | 多源补全 + 多提供方 PDF 检索 | 调其检索流水线 | `deep_enrich(itemKey)` 组合补全 + 找 PDF |

> `run_javascript` 是万能兜底通道：任何在 `Zotero` 对象（或全局）上暴露函数的已装插件，agent **今天**就能驱动。TODO 列是把最常用的互动提升为带类型、默认 dry-run 的 MCP 工具。
