# 下载 + 元数据工具 实施计划（调研落定版）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。承接选型决策文档 `2026-07-06-pdf-download-metadata-in-mcp.md`，把 4 个缺口工具展开为可执行 task。**每个工具的纯函数进独立模块本机 TDD，wiring 进 streamableMCPServer 的 case + selfTest 真机覆盖**（延续 T1–T16 模式）。

**Goal:** 文献下载 + 元数据建立全部进 MCP：`manage_pdf_resolvers`、`extract_identifier_from_pdf`、`find_doi`、`enrich_item_metadata`（+ 低优先 `normalize_fields`）。

**关键前提（12 库源码调研落定）:**
- **下载 = 写 pref**：Sci-Hub 类插件本质是往 `extensions.zotero.findPDFs.resolvers` 注册一条 resolver，真正下载靠 `Zotero.Attachments.addAvailablePDF`（我们 `find_missing_pdfs` 已在用）。**pdferret `resolverManager.ts` 是标准答案**。
- **元数据合并**：metadata-hunter 的字段级合并规则 + doi-fix 的标题相似度 + ZotMeta 的全文挖标识符，全部纯 `Zotero.HTTP`/`Translate`/`Fulltext`，无 Node/Python 依赖，可进程内 JS 1:1 移植。

**攒批部署:** 离线时先做全部纯函数 + wiring + tsc + build + selfTest 场景；连接恢复后一次 `deploy-live.mjs` 部署 + 真机 API 验证（task 21 探测代码）+ `ZoteroMCPSelfTest.run('protocol')` 全量回归。

---

## 部署前 gate：真机 API 验证（task 21，连接恢复即跑）

每个工具的 wiring 依赖的 Zotero API，用这段一次性验证（连接恢复后经 run_javascript 跑，任何 `undefined`/异常回填对应工具的 fallback）：resolvers pref 读写往返、`addAvailablePDF` 认自定义 resolver、`Fulltext.getItemCacheFile(att)` 返回缓存文件、`OpenURL.createContextObject(item,"1.0")`、`Translate.Search` scratch 建条目即删、CrossRef `/works/{doi}` 的 abstract/container-title 字段可用性。（探测代码见对话记录，已备。）

---

## Phase A：下载能力（最小改动打通 Sci-Hub / Anna's Archive）

### Task A1: pdfResolvers.ts 纯函数 + 单测

**Files:** Create `src/modules/pdfResolvers.ts`、`test/pdfResolvers.test.cjs`（注册进 `scripts/unit-test.mjs`）

调研落定的关键设计（**与三个参考插件区别的正确落点**）：
- resolver JSON：`{name, method:"GET", url:"https://.../{doi}", mode:"html", selector, attribute, automatic, mcpManaged:true}`
- **灰色源写 `automatic:false`**（只在手动 Find Available PDF 时用，绝不在 connector 自动流程静默访问）——`automatic` 省略=true，故必须**显式 false**
- **merge = `[...mine, ...external]`**：读现有 pref→`JSON.parse`（防非数组）→剔除带 `mcpManaged:true` 的（external 保留）→自己的全量重建→合并写回。身份只认 `name+url`，**不把 automatic 算进身份**（scipdf 的重复 bug 根因）
- 预置（selector 用 sanfy008 多选择器版，更鲁棒）：

