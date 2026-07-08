# Zotero Agent

> **English** | [中文](./README-zh.md)

**Zotero Agent** is a Zotero plugin that embeds an MCP (Model Context Protocol) server, turning your local Zotero library into a workspace an AI agent can fully operate — not just read.

It exposes **46 tools** spanning library search & retrieval, metadata enrichment, identifier-based import (DOI / arXiv / ISBN / PMID), bulk bibliography import (BibTeX / RIS / CSL-JSON), preprint→published-version upgrade, DOI repair, grey-source PDF download (Sci-Hub / Anna's Archive), duplicate detection & merge, batch tagging, citation-graph expansion, annotation synthesis, and companion-plugin bridges (jasminum, Linter) — plus an escape-hatch `run_javascript` for arbitrary in-process automation beyond the built-in tools.

In practice, an AI assistant (Claude, Codex, …) talking to this server can search your library in natural language, clean up metadata and tags in bulk, import and de-duplicate papers, fetch missing PDFs, expand a topic through its citation graph, and synthesize your annotations — with dry-run-by-default safety on every write.

## How to Use

### Step 1: Install the Zotero Plugin

1. Download the latest `zotero-agent.xpi` from the [Releases Page](https://github.com/psiQAQ/zotero-agent/releases/).
2. Install it in Zotero through `Tools -> [gear icon] -> Install Plugin From File...`.
3. Open `Editor -> Settings -> Zotero Agent` and enable these permissions:
   1. Allow Remote Access
   2. Enable Write Operations
   3. Run JavaScript (eval)

> Note: `Run JavaScript (eval)` is used to run JavaScript inside Zotero so it can handle tasks that go beyond the built-in MCP tools. Enable it only when you need it.

### Step 2: Configure Your AI Client

Get your token from `Zotero -> Editor -> Settings -> Zotero Agent -> PSK`.

#### Codex App

Go to `Setting -> MCP Servers -> Add server`, then use this configuration:

| Field | Value |
| --- | --- |
| MCP server name | `zotero-mcp` |
| Transport | `Streamable HTTP` |
| URL | `http://127.0.0.1:23120/mcp` |
| Header Key: `Authorization` | `Bearer <YOUR_PSK>` |
| Header Key: `Content-Type` | `application/json` |

#### Codex CLI

Edit `%USERPROFILE%/.codex/config.toml` or `~/.codex/config.toml`:

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

> Note: If you install it inside this project and run it from this project directory, do not use `--scope user`.

### Step 3 (Optional): Recommended Companion Plugins

These plugins run **alongside** Zotero Agent — they're not bundled in, but once installed, the AI agent can drive them through the `run_javascript` tool (Zotero's privileged context can reach any installed plugin's API). Install the ones that match your workflow:

| Plugin | What it does | How it pairs with this plugin / the agent |
| --- | --- | --- |
| [jasminum 茉莉花](https://github.com/l0o0/jasminum) | Scrapes Chinese-database metadata (CNKI / Wanfang / VIP) for Chinese literature with incomplete fields. | This plugin's built-in enrichment targets Western sources (CrossRef / OpenAlex); jasminum fills the Chinese gap. After importing Chinese PDFs, the agent can trigger its scrape / filename-match via `run_javascript`. |
| [zotero-updateifsE 绿青蛙](https://github.com/redleafnew/zotero-updateifsE) | Writes impact factor, JCR / CAS quartiles, and other journal metrics into items. | After `import_by_identifier` / `enrich_item_metadata` fills the core metadata, the agent can batch-update metrics per collection via `run_javascript`. |
| [zotero-format-metadata](https://github.com/northword/zotero-format-metadata) | 50+ metadata linters: title case, dates, pages, LTWA journal abbreviations, Chinese name / pinyin cleanup. | Complements `enrich_item_metadata` (fills fields) with format normalization — the agent can run its lint rules as a post-enrichment cleanup step. |
| [zotero-zotadata](https://github.com/ydeng11/zotero-zotadata) | Multi-source metadata fill + multi-provider PDF discovery (Unpaywall / arXiv / CORE / …). | A heavier alternative to `find_missing_pdfs` when you need broader PDF sources; the agent can invoke its retrieval pipeline via `run_javascript`. |

**Let the agent install them for you.** With `run_javascript` (eval) enabled, paste a prompt like this — trim the list to what you need:

> Please install these Zotero companion plugins via `run_javascript`. For each repo: `fetch` `https://api.github.com/repos/<repo>/releases/latest`, pick the asset whose name ends in `.xpi`, install it with `AddonManager.getInstallForURL(url)` then `install.install()`, and report each plugin's id / version / active state. Drop any I don't need:
> - jasminum (Chinese metadata: CNKI / Wanfang / VIP) — `l0o0/jasminum`
> - Green Frog / updateifsE (impact factor & quartiles) — `redleafnew/zotero-updateifsE`
> - Linter / format-metadata (format cleanup & journal abbreviations) — `northword/zotero-format-metadata`
> - Zotadata (multi-source fill + PDF discovery) — `ydeng11/zotero-zotadata`

Some plugins may need a Zotero restart to fully activate. Note: most of these are also searchable in the community [Zotero Add-on Market](https://github.com/syt2/zotero-addons) plugin (e.g. `format-metadata` appears there as **"Linter for Zotero"**); a few (like `zotadata`) are GitHub-release-only.

> See the **Built on Open Source — Integration Status & Roadmap** section below for how each is called today and which interactions we plan to promote into dedicated MCP tools.

## Grey-source PDF Download (Sci-Hub / Anna's Archive)

On top of Zotero's built-in open-access resolvers, the plugin can use Sci-Hub / Anna's Archive as fallback PDF download sources.

**Enable in the preferences panel.** In `Editor -> Settings -> Zotero Agent`, turn on the Sci-Hub / Anna's Archive toggle. A source list appears pre-filled with sensible defaults (several Sci-Hub mirrors + Anna's Archive); you can add or remove sources, or restore the defaults. Sources register as **manual-only** resolvers — used only when you explicitly trigger a download, never in the background. Everything stays off by default.

**Download.** Once enabled, Zotero's native right-click **Find Available PDF** automatically includes these sources: Zotero tries free sources first (arXiv / open access) and falls back to the grey sources only when needed. You can also drive it through the MCP tools `manage_pdf_resolvers` (enable/disable and manage the source list) and `find_missing_pdfs` (audit which items lack a PDF, then fetch).

**Compliance.** Sci-Hub / Anna's Archive are grey-area sources. Legal compliance in your jurisdiction is your responsibility.

## Development Setup

Clone the repository:

```bash
git clone https://github.com/psiQAQ/zotero-agent.git
cd zotero-agent
```

Set up the plugin development environment:

```bash
npm install
npm run build
```

Load the plugin in Zotero:

```bash
# For development with auto-reload
npm run start

# Or install the built .xpi file manually
# The xpi file will be generated at "./.scaffold/build/zotero-agent.xpi"
npm run build
```

## MCP Tools

The table below is based on the actual tool definitions in `src/modules/streamableMCPServer.ts`.

| Tool Name | Purpose |
| --- | --- |
| `get_libraries` | List the Zotero libraries available in the current client. |
| `search_library` | Search the Zotero library with filters such as title, year, full text, item type, and relevance scoring. |
| `search_libraries` | Search libraries by name. |
| `search_annotations` | Search highlights, notes, and comments by query, color, tag, or item scope. |
| `get_item_details` | Get detailed metadata for a specific Zotero item. |
| `get_annotations` | Get annotations and notes for a specific item or annotation ID. |
| `get_content` | Read full-text content from PDFs, attachments, notes, and abstracts. |
| `get_collections` | List collections in the library, including recursive tree output when needed. |
| `search_collections` | Search collections by name. |
| `get_collection_details` | Get detailed information for a specific collection. |
| `get_collection_items` | List items inside a specific collection. |
| `get_subcollections` | Get child collections under a specific collection. |
| `create_collection` | Create a new collection, optionally under a parent collection. |
| `update_collection` | Rename or move an existing collection. |
| `delete_collection` | Delete a collection, with optional item deletion. |
| `add_items_to_collection` | Add one or more items to a collection. |
| `remove_items_from_collection` | Remove one or more items from a collection without deleting them from the library. |
| `search_fulltext` | Search across cached full-text document content and return matching passages. |
| `get_item_abstract` | Get the abstract or summary of a specific item. |
| `semantic_search` | Run embedding-based semantic search to find conceptually related content. |
| `find_similar` | Find items that are semantically similar to a given item. |
| `semantic_status` | Show the status and index statistics of the semantic search service. |
| `fulltext_database` | Access the cached full-text database with list, search, get, and stats actions. |
| `write_note` | Create, update, or append Zotero notes. |
| `write_tag` | Add, remove, or replace tags on Zotero items. |
| `write_metadata` | Update item metadata such as title, abstract, DOI, date, or creators. |
| `write_item` | Create items, re-parent attachments, or import local files as attachments. |
| `run_javascript` | Execute JavaScript inside the Zotero process for advanced automation. |
| `reload_plugin` | Reload an installed Zotero plugin for development workflows. |
| `install_plugin_from_url` | Install or upgrade a plugin XPI from a reachable URL or file path. |
| `import_by_identifier` | Import an item by DOI, arXiv ID, ISBN, or PMID. |
| `import_bibliography` | Bulk-import BibTeX / RIS / CSL-JSON (auto-detected); idempotent dedup by DOI / title similarity; dry-run plan by default. |
| `find_missing_pdfs` | Report items without PDFs or fetch open-access PDFs for them. |
| `manage_pdf_resolvers` | Register Sci-Hub / Anna's Archive into Zotero's native PDF resolver pref (grey sources default automatic=false, manual-only); actual download is via find_missing_pdfs. |
| `extract_identifier_from_pdf` | Mine DOI or arXiv ID from a PDF's fulltext cache using frequency voting. Read-only. |
| `find_doi` | Reverse-lookup a DOI via CrossRef title-similarity (≥0.86 threshold), or `mode:"repair"` to validate a dead DOI (Handle System API) and propose a replacement; dry-run default, confirm write requires write.enabled. |
| `enrich_item_metadata` | Fill missing fields (abstract/venue/volume/issue/pages/ISSN/publisher/date) from a DOI via doi.org CSL-JSON + OpenAlex; dry-run default, confirm write requires write.enabled. |
| `upgrade_preprints` | Find the published version of arXiv-style preprints via OpenAlex title search and upgrade DOI/venue/date/itemType; old values backed up into Extra; dry-run default. |
| `check_retractions` | Check items against scite.ai editorial notices such as retractions or corrections. |
| `find_related_papers` | Traverse the citation graph through OpenAlex to find citing or referenced papers. |
| `synthesize_annotations` | Aggregate highlights and notes into a literature-review-oriented markdown bundle. |
| `find_duplicates` | Detect duplicate items using Zotero's native duplicates engine. |
| `merge_duplicates` | Merge duplicate items into a chosen master item. |
| `batch_update_tags` | Run bulk tag operations such as add, remove, or rename. |
| `fetch_chinese_metadata` | Scrape CNKI/Wanfang/VIP metadata for top-level Chinese attachments & CNKI snapshots via the jasminum companion plugin (eligibility classification, hang-proof watchdog). |
| `lint_metadata` | Run zotero-format-metadata (Linter) rules over items — title case, dates, journal abbreviations, Chinese name splitting; unknown rule ids rejected with the valid list. |

## Built on Open Source — Integration Status & Roadmap

This plugin stands on the shoulders of several open-source projects: it forks a writable in-process MCP base and folds in the best ideas from ~17 reference projects (archived read-only as submodules under `refs/`). Full technical comparisons live in:

- [AI / MCP integration approaches](./docs/benchmarking/ai-plugins-mcp.md) — 5 projects
- [Metadata enrichment plugins](./docs/benchmarking/metadata-enrichment.md) — 8 projects
- [PDF download approaches](./docs/benchmarking/pdf-download.md) — 4 projects

### 1. What this fork adds on top of the base

Forked from [cookjohn/zotero-mcp](https://github.com/cookjohn/zotero-mcp) — a clean, in-process, locally-writable MCP server (27 tools, direct `saveTx`/`eraseTx`). Our additions:

| Area | cookjohn base | This fork adds |
| --- | --- | --- |
| Auth | loopback only | **PSK Bearer** auth + `Origin` validation (DNS-rebind defense) |
| Eval | none | **`run_javascript`** privileged eval tool (timeout + 100 KB cap) |
| Tools | 27 | **46** — +19 tools (identifier & bulk-bibliography import, missing-PDF audit, citation graph, dedup, batch tags, metadata enrich, DOI reverse-lookup & repair, preprint upgrade, grey-source download, companion-plugin bridges, …) |
| Search | keyword | + RRF **hybrid** semantic search, 0-result **fallback ladder** |
| Testing | none | 31-scenario in-process **selfTest** + node unit tests (91 cases) |
| Deploy | manual | one-shot **`deploy-live`** (base64 ship + self-upgrade) + `reload_plugin` / `install_plugin_from_url` |
| i18n | zh / en | + de / es / fr / ja |
| CJK | — | byte-level HTTP read fix (dense CJK bodies no longer mojibake) |

### 2. Capabilities absorbed from reference projects (integrated)

Ideas were **re-implemented** (not vendored) into native tools:

**AI / MCP** — see [comparison](./docs/benchmarking/ai-plugins-mcp.md)

| Source | Absorbed into | Status | TODO |
| --- | --- | --- | --- |
| [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp) | `import_by_identifier`, `import_bibliography` (BibTeX / RIS / CSL-JSON), `find_missing_pdfs`, `find_related_papers` (OpenAlex), `check_retractions` (scite), `synthesize_annotations` | ✅ | batch OA indexing |
| [introfini/ZotSeek](https://github.com/introfini/ZotSeek) | RRF hybrid `semantic_search` | ✅ | WebGPU acceleration; Matryoshka dim truncation |
| [introfini/mcp-server-zotero-dev](https://github.com/introfini/mcp-server-zotero-dev) | `run_javascript`, `reload_plugin`, `install_plugin_from_url` | ✅ | screenshot / DOM-inspection tools for UI debugging |

**Metadata** — see [comparison](./docs/benchmarking/metadata-enrichment.md)

| Source | Absorbed into | Status | TODO |
| --- | --- | --- | --- |
| [zotero-metadata-hunter](https://github.com/federicotorrielli/zotero-metadata-hunter) | `enrich_item_metadata` (field-level fill from DOI CSL-JSON + OpenAlex), `upgrade_preprints` (published-version upgrade via OpenAlex title search) | ✅ | — |
| [zotero-doi-fix](https://github.com/pandaAIGC/zotero-doi-fix) | `find_doi` (title-similarity fusion + `mode:"repair"`: Handle-System validation → replace w/ backup), `extract_identifier_from_pdf` | ✅ | — |

**PDF** — see [comparison](./docs/benchmarking/pdf-download.md)

| Source | Absorbed into | Status | TODO |
| --- | --- | --- | --- |
| [pdferret](https://github.com/urschrei/pdferret), [zotero-scipdf](https://github.com/syt2/zotero-scipdf) | `manage_pdf_resolvers` (native `findPDFs.resolvers` read/write) + grey-source download | ✅ | multi-mirror rotation; stronger DOI extraction (scipdf's 5-regex + attachment scrape) |

### 3. Not integrated, but callable via `run_javascript` (interaction boundary + roadmap)

These plugins aren't folded into this one, but if the user **installs them**, an AI agent can drive them through **`run_javascript`** — which runs in Zotero's privileged context and can reach any installed plugin's exposed API. Current boundary and future dedicated-tool directions:

| Plugin | Capability | Current agent boundary | TODO (dedicated tool) |
| --- | --- | --- | --- |
| [jasminum 茉莉花](https://github.com/l0o0/jasminum) | Chinese metadata scraping (CNKI / Wanfang / VIP) | ✅ dedicated tool **`fetch_chinese_metadata`** (v2.1.0): eligibility classification + hang-proof watchdog over `Zotero.Jasminum` task runner | — |
| [zotero-updateifsE 绿青蛙](https://github.com/redleafnew/zotero-updateifsE) | Impact factor / JCR & CAS quartiles | Call its easyScholar update path per item via `run_javascript` | `update_journal_metrics(scope)` tool |
| [zotero-format-metadata](https://github.com/northword/zotero-format-metadata) | 50+ format linters, LTWA journal abbreviation | ✅ dedicated tool **`lint_metadata`** (v2.1.0): standard/explicit rules over `Zotero.Linter.hooks.onLintInBatch`, unknown ids rejected | — |
| [zotero-zotadata](https://github.com/ydeng11/zotero-zotadata) | Multi-source fill + multi-provider PDF discovery | Call its retrieval pipeline via `run_javascript` | `deep_enrich(itemKey)` combining fill + PDF fetch |

> `run_javascript` is the universal escape hatch: any installed plugin exposing functions on the `Zotero` object (or a global) can be driven by the agent **today**. The TODO column is about promoting the most-used interactions into typed, dry-run-safe MCP tools.
