# Changelog

本项目 fork 自 [cookjohn/zotero-mcp](https://github.com/cookjohn/zotero-mcp)(上游 master **v1.5.0**,commit `bbaf5cf`,2026-06-11),在其基础上二次开发,与上游独立演进。本文件记录 fork 之后的全部版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循语义化版本。

## [Unreleased]

### 新增
- eval 边界单元测试:timeout clamp、UTF-16 surrogate 截断、循环引用返回值;文档化长任务断连语义
- 文献库导入 + 去重 + 中文重打标的执行计划与完成记录(`docs/superpowers/plans/2026-07-06-library-import-retag-plan.md`)

### 变更
- `refs/metadata-enrich/` 下 8 个参考子模块删除重建(锁定 commit 不变);`zotero-format-metadata` 配 `ignore = dirty` 静音 Windows CRLF 假脏

## [1.8.2] - 2026-07-06

### 新增
- **Sci-Hub 下载代理**:PAC data-url 方式仅对灰色源域名走代理(默认端口 7890),正常流量直连;偏好面板提供开关 + host/port 输入,应用到 `network.proxy` 系列 pref(`scihubProxy.ts`,纯函数 + 面板接线)
- 代理面板 locale 字符串(en/zh 及 de/es/fr/ja)

### 文档
- README 记录灰色源(Sci-Hub / Anna's Archive)PDF 下载功能
- 中文 README 重写并与英文版交叉链接;旧版双语 README 标记 deprecated 保留存档

## [1.8.1] - 2026-07-06

### 修复
- selfTest 的 scihub-warn 场景改用 `limit: 0`,避免真实下载触发 NetworkError 误报

### 国际化
- Sci-Hub 面板字符串补齐 de/es/fr/ja 四语言

## [1.8.0] - 2026-07-06

### 新增
- **Sci-Hub 灰色源下载**(设计文档 `docs/superpowers/specs/2026-07-06-scihub-download-design.md`):
  - 偏好面板:Sci-Hub 启用开关 + 镜像源列表管理(添加/删除/重置,内置 11 个默认镜像),配置与 Zotero 原生 resolver pref 双向同步(`scihubSources.ts`)
  - 三个入口:偏好面板、MCP 工具、原生右键(右键复用 Zotero 内建 "Find Available PDF",把选择权留给用户)
  - PDF 链接 selector 放宽,兼容各镜像站 DOM 差异

### 重构
- SCIHUB/ANNAS selector 收敛为单一来源;清理无引用的 ftl key

## [1.7.1] - 2026-07-06

### 修复
- `buildResolver` 忽略显式 `undefined` key——此前面板"添加预置 resolver"会被 undefined 覆盖破坏

## [1.7.0] - 2026-07-06

PDF 下载 + 元数据补全,工具 38 → **42**。参考实现取自 `refs/metadata-enrich/`、`refs/pdf-download/` 下 12 个调研仓库(计划见 `docs/superpowers/plans/2026-07-06-impl-download-metadata-tools.md`)。

### 新增
- `manage_pdf_resolvers`:把 Sci-Hub / Anna's Archive 等注册进 Zotero 原生 `findPDFs.resolvers` pref(`pdfResolvers.ts` 纯函数:merge/build/parse)
- `extract_identifier_from_pdf`:从全文缓存挖标识符——DOI 频率投票 + arXiv ID 提取(`pdfIdentifier.ts`)
- `find_doi`:CrossRef 按标题反查 DOI,标题相似度融合评分(含变音符折叠,借鉴 zotero-doi-fix),dry-run 默认(`titleSimilarity.ts`)
- `enrich_item_metadata`:从 doi.org CSL-JSON + OpenAlex 补齐缺失字段,字段级合并规则借鉴 zotero-metadata-hunter,dry-run 默认(`metadataMerge.ts`)

### 修复
- 基础字段按 item type 正确落位(会议论文的 venue → proceedingsTitle);日期补零格式化
- subtitle 拆分启发式收紧到 ≥3 tokens;移除不可达的 find_doi 备用分支
- selfTest 定向清理测试产物;`set_automatic` 对不存在的 resolver 如实报 not-found;`find_missing_pdfs` 提示指向 resolvers

## [1.6.1] - 2026-07-03

### 修复
- **中文请求体 mojibake**:HTTP 读取层改为原始字节收集 + 单次解码,密集 CJK body 不再触发 -32700 解析错误(`httpByteReader.ts`)
- selfTest 改用特权 XHR 发送 Origin 头(fetch 会静默丢弃 forbidden header,导致 Origin 校验场景空转)
- 协议版本字符串全局统一

### 新增
- `scripts/deploy-live.mjs` 一键部署:xpi base64 经 `run_javascript` 写入Zotero 端 /tmp,再 `install_plugin_from_url` 自升级,~5s 断连后即新版
- PSK/eval 偏好页字符串补齐 de/es/fr/ja

### 文档 / 仓库
- README 全面更新并新增英文版
- 参考子模块重组:原 5 个调研仓库移入 `refs/AI-plugins/`;新增 `refs/metadata-enrich/`(8 个)+ `refs/pdf-download/`(4 个)只读参考子模块

## [1.6.0] - 2026-07-03

Fork 后首个版本。核心改造:PSK 认证 + `run_javascript`;随后按四参考仓库(papersgpt / mcp-server-zotero-dev / ZotSeek / 54yyyu)优势汲取计划落地 11 个新工具与协议修正,工具 27 → **38**。

### 新增 — 认证与 eval
- **PSK Bearer 认证**(`authGuard.ts`):`POST /mcp` 校验 `Authorization: Bearer <PSK>`;PSK 首次启动自动生成存 pref,偏好页可复制/重生成;`auth.enabled` 默认**开**
- **`run_javascript` 工具**(`evalTool.ts`):AsyncFunction 在 Zotero 特权上下文执行任意 JS,注入 `Zotero/ZoteroPane/ztoolkit/console`,结构化返回 `{result, logs, error}`;独立 pref `eval.enabled` 默认**关**;`timeout_ms`(默认 60s,诚实报告超时后仍在运行)+ 100KB 结果限幅

### 新增 — 工具(11 个)
- `import_by_identifier`:DOI/arXiv/ISBN/PMID 导入,`if_exists` 幂等(大小写不敏感 DOI 去重含 Extra 字段、adsBibcode 去重、导入后回读校验)
- `find_missing_pdfs`:全库/集合缺 PDF 审计 + Unpaywall OA 自动补齐
- `check_retractions`:scite.ai 撤稿检查(免密钥;网络不可达时如实报 unreachable)
- `find_related_papers`:OpenAlex 引文图扩展,标注 `inLibrary`;fetch 默认降到 5 防客户端超时
- `synthesize_annotations`:按论文分组的注释综述包;scope 解析逻辑统一(DRY)
- `find_duplicates` / `merge_duplicates`:复用 Zotero 原生查重引擎,dry-run 默认,合并残留进回收站;披露结果截断
- `batch_update_tags`:批量加/删/rename(rename 走 `Zotero.Tags.rename` 保留条目关联),dry-run 预览影响面
- `reload_plugin` / `install_plugin_from_url`:部署循环,受 eval 门禁;`self_upgrade` 显式标志,内联安装回报结果

### 新增 — 搜索
- 搜索 0 结果降级级联(fallback ladder),响应带 `fallback` 标注(54yyyu 模式)
- semantic search hybrid 模式:RRF 融合 + query 自适应权重(ZotSeek 模式);关键词腿降级带标注,date 字段保留年份兜底

### 新增 — 测试
- 进程内 selfTest harness(`selfTest.ts`,20 场景全栈回归,经 `run_javascript` 驱动);isError 场景用真实抛错调用、日志捕获检测、部分结果披露
- 纯函数单元测试(`test/*.test.cjs`,node 直跑无框架)+ 真机验证清单 `test/live-verification.md`

### 修复 — 协议与安全
- 工具执行错误返回 `result.isError` 而非 JSON-RPC `-32603`(对齐 MCP 规范)
- `POST /mcp` 校验 Origin 头(DNS 重绑定防御,非法 Origin 返回 403;含 opaque origin / IP 后缀 / path 后缀边界测试)
- 协议版本改为协商制,不再硬编码 `2024-11-05`
- 声明 `listChanged: false`(POST-only 传输本就无法推送 list_changed)
- `write.enabled` 关闭时,`tools/list` 隐藏 collection 写工具(不再"列出但调不动")

---

**上游基线**:cookjohn/zotero-mcp v1.5.0(27 个工具,MCP server 内嵌 Zotero 插件,nsIServerSocket 手写 HTTP,端口 23120)。上游存档见 `refs/AI-plugins/zotero-mcp-cookjohn` 子模块。