```ts
/** PDF resolver management — writes extensions.zotero.findPDFs.resolvers; download itself is Zotero-native (addAvailablePDF). Pure functions, no Zotero imports. */

export interface Resolver {
  name: string; method: "GET"; url: string; mode: "html" | "json";
  selector: string; attribute?: string; automatic: boolean; mcpManaged: true;
}

const SCIHUB_SELECTOR = '#pdf, embed[src*=".pdf"], iframe[src*=".pdf"]';

/** Built-in grey-source templates. automatic defaults to false (manual-only). */
export const RESOLVER_PRESETS: Record<string, Omit<Resolver, "automatic">> = {
  "scihub-se": { name: "Sci-Hub", method: "GET", url: "https://sci-hub.se/{doi}", mode: "html", selector: SCIHUB_SELECTOR, attribute: "src", mcpManaged: true },
  "scihub-st": { name: "Sci-Hub", method: "GET", url: "https://sci-hub.st/{doi}", mode: "html", selector: SCIHUB_SELECTOR, attribute: "src", mcpManaged: true },
  "scihub-ru": { name: "Sci-Hub", method: "GET", url: "https://sci-hub.ru/{doi}", mode: "html", selector: SCIHUB_SELECTOR, attribute: "src", mcpManaged: true },
  "annas-scidb": { name: "Anna's Archive SciDB", method: "GET", url: "https://annas-archive.gl/scidb/{doi}/", mode: "html", selector: 'a[href$=".pdf"]', attribute: "href", mcpManaged: true },
};

/** Parse the pref value defensively (string→array; single object→[obj]; junk→[]). */
export function parseResolvers(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : p ? [p] : []; } catch { return []; }
}

/** Merge our managed resolvers with foreign ones — never touch external, dedupe ours by name+url. */
export function mergeResolvers(existing: any[], mine: Resolver[]): any[] {
  const external = existing.filter((r) => !r?.mcpManaged);
  const seen = new Set<string>();
  const deduped = mine.filter((r) => { const k = r.name + "\n" + r.url; if (seen.has(k)) return false; seen.add(k); return true; });
  return [...deduped, ...external];
}

/** Build a resolver from a preset key or a full custom config; automatic defaults false. */
export function buildResolver(cfg: Partial<Resolver> & { preset?: string; automatic?: boolean }): Resolver {
  const base = cfg.preset ? RESOLVER_PRESETS[cfg.preset] : null;
  if (cfg.preset && !base) throw new Error(`Unknown preset: ${cfg.preset}. Known: ${Object.keys(RESOLVER_PRESETS).join(", ")}`);
  const merged: any = { method: "GET", mode: "html", attribute: "src", ...base, ...cfg, mcpManaged: true };
  delete merged.preset;
  if (!merged.name || !merged.url || !merged.selector) throw new Error("resolver requires name, url, selector");
  if (!merged.url.includes("{doi}")) throw new Error("url must contain {doi} placeholder");
  merged.automatic = cfg.automatic === true; // grey sources default OFF
  return merged as Resolver;
}
```

单测覆盖：`parseResolvers` 三种畸形输入；`mergeResolvers` 保留 external + 去重 + 不把 automatic 算进身份；`buildResolver` preset/custom/缺 `{doi}` 抛错/automatic 默认 false。

### Task A2: manage_pdf_resolvers 工具注册 + wiring

**Files:** Modify `streamableMCPServer.ts`（schema + case + writeToolNames）、`selfTest.ts`

- action: `list`（读 pref 返回当前 + 可用 preset 名，只读）/ `add`（preset 或 custom→buildResolver→mergeResolvers→写 pref）/ `remove`（按 name+url 或清全部 mcpManaged）/ `set_automatic`（改某条 automatic）
- 写门禁（改 pref 属库配置写）：挂 `write.enabled`，入 writeToolNames
- wiring：`Zotero.Prefs.get/set("extensions.zotero.findPDFs.resolvers", ..., true)` **第三参 true 必传**（sanfy008 漏传是 bug）
- description 注明：灰色源默认 `automatic:false`（仅手动 Find Available PDF 生效）、下载靠 `find_missing_pdfs action=fetch`、合规自负
- selfTest：add scihub-se preset → list 含之→不实际下载（只验 pref 往返）→remove 清理

### Task A3: find_missing_pdfs 联动（零改动，仅文档）

注册非 OA resolver 后，现有 `addAvailablePDF` 自动覆盖这些源（机制使然）。仅在 `find_missing_pdfs` description 补一句「下载源由 manage_pdf_resolvers 配置，含 Sci-Hub 需显式 add 且开 automatic 或手动触发」。

---

## Phase B：从 PDF 挖标识符

### Task B1: pdfIdentifier.ts 纯函数 + 单测

**Files:** Create `src/modules/pdfIdentifier.ts`、`test/pdfIdentifier.test.cjs`

ZotMeta 的两条正则 + **补掉其短板**（多 DOI 取第一个不可靠→频率投票取众数）：

