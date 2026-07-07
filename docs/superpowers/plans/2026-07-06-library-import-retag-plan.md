# 2026-07-06 全库 PDF 导入 + 查重 + 中文重打标计划

> 说明：这是用本插件做一次批量库整理的流程记录。具体库内容（研究主题 / 集合结构 / 条目标识 / 篇数）已脱敏为占位，仅保留可复用的操作流程与插件能力验证。

## 背景与目标

把一批未分类 PDF 导入 Zotero 的 `unclassify` 分组 → 元数据自动识别 → 与库中已有文献查重、重复的进回收站 → 全部文献按主题分类 + 每篇 2~4 个**中文**标签（逐篇读标题+摘要生成，必要时读 conclusion）→ 已有英文标签全部中文化 / 清理 → 完善插件测试并回归修 bug。

执行通道：Claude Code ⇄ 本插件 MCP（端口 23120，write / eval 开启）⇄ Zotero。

## 侦察结果

- 待导入目录：一批 PDF（数十篇），按子目录分若干研究主题
- 库现状：数百个对象（含附件 / 笔记）、约两百篇 regular items、数十个集合、`unclassify` 分组已存在且为空；数百个标签，多为英文自动关键词，中文标签少量，混有工作流标签（reviewer 1-4、resolved / unresolved 等）

## 分阶段方案

### Phase 1 导入（→ unclassify）
`run_javascript` 分批（每批 ~20）调 `Zotero.Attachments.importFromFile({file, collections:[<unclassify id>]})`，记录 `path → itemKey` 映射。导入为 standalone attachment，等 Phase 2 建 parent。

### Phase 2 元数据识别
`Zotero.RecognizeDocument.recognizeItems()` 批量识别（多数有 DOI / arXiv）。预期失败项：书籍、专利、学位论文、海报 / 补充材料。失败项按文件名手动补建 parent（book / patent / thesis / journalArticle）。判据：attachment 有 parentItem 或进入失败清单。

### Phase 3 查重
1) 源内重复：按文件名 / 标题先行合并（保留一份，另一份 `deleted=true`）。
2) 与库存查重：`find_duplicates`（原生引擎）为主，辅以标题模糊比对。
3) 处理原则：**保留库中已有条目，重复的新导入项进回收站**（`deleted=true`，绝不 `eraseTx`）。

### Phase 4 全库分类 + 中文打标
- 先拉全库标题清单，制定**统一中文标签词表**，维度：
  1. 主题（按库的实际研究方向）
  2. 方法（深度学习 / 几何法 / 蒙特卡洛 / 3D 高斯…）
  3. 文献类型（综述 / 数据集 / 专利 / 书籍 / 学位论文 / 补充材料）
  4. 场景 / 设备
- 逐篇读标题+摘要打 2~4 个标签（`write_tag set` 全替换，顺带清掉旧英文标签）；无摘要的用 `get_content` 读 PDF 首尾（conclusion）。
- 分类：沿用现有集合树，新导入按主题归入对应集合，明显错位者调整。
- 一致性控制：词表集中登记，新增标签必须先查表，避免同义词分裂。

### Phase 5 旧标签清理
Phase 4 的 `set` 已清掉条目级旧标签；收尾用 `Zotero.Tags.purge()` / `removeFromLibrary` 清库级残留孤儿标签；工作流标签 rename 中文（reviewer N → 审稿人 N、resolved → 已解决 等，语义不明的保留原样并在报告中列出待裁决）。最终校验：全库无纯英文主题标签。

### Phase 6 测试完善 + 回归
审查 `test/*.cjs` 单测与 `Zotero.ZoteroMCPSelfTest`；针对本次重度使用路径（run_javascript 大批量、write_tag set、find_duplicates、add_items_to_collection）补测试场景；`npm test` 本地全绿 + `SelfTest.run('protocol')` 全通过；过程中发现的 bug 修复并 `deploy-live.mjs` 热部署验证。

### Phase 7 push

## 风险与安全

- 全程只用 `deleted=true`（回收站，可恢复），**不用 eraseTx**。
- 每个写阶段后立即回读校验（不信 saveTx resolved）。
- 打标前导出一份当前 `itemKey → tags` 快照（回滚依据）。
- run_javascript 大批量传 `timeout_ms`，分批执行防超时。
- 发现插件 bug → 改源码 → `npm run build` → `deploy-live.mjs` 热部署 → 复测。

## 进度记录（脱敏摘要）

- [x] 侦察（目录 / 库现状 / 测试目录）
- [x] Phase 1 导入 — 一批 PDF 全部入 unclassify（同名文件天然只导一份）
- [x] Phase 2 识别 — 多数自动识别，少数手动补建 parent（报告 / 专利 / 书 / 学位论文），个别 DOI 导入
- [x] Phase 3 查重 — `find_duplicates` 多组「老库 vs 新导入」重复（新导入方进回收站）；识别并重建个别误识别 / 垃圾条目。**经验：源目录文件名不可靠，一切以 PDF 内容为准**
- [x] Phase 4 分类打标 — 数百篇经多个并行 subagent 逐篇读标题+摘要打标，百余个中文标签（词表 + 审批新词），写入后逐篇回读校验全过；新导入归入目标集合（unclassify 清空）
- [x] Phase 5 标签清理 — 残留纯英文标签删除；工作流标签 rename 中文（rename 保留关联）。**教训：setTags 全替换会抹掉工作流标签，先快照后写入救了回来**
- [x] Phase 6 测试回归 — 本地单测全绿（新增 3 个 evalTool 边界用例）；selfTest 全通过（skip 均为 pref 环境原因）；补「长任务 eval 断连语义」操作守则
- [x] Phase 7 push
