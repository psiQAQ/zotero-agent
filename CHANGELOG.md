# Changelog

Forked from [cookjohn/zotero-mcp](https://github.com/cookjohn/zotero-mcp) (upstream v1.5.0, commit `bbaf5cf`, 2026-06-11) and evolved independently.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning adheres to [Semantic Versioning](https://semver.org/).

## [2.2.0] - 2026-07-19

### Added
- **`search_web_of_science`**: read-only Web of Science Starter API advanced search with normalized bibliographic output, fixed Clarivate HTTPS endpoint, API Key authentication, stable 50-record pagination, and direct DOI/PMID/ISBN handoff to `import_by_identifier`
- Web of Science preferences for API Key, plan, database, per-call record cap, timeout, and a one-record connection test; the Key uses a password field and is never returned by MCP
- Plan-aware request protection: serialized starts, conservative 1.1s/220ms spacing, local UTC daily counters for the official 50/5,000/20,000-request plans, per-call safety caps, and no hidden retries after HTTP 429
- English and Chinese Web of Science guides covering individual eligibility, API Key acquisition, plan capabilities, security, and quota-tracking limitations

### Changed
- Tools: 46 → 47; selfTest scenarios: 31 → 32; unit tests: 91 → 100
- `import_by_identifier` remains provider-neutral; WoS results reuse its existing DOI/PMID/ISBN path rather than adding a WoS-specific importer
- Refreshed the default grey-source resolver list to 13 Sci-Hub-compatible mirrors plus 2 Anna's Archive endpoints; removed the deprecated `sci-hub.se`, `sci-hub.st`, and `sci-hub.su` defaults

## [2.1.0] - 2026-07-08

### Added (4 new tools, 42 → 46)
- **`import_bibliography`**: bulk BibTeX / RIS / CSL-JSON import (format auto-detected via Zotero's import translators) with idempotent dedup — case-insensitive DOI match first, then title similarity ≥0.86 — and a dry-run per-entry plan (import/skip + reason). Partial imports go through a lossless CSL-JSON round-trip; entries that fail the round-trip are reported as skipped (`csl-roundtrip-unsupported`), never silently dropped
- **`upgrade_preprints`**: find the published version of arXiv-style preprints via OpenAlex **title search** (publishedVersion + non-repository source + non-arXiv DOI, guarded by title similarity ≥0.86) and upgrade DOI / venue / date / itemType. Old values are backed up into Extra (`previous_doi` / `previous_version`); dry-run by default, per-item read-back verification on confirm
- **`fetch_chinese_metadata`**: bridge to the [jasminum](https://github.com/l0o0/jasminum) companion plugin — CNKI / Wanfang / VIP scraping for top-level Chinese attachments and CNKI snapshots, with eligibility classification (per-item reasons for ineligible shapes). A watchdog auto-resolves jasminum's multiple-results pause so batch scrapes cannot hang; returns structured `{installed:false, hint}` when the plugin is missing
- **`lint_metadata`**: bridge to [zotero-format-metadata](https://github.com/northword/zotero-format-metadata) (Linter) — run `"standard"` or explicit rule ids over items; unknown rule ids are rejected with the valid list; bounded wait (`timeout_ms`) with a best-effort stats snapshot. The plugin has no preview API, so dry-run lists targets only — documented honestly in the tool description
- **`find_doi` repair mode** (`mode:"repair"`): validate an item's existing DOI via the Handle System API (`doi.org/api/handles`); dead DOIs get a CrossRef reverse-lookup replacement proposal (the dead DOI itself is excluded from candidates), `unknown` outcomes (5xx / network failure) never propose a replacement; the old DOI is backed up into Extra on confirm

### Changed
- selfTest: 26 → 31 scenarios (5 new, covering all tools above; missing-companion paths included so CI-like profiles still pass)
- Unit tests: 70 → 91 cases (new pure modules: `importDedup`, `preprintService`, `companionBridge`)
- `deploy-live.mjs`: Zotero-side staging path now resolved via `PathUtils.tempDir` (cross-platform, no hardcoded `/tmp`); file URL built with `Services.io.newFileURI`; MCP config lookup accepts `zotero` / `zotero-mcp` / `zotero-dev` server names

## [2.0.2] - 2026-07-07

### Fixed
- TOML config: remove unnecessary quotes around bare key in `[mcp_servers]` section (Codex CLI)
- `/mcp/status` endpoint: repository and documentation URLs now point to this repo
- selfTest error log filter: updated regex to match new addon ref
- Vector database filename: `zotero-agent-vectors.sqlite`

## [2.0.1] - 2026-07-07

### Changed
- CLI commands in client config generator now use single-line format (Claude Code, Qwen Code)

## [2.0.0] - 2026-07-07

First public release. Relative to upstream v1.5.0 (27 tools), tools expanded from 27 → **42**, with PSK authentication + security model + `run_javascript` as core additions.

### Security & Authentication
- **PSK Bearer auth**: `POST /mcp` validates `Authorization: Bearer <PSK>`; PSK auto-generated on first launch and stored in prefs, copyable/regenerable from preferences panel; `auth.enabled` defaults to **on**
- **Defense in depth**: loopback-only binding → PSK → `eval.enabled` defaults to **off** → `write.enabled` defaults to **off**
- **DNS rebinding defense**: `POST /mcp` validates Origin header, returns 403 for disallowed origins (covers opaque origin / IP suffix / path suffix edge cases)
- Write tools are **dry-run by default**, `confirm: true` to execute; read-back verification after writes

### Core Tools (15 new)
- **`run_javascript`**: AsyncFunction executing arbitrary JS in Zotero's privileged context, with `Zotero/ZoteroPane/ztoolkit/console` injected; structured return `{result, logs, error}`; guarded by `eval.enabled` pref (default **off**); `timeout_ms` + 100KB result cap
- **`import_by_identifier`**: DOI/arXiv/ISBN/PMID import with `if_exists` idempotency (case-insensitive DOI dedup including Extra field, adsBibcode dedup, post-import read-back verification)
- **`find_missing_pdfs`**: Library/collection PDF missing audit + Unpaywall OA auto-fill
- **`check_retractions`**: scite.ai retraction check (no API key required; truthfully reports unreachable on network errors)
- **`find_related_papers`**: OpenAlex citation graph expansion, marked with `inLibrary`; fetch default reduced to 5 to prevent client timeouts
- **`synthesize_annotations`**: Per-paper annotation summary bundles; unified scope resolution logic (DRY)
- **`find_duplicates`** / **`merge_duplicates`**: Reuse Zotero's native dedup engine, dry-run by default, merged leftovers go to trash; truncated result disclosure
- **`batch_update_tags`**: Batch add/remove/rename (rename uses `Zotero.Tags.rename` preserving item associations), dry-run previews impact
- **`extract_identifier_from_pdf`**: Extract identifiers from full-text cache — DOI frequency voting + arXiv ID extraction
- **`find_doi`**: CrossRef title-based DOI reverse lookup, title similarity fused scoring (with diacritic folding), dry-run by default
- **`enrich_item_metadata`**: Fill missing fields from doi.org CSL-JSON + OpenAlex, field-level merge rules, dry-run by default
- **`manage_pdf_resolvers`**: Register Sci-Hub / Anna's Archive etc. into Zotero's native `findPDFs.resolvers` pref
- **`reload_plugin`** / **`install_plugin_from_url`**: Deployment loop, guarded by eval gate; `self_upgrade` flag

### Search Enhancements
- Zero-result fallback ladder, responses annotated with `fallback`
- Semantic search hybrid mode: RRF fusion + query-adaptive weights; keyword leg degradation noted, date field keeps year fallback

### Grey-Literature PDF Download
- **Sci-Hub / Anna's Archive support**: Preferences panel toggle + mirror list management (11 built-in defaults, add/remove/reset), bidirectional sync with Zotero's native resolver pref
- Three entry points: preferences panel, MCP tool, native right-click "Find Available PDF"
- Relaxed PDF link selectors for mirror DOM variance
- **Sci-Hub download proxy**: PAC data-url mode proxying only grey-source domains (default port 7890), normal traffic direct

### Developer Experience
- `scripts/deploy-live.mjs`: One-click deploy, xpi base64 via `run_javascript` write + `install_plugin_from_url` self-upgrade, ~5s reconnect to new version
- In-process **selfTest harness** (26 scenarios full-stack regression, driven via `run_javascript`)
- Pure-function unit tests (70 cases, `test/*.test.cjs`, Node.js direct run, no framework)
- Eval boundary tests: timeout clamp, UTF-16 surrogate truncation, circular reference returns
- GitHub Actions CI: tag push auto build + Release + update.json; release notes auto-extracted from CHANGELOG

### Fixes
- **Chinese request body mojibake**: HTTP read layer changed to raw byte collection + single-pass decoding, dense CJK bodies no longer trigger -32700 parse errors
- Tool execution errors return `result.isError` instead of JSON-RPC `-32603` (MCP spec compliance)
- Protocol version negotiation instead of hardcoded value
- When `write.enabled` is off, `tools/list` hides collection write tools (no more "listed but not callable")
- Basic fields correctly placed per item type (conference paper venue → proceedingsTitle); date zero-pad formatting
- Subtitle splitting heuristic tightened to ≥3 tokens
- `buildResolver` ignores explicit `undefined` keys
- selfTest uses privileged XHR (fetch silently drops forbidden headers)
- Protocol version string unified globally

### Internationalization
- Full en / zh-CN / de / es / fr / ja six-language support

---

**Upstream baseline**: cookjohn/zotero-mcp v1.5.0 (27 tools, MCP server embedded in Zotero plugin, hand-written `nsIServerSocket` HTTP, port 23120). Upstream archive at `refs/AI-plugins/zotero-mcp-cookjohn` submodule.
