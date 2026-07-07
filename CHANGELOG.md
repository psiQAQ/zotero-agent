# Changelog

Forked from [cookjohn/zotero-mcp](https://github.com/cookjohn/zotero-mcp) (upstream v1.5.0, commit `bbaf5cf`, 2026-06-11) and evolved independently.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versioning adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
