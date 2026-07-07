# 文献下载 + 元数据建立 全面进 MCP —— 插件比对与集成计划

> 目标：把「给条目补 PDF」与「给条目补/建元数据（DOI、摘要、字段）」两件事全部做进本 MCP 插件，能自己实现的绝不依赖外部插件；只有依赖独有闭源数据源的才装插件、由 MCP 经 `run_javascript` 或专用适配工具调用。
>
> 日期：2026-07-06 ｜ 目标环境：Zotero 9.0.4（目标 Zotero）｜ 现有 MCP：38 工具，v1.6.1

---

## 1. 结论先行

两条技术主线决定了「几乎全部能力都能直接进 MCP，不用装插件」：

1. **元数据补全**几乎全部建立在**免 key 公共 API**（CrossRef / OpenAlex / Semantic Scholar / DBLP / arXiv / Unpaywall）之上。我们已有 `Zotero.HTTP.request` + `Zotero.Translate.Search`（`import_by_identifier` 已验证可用），照抄插件的**级联/合并逻辑**即可，不需要装插件。
2. **PDF 下载**几乎全部建立在 Zotero 官方的 **Custom PDF Resolvers** 机制（`extensions.zotero.findPDFs.resolvers` pref + `Zotero.Attachments.addAvailablePDF`）之上。Sci-Hub 类插件**本身不下载**，只是往这个 pref 注册一条 resolver；真正下载是 Zotero 内置的 "Find Available PDF"——而这个函数我们在 `find_missing_pdfs` 里**已经在调用**。所以下载源（Sci-Hub / Anna's Archive / 自定义镜像）只是「往 pref 写 JSON」的事。

**只有 2 类必须装插件**：依赖闭源浏览器插件数据接口的 **easyScholar**（影响因子/中科院分区，Green Frog 用）、依赖知网 translator 生态与中文 PDF 命名识别的 **Jasminum**。

---

## 2. MCP 现状与缺口

| 能力 | 现有工具 | 状态 |
|---|---|---|
| 按标识符**新建**条目 | `import_by_identifier`（DOI/arXiv/ISBN/PMID，走 translation engine，幂等） | ✅ 已实现 |
| 缺 PDF 审计 + **OA** 下载 | `find_missing_pdfs`（`action=fetch` 调 `addAvailablePDF`） | ✅ 但只走 Zotero 默认 OA resolver（Unpaywall 镜像），**够不到 Sci-Hub 等非 OA 源** |
| 刷新**已有**条目元数据（补空 DOI/摘要/字段） | — | ❌ **缺口**（当年 YAGNI 砍掉） |
| 从标题**反查** DOI | — | ❌ 缺口（import 只认已知标识符） |
| 从 PDF 全文**挖** DOI/arXiv | — | ❌ 缺口 |
| 非 OA 下载源（Sci-Hub/Anna's Archive） | — | ❌ 缺口（未注册 resolver） |

本计划就是填平这 4 个缺口。

---

## 3. 元数据类插件比对

（★ = 建议 clone 源码借鉴；「依赖」列是集成判定的关键——公共 API=可自实现，独有资产=需装插件）

