# Zotero 元数据增强 / 补全 / 格式化插件技术对比（八项目）

> 目的：横向梳理 Zotero 生态里「补全缺失元数据、修复 / 反查 DOI、规范期刊缩写、更新影响因子、抓取中文文献元数据、清洗字段格式」这一类插件，厘清各自的**能力边界、数据源、触发方式与适用场景**，为选型与组合使用提供依据。
>
> 八个对象（均为 Zotero 插件，非 MCP / 非外部服务）：
> `zotero-metadata-hunter`、`zotero-zotadata`、`ZotMeta`、`zotero-format-metadata`、`zotero-doi-fix`、`zotero-doi-finder`、`jasminum`、`zotero-updateifsE`。
>
> 结论先行：这八个插件**功能重叠面很小、互补性很强**——补全型、DOI 专项、格式清洗型、中文抓取型、期刊指标型各占一隅。没有任何一个能覆盖全部需求，实际使用往往是「按用途叠 2–3 个」。

---

## 1. 概述：元数据增强要解决什么问题

Zotero 条目的元数据质量问题大致分为六类，八个插件正好对应这六个方向（多数插件只专注其中一两个）：

| 问题 | 典型表现 | 主攻插件 |
|---|---|---|
| **字段缺失** | 有标题没作者 / 没期刊 / 没摘要 / 没年份 | metadata-hunter、ZotMeta、zotadata、doi-finder |
| **缺 DOI / DOI 反查** | 条目没有 DOI，需要用标题+作者反查 | doi-finder、doi-fix、metadata-hunter、ZotMeta |
| **DOI 错误 / 失效** | DOI 写错、指向错误文献、需校验修复 | doi-fix（唯一真正「改对」的）、format-metadata（校验+短长转换） |
| **期刊缩写不规范** | 需要 ISO4 / LTWA 标准缩写填 `Journal Abbr` | format-metadata、updateifsE |
| **缺影响因子 / 分区** | 想在条目里标注 IF、JCR 分区、中科院分区 | updateifsE（唯一） |
| **中文文献元数据差** | 知网 / 万方导入的中文文献字段残缺、姓名格式乱 | jasminum（唯一抓中文源）、format-metadata（中文清洗） |
| **格式脏乱** | 标题大小写、页码、日期、作者格式不统一 | format-metadata（唯一系统性 linter） |

### 功能分型（理解全局的关键）

按「核心解决什么」把八个插件分成五型，型内有重叠、型间基本互补：

- **A. 标识符补全型**（identifier / title → metadata）：`metadata-hunter`、`ZotMeta`、`zotadata`、`doi-finder`——共性是「给缺字段的条目查权威源、回填」，差别在数据源广度与附带能力（zotadata 还带 PDF 检索，metadata-hunter 还带预印本升级）。
- **B. DOI 专项型**：`doi-fix`（查 / 改 / 验，Crossref 全生命周期）、`doi-finder`（DOI + 摘要发现）——把 DOI 这一件事做深。
- **C. 格式清洗型**：`zotero-format-metadata`——50+ 条 linter 规则，唯一系统性做「格式规范化」的。
- **D. 中文源抓取型**：`jasminum`（茉莉花）——唯一直连知网 / 万方 / 维普抓中文元数据的。
- **E. 期刊评价指标型**：`zotero-updateifsE`（绿青蛙）——唯一更新影响因子 / 分区 / 期刊缩写的。

---

## 2. 对比表格

### 2.1 核心功能矩阵

✓✓=核心强项｜✓=具备｜〜=部分 / 附带｜✗=无

| 插件 | 元数据补全 | 格式化清洗 | 查重 | DOI 反查 | DOI 修复 | 期刊缩写 | 影响因子 | 中文支持 |
|---|---|---|---|---|---|---|---|---|
| **metadata-hunter** | ✓（+预印本升级） | 〜（仅填空字段） | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **zotadata** | ✓✓（多源+ISBN） | 〜（作者去重等） | ✗¹ | ✓ | ✗ | ✗ | ✗ | 〜（界面中文，源仅英文） |
| **ZotMeta** | ✓（DOI/ISBN/arXiv） | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **format-metadata** | ✓（多源） | ✓✓（50+ 规则） | ✓（导入时检测） | ✓ | ✓（校验+短长转换）² | ✓✓（LTWA+JabRef） | ✗ | ✓✓（拼音/高校/语言） |
| **doi-fix** | ✗（只碰 DOI） | ✗ | ✗ | ✓ | ✓✓（查/改/验）² | ✗ | ✗ | ✗ |
| **doi-finder** | ✓（+摘要） | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | 〜（界面简中） |
| **jasminum** | ✓✓（中文源） | 〜（中文姓名拆合） | ✗ | ✗ | ✗ | ✗ | ✗ | ✓✓（知网/万方/维普） |
| **updateifsE** | ✓（期刊指标字段） | 〜（大小写工具） | ✗ | ✗ | ✗ | ✓（5000+ 内置表） | ✓✓（核心） | ✓（中文 IF/分区） |

