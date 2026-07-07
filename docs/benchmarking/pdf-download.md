# Zotero PDF 全文获取方案对比（四项目）

> 目的：为「给缺全文的条目自动补 PDF」做技术选型。核心结论——**关键分野是"走 Zotero 原生 resolver"还是"自建下载器"**：注册型方案把 URL 模板 + CSS selector 写进 `extensions.zotero.findPDFs.resolvers`，抓取交给 Zotero 内置的 "Find Available PDF"（省心、自动继承原生 OA 通道、随 Zotero 升级免维护）；自建型方案自己发 `Zotero.HTTP.request` + 解析 HTML + `importFromURL`（可控、能做多源级联，但要自己追镜像站的域名/页面变动）。
>
> 四个对象都是 Zotero 插件，同源自 `ethanwillis/zotero-scihub`（经典 XUL 时代的 Sci-Hub 插件），在 Zotero 7 的 bootstrap 插件体系下各自重写、分化。它们存于 `refs/pdf-download/`（只读存档）。

---

## 1. 概述

### 1.1 要解决的问题

一条带 DOI（或 arXiv / URL）的文献条目常缺 PDF 全文。自动补全需要回答两件事：**去哪儿找**（下载源）与**怎么抓**（下载机制）。

**下载源分三类：**

- **开放获取（OA）** —— Unpaywall、Semantic Scholar 的 `openAccessPdf`、arXiv、出版商 OA 页。合法免费，但覆盖不全（付费墙论文拿不到）。
- **灰色源** —— Sci-Hub、Anna's Archive（其 SciDB 频道）、LibGen。覆盖极广，但处于版权灰色地带，且镜像域名频繁更替、常有验证码 / DDoS 防护。
- **镜像站** —— 同一灰色源的多个域名（如 `sci-hub.se / .st / .ru / .ee …`），用作冗余以对抗单点封锁。

### 1.2 关键背景：Zotero 原生 "Find Available PDF"

