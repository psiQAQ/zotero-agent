# Preprint Upgrade & DOI Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 metadata 链路两个已知缺口：(1) `upgrade_preprints` 工具——发现库中 preprint（以 arXiv 为主）的已发表正式版并升级条目；(2) `find_doi` 新增 `repair` 模式——校验坏 DOI（404/迁移）并安全替换。

**Architecture:** 纯函数判定（isPreprintItem、DOI 规范化）放 `metadataMerge.ts` 同级新文件 `preprintService.ts`，可 node 单测；OpenAlex 查询复用 `scholarlyService.ts` 的既有调用模式（该文件已有 `findRelatedPapers` 的 OpenAlex 集成可参考）。两个能力都走「dry-run 出 patch → confirm 写回 → 旧值备份进 `extra` 字段 → 写后回读」的既定安全模式（参照 `case 'enrich_item_metadata'` handler 的形状，`streamableMCPServer.ts:1978` 附近）。

**Tech Stack:** TypeScript、OpenAlex API（`api.openalex.org/works?filter=...`）、doi.org content negotiation（已用于 enrich）。

**Non-goals:** 不做全自动批量写（每次 confirm 都要求显式 scope）；不动 `enrich_item_metadata` 现有行为。

---

### Task 1: preprint 判定纯函数 + 单测

**Files:**
- Create: `src/modules/preprintService.ts`
- Test: `test/preprintService.test.cjs`

- [x] **Step 1: 写失败单测**

```js
// test/preprintService.test.cjs（模块加载方式照抄 test/metadataMerge.test.cjs 的现有约定）
const assert = require("node:assert");
const { isPreprintCandidate, extractArxivId } = require(/* 按现有约定 */);

// itemType 为 preprint 的直接命中
assert.strictEqual(isPreprintCandidate({ itemType: "preprint", url: "", extra: "", DOI: "" }), true);
// journalArticle 但 DOI 是 arXiv 形态（10.48550/arXiv.xxxx）也命中
assert.strictEqual(isPreprintCandidate({ itemType: "journalArticle", url: "", extra: "", DOI: "10.48550/arXiv.2401.00001" }), true);
// 正常期刊文章不命中
assert.strictEqual(isPreprintCandidate({ itemType: "journalArticle", url: "", extra: "", DOI: "10.1145/3313831" }), false);

assert.strictEqual(extractArxivId("https://arxiv.org/abs/2401.00001v2"), "2401.00001");
assert.strictEqual(extractArxivId("arXiv:2401.00001"), "2401.00001");
assert.strictEqual(extractArxivId("10.48550/arXiv.2401.00001"), "2401.00001");
assert.strictEqual(extractArxivId("https://example.com"), null);
console.log("preprintService: ok");
```

- [x] **Step 2: 跑测试确认失败**

Run: `npm run test:unit` → Expected: FAIL（模块不存在）

- [x] **Step 3: 实现纯函数**

```ts
// src/modules/preprintService.ts
export interface ItemFacts { itemType: string; url: string; extra: string; DOI: string; }

const ARXIV_PATTERNS = [
  /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i,
  /^arxiv:(\d{4}\.\d{4,5})(?:v\d+)?$/i,
  /10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i,
];

export function extractArxivId(s: string): string | null {
  for (const re of ARXIV_PATTERNS) {
    const m = (s || "").match(re);
    if (m) return m[1];
  }
  return null;
}

export function isPreprintCandidate(f: ItemFacts): boolean {
  if (f.itemType === "preprint") return true;
  return !!(extractArxivId(f.DOI) || extractArxivId(f.url) || extractArxivId(f.extra));
}
```

- [x] **Step 4: 跑测试确认通过** → `npm run test:unit` PASS

- [x] **Step 5: Commit**

```bash
git add src/modules/preprintService.ts test/preprintService.test.cjs
git commit -m "feat: preprint candidate detection (pure functions + tests)"
```

---

### Task 2: OpenAlex 正式版查询

**Files:**
- Modify: `src/modules/preprintService.ts`

- [x] **Step 1: 实现 findPublishedVersion**（按侦察结果走标题搜索路线：`findPublishedVersion(title, arxivId)` + 纯函数 `pickPublishedVersion(results, title)` 以 fixture 单测覆盖判据）