> ¹ zotadata 只有「避免重复下载 PDF」和「同条目内作者列表去重」，**没有全库查重工具**。
> ² 「DOI 修复」两种含义要区分：`doi-fix` 是真正的**坏 DOI → 重新反查 → 替换**（并备份旧值）；`format-metadata` 是 DOI **校验 + 短长格式转换**（规范化，非重新反查）。

### 2.2 数据源 / 技术栈 / 许可 / 维护

| 插件 | 主要数据源 | 触发方式 | 语言 / 技术栈 | 许可证 | Zotero 兼容 | 版本 / 活跃度 |
|---|---|---|---|---|---|---|
| **metadata-hunter** | CrossRef、OpenAlex、Semantic Scholar、DBLP、arXiv、PubMed(eutils) | 右键 / 工具栏 / 快捷键 / 全库 | TS + esbuild（自建脚本，**不用** toolkit） | EUPL-1.2 | 6.999–9.* | v0.5.0（早期） |
| **zotadata** | CrossRef、OpenAlex、Semantic Scholar、OpenLibrary、Google Books、DBLP；PDF 源：Unpaywall/arXiv/CORE/Libgen/Sci-Hub/IA | 右键 / 批量 / 进度弹窗 | TS + zotero-plugin-toolkit 5 + scaffold + Vitest | AGPL-3.0 | 8.0–9.* | v1.5.x（活跃） |
| **ZotMeta** | doi.org 内容协商（CSL JSON）、OpenLibrary、arXiv | 右键菜单 | JS（bootstrap 老式）+ Makefile | MIT | 7.0–9.0.* | v2.0（稳定 / 低频） |
| **format-metadata** | Semantic Scholar、arXiv、shortdoi.org、doi.org handle、abbreviso(LTWA)、Zotero Translate（含 CrossRef）；本地 JabRef/高校/语言表 | **导入自动** / 右键 / 快捷键 / 工具栏 | TS + toolkit 5 + scaffold + Vitest/Mocha | AGPL-3.0 | 7.999–10.999 | v3.3.0（活跃） |
| **doi-fix** | 仅 CrossRef（OpenURL + REST） | 右键子菜单 / 批量 | JS（bootstrap 老式）+ PowerShell 构建 | MIT | 7.0–10.* | v1.1.6（活跃，含回归测试） |
| **doi-finder** | CrossRef + Semantic Scholar + PubMed + OpenAlex | 右键 / 工具栏 / 快捷键 / 新增自动 | TS + toolkit 2.x + scaffold | AGPL-3.0 | 7.0–9.0.* | v0.0.2（实验期） |
| **jasminum** | 知网 CNKI、万方、维普（网页抓取，含海外/大陆路由） | 右键（中文 PDF / 快照） | TS + toolkit 5 + scaffold + pdf-lib | AGPL-3.0 | 9.0.3–10.* | v1.1.37（活跃） |
| **updateifsE** | easyScholar API（需密钥）、中科院分区 API（硬编码 IP）、南农大 API；本地缩写表 | 右键 / 快捷键 / 新增自动 / 工具箱批量 | TS + toolkit 4 + scaffold | AGPL-3.0 | 6.999–9.9.999 | v0.21.0（活跃） |