```ts
/** Extract DOI / arXiv id from PDF fulltext. Pure — caller supplies the text. */
const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;
const ARXIV_RE = /\b(?:arxiv\s*(?:id)?\s*[:：]\s*)?((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)\b/i;

function cleanDoi(d: string): string { return d.replace(/[.,;:)]+$/, ""); }

export function extractIdentifiers(text: string): { doi: string | null; arxiv: string | null } {
  const t = String(text || "");
  // DOI: frequency vote — the true DOI recurs (header/footer); the first hit is often a reference-list DOI.
  const counts = new Map<string, number>();
  for (const m of t.matchAll(DOI_RE)) { const d = cleanDoi(m[0]); counts.set(d, (counts.get(d) ?? 0) + 1); }
  let doi: string | null = null, best = 0;
  for (const [d, c] of counts) if (c > best) { best = c; doi = d; }
  const am = t.match(ARXIV_RE);
  return { doi, arxiv: am ? am[1] : null };
}
```

单测：ZotMeta 测试串（`arXiv:2209.14577v1 [stat.ML]\nDOI: 10.1108/03321640510615607.` → 两者）；频率投票（正文 DOI 出现 3 次 vs 参考文献 DOI 1 次→取前者）；全角冒号 arXiv；尾标点清理。

### Task B2: extract_identifier_from_pdf 工具

**Files:** Modify `streamableMCPServer.ts`、`selfTest.ts`

- 只读（不改库），无门禁；入参 itemKey，遍历其 PDF 附件
- wiring：`Zotero.Fulltext.getItemCacheFile(att)` → `.exists()` → `Zotero.File.getContentsAsync(cf.path)` → `extractIdentifiers` → 返回 `{doi, arxiv, source: attKey}`
- 真机验证点：`getItemCacheFile` 返回值形状（path? 直接 nsIFile?）
- selfTest：对已知有 PDF 的条目跑，断言返回结构（有 PDF 全文缓存时）

---

## Phase C：标题反查 DOI

### Task C1: titleSimilarity.ts 纯函数 + 单测

**Files:** Create `src/modules/titleSimilarity.ts`、`test/titleSimilarity.test.cjs`

移植 doi-fix 的 `getTitleSimilarity`（三算法融合 + 副标题启发式 + 阈值 0.86），**补掉共性短板**（加 NFKD 折叠变音符）：

```ts
/** doi-fix-style title similarity — token+char+jaccard fusion with subtitle heuristics. Pure. */
export const MATCH_THRESHOLD = 0.86;

export function normalizeTitle(s: string): string {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // fold diacritics (doi-fix lacked this)
    .toLowerCase().replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokens(s: string): string[] { return normalizeTitle(s).split(" ").filter((t) => t.length > 1); }

function levenshtein(a: string, b: string): number { /* two-row DP, cap inputs to 300 chars */ ... }

export function titleSimilarity(t1: string, t2: string): number {
  const n1 = normalizeTitle(t1), n2 = normalizeTitle(t2);
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 1;
  const a = tokens(t1), b = tokens(t2), setA = new Set(a), setB = new Set(b);
  const common = [...setA].filter((x) => setB.has(x)).length;
  const overlap = common / Math.min(setA.size, setB.size);
  const jaccard = common / new Set([...a, ...b]).size;
  if (overlap === 1 && Math.abs(a.length - b.length) <= 2) return Math.max(0.94, jaccard); // subtitle diff
  if (overlap === 1 && Math.min(setA.size, setB.size) >= 5 && Math.max(a.length, b.length) / Math.min(a.length, b.length) <= 2) return Math.max(0.9, jaccard);
  const lev = 1 - levenshtein(n1.slice(0, 300), n2.slice(0, 300)) / Math.max(n1.length, n2.length);
  const prec = common / setA.size, rec = common / setB.size, f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  return Math.max(lev, f1, jaccard);
}
```

单测：完全相等=1；副标题差异≥0.94；变音符（Müller vs Muller 归一化后相等）；无关标题<0.5；阈值边界。

### Task C2: find_doi 工具 + wiring

**Files:** Modify `streamableMCPServer.ts`、`selfTest.ts`；可复用 `importService` 的 `normalizeStringList`

