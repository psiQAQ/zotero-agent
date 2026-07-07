/**
 * In-process self-test harness, driven by an agent through run_javascript:
 *   await Zotero.ZoteroMCPSelfTest.run('protocol')
 * Suites hit our own HTTP server via in-process fetch — full-stack coverage.
 */

import { LATEST_PROTOCOL_VERSION } from "./mcpProtocol";

interface ScenarioResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  ms: number;
}
export interface SuiteResult {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  scenarios: ScenarioResult[];
  newErrorsInLog: string[];
  logCaptureAvailable: boolean;
}

type SuiteFn = (t: SuiteApi) => Promise<void>;
const suites = new Map<string, SuiteFn>();

export function registerSuite(name: string, fn: SuiteFn): void {
  if (suites.has(name)) throw new Error(`duplicate suite: ${name}`);
  suites.set(name, fn);
}

class SkipScenario extends Error {}

class SuiteApi {
  results: ScenarioResult[] = [];
  async scenario(name: string, fn: () => Promise<void>): Promise<void> {
    const t0 = Date.now();
    try {
      await fn();
      this.results.push({ name, status: "passed", ms: Date.now() - t0 });
    } catch (e: any) {
      const status = e instanceof SkipScenario ? "skipped" : "failed";
      this.results.push({ name, status, error: e?.message ?? String(e), ms: Date.now() - t0 });
    }
  }
  assertEq(actual: any, expected: any, msg = ""): void {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`.trim());
  }
  assertTrue(cond: any, msg = "assertTrue failed"): void {
    if (!cond) throw new Error(msg);
  }
  skip(reason: string): never {
    throw new SkipScenario(reason);
  }
}

function isDebugEnabled(): boolean {
  try {
    const d = (Zotero as any).Debug;
    if (!d) return false;
    const prop = d.isEnabled;
    return typeof prop === "function" ? prop() : !!prop;
  } catch {
    return false;
  }
}

function grabDebugLog(): string {
  try {
    return (Zotero as any).Debug?.getConsoleViewerOutput?.()?.join?.("\n") ?? "";
  } catch {
    return "";
  }
}

export async function runSelfTest(name: string): Promise<SuiteResult> {
  const fn = suites.get(name);
  if (!fn) throw new Error(`unknown suite: ${name}; have: ${[...suites.keys()].join(", ")}`);
  const logAvailable = isDebugEnabled();
  const baseline = logAvailable ? grabDebugLog() : "";
  const api = new SuiteApi();
  try {
    await fn(api);
  } catch (e: any) {
    // Out-of-scenario throw (suite setup/teardown): preserve partial results and record the failure.
    api.results.push({
      name: "<suite setup/teardown>",
      status: "failed",
      error: e?.message ?? String(e),
      ms: 0,
    });
  }
  const after = logAvailable ? grabDebugLog() : "";
  // Only lines appended during the run; if the ring buffer rotated, fall back to the full log.
  const newLines = after.startsWith(baseline) ? after.slice(baseline.length) : after;
  const newErrorsInLog = logAvailable
    ? newLines
        .split("\n")
        .filter((l) => /\berror\b/i.test(l) && /zotero-mcp|StreamableMCP|HttpServer/i.test(l))
        .slice(0, 50)
    : [];
  return {
    suite: name,
    passed: api.results.filter((r) => r.status === "passed").length,
    failed: api.results.filter((r) => r.status === "failed").length,
    skipped: api.results.filter((r) => r.status === "skipped").length,
    scenarios: api.results,
    newErrorsInLog,
    logCaptureAvailable: logAvailable,
  };
}

export function listSuites(): string[] {
  return [...suites.keys()];
}

// ---------------------------------------------------------------- suites

const PREF = "extensions.zotero.zotero-mcp-plugin.";

async function mcpPost(
  body: any,
  opts: { token?: string | null; origin?: string } = {},
): Promise<{ status: number; json: any }> {
  const port = Number(Zotero.Prefs.get(PREF + "mcp.server.port", true)) || 23120;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token =
    opts.token === undefined
      ? String(Zotero.Prefs.get(PREF + "auth.token", true) || "")
      : opts.token;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.origin) {
    // ponytail: fetch silently drops forbidden Origin header — privileged XHR delivers it.
    try {
      const r = await (Zotero as any).HTTP.request("POST", `http://127.0.0.1:${port}/mcp`, {
        headers: { ...headers, Origin: opts.origin },
        body: JSON.stringify(body),
        responseType: "text",
        timeout: 10000,
        successCodes: false,
      });
      let json: any = null;
      try { json = JSON.parse(r.responseText ?? r.response ?? ""); } catch { /* non-JSON body */ }
      return { status: r.status, json };
    } catch (e: any) {
      const status = e?.xmlhttp?.status;
      if (typeof status === "number" && status > 0) {
        let json: any = null;
        try { json = JSON.parse(e.xmlhttp.responseText ?? ""); } catch { /* non-JSON */ }
        return { status, json };
      }
      throw e;
    }
  }
  const resp = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await resp.json();
  } catch {
    // 401/403 bodies are JSON too, but stay defensive against empty bodies
  }
  return { status: resp.status, json };
}