要点速读：
- **数据源阵营**：西文学术源高度趋同（CrossRef / OpenAlex / Semantic Scholar / arXiv 反复出现）；差异化的是——ZotMeta 走 **doi.org 内容协商**（而非直连 CrossRef API）、jasminum 走**中文数据库网页抓取**、updateifsE 走 **easyScholar 期刊评价 API**、zotadata 额外接**一大批 PDF 全文源**。
- **技术栈两代分野**：`ZotMeta`、`doi-fix` 是老式 bootstrap.js（无 TS、无 toolkit、脚本 / Makefile 构建）；其余六个是现代 `zotero-plugin-scaffold + zotero-plugin-toolkit` TS 工程。
- **许可证**：MIT（ZotMeta、doi-fix，商用友好）；AGPL-3.0（zotadata、format-metadata、doi-finder、jasminum、updateifsE，强 copyleft）；EUPL-1.2（metadata-hunter，欧盟公共许可）。
- **Zotero 版本**：最激进的 format-metadata（到 10.999）、doi-fix（到 10.*）、jasminum（到 10.*）已看向 Zotero 10；zotadata 放弃了 7（8.0 起）；jasminum 门槛最高（9.0.3 起）。

---

## 3. 逐仓库分析

### 3.1 zotero-metadata-hunter —— 轻量补全 + 预印本升级

- **定位**：单文件、零 toolkit 依赖的轻量补全器，专攻「补 DOI / 补摘要 / 预印本升级到正式发表版」。
- **核心能力**：缺 DOI 先反查（CrossRef → DBLP → Semantic Scholar → arXiv 级联降级），再回填标题 / 作者 / 出版信息；检测预印本条目（类型 / URL / DOI 前缀 / Extra）并替换为正式版；只填空字段和短摘要（<200 字），不覆盖冲突。
- **数据源**：CrossRef、OpenAlex、Semantic Scholar、DBLP、arXiv、PubMed(eutils) —— 六源，覆盖计算机（DBLP）与生医（PubMed）。
- **优势**：极轻（单 `index.ts`，启动快）；级联降级覆盖率高；标题相似度门限（Levenshtein > 0.85）防误匹配；对预印本工作流针对性强。
- **局限**：格式清洗几乎没有（只回填不重整）；无 PDF、无 ISBN / 书籍、无中文；v0.5.0 尚早期，无 CHANGELOG。

### 3.2 zotero-zotadata —— 全能补全 + PDF 检索平台

- **定位**：八个里**功能最密集**的一个，把「元数据补全 + PDF 检索 + 预印本处理 + 附件校验」打包成一站式工作流平台。
- **核心能力**：多源元数据补全（CrossRef / OpenAlex / Semantic Scholar / OpenLibrary / Google Books / DBLP），带严格作者验证（重叠率 / 计数相似度，防弱匹配）与 ISBN 书籍发现；DOI 反查（多源并行竞速）；预印本升级；**多源 PDF 检索**（Unpaywall → arXiv → CORE → Libgen → Sci-Hub → Internet Archive 逐级降级，Sci-Hub 默认关、可选开）。
- **数据源**：元数据 6 源 + PDF 8 源，是本组「数据源最广」的。
- **优势**：一个插件覆盖补全 + 找文件全链路；作者验证严格（v1.5.x 专门修弱匹配 bug）；现代架构（ESM + toolkit + Vitest，热重载开发）；批量进度弹窗可展开失败原因。
- **局限**：复杂度高（多模块、数千行，排错要跨文件）；只支持 Zotero 8+（放弃 7）；多个源有配额 / 限流（Unpaywall 需邮箱、CORE 有月配额）；集成 Sci-Hub 在部分地区有合规风险；**无全库查重**（易被误认为有）。

### 3.3 ZotMeta —— 简洁的批量标识符补全

- **定位**：老式 bootstrap 风格的批量补全工具，从 DOI / ISBN / arXiv 三类标识符查询并更新条目，能从 PDF 提取标识符、创建父条目。
- **核心能力**：DOI（doi.org 内容协商取 CSL JSON）、ISBN（OpenLibrary）、arXiv 三路补全；高并发批量（可调线程）；失败 / 跳过用标签（`ZotMeta: Failed` 等）标记便于后续处理。
- **数据源**：doi.org（内容协商，由 DOI 注册机构 CrossRef/DataCite 返回 CSL）、OpenLibrary、arXiv —— 注意它**不直连 CrossRef API**，而是走 doi.org。
- **优势**：代码简洁依赖少；三源覆盖学术主流；批量并发强；标签机制清晰。
- **局限**：期刊缩写 / 格式清洗 / 查重 / 中文全无（纯补全）；仅右键单一触发、无导入自动；老式 XUL overlay 与 Zotero 8+ 新架构贴合度一般。