| 插件 | 数据源 | 核心能力 | 补**已有**条目 | Zotero 9 | 依赖性质 | 判定 |
|---|---|---|---|---|---|---|
| ★ **zotero-metadata-hunter** | CrossRef→DBLP→S2→arXiv（DOI 级联）；S2/PubMed/OpenAlex（摘要并行取先） | 补 DOI+摘要+venue/卷期页/ISSN/出版社/日期/语言/URL；预印本→正式版升级（迁移附件/笔记/批注） | ✅ 核心场景 | 需查 release | **纯公共 API** | **直接集成** |
| ★ **zotero-zotadata** | CrossRef/OpenAlex/S2/OpenLibrary/GoogleBooks/DBLP（6 源） | 元数据全量刷新 + DOI/ISBN 反查发现 + PDF 检索(8 源) + 预印本处理 | ✅ | 8.0+（7 需旧版） | **纯公共 API** | **直接集成** |
| ★ **ZotMeta** | DOI/ISBN/arXiv 记录 | 批量刷新；**从 PDF 全文缓存挖 DOI/arXiv**；给孤儿 PDF 建父条目；批量队列+进度 | ✅ | 需查 release | **纯公共 API + Zotero 全文索引** | **直接集成** |
| ★ **zotero-format-metadata**（Linter） | CrossRef/S2/shortdoi/abbreviso | 规范化（标题句式、期刊缩写、语言字段、DOI/页码/卷号格式统一）+ 按标识符更新 | ✅（偏规范化） | 活跃维护 | **纯公共 API** | **直接集成**（规范化逻辑） |
| ★ **zotero-doi-fix**（用户补充） | CrossRef | 检索/更新/校验 DOI，标题+作者+年份匹配 | ✅（仅 DOI） | **7/8/9 明确** | **纯公共 API** | **直接集成** |
| zotero-shortdoi（MiguelDLM fork） | CrossRef+OpenAlex | 补 DOI + 校验清理无效 DOI + full metadata（含摘要） | ✅ | 标注新版 | 纯公共 API | 直接集成（并入上面） |
| zotero-doi-finder | CrossRef | 纯补 DOI（标题相似度匹配，可批量） | ✅（仅 DOI） | 7 | 纯公共 API | 直接集成（并入） |
| ajdavis/metadata-search、kentridge、Creling/Scraper | CrossRef/DBLP/OpenAlex/arXiv/S2 | **交互式**按标题搜→人工选→更新 | ✅ | 混杂 | 纯公共 API | 直接集成（自动匹配替代人工选） |
| ZoteroAutomaticReferenceExtraction | OpenCitations/CrossRef/S2 | 从文章抽引文并导入（+摘要/被引数） | 建新条目 | 需查 | 纯公共 API | 直接集成（与现有 `find_related_papers` 互补） |
| **Green Frog**（updateifsE） | **easyScholar** + DOI/题目 | 影响因子/中科院分区/JCR + 添加时更新元数据 | ✅ | 活跃 | **闭源浏览器插件数据接口** | **装插件** |
| **Jasminum**（茉莉花） | **知网** translator | 中文 PDF 元数据识别、中文姓名拆分、知网抓取 | ✅（中文） | 8/9 | **知网 translator 生态 + 文件名识别** | **装插件**（中文文献多时） |
| AI4Paper | 闭源商业后端 | AI 综述/搜文献/期刊分级/刷新元数据 | ✅ | 7/8/9 | **闭源商业（7 天试用）** | 不集成（商业） |

---

## 4. 下载类插件比对

**关键洞察：下面除 zotadata 外全部基于同一个 Zotero 原生机制**（Custom PDF Resolvers）。它们的差异只在「预置了哪些站点」和「pref 管理 UI」——这些对 MCP 毫无意义，MCP 直接写 pref 即可。

| 插件 | 下载源 | 机制 | 多源/fallback | Zotero 9 | 判定 |
|---|---|---|---|---|---|
| ★ **zotero-scipdf**（syt2，791★，主力） | Sci-Hub（多镜像可配） | **写 native resolver pref** | 多镜像逗号分隔 | 7/8（v8.0.4） | **直接集成**（注册 resolver，无需装） |
| ★ **pdferret**（urschrei） | Sci-Hub + **Anna's Archive** + **自定义 provider**（URL 模板+CSS selector+attribute） | **写 native resolver pref** | ✅ 可加任意源 | 8.x | **直接集成**（其 provider 抽象最值得抄） |
| sanfy008/scihub | Sci-Hub（6 镜像预置） | 写 native resolver pref | ✅ | 7/8 | 直接集成（并入） |
| 0xc1c4da/zotero7-scidb | Sci-Hub / **SciDB** | 写 native resolver pref | 端点可换 | 7 | 直接集成（SciDB 端点补入） |
| ethanwillis/zotero-scihub | Sci-Hub | 旧 XUL（元祖） | ✗ | 停更（6/7 前） | 仅参考 |
| zotero-zotadata（下载侧） | Unpaywall/CORE/arXiv/LibGen/Sci-Hub/IA（8 源） | **自建下载逻辑**（非纯 resolver） | ✅ 失败自动降级、Sci-Hub 兜底 | 8.0+ | **直接集成**（多源降级策略照抄） |

