/**
 * Executes user-supplied JavaScript inside the current (privileged) context
 * and returns a structured, JSON-safe result. No Zotero imports — the caller
 * injects Zotero/ZoteroPane/ztoolkit via `globals` so this stays unit-testable.
 */
export interface EvalResult {
  result: any;
  logs: string[];
  error: { message: string; stack?: string } | null;
  timedOut?: boolean;
  truncated?: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;
// Aligns with the HTTP layer's 100KB compact-JSON threshold (streamableMCPServer).
const MAX_RESULT_CHARS = 100_000;

class EvalTimeout extends Error {
  constructor(public ms: number) {
    super(`timeout after ${ms}ms`);
  }
}

export async function runUserJavaScript(
  code: string,
  globals: Record<string, any>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<EvalResult> {
  const logs: string[] = [];
  const fmt = (a: any[]) =>
    a
      .map((x) => {
        if (typeof x === "string") return x;
        try {
          return JSON.stringify(x);
        } catch {
          return String(x);
        }
      })
      .join(" ");
  const consoleShim = {
    log: (...a: any[]) => logs.push(fmt(a)),
    info: (...a: any[]) => logs.push(fmt(a)),
    warn: (...a: any[]) => logs.push("[warn] " + fmt(a)),
    error: (...a: any[]) => logs.push("[error] " + fmt(a)),
  };

  const scope: Record<string, any> = { ...globals, console: consoleShim };
  const names = Object.keys(scope);
  const values = names.map((n) => scope[n]);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as any;

  try {
    const fn = new AsyncFunction(...names, code);
    const ms = Math.min(Math.max(Math.floor(timeoutMs) || DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
    let timer: any;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EvalTimeout(ms)), ms);
    });
    let raw: any;
    try {
      raw = await Promise.race([fn(...values), timeout]);
    } finally {
      clearTimeout(timer);
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(raw === undefined ? null : raw);
    } catch {
      serialized = JSON.stringify(String(raw));
    }
    if (serialized.length > MAX_RESULT_CHARS) {
      return {
        result: serialized.slice(0, MAX_RESULT_CHARS),
        logs,
        truncated: true,
        error: {
          message: `Result truncated to ${MAX_RESULT_CHARS} chars (was ${serialized.length}). Return only the fields you need, e.g. map/filter before returning.`,
        },
      };
    }
    return { result: JSON.parse(serialized), logs, error: null };
  } catch (e: any) {
    if (e instanceof EvalTimeout) {
      return {
        result: null,
        logs,
        timedOut: true,
        error: {
          message: `Timed out after ${e.ms}ms — the code may still be running inside Zotero. Do not blindly re-send write operations; verify state first. Pass a larger timeout_ms (max ${MAX_TIMEOUT_MS}) for long library sweeps.`,
        },
      };
    }
    return { result: null, logs, error: { message: e?.message ?? String(e), stack: e?.stack } };
  }
}