OpenAlex 对 arXiv 收录有两条路：按 arXiv DOI 查 work，其 `primary_location.version` 若为 `submittedVersion`，看 `locations[]` 里有没有 `version:"publishedVersion"` 的来源；或者用 work 的 `ids.doi` 与 `related_works`。**实现前先用 2 个真实 arXiv id 手测 API 响应确定字段路径**（curl 或 fetch 均可），把确认的 JSON 路径写成注释。

```ts
export interface PublishedVersion { doi: string; venue: string; year: string; openalexId: string; }

export async function findPublishedVersion(arxivId: string): Promise<PublishedVersion | null> {
  const url = `https://api.openalex.org/works/https://doi.org/10.48550/arXiv.${encodeURIComponent(arxivId)}`;
  const resp = await fetch(url, { headers: { "User-Agent": "zotero-agent (mailto:noreply@example.com)" } });
  if (!resp.ok) return null;
  const work = await resp.json();
  // 字段路径以手测为准：寻找 publishedVersion location 或 work.doi ≠ arXiv DOI 的情形
  const pub = (work.locations || []).find((l: any) => l.version === "publishedVersion" && l.source?.type === "journal");
  if (!pub) return null;
  const doi = String(work.doi || "").replace(/^https:\/\/doi\.org\//i, "");
  if (!doi || /10\.48550\/arxiv/i.test(doi)) return null;
  return { doi, venue: pub.source?.display_name || "", year: String(work.publication_year || ""), openalexId: work.id };
}
```

**侦察结果（2026-07-08，经 run_javascript 在真机 Zotero 9.0.4 内 fetch 实测）**：

1. **上面骨架假设的「按 arXiv DOI 查 work、看 locations[] 有无 publishedVersion」路线实测不可用**（3/3 样本失败）：
   - `works/https://doi.org/10.48550/arXiv.1706.03762`（Attention Is All You Need，NeurIPS 2017）→ **HTTP 404**；
   - `10.48550/arXiv.2104.12668`（已发表 TPAMI 2024）与 `10.48550/arXiv.2312.02069`（已发表 CVPR 2024）→ 200，但返回的都是**独立的 preprint work**：`doi` 仍为 arXiv DOI、`primary_location = {version:"submittedVersion", is_published:false, source:{type:"repository", display_name:"arXiv (Cornell University)"}}`、`locations[]` 全为 repository 条目（version 为 "submittedVersion" 或 null）、`ids` 仅 `{openalex, doi(=arXiv), mag?}`——**没有任何指向正式版的字段**。OpenAlex 对这些 CS 论文并未把 preprint 与出版商版本 merge 成同一 work。
2. **可用替代路线：标题搜索**。`GET /works?filter=title.search:<题名>&per-page=5&select=id,doi,title,type,publication_year,primary_location` 对 2104.12668 的标题实测返回 2 个 work，形状对比：
   - 正式版：`{doi:"https://doi.org/10.1109/tpami.2024.3393571", publication_year:2024, primary_location:{version:"publishedVersion", source:{display_name:"IEEE Transactions on Pattern Analysis and Machine Intelligence", type:"journal"}}}`
   - 纯 preprint：`{doi:"https://doi.org/10.48550/arxiv.2104.12668", primary_location:{version:"submittedVersion", source:{type:"repository"}}}`
   - **判定字段路径**（在标题搜索结果里挑正式版）：`primary_location.version === "publishedVersion"` && `primary_location.source.type !== "repository"` && `doi` 不匹配 `/10\.48550\/arxiv/i`；venue 取 `primary_location.source.display_name`，year 取 `publication_year`。命中后**必须**用 titleSimilarity ≥0.86 校验题名防误配（title.search 是模糊搜索）。`findPublishedVersion` 的实现应改为「arXiv id → 条目题名（或先查 preprint work 拿规范题名）→ title.search → 按上述判据过滤」。
   - 纯 preprint 的预期结果形状：搜索结果中**不存在**满足上述判据的 work（只有 repository 版本）→ 返回 null。
