// Install a local XPI into the live Zotero (reached via the zotero MCP) in one
// shot: reads the PSK from the local Claude MCP config, base64-ships the XPI
// through the run_javascript tool into the remote /tmp, then self-upgrades.
// Two uses:
//   node scripts/deploy-live.mjs               # dev debug: install the freshly built XPI (run `npm run build` first)
//   node scripts/deploy-live.mjs path/to.xpi   # install any local XPI (e.g. one a user downloaded)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const XPI = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../.scaffold/build/zotero-agent.xpi", import.meta.url));
if (!existsSync(XPI)) throw new Error(`XPI not found: ${XPI}`);
const REMOTE_PATH = "/tmp/zotero-agent-deploy.xpi";

const claudeJson = `${process.env.USERPROFILE || process.env.HOME}/.claude.json`;
const cfg = JSON.parse(readFileSync(claudeJson, "utf8"));
function findZotero(o) {
  if (!o || typeof o !== "object") return null;
  if (o.zotero?.url && o.zotero?.headers?.Authorization) return o.zotero;
  for (const v of Object.values(o)) {
    const hit = findZotero(v);
    if (hit) return hit;
  }
  return null;
}
const z = findZotero(cfg);
if (!z) throw new Error(`zotero MCP config not found in ${claudeJson}`);

async function callTool(name, args) {
  const resp = await fetch(z.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: z.headers.Authorization },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const json = await resp.json();
  const text = json?.result?.content?.[0]?.text ?? JSON.stringify(json);
  if (json?.result?.isError) throw new Error(`${name} failed: ${text.slice(0, 300)}`);
  return text;
}

const b64 = readFileSync(XPI).toString("base64");
const code = [
  `const b64 = ${JSON.stringify(b64)};`,
  `const bin = atob(b64);`,
  `const bytes = new Uint8Array(bin.length);`,
  `for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);`,
  `await IOUtils.write(${JSON.stringify(REMOTE_PATH)}, bytes);`,
  `const stat = await IOUtils.stat(${JSON.stringify(REMOTE_PATH)});`,
  `return { written: bytes.length, onDisk: stat.size };`,
].join("\n");

console.log("shipping", b64.length, "b64 chars →", REMOTE_PATH);
console.log(await callTool("run_javascript", { code, timeout_ms: 120000 }));
console.log(await callTool("install_plugin_from_url", { url: `file://${REMOTE_PATH}`, self_upgrade: true }));
console.log("self-upgrade scheduled — wait ~5s, then verify the addon version via run_javascript/AddonManager.");