### 3.4 zotero-format-metadata —— 元数据 Linter（格式清洗集大成者）

- **定位**：唯一系统性的「元数据 linter」——50+ 条规则覆盖格式标准化、验证、去重、补全，是**格式清洗 + 期刊缩写 + 中文支持**这三项的最强者。
- **核心能力**：格式规范化（标题大小写、日期、页码、卷号、DOI 短长转换与校验）；**期刊缩写**（本地 JabRef 缩写表 + 在线 abbreviso 按 ISSN LTWA 推断 + 用户自定义表，三路）；导入时重复检测弹窗；多源补全（Semantic Scholar / arXiv / Zotero Translate 含 CrossRef）；**中文支持最全**（拼音转换、高校地址库、语言检测 ISO 639-3）。
- **数据源**：Semantic Scholar、arXiv、shortdoi.org、doi.org handle、abbreviso(LTWA)、Zotero Translate；本地 JabRef / 会议缩写 / 高校 / 语言表。
- **优势**：规则引擎工业级；数据源 + 本地表覆盖最广；中文首选（拼音 / 高校 / 语言）；导入时自动处理，工作流高效；现代 TS + 完整测试。
- **局限**：无影响因子；AGPL 传染性强；依赖库多、体积较大；活跃迭代下大版本间可能有破坏性改动。

### 3.5 zotero-doi-fix —— DOI 全生命周期（查 / 改 / 验）

- **定位**：DOI 三合一——不仅查缺失 DOI，还能**修复错误 DOI 并验证有效性**，是八个里唯一真正「把坏 DOI 改对」的。
- **核心能力**：Retrieve（补缺）、Update（强制重查 + 对比新旧 + 替换，旧 DOI 备份进 Extra）、Validate（在 CrossRef 校验是否有效且与条目匹配）；批量 + 进度反馈；失败分类打标签（无 DOI / 低置信度 / 多候选 / 不匹配）；标题匹配用 Levenshtein + Jaccard + token 级精确率 / 召回率。
- **数据源**：仅 CrossRef（OpenURL 序列化 + REST `api.crossref.org/works`）。
- **优势**：DOI 生命周期完整；防错强（置信度阈值 0.86 + 标签 + 备份）；标题匹配算法先进；与 Zotero OpenURL 深度集成；Zotero 7–10 全兼容，有回归测试。
- **局限**：单一数据源（中文学位论文 / 专利等覆盖不到）；不补摘要 / 其他字段；老式 bootstrap 架构。

### 3.6 zotero-doi-finder —— 轻量 DOI + 摘要发现

- **定位**：偏「发现」而非「修复」的轻量工具，给无 DOI 的条目反查 DOI，同时从多源补摘要。
- **核心能力**：Find DOI（CrossRef，标题 + 作者 + 出版年过滤）、Find Abstract（Semantic Scholar / PubMed / OpenAlex 三源聚合）；库 / 集合 / 选中三级批量；新增条目可自动触发；可配速率限制与相似度阈值；快捷键全库扫描。
- **数据源**：CrossRef + Semantic Scholar + PubMed + OpenAlex。
- **优势**：一次操作补 DOI + 摘要；可配置性强（限速 / 阈值 / 自动开关）；快捷键友好；现代 TS 脚手架。
- **局限**：v0.0.2 实验期、无测试；查询用同步 XMLHttpRequest（大库有阻塞风险）；失败不打标签、易重复消耗配额；无 DOI 修复；暂未支持 Zotero 10。

### 3.7 jasminum（茉莉花）—— 中文数据库元数据抓取

- **定位**：八个里**唯一面向中文文献**的，直连知网 / 万方 / 维普抓取元数据并回填，解决中文 PDF 导入后字段残缺。
- **核心能力**：从文件名 / 快照抓取中文期刊元数据（标题 / 作者 / 出版社 / 摘要等）；中文姓名拆分合并；本地附件按文件名相似度自动匹配条目；PDF 大纲 / 书签编辑。
- **数据源**：知网 CNKI（`kns8s` 高级搜索 + 导出接口，含海外 / 大陆路由）、万方、维普——网页抓取，无需 API 密钥。
- **优势**：中文学术工作流针对性强，一次抓多字段；多源（知网 / 万方 / 维普）降低单源失败；本地附件匹配弥补 Connector 下载失败；集成 PDF 大纲编辑。
- **局限**：仅中文源，国际期刊无能力；依赖网页结构，反爬 / 改版易失效（代码已做 User-Agent 伪装）；可用性受地域网络影响；门槛较高（需 Zotero 9.0.3+）。