> ⚠️ 合规：Sci-Hub/Anna's Archive/LibGen 属灰色源。计划把它们做成**默认关闭、需显式开启**的 resolver（与 zotadata「Sci-Hub 默认关、仅作最后兜底」一致），OA 源（Unpaywall/arXiv/CORE）默认开。用户自负辖区合规。

---

## 5. 集成策略：三分类

**A 类——直接集成进 MCP（不装插件）**：能力核心是公共 API 或 Zotero 原生机制，我们能自实现。**这是绝大多数**。
- 优势：① 不受插件的 Zotero 版本兼容性约束（我们跑在进程内，API 直调）；② 无 UI，纯工具化，能被 Agent 编排（如「发现相关文献→补库→补元数据→下 PDF」一条链）；③ 一处维护。
- 覆盖：metadata-hunter 全套、zotadata（元数据+下载多源）、ZotMeta（PDF 挖标识符）、format-metadata（规范化）、doi-fix/doi-finder/shortdoi（DOI）、scipdf/pdferret/sanfy008/scidb（下载 resolver）。

**B 类——装插件 + MCP 调用**：依赖独有闭源数据源，自实现成本过高或不可能。
- **Green Frog（easyScholar）**：影响因子/分区数据来自 easyScholar 闭源接口，无公共替代。装插件；MCP 侧经 `run_javascript` 触发其更新逻辑（需查它是否挂全局方法，多数 UI 插件没有 → 可能只能提示用户手动，或退而用 OpenAlex 的 venue 信息近似）。
- **Jasminum（知网）**：中文文献量大时装；知网元数据也可经 `translators_CN` 在进程内跑，边界模糊——**若中文文献少，A 类的 translation engine + 中文 translator 已够，可不装**。

**C 类——仅借鉴/不动**：元祖废弃（ethanwillis）、商业闭源（AI4Paper）、纯 UI 重复（交互式选择类，被 A 类自动匹配取代）。

---

## 6. MCP 落地设计（要新增/扩展的工具）

> 遵循现有约定：写类工具挂 `write.enabled` + dry-run 默认 + 写后回读校验；外呼类 description 注明发送 DOI 到外部；入参 `normalizeStringList` 容错。

### 6.1 元数据侧

- **`enrich_item_metadata`（新，写门禁）** —— 填平最大缺口。对已有条目：有 DOI→CrossRef/OpenAlex 取规范记录**仅补空字段**（venue/卷期页/ISSN/出版社/日期/URL），摘要为空或<200 字符则补/替换（metadata-hunter 阈值）；`mode: fill|replace` 控制作者列表是否替换（zotadata：默认仅补空，替换需显式）。批量 + 逐项 tag 标记失败。**借鉴 metadata-hunter 的字段级合并规则 + 级联数据源**。
- **`find_doi`（新，写门禁或只读+返回候选）** —— 无 DOI 条目：标题+首作者+年份 查 CrossRef，标题相似度阈值（doi-finder 默认 0.85）匹配，回填或返回候选。**借鉴 doi-fix/doi-finder 的匹配策略**。
- **`extract_identifier_from_pdf`（新，可选）** —— 从 Zotero 全文缓存（`Zotero.Fulltext`）正则挖 DOI/arXiv，喂给 `find_doi`/`import_by_identifier`。**借鉴 ZotMeta**。
- 规范化（format-metadata 的标题句式/期刊缩写/DOI 格式统一）：**低优先**，`run_javascript` 兜底即可，高频再固化。

### 6.2 下载侧

- **`manage_pdf_resolvers`（新，写门禁）** —— 读/加/删/开关 `extensions.zotero.findPDFs.resolvers`。预置模板：Sci-Hub（多镜像，`mode:html` selector `embed[type="application/pdf"],#pdf` attr `src`）、Anna's Archive（`a[href*="/slow_download"]`）、SciDB、自定义（URL 模板+selector+attr，**照 pdferret 的 provider 抽象**）。灰色源 `automatic:false` 默认关。
- **扩展 `find_missing_pdfs` 的 fetch** —— 注册非 OA resolver 后，现有 `addAvailablePDF` 调用**自动**覆盖这些源（零改动，机制使然）；仅需在 description 说明「下载源由 `manage_pdf_resolvers` 配置」。
- **可选 `retrieve_pdf`（多源降级，照 zotadata）** —— 若嫌 native resolver 串行慢，可做并行多源+失败降级的显式下载工具；但 native 机制够用时 YAGNI，先不做。