- 入参 itemKey（读其 title/首作者/年份）；写门禁（回填 DOI 字段）+ dry-run（返回候选不写）
- wiring（doi-fix 两级）：① `Zotero.OpenURL.createContextObject(item,"1.0")` → GET `crossref.org/openurl?pid=...&{ctx}&multihit=true` 解析 `<doi>`；② 未解析→REST `api.crossref.org/works?query.title=...&query.author=<lastName>&filter=from-pub-date:Y,until-pub-date:Y&rows=5&select=DOI,title,...&mailto=`，**年份双探**（带年份低分则去年份重试）
- 候选用 `titleSimilarity ≥ 0.86` 过滤，取最高分；<阈值返回候选让上层判断（不盲写）
- 写前 `cleanDoi` + 可选 `validateDoi`（GET works/{doi} 存在性）；旧 DOI 备份进 Extra
- 真机验证点：`OpenURL.createContextObject` 签名、CrossRef openurl XML 结构

---

## Phase D：补全已有条目元数据（最大缺口，最复杂）

### Task D1: metadataMerge.ts 纯函数 + 单测

**Files:** Create `src/modules/metadataMerge.ts`、`test/metadataMerge.test.cjs`

移植 metadata-hunter 的字段合并规则（**极高价值，1:1**）+ OpenAlex 倒排重建 + zotadata 作者校验：

```ts
/** Field-level merge for enriching an EXISTING item from a canonical record. Pure — operates on plain snapshots. */

export const FILL_MISSING_FIELDS = ["publicationTitle","proceedingsTitle","conferenceName","publisher","place","volume","issue","pages","ISSN","ISBN","language","url","series","seriesTitle","seriesNumber"];

/** Rebuild abstract from OpenAlex abstract_inverted_index {word: [positions]}. */
export function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string | null {
  if (!inv) return null;
  const words: string[] = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) words[p] = w;
  const s = words.filter((x) => x != null).join(" ").trim();
  return s || null;
}

/** metadata-hunter rule: replace abstract only if empty OR (<200 chars AND incoming is longer). */
export function shouldReplaceAbstract(existing: string, incoming: string): boolean {
  if (!incoming) return false;
  if (!existing) return true;
  return existing.length < 200 && incoming.length > existing.length;
}

/** metadata-hunter rule: replace creators only if incoming strictly longer AND ≥1 shared surname (or existing <2). */
export function shouldReplaceCreators(existing: any[], incoming: any[]): boolean {
  if (!incoming?.length) return false;
  if ((existing?.length ?? 0) < 2) return true;
  if (incoming.length <= existing.length) return false;
  const surn = (c: any) => String(c.lastName || c.name || "").toLowerCase();
  const exSet = new Set(existing.map(surn));
  return incoming.some((c) => exSet.has(surn(c)));
}

/** date rule: fill when existing has no 4-digit year; upgrade bare year to full date. */
export function shouldUpdateDate(existing: string, incoming: string): boolean {
  if (!incoming) return false;
  if (!/\d{4}/.test(existing || "")) return true;
  return /^\d{4}$/.test(existing) && /\d{4}-\d{2}/.test(incoming);
}

/** Compute the field-level patch (does NOT mutate; caller applies via setField after isValidForType). */
export function computeEnrichPatch(existing: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const f of FILL_MISSING_FIELDS) if (!existing[f] && incoming[f]) patch[f] = incoming[f];
  if (incoming.abstractNote && shouldReplaceAbstract(existing.abstractNote || "", incoming.abstractNote)) patch.abstractNote = incoming.abstractNote;
  if (incoming.date && shouldUpdateDate(existing.date || "", incoming.date)) patch.date = incoming.date;
  return patch;
}
```

单测：`reconstructAbstract` 倒排还原；`shouldReplaceAbstract`（空/短且更长/长则不换）；`shouldReplaceCreators`（<2换/更短不换/姓氏交集）；`shouldUpdateDate`（无年补/纯年升级）；`computeEnrichPatch` 只补空标量。

### Task D2: enrich_item_metadata 工具 + wiring

**Files:** Modify `streamableMCPServer.ts`、`selfTest.ts`