3. 备选路线（记录备查，不作主路线）：Semantic Scholar `GET api.semanticscholar.org/graph/v1/paper/arXiv:<id>?fields=externalIds,venue,year` 会把 preprint 与正式版 merge 为同一 paper（`externalIds.DOI` 直接给正式版 DOI），但当前网络下无 API key 的公共池实测**持续 429**（含退避重试），不可靠。
4. **doi.org 存活判据实测（适用于 Task 4 repair 模式）**——plan 原假设「活 DOI 返回 3xx」在 Zotero 环境**不成立**：
   - `fetch('https://doi.org/<真实DOI>', {method:'HEAD', redirect:'manual'})` → `{status: 0, type: "opaqueredirect", location: null}`（Firefox/Zotero 的 fetch 在 manual redirect 下返回 opaqueredirect，**status 恒为 0，拿不到 3xx 和 Location**）；
   - 伪造 DOI（`10.9999/nonexistent-recon-test`）→ `{status: 404, type: "basic"}`。
   - **推荐判据（首选）**：改用 Handle System REST API `GET https://doi.org/api/handles/<doi>`——活 = HTTP 200 且 `body.responseCode === 1`；死 = HTTP 404 且 `responseCode === 100`（两例实测均符合）。语义明确、不依赖 redirect 行为、不会真的打到出版商站点。
   - 若坚持 HEAD：`resp.type === "opaqueredirect"` → 活；`resp.status === 404 || resp.status === 410` → 死；其余（5xx/网络错误）→ unknown，不下结论、不提议替换。

- [ ] **Step 2: 真机手测**（跳过——留给集成阶段，见留验清单）

经 `run_javascript` 对库里 2 个已知有正式版的 arXiv 条目跑 `findPublishedVersion`（先 build+deploy，或直接把函数体粘进 run_javascript 验证字段路径）。
Expected: 返回非 arXiv 的 DOI + venue；对纯 preprint（无正式版）返回 null。

- [x] **Step 3: Commit**

```bash
git add src/modules/preprintService.ts
git commit -m "feat: OpenAlex published-version lookup for arXiv preprints"
```

---

### Task 3: `upgrade_preprints` 工具

**Files:**
- Modify: `src/modules/streamableMCPServer.ts`（tools 数组 + case handler）

- [x] **Step 1: 工具 schema**

```ts
{
  name: 'upgrade_preprints',
  description: 'Scan a scope for preprints (arXiv etc.), look up their published journal/conference version via OpenAlex, and upgrade the item: DOI, venue, date, itemType. Dry-run by default (returns per-item patch preview); confirm:true applies (requires write.enabled). Old values are preserved in the extra field (previous_doi / previous_version). Always read back after write.',
  inputSchema: {
    type: 'object',
    properties: {
      collectionKey: { type: 'string', description: 'Scope: a collection (top-level items)' },
      itemKeys: { type: 'array', items: { type: 'string' }, description: 'Scope: explicit item keys' },
      confirm: { type: 'boolean', description: 'false (default) = preview patches only; true = write' },
      limit: { type: 'number', description: 'Max items to check per call (default 20 — OpenAlex politeness)' },
      libraryID: { type: 'number' },
    },
  },
},
```

- [x] **Step 2: handler（形状参照 `case 'enrich_item_metadata'`）**

```ts
case 'upgrade_preprints': {
  const scopeItems = await resolveScopeItems(/* importService 的既有签名 */);
  const cands = scopeItems.filter(i => isPreprintCandidate({
    itemType: Zotero.ItemTypes.getName(i.itemTypeID), url: i.getField('url'),
    extra: i.getField('extra'), DOI: i.getField('DOI'),
  })).slice(0, Math.max(1, Math.min(args?.limit ?? 20, 100)));
  const patches = [];
  for (const it of cands) {
    const aid = extractArxivId(it.getField('DOI')) || extractArxivId(it.getField('url')) || extractArxivId(it.getField('extra'));
    if (!aid) continue;
    const pub = await findPublishedVersion(aid);
    patches.push({ key: it.key, arxivId: aid, found: !!pub, patch: pub && {
      DOI: pub.doi, publicationTitle: pub.venue, date: pub.year, itemType: 'journalArticle',
    }});
  }
  if (args?.confirm !== true) { result = { dryRun: true, checked: cands.length, patches }; break; }
  // confirm 分支：write.enabled 门禁（照抄 case 'import_by_identifier' 开头的检查）→ 逐条写:
  //   旧值追加进 extra（previous_doi: ...\nprevious_version: preprint）→ saveTx → getAsync 回读校验 DOI 已变
  ...
}
```