Zotero 7+ 内置 "Find Available PDF" 功能：先按 DOI → 出版商页 → OA（含 Unpaywall）尝试，**再**读用户在偏好 `extensions.zotero.findPDFs.resolvers` 里配置的自定义 resolver（[官方文档：Custom PDF Resolvers](https://www.zotero.org/support/kb/custom_pdf_resolvers)）。一条 resolver 就是一个 JSON：`{name, method, url（含 {doi} 占位）, mode: html|json, selector, attribute, automatic}`。

这带来一个重要事实：**只要把灰色源注册成 resolver，就能白嫖 Zotero 的原生 OA 通道**——原生流程会先试 OA，实在没有才落到你注册的 Sci-Hub 上；同时抓取、重定向、附件落库全由 Zotero 负责，插件几乎不用维护抓取逻辑。

### 1.3 方案分型（两个轴）

- **轴一 · 集成形态**：本组四个**全是 Zotero 插件**（无独立 CLI / 库）。区别只在插件内部机制。
- **轴二 · 下载机制**：
  - **① 原生 resolver 注册型** —— 只往 `findPDFs.resolvers` 写配置，抓取全交给 Zotero。代表：**pdferret**。
  - **② 自建下载器型** —— 自己 `Zotero.HTTP.request` 抓页、`querySelector` 解析、`importFromURL/importFromFile` 落库，不碰原生 resolver。代表：**zotero7-scidb**。
  - **③ 混合型** —— 既注册原生 resolver（供 "Find Available PDF" 用），又保留一套自建下载器（供右键菜单手动抓 / 多源级联）。代表：**sanfy008-scihub**、**zotero-scipdf**。

| 机制 | 抓取由谁负责 | 自动接入原生 OA | 维护成本 | 本组代表 |
|---|---|---|---|---|
| ① 原生 resolver 注册 | Zotero | 是（免费继承） | 低 | pdferret |
| ② 自建下载器 | 插件自己 | 否（需自己实现 OA） | 高（追镜像变动） | zotero7-scidb |
| ③ 混合 | 两者都有 | 是（resolver 部分） | 中 | sanfy008、scipdf |

---

## 2. 对比表格

| 维度 | **pdferret** | **sanfy008-scihub** | **zotero-scipdf** | **zotero7-scidb** |
|---|---|---|---|---|
| 定位 | 多源 DOI 下载器（可配 provider） | Sci-Hub + OA 多路兜底 | Sci-Hub 全文下载（成熟） | Sci-Hub/SciDB 下载（PoC） |
| 主要下载源 | Sci-Hub、Anna's Archive SciDB、**自定义 provider** | 6 个 Sci-Hub 镜像 + **Semantic Scholar(OA)** + **LibGen** | 7 个 Sci-Hub 镜像 | Sci-Hub（默认 `sci-hub.ru`）/ Anna's Archive |
| 下载机制 | **① 纯原生 resolver** | **③ 混合**（resolver + 自建） | **③ 混合**（resolver + 自建 fetcher） | **② 纯自建下载器** |
| 接入原生 Find Available PDF | 是（核心） | 是（v3.0 主打） | 是（启动即注册 resolver） | 否 |
| 自定义源 | 是（URL 模板 + selector + attribute） | 否（仅改镜像 URL） | 是（可增删 Sci-Hub 站点） | 否（仅改单一 endpoint） |
| DOI 提取 | 交给 Zotero 原生 | DOI 字段 / extra / url | **多正则 + 5 字段 + 附件**（最强） | 仅 DOI 字段（最弱） |
| 语言 / 技术栈 | TypeScript · zotero-plugin-toolkit · esbuild · **vitest 测试** | 纯 JavaScript · bootstrap.js | TypeScript · zotero-plugin-scaffold（windingwind 模板）· LargePrefHelper | TypeScript · zotero-plugin-scaffold（旧 toolkit v4） |
| 许可证 | **Blue Oak 1.0.0**（宽松） | AGPL-3.0（LICENSE 文件；README 徽章误标 GPL-3.0） | AGPL-3.0-or-later | AGPL-3.0-or-later |
| Zotero 兼容 | 7.0 – 9.* | 6.999 – 8.* | 6.999 – 9.* | 6.999 – **7.0.***（仅 7） |
| 维护活跃度 | 活跃（末次 2026-05，210 commits） | 中（末次 2026-02，171 commits） | **最活跃/最成熟**（末次 2026-02，432 commits，版本至 8.0.4） | **停滞 PoC**（末次 2024-12，仅 3 commits） |

> 说明：维护活跃度基于 submodule 内 `git log`（相对本文写作日 2026-07-07）。许可证以仓库 LICENSE 文件为准。

---

## 3. 逐仓库分析

### 1. pdferret —— 最干净的原生 resolver 方案 ✅

- **定位**：一个「多 provider、可扩展」的按 DOI 下载器，把 provider 概念抽象出来（内置 Sci-Hub + Anna's Archive SciDB，用户可加任意自定义源）。
- **下载源与机制**：**纯 ① 型**。`ResolverManager` 把每个 provider 转成 Zotero resolver 写进 `findPDFs.resolvers`（`content/resolvers/resolverManager.ts`），抓取完全交给原生 "Find Available PDF"。右键菜单默认调 `Zotero.Attachments.addAvailableFiles()`（原生批量补全，仅补缺 PDF/EPUB 的条目）；另有 "强制重下" 模式走 `getFileResolvers()` + `addFileFromURLs()` 追加附件。
- **优势**：
  - 机制最干净——插件只管「维护 resolver 列表」，抓取 / 重定向 / 落库全是 Zotero 原生，随 Zotero 升级免维护；
  - **provider 可扩展**：自定义源只需填 URL 模板 + CSS selector + attribute，不写代码即可接入任意站点（含机构代理、其他镜像）；
  - **卸载自清理**：`resolverManager.cleanup()` 在 shutdown 时只删自己打了 `pdferretManaged` 标记的 resolver，保留用户手配的（非破坏性）；
  - 工程最规范：TypeScript + 有 vitest 单测；许可证 **Blue Oak 1.0.0**（宽松，商用 / 二开无 copyleft 负担）；兼容到 Zotero 9。
- **局限**：
  - 完全依赖原生 resolver 引擎——原生抓不到（如页面结构变、需要验证码）时插件无从兜底，无自建下载器；
  - 不做 OA 专属逻辑（但因走原生，OA 由 Zotero 内置通道覆盖，问题不大）。

### 2. sanfy008-scihub —— OA 优先 + 灰色源兜底的混合方案

- **定位**：`ethanwillis/zotero-scihub` 的直系 fork，升级到 Zotero 7/8，v3.0 起转向「原生 resolver + 多路兜底」。
- **下载源与机制**：**③ 混合**。启动时把 **6 个 Sci-Hub 镜像**注册成原生 resolver（`registerPdfResolvers()`）；同时右键 "Update Scihub PDF" 走自建 `updateItems()`，其抓取顺序耐人寻味——**先试 Semantic Scholar 的 `openAccessPdf`（OA），再试 LibGen scimag 镜像，最后才把 Sci-Hub 页面丢到浏览器让用户手动过验证码**（`scihub.js`）。即自动通道其实以 OA + LibGen 为主，Sci-Hub 直连留给原生 resolver 和浏览器兜底。
- **优势**：
  - **多路兜底**：OA（Semantic Scholar）→ LibGen → 浏览器，单一源失败还有下家，命中率高；
  - **OA 优先**：自建路径先打合法 OA，灰色源靠后，实践上更稳（OA 无验证码 / 无封锁）；
  - 6 镜像原生注册，"Find Available PDF" 也能用；验证码场景优雅降级到浏览器手动。
- **局限**：
  - 纯 JavaScript（无 TS 类型），代码规范弱于其余三者；
  - 自建下载器把 LibGen 域名 / 页面选择器写死，镜像一变就要改代码（② 型的通病）；
  - 只到 Zotero 8，未覆盖 9；许可证 AGPL-3.0（强 copyleft，二开需同源开放，且 README 徽章标 GPL-3.0 与 LICENSE 文件不一致，易误判）。

### 3. zotero-scipdf —— 最成熟、DOI 提取最强的 Sci-Hub 方案

- **定位**：面向 Zotero 7/8 的 Sci-Hub 全文插件，基于 windingwind 的 `zotero-plugin-scaffold` 模板，工程完成度最高（432 commits，版本迭代至 8.0.4，含中英文 README）。
- **下载源与机制**：**③ 混合**。启动时注册 **7 个 Sci-Hub 镜像**为原生 resolver（`CustomResolverManager`，用 `LargePrefHelper` 存自管列表，并与 Zotero 原生 pref 做增量同步、去重）；右键 "Find Full Text" 走自建 `SciHubFetcher`——它对每个 DOI × 每个镜像组合逐一 `HTTP.request` 抓 `#pdf` 元素的 `src`，多镜像轮询直到成功。
- **优势**：
  - **DOI 提取最强**：`identifierPatterns.ts` 用 5 条正则，从 `DOI / url / title / extra` 四个字段**外加条目的最佳附件**里刮 DOI（`utils.ts`），对元数据不规整的老库友好；
  - resolver 管理最讲究：自管列表与 Zotero pref 双向同步、按 `isCustomResolverEqual` 去重，不污染用户已有 resolver；
  - 自建 fetcher 支持多镜像轮询 + 相对 URL 归一 + "PDF 不可得" 的多语言错误页识别（含俄文），健壮性好；
  - 用户可在偏好里**增删 Sci-Hub 站点**（逗号分隔）；兼容到 Zotero 9；工程规范（TS + prettier + eslint + mocha）。
- **局限**：
  - 下载源单一（只 Sci-Hub，无 OA / LibGen / Anna's 兜底），Sci-Hub 全挂时无退路；
  - 混合双轨（resolver + fetcher）逻辑上有重叠，维护面比纯 ① 型大；
  - 许可证 AGPL-3.0-or-later（强 copyleft）。

### 4. zotero7-scidb —— 概念验证级的自建下载器

- **定位**：自称「`ethanwillis/zotero-scihub` 的 Zotero 7 兼容版」，实为最小可用原型（**全仓仅 3 个 commit**，末次 2024-12，明显停滞）。
- **下载源与机制**：**纯 ② 型**，不碰原生 resolver。右键 "Download from SciDB" 走自建 `SciDBManager`：按可配 endpoint（默认 `sci-hub.ru`）拼 `endpoint + doi`，`HTTP.request` 抓页，**若遇 Anna's Archive 的 iframe 会跟进 iframe 的 src 再抓一次**（针对 SciDB→Sci-Hub 跳转），解析 `#pdf` 的 `src`，下到临时文件再 `importFromFile` 落库；抓不到时收集页面里的 `.pdf`/`/pdf/`/`ipfs` 等候选链接丢浏览器。
- **优势**：
  - endpoint 可配，能指向 Sci-Hub 或 Anna's Archive SciDB；
  - **iframe 跟进**逻辑是其独有细节（应对 Anna's Archive 的间接跳转）；
  - 提供了一个「自建下载器 + 临时文件落库」的最小范本。
- **局限**：
  - **基本停更**（3 commits / 2024-12），且 manifest 锁 `strict_max_version: 7.0.*`——**装不上 Zotero 8/9**；
  - DOI 提取最弱（只读 `DOI` 字段，无 extra/url 兜底）；
  - 无 OA、无多镜像轮询、无自定义源；不接原生 "Find Available PDF"；
  - 许可证 AGPL-3.0-or-later。

---

## 4. 选型建议与适用场景

| 场景 | 推荐 | 理由 |
|---|---|---|
| 要最省心、随 Zotero 升级免维护、可扩展任意源 | **pdferret** | 纯原生 resolver，抓取交给 Zotero；provider 可视化扩展；宽松许可 |
| 要高命中率、OA 优先、灰色源兜底 | **sanfy008-scihub** | OA(Semantic Scholar)→LibGen→浏览器多路级联 |
| 要专攻 Sci-Hub、老库 DOI 不规整、要多镜像轮询 | **zotero-scipdf** | DOI 提取最强、镜像管理最讲究、工程最成熟 |
| 要「自建下载器」范本 / 需 iframe 跟进逻辑 | **zotero7-scidb**（仅参考源码） | 已停更且不支持 Zotero 8/9，不建议实际安装 |

**几条通用判断：**

- **优先原生 resolver（① 或 ③ 的 resolver 部分）**：写 `findPDFs.resolvers` 的方案能白嫖 Zotero 原生 OA 通道，且抓取逻辑随 Zotero 升级由官方维护，长期成本最低。纯自建下载器（②）虽可控，但镜像域名 / 页面结构一变就得改代码。
- **DOI 提取质量**决定老库补全率：字段规整的新库差别不大；元数据脏的老库，scipdf 的「多正则 + 多字段 + 附件」提取明显更能刮出 DOI。
- **许可证**影响二开：pdferret 的 Blue Oak 1.0.0 宽松无 copyleft；其余三者 AGPL-3.0 系（强 copyleft，衍生需同源开放）。
- **版本兼容**：需 Zotero 9 → pdferret / scipdf；只到 8 → sanfy008；scidb 锁死在 7，勿用于新版本。
- **与本仓库的关系**：本项目的 Zotero MCP 插件已内置 `manage_pdf_resolvers` 工具，其底层正是「读写 `extensions.zotero.findPDFs.resolvers`」这套原生 resolver 机制——与 pdferret / scipdf 的注册思路同构，可程序化增删灰色源 / 自定义 resolver，等价于上述插件的「注册」环节。

> **灰色源合规风险（中立说明）**：Sci-Hub、Anna's Archive（含其 SciDB 频道）、LibGen 等属于版权灰色地带，在不同法域的合法性存在争议。上述插件只是把这些站点接入 Zotero 的下载流程，**是否使用、以及使用是否合规，由使用者依据自身所在法域的法律与所属机构的规定自行判断并承担责任**。相较之下，开放获取（OA，如 Unpaywall / Semantic Scholar `openAccessPdf` / arXiv）为合法免费通道，应优先使用；Zotero 原生 "Find Available PDF" 默认即先走 OA。四个仓库的 README 也均附有各自的免责声明。

---

## 相关文件指引

- `refs/pdf-download/pdferret/content/{resolvers/resolverManager.ts, providers/*}` —— 原生 resolver 注册 + provider 抽象
- `refs/pdf-download/sanfy008-scihub/chrome/content/scihub.js` —— 混合方案：resolver 注册 + Semantic Scholar/LibGen 多路兜底
- `refs/pdf-download/zotero-scipdf/src/modules/{CustomResolverManager.ts, SciHubFetcher.ts}` 与 `src/utils/identifierPatterns.ts` —— resolver 同步、自建 fetcher、最强 DOI 提取
- `refs/pdf-download/zotero7-scidb/src/modules/scidb.ts` —— 纯自建下载器 + iframe 跟进范本（PoC，已停更）