- 入参 itemKey（或 scope 批量）；写门禁 + dry-run（返回 patch 预览不写）；`mode: fill|replace`（作者是否允许替换）
- wiring（metadata-hunter 骨架）：
  1. 有 DOI→取规范记录；无 DOI→先 `find_doi`（复用 C2）
  2. 取规范记录用 **scratch 条目法防库翻倍**：`Translate.Search` 建临时条目→快照成纯对象→`finally { Zotero.Items.erase(scratch.id) }`；或直接 doi.org CSL-JSON（`Accept: application/vnd.citationstyles.csl+json`，ZotMeta 法，一次拿全字段更省）
  3. 摘要为空→`Promise.any([S2, PubMed, OpenAlex])` race（withNullAsReject），OpenAlex 走 `reconstructAbstract`
  4. `computeEnrichPatch` + itemType 先改（setType 最先）+ 逐字段 `ItemFields.isValidForType` 校验后 `setField`
  5. `mode=replace` 且 `shouldReplaceCreators`→换作者
  6. **写后回读校验**；失败打 tag（No DOI / No Richer Record）
- 真机验证点：scratch 建条目即删不留残、doi.org CSL-JSON 响应形状、S2/OpenAlex 可达（CrossRef/OpenAlex 已验证 200）
- selfTest：对一个缺字段条目 dry-run→断言 patch 非空且不含已有字段；对已完整条目→patch 空

**预印本升级**（metadata-hunter 高价值）作为 D2 可选扩展或独立 `upgrade_preprint`：先迁子项（附件/笔记/批注 `parentItemID` 改指）**后** trash 旧条目（顺序防丢标注 PDF）——**破坏性，dry-run 默认 + 显式 confirm**。首版可只做 enrich，预印本升级列 backlog。

---

## Phase E（低优先）：字段规范化

### Task E1: normalize_fields（纯算法，桶 D）

format-metadata 里**只值得抄纯字符串算法**：化学式上下标、版次/卷号数字化（放开 book 限制 + 补 `vol.` 剥离）、去前导零、页码连接符（补 `--`→`-`）、尾句号、Unicode 标点归一。打包成一个 `normalize_fields` 工具（纯函数模块 `fieldNormalize.ts` + 单测）。sentence case 值得但要连 16KB 词典 + 测试 + 结构性缺陷一起接受→**列 backlog**。依赖 1.7MB 期刊缩写词典/高校词典的规则**放弃**（转 abbreviso API 或 run_javascript 兜底）。DOI 去前缀/日期 ISO 化→`run_javascript` 调 `cleanDOI`/`Zotero.Date.strToISO` 即可，不单独做工具。

---

## 实施顺序与批次

1. **批 1（下载，最快见效）**：A1→A2→A3。纯函数单测 + wiring + selfTest。
2. **批 2（挖标识符）**：B1→B2。
3. **批 3（反查）**：C1→C2。
4. **批 4（元数据补全，最大缺口）**：D1→D2。
5. **批 5（低优先）**：E1；预印本升级、sentence case 视需要。
- 每批：tsc + 本机单测全绿 + build。**连接恢复后**：`deploy-live.mjs` 部署 + task 21 探测验证 API + `ZoteroMCPSelfTest.run('protocol')` 全量回归 + 版本 bump。
- 工具数 38 → 约 44（+manage_pdf_resolvers/extract_identifier_from_pdf/find_doi/enrich_item_metadata/normalize_fields，预印本升级可选）。

## 安全与边界

- **SSRF**（zotadata 反面教材）：我们下载走 native resolver + `addAvailablePDF`，URL 由 Zotero 处理，SSRF 面小——这正是选 native 而非自建下载的又一优势。若未来做自建多源 `retrieve_pdf`，**必须**补主机 allowlist + 私网/环回/链路本地 IP 拦截。
- **灰色源**：`automatic:false` 默认（仅手动触发）；合规自负；description 明示。
- **破坏性**：预印本升级/DOI 覆盖/作者替换→dry-run 默认 + 写后回读；旧值备份进 Extra。
- **共性短板已补**：NFKD 折叠变音符（相似度）、DOI 频率投票（挖标识符）。