- [ ] **Step 3: build + 部署 + 真机验证**（build 已本地通过；部署+真机验证跳过——留给集成阶段，见留验清单）

`npm run build && node scripts/deploy-live.mjs`。dry-run 扫一个 arXiv 密集的集合，人工核对 2 条 patch 是否指向正确正式版（DOI 在浏览器里打开确认），再对**其中 1 条**confirm 写回、回读校验、并在 Zotero UI 里目检。

- [x] **Step 4: Commit**

```bash
git add src/modules/streamableMCPServer.ts
git commit -m "feat: upgrade_preprints tool (OpenAlex published-version upgrade, dry-run default)"
```

---

### Task 4: `find_doi` 增加 repair 模式

**Files:**
- Modify: `src/modules/streamableMCPServer.ts`（`case 'find_doi'` handler，1827 行附近；schema 加 `mode` 参数）

- [x] **Step 1: schema 加参数**

在 `find_doi` 的 inputSchema.properties 增加：

```ts
mode: { type: 'string', enum: ['find', 'repair'], description: "find (default): reverse-lookup a DOI for items lacking one. repair: validate the item's existing DOI against doi.org; if dead (404/410), reverse-lookup a replacement and propose it (old DOI preserved in extra on confirm)." },
```

- [x] **Step 2: repair 分支实现**（按侦察结果改用 Handle System API `GET doi.org/api/handles/<doi>`：200+responseCode 1=活；404+responseCode 100=死；其余 unknown 不下结论。repair 跳过 OpenURL tier 且候选过滤掉死 DOI 自身，防自匹配）

```ts
if (args?.mode === 'repair') {
  const doi = String(itemFD.getField('DOI') || '').trim();
  if (!doi) { result = { needsDoi: true, hint: 'Item has no DOI — use mode:"find".' }; break; }
  const resp = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, { method: 'HEAD', redirect: 'manual' });
  const alive = resp.status >= 300 && resp.status < 400; // doi.org 活 DOI 返回重定向
  if (alive) { result = { doi, alive: true }; break; }
  // 死 DOI → 复用本 case 既有的 CrossRef 标题反查逻辑（≥0.86 相似度）拿候选
  // dry-run: {doi, alive:false, candidate, confirmHint}; confirm:true: extra 追加 previous_doi 后替换 + 回读
}
```

注意：doi.org 对 HEAD 的行为（3xx=活）先用 1 个真实 DOI + 1 个伪造 DOI 手测确认，再定 `alive` 判据；机构代理网络下可能全 200，判据要以实测为准。

- [ ] **Step 3: build + 真机验证**（build 已本地通过；真机验证跳过——留给集成阶段，见留验清单）

对一个正常条目跑 `mode:"repair"` 应报 `alive:true`；手工把一个测试条目的 DOI 改错一位再跑，应给出 candidate（不写库），confirm 后替换并回读。

- [x] **Step 4: Commit**

```bash
git add src/modules/streamableMCPServer.ts
git commit -m "feat: find_doi repair mode (validate dead DOIs, propose replacement)"
```

---

### Task 5: selfTest + 文档收尾

**Files:**
- Modify: `src/modules/selfTest.ts`、`README.md`、`CLAUDE.md`（工具数）

- [ ] **Step 1: 两个 selfTest 场景（都走 dry-run，不依赖网络成功——网络失败时接受结构化 unreachable）**

```ts
await t.scenario("upgrade_preprints dry-run returns patch preview", async () => { /* 空集合 scope → checked:0, dryRun:true */ });
await t.scenario("find_doi repair mode reports alive/dead structurally", async () => { /* 有 DOI 的条目 → {alive} 或 unreachable 结构 */ });
```

- [ ] **Step 2: 全量回归**

`npm run build && node scripts/deploy-live.mjs` → `Zotero.ZoteroAgentSelfTest.run('protocol')` → 全 passed。

- [ ] **Step 3: README 工具表加 `upgrade_preprints`、`find_doi` 描述更新 repair；§2 表格 metadata TODO 打勾。Commit**

```bash
git add src/modules/selfTest.ts README.md CLAUDE.md
git commit -m "feat: selfTest + docs for preprint upgrade and DOI repair"
```