const rpc = (method: string, params: any = {}, id: number = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});

registerSuite("protocol", async (t) => {
  let serverUp = true;
  try {
    await mcpPost(rpc("ping"));
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    await t.scenario("server reachable", async () => t.skip("MCP server not running"));
    return;
  }

  await t.scenario("initialize echoes known protocol version", async () => {
    const r = await mcpPost(
      rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "selftest" } }),
    );
    t.assertEq(r.json?.result?.protocolVersion, "2024-11-05");
  });

  await t.scenario("initialize answers latest for unknown version", async () => {
    const r = await mcpPost(
      rpc("initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "selftest" } }),
    );
    t.assertEq(r.json?.result?.protocolVersion, LATEST_PROTOCOL_VERSION);
  });

  await t.scenario("missing bearer token → 401 (when auth enabled)", async () => {
    const authOn = Zotero.Prefs.get(PREF + "auth.enabled", true) !== false;
    if (!authOn) t.skip("auth disabled");
    const r = await mcpPost(rpc("ping"), { token: null });
    t.assertEq(r.status, 401);
  });

  await t.scenario("non-loopback Origin → 403", async () => {
    const r = await mcpPost(rpc("ping"), { origin: "http://evil.example" });
    t.assertEq(r.status, 403);
  });

  await t.scenario("unknown method → -32601, HTTP 200", async () => {
    const r = await mcpPost(rpc("no/such/method"));
    t.assertEq(r.status, 200);
    t.assertEq(r.json?.error?.code, -32601);
  });

  await t.scenario("unknown tool → -32602", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "no_such_tool", arguments: {} }));
    t.assertEq(r.json?.error?.code, -32602);
  });

  await t.scenario("missing required arg → result.isError, not protocol error", async () => {
    // search_libraries requires q; omitting it throws inside handleToolCall's switch
    // (streamableMCPServer.ts: `throw new Error('q is required')`), which the outer
    // catch wraps as isError:true — a genuine execution failure, not a protocol error.
    const r = await mcpPost(
      rpc("tools/call", { name: "search_libraries", arguments: {} }),
    );
    t.assertEq(r.status, 200);
    t.assertTrue(!r.json?.error, "must not be a JSON-RPC error");
    t.assertEq(r.json?.result?.isError, true);
  });

  await t.scenario("tools/list hides collection write tools when write disabled", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (writeOn) t.skip("write enabled on this profile");
    const r = await mcpPost(rpc("tools/list"));
    const names = (r.json?.result?.tools ?? []).map((x: any) => x.name);
    t.assertTrue(!names.includes("create_collection"), "create_collection must be hidden");
    t.assertTrue(!names.includes("delete_collection"), "delete_collection must be hidden");
  });

  await t.scenario("run_javascript times out honestly", async () => {
    const evalOn = Zotero.Prefs.get(PREF + "eval.enabled", true) === true;
    if (!evalOn) t.skip("eval disabled");
    const r = await mcpPost(
      rpc("tools/call", {
        name: "run_javascript",
        arguments: { code: "await new Promise(() => {});", timeout_ms: 1500 },
      }),
    );
    const payload = JSON.parse(r.json?.result?.content?.[0]?.text ?? "{}");
    t.assertEq(payload.timedOut, true);
  });

  await t.scenario("dev tools hidden when eval disabled", async () => {
    const evalOn = Zotero.Prefs.get(PREF + "eval.enabled", true) === true;
    if (evalOn) t.skip("eval enabled on this profile");
    const r = await mcpPost(rpc("tools/list"));
    const names = (r.json?.result?.tools ?? []).map((x: any) => x.name);
    t.assertTrue(
      !names.includes("reload_plugin") && !names.includes("install_plugin_from_url"),
      "dev tools must be hidden",
    );
  });

  await t.scenario("import_by_identifier is idempotent (skip on second run)", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    const call = () =>
      mcpPost(rpc("tools/call", { name: "import_by_identifier", arguments: { identifier: "10.1038/nature14539" } }));
    const first = JSON.parse((await call()).json.result.content[0].text);
    const second = JSON.parse((await call()).json.result.content[0].text);
    t.assertTrue(first.imported === true || first.skipped === true, "first call lands or finds existing");
    t.assertEq(second.skipped, true, "second call must skip");
  });

  await t.scenario("find_missing_pdfs reports coverage", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "find_missing_pdfs", arguments: { action: "report", limit: 5 } }));
    const payload = JSON.parse(r.json.result.content[0].text);
    t.assertTrue(typeof payload.regularItems === "number" && payload.regularItems >= 0, "regularItems must be a number");
    t.assertEq(payload.withPdf + payload.missingPdf, payload.regularItems, "coverage must sum");
  });

  await t.scenario("check_retractions runs on a tiny scope", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "check_retractions", arguments: { itemKeys: "NOSUCHKEY1" } }));
    if (r.json?.result?.isError) {
      const text = r.json.result.content?.[0]?.text ?? "";
      if (/unreachable/i.test(text)) t.skip("scite unreachable");
      throw new Error(`unexpected tool error: ${text.slice(0, 200)}`);
    }
    const payload = JSON.parse(r.json.result.content[0].text);
    t.assertEq(payload.checked, 0, "bogus key yields zero checked");
  });

  await t.scenario("find_related_papers annotates inLibrary", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "find_related_papers", arguments: { doi: "10.1038/nature14539", limit: 3 } }));
    if (r.json?.result?.isError) {
      const text = r.json.result.content?.[0]?.text ?? "";
      if (/try again later|failed/i.test(text)) t.skip("openalex unreachable");
      throw new Error(`unexpected tool error: ${text.slice(0, 200)}`);
    }
    const payload = JSON.parse(r.json.result.content[0].text);
    t.assertTrue(
      Array.isArray(payload.results) && payload.results.every((x: any) => typeof x.inLibrary === "boolean"),
      "every result must carry a boolean inLibrary",
    );
  });

  await t.scenario("synthesize_annotations requires a scope", async () => {
    const r = await mcpPost(rpc("tools/call", { name: "synthesize_annotations", arguments: {} }));
    t.assertEq(r.json?.result?.isError, true, "unscoped synthesis must be rejected");
  });

  await t.scenario("batch_update_tags refuses unscoped add", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    const r = await mcpPost(rpc("tools/call", { name: "batch_update_tags", arguments: { add: "X" } }));
    t.assertEq(r.json?.result?.isError, true, "unscoped add must be rejected");
    const text = r.json?.result?.content?.[0]?.text ?? "";
    t.assertTrue(/scope/i.test(text), "error must mention scope");
  });

  await t.scenario("merge_duplicates without confirm is a dry-run", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    const r = await mcpPost(
      rpc("tools/call", { name: "merge_duplicates", arguments: { masterKey: "NOSUCHKEY", otherKeys: "NOSUCHKEY2" } }),
    );
    if (r.json?.result?.isError) {
      const text = r.json.result.content?.[0]?.text ?? "";
      t.assertTrue(/not found/i.test(text), "bogus keys must fail loudly before any merge");
    } else {
      const payload = JSON.parse(r.json.result.content[0].text);
      t.assertEq(payload.dryRun, true, "must never merge implicitly");
    }
  });

  await t.scenario("search falls back instead of returning bare empty", async () => {
    const r = await mcpPost(
      rpc("tools/call", { name: "search_library", arguments: { q: "zzzznonexistent qqqq", limit: 3 } }),
    );
    t.assertTrue(!r.json?.error, "search must not be a protocol error");
    const text = r.json?.result?.content?.[0]?.text ?? "";
    // Either the token fallback found something ("fallback") or the ladder exhausted (also labeled).
    t.assertTrue(/fallback/i.test(text), "response must carry fallback labeling");
  });

  await t.scenario("semantic_search hybrid mode does not blow up", async () => {
    const semOn = Zotero.Prefs.get(PREF + "semantic.enabled", true) !== false;
    if (!semOn) t.skip("semantic disabled");
    const r = await mcpPost(
      rpc("tools/call", { name: "semantic_search", arguments: { query: "machine learning survey", topK: 3 } }),
    );
    t.assertTrue(!r.json?.error, "hybrid path must not be a protocol error");
    t.assertTrue(r.json?.result?.isError !== true, "hybrid path must not be a tool error");
  });

  await t.scenario("CJK-dense body survives the read layer (mojibake regression)", async () => {
    const cjk = String.fromCharCode(20013, 25991).repeat(1200); // ~7KB of UTF-8 CJK — the empirical failure zone
    const r = await mcpPost(rpc("ping", { note: cjk }));
    t.assertEq(r.status, 200, "dense CJK body must parse");
    t.assertTrue(!r.json?.error, "must not be -32700");
  });

  await t.scenario("manage_pdf_resolvers round-trips a preset", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    // add → list contains it → remove cleans up
    await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "add", preset: "scihub-se" } }));
    const listed = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "list" } }))).json.result.content[0].text);
    const found = (listed.mcpManaged ?? []).some((r: any) => r.url.includes("sci-hub.se"));
    const rm = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "remove", name: "Sci-Hub", url: "https://sci-hub.se/{doi}" } }))).json.result.content[0].text);
    t.assertTrue(found, "added preset must appear in list");
    t.assertTrue(rm.removed >= 1, "remove must drop the managed resolver");
  });

  await t.scenario("extract_identifier_from_pdf returns a structured result", async () => {
    // Find any regular item with a PDF via search, then scan it. Tolerant: fulltext may not be indexed.
    const s = JSON.parse((await mcpPost(rpc("tools/call", { name: "search_library", arguments: { q: "a", limit: 5 } }))).json.result.content[0].text);
    const withPdf = (s.results ?? []).find((r: any) => (r.attachments ?? []).some((a: any) => a.contentType === "application/pdf"));
    if (!withPdf) t.skip("no item with PDF found in sample");
    const r = JSON.parse((await mcpPost(rpc("tools/call", { name: "extract_identifier_from_pdf", arguments: { itemKey: withPdf.key } }))).json.result.content[0].text);
    t.assertTrue(typeof r.found === "boolean" && Array.isArray(r.scanned), "must return {found, scanned}");
  });

  await t.scenario("find_doi dry-run returns structured result", async () => {
    // pick an item that HAS a DOI so lookup should either match it or skip
    const s = JSON.parse((await mcpPost(rpc("tools/call", { name: "search_library", arguments: { q: "learning", limit: 5 } }))).json.result.content[0].text);
    const it = (s.results ?? [])[0];
    if (!it) t.skip("no items");
    const r = JSON.parse((await mcpPost(rpc("tools/call", { name: "find_doi", arguments: { itemKey: it.key } }))).json.result.content[0].text);
    if (r.error && /unreachable|failed/i.test(JSON.stringify(r))) t.skip("crossref unreachable");
    t.assertTrue("found" in r || "alreadyHasDoi" in r, "must return found/alreadyHasDoi/candidates");
  });

  await t.scenario("enrich_item_metadata dry-run returns a patch", async () => {
    const s = JSON.parse((await mcpPost(rpc("tools/call", { name: "search_library", arguments: { q: "learning", limit: 5 } }))).json.result.content[0].text);
    const withDoi = (s.results ?? []).find((r: any) => r.DOI || (r.attachments && false));
    const it = withDoi || (s.results ?? [])[0];
    if (!it) t.skip("no items");
    const r = JSON.parse((await mcpPost(rpc("tools/call", { name: "enrich_item_metadata", arguments: { itemKey: it.key } }))).json.result.content[0].text);
    if (r.error && /try again later/i.test(JSON.stringify(r))) t.skip("doi.org unreachable");
    t.assertTrue("dryRun" in r || "needsDoi" in r, "must return dryRun patch or needsDoi");
  });

  await t.scenario("manage_pdf_resolvers enable/disable toggles scihub sources", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    const en = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "enable" } }))).json.result.content[0].text);
    const listed = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "list" } }))).json.result.content[0].text);
    const hasScihub = (listed.mcpManaged ?? []).some((r: any) => /sci-hub/.test(r.url));
    const dis = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "disable" } }))).json.result.content[0].text);
    const listed2 = JSON.parse((await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "list" } }))).json.result.content[0].text);
    const noScihub = !(listed2.mcpManaged ?? []).some((r: any) => /sci-hub/.test(r.url));
    t.assertEq(en.scihubEnabled, true, "enable reports enabled");
    t.assertTrue(hasScihub, "sci-hub present after enable");
    t.assertTrue(!!en.greySourceWarning, "enable returns grey-source warning");
    t.assertTrue(noScihub, "sci-hub gone after disable (external kept)");
  });

  await t.scenario("find_missing_pdfs warns when scihub enabled", async () => {
    const writeOn = Zotero.Prefs.get(PREF + "write.enabled", true) === true;
    if (!writeOn) t.skip("write disabled");
    await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "enable" } }));
    // limit:0 → warning is added regardless of actual download; avoids triggering a real
    // Sci-Hub fetch (unreachable on many networks) which would NetworkError the regression.
    const r = JSON.parse((await mcpPost(rpc("tools/call", { name: "find_missing_pdfs", arguments: { action: "fetch", limit: 0 } }))).json.result.content[0].text);
    await mcpPost(rpc("tools/call", { name: "manage_pdf_resolvers", arguments: { action: "disable" } })); // cleanup
    t.assertTrue(!!r.greySourceWarning, "fetch must warn when scihub enabled");
  });
});