### 6.3 建议实施顺序

1. `manage_pdf_resolvers` + `find_missing_pdfs` 联动（最小改动即打通 Sci-Hub/Anna's Archive 下载）——**先出下载能力**。
2. `enrich_item_metadata`（填最大缺口）+ `find_doi`——**元数据补全主力**。
3. `extract_identifier_from_pdf`——补齐「只有 PDF 没元数据」场景。
4. 每步：真机验证 API 形状 → 单测纯函数（相似度/字段合并/resolver JSON 构造）→ selfTest 加场景 → `deploy-live.mjs` 部署 → 回归。

---

## 7. submodule 命令（你执行，会触网 clone）

建议 `refs/` 下按用途分两个文件夹（英文命名，与现有 `refs/AI-plugins/` 一致，避免 git 中文路径在 msys/Windows 的编码坑）：

- `refs/metadata-enrich/` = **文献元数据建立**
- `refs/pdf-download/` = **文献下载**

在 **`<repo-root>`** 目录下执行（你之前的迁移已把参考库放 `refs/AI-plugins`，这里是新增两组）：

```bash
cd <repo-root>

# --- 文献元数据建立 (A 类，借鉴源码) ---
git submodule add https://github.com/federicotorrielli/zotero-metadata-hunter.git refs/metadata-enrich/zotero-metadata-hunter
git submodule add https://github.com/ydeng11/zotero-zotadata.git                 refs/metadata-enrich/zotero-zotadata
git submodule add https://github.com/RoadToDream/ZotMeta.git                      refs/metadata-enrich/ZotMeta
git submodule add https://github.com/northword/zotero-format-metadata.git         refs/metadata-enrich/zotero-format-metadata
git submodule add https://github.com/pandaAIGC/zotero-doi-fix.git                 refs/metadata-enrich/zotero-doi-fix

# --- 文献下载 (A 类，借鉴 resolver 写法) ---
git submodule add https://github.com/syt2/zotero-scipdf.git                       refs/pdf-download/zotero-scipdf
git submodule add https://github.com/urschrei/pdferret.git                        refs/pdf-download/pdferret
git submodule add https://github.com/sanfy008/scihub.git                          refs/pdf-download/sanfy008-scihub

# 提交（.gitmodules + 8 个 gitlink）
git commit -m "refs: add metadata-enrich + pdf-download reference submodules"
```

可选追加（按需）：
```bash
# 下载多源降级参考（scidb 端点、doi 匹配轻量参考）
git submodule add https://github.com/0xc1c4da/zotero7-scidb.git                   refs/pdf-download/zotero7-scidb
git submodule add https://github.com/dnnunn/zotero-doi-finder.git                 refs/metadata-enrich/zotero-doi-finder
# B 类（若要装/借鉴中文与分区能力）
git submodule add https://github.com/l0o0/jasminum.git                           refs/metadata-enrich/jasminum
git submodule add https://github.com/redleafnew/zotero-updateifsE.git            refs/metadata-enrich/zotero-updateifsE
```

> 执行完告诉我，我读源码后细化第 6 节各工具的真机 API 验证与实现（照 `2026-07-03-adopt-refs-strengths.md` 的 task 粒度展开）。若坚持用中文文件夹名，把上面路径里的 `metadata-enrich`/`pdf-download` 换成中文即可，其余不变。

---

## 8. 不做 / 边界

- ✗ 不为「交互式按标题选择」做 UI —— A 类用相似度阈值自动匹配，选不准就返回候选让 Agent 判断。
- ✗ 不自建 Sci-Hub 镜像发现 —— 直接用 native resolver 多镜像列表；镜像失效由用户在 `manage_pdf_resolvers` 更新。
- ✗ 不集成 AI4Paper（商业闭源）。
- ✗ easyScholar 影响因子/分区：无公共 API 替代，除非装 Green Frog；OpenAlex 的 venue/被引可近似「期刊质量」但给不出中科院分区。中文期刊分级是硬缺口，明确标注需装插件。
- ⚠️ 灰色下载源合规风险由用户承担；默认关闭 + 显式开启。