### 3.8 zotero-updateifsE（绿青蛙）—— 期刊影响因子 / 分区更新

- **定位**：八个里**唯一更新期刊评价指标**的，把影响因子 / JCR 分区 / 中科院分区 / 各类核心标记写进条目「其他」字段。
- **核心能力**：经 easyScholar 一次拉取 20+ 指标（单年 / 5 年 IF、JCR 分区、中科院分区、SSCI/EI/北大核心/南大核心/CCF 等）；中文期刊复合 / 综合 IF；期刊缩写（5000+ 内置表）；新增条目可自动更新；支持 easyScholar 网页端自定义期刊库同步。
- **数据源**：easyScholar 开放接口（`getPublicationRank`，需注册取密钥）、中科院分区 API（硬编码第三方 IP 端点）、南农大高质量期刊 API；本地缩写与分类表。
- **优势**：一次请求获多指标；多层降级（easyScholar → 中科院 API → 南农大 → 内置表）；支持自定义私有期刊库；写入「其他」字段不污染标准元数据。
- **局限**：easyScholar 需注册 + 密钥，门槛高、失败无离线兜底；缩写库仅 5000+，冷门期刊覆盖不足；中文 IF 依赖硬编码 IP 的第三方服务器，稳定性有风险；自定义库需网页手动维护。

---

## 4. 能力矩阵总结与组合使用建议

### 4.1 谁重叠、谁互补

- **高度互补（几乎零重叠）**：`format-metadata`（清洗 / 缩写）、`updateifsE`（影响因子）、`jasminum`（中文抓取）、`doi-fix`（DOI 修复）——各自把持一个别人都不碰的方向，可以放心叠加。
- **补全型内部有重叠**：`metadata-hunter`、`ZotMeta`、`zotadata`、`doi-finder` 都做「标识符 → 回填」，数据源大量重合（CrossRef / OpenAlex / Semantic Scholar / arXiv）。**同类装一个就够**，按需求挑：
  - 只要轻量补 DOI / 摘要 → `doi-finder` 或 `metadata-hunter`；
  - 要连 PDF 一起找、且能接受 Zotero 8+ 和复杂度 → `zotadata`（最全）；
  - 要简洁批量 + ISBN 书籍、许可证要 MIT → `ZotMeta`。
- **DOI 两个的分工**：`doi-finder` 管「没有 → 查到」，`doi-fix` 管「有但错 → 改对 / 验证」。二者可并存（一个补、一个修），但都只碰 DOI，别指望它们补其他字段。
- **中文 vs 西文**：`jasminum`（抓中文源）与其余七个（西文源为主）正交；中文文献库几乎必配 jasminum + format-metadata（后者做中文姓名 / 拼音 / 语言清洗）。

### 4.2 典型组合方案

| 场景 | 推荐组合 | 分工 |
|---|---|---|
| **西文库 · 轻量** | `doi-finder` 或 `metadata-hunter` + `format-metadata` | 前者补 DOI / 摘要，后者清洗格式 + 期刊缩写 |
| **西文库 · 全能** | `zotadata` + `format-metadata` + `updateifsE` | 补全 + 找 PDF｜格式清洗｜影响因子 |
| **DOI 数据治理** | `doi-fix`（+ `doi-finder`） | 修 / 验已有 DOI｜反查缺失 DOI |
| **中文文献库** | `jasminum` + `format-metadata`（+ `updateifsE`） | 抓知网元数据｜中文姓名 / 拼音清洗｜中文期刊 IF / 分区 |
| **投稿 / 评估导向** | `format-metadata` + `updateifsE` | LTWA 期刊缩写规范化｜IF / 分区标注 |

### 4.3 一句话结论

八个插件里，**`format-metadata` 是覆盖面最广的「清洗 + 缩写 + 中文」中枢**，`zotadata` 是「补全 + 找 PDF」最全的重型选手，二者分别是西文工作流「治理」与「补全」两端的首选；`jasminum`（中文）、`updateifsE`（影响因子）、`doi-fix`（DOI 修复）各自不可替代，按需叠加即可；纯补全型（metadata-hunter / ZotMeta / doi-finder）功能相近，同类留一即可，无须堆叠。
