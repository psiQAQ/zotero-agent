import { StreamableMCPServer } from "./streamableMCPServer";
import { serverPreferences } from "./serverPreferences";
import { testMCPIntegration } from "./mcpTest";
import { extractBearerToken, tokensMatch, extractOriginHeader, isOriginAllowed } from "./authGuard";
import { findHeaderEnd, parseContentLength } from "./httpByteReader";
import { LATEST_PROTOCOL_VERSION } from "./mcpProtocol";

declare let ztoolkit: ZToolkit;

/**
 * Helper to get UTF-8 byte length of a string
 */
function getByteLength(str: string): number {
  // Use TextEncoder for accurate UTF-8 byte count
  try {
    return new TextEncoder().encode(str).length;
  } catch {
    // Fallback for environments without TextEncoder
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
      const charCode = str.charCodeAt(i);
      if (charCode < 0x80) bytes += 1;
      else if (charCode < 0x800) bytes += 2;
      else if (charCode < 0xd800 || charCode >= 0xe000) bytes += 3;
      else { // surrogate pair
        i++;
        bytes += 4;
      }
    }
    return bytes;
  }
}

/**
 * Slice string by UTF-8 byte length without splitting multibyte characters.
 */
function sliceByUtf8Bytes(str: string, maxBytes: number): string {
  if (maxBytes <= 0 || !str) {
    return "";
  }

  let bytes = 0;
  let end = 0;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    let charBytes = 0;

    if (code < 0x80) {
      charBytes = 1;
    } else if (code < 0x800) {
      charBytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        charBytes = 4;
      } else {
        charBytes = 3;
      }
    } else {
      charBytes = 3;
    }

    if (bytes + charBytes > maxBytes) {
      break;
    }

    bytes += charBytes;
    end = i + 1;

    // Skip low surrogate after consuming a valid pair.
    if (charBytes === 4) {
      i++;
      end = i + 1;
    }
  }

  return str.substring(0, end);
}

/**
 * Write string to output stream with correct UTF-8 encoding
 */
function writeStringToStream(output: any, str: string): void {
  const converterStream = Cc["@mozilla.org/intl/converter-output-stream;1"]
    .createInstance(Ci.nsIConverterOutputStream);
  (converterStream as any).init(output, "UTF-8", 0, 0);
  converterStream.writeString(str);
  converterStream.flush();
}

export class HttpServer {
  public static testServer() {
    Zotero.debug("Static testServer method called.");
  }
  private serverSocket: any;
  private isRunning: boolean = false;
  private mcpServer: StreamableMCPServer | null = null;
  private port: number = 8080;
  private activeSessions: Map<string, { createdAt: Date; lastActivity: Date; }> = new Map();
  private keepAliveTimeout: number = 30000; // 30 seconds
  private sessionTimeout: number = 300000; // 5 minutes
  private sessionCleanupInterval: ReturnType<typeof setInterval> | null = null;
  // Track active transports to close them on shutdown
  private activeTransports: Set<any> = new Set();

  public isServerRunning(): boolean {
    return this.isRunning;
  }

  public start(port: number) {
    // 进程诊断
    try {
      const pid = (Cc["@mozilla.org/xre/app-info;1"]?.getService(Ci.nsIXULRuntime) as any)?.processID;
      ztoolkit.log(`[HttpServer] start() called - port: ${port}, PID: ${pid}, isRunning: ${this.isRunning}`);
    } catch (e) {
      ztoolkit.log(`[HttpServer] start() called - port: ${port}, isRunning: ${this.isRunning}`);
    }

    if (this.isRunning) {
      ztoolkit.log("[HttpServer] Server is already running, skipping start");
      return;
    }

    if (!port || isNaN(port) || port < 1 || port > 65535) {
      const errorMsg = `[HttpServer] Invalid port number: ${port}. Port must be between 1 and 65535.`;
      ztoolkit.log(errorMsg, 'error');
      throw new Error(errorMsg);
    }

    try {
      this.port = port;
      ztoolkit.log(`[HttpServer] Attempting to start server on port ${port}...`);

      this.serverSocket = Cc[
        "@mozilla.org/network/server-socket;1"
      ].createInstance(Ci.nsIServerSocket);

      // init方法参数：端口，是否仅允许回环地址，backlog队列大小
      // loopbackOnly=true: 仅监听 127.0.0.1
      // loopbackOnly=false: 监听 0.0.0.0 (所有接口)
      const loopbackOnly = !serverPreferences.isRemoteAccessAllowed();
      Zotero.debug(`[HttpServer] Binding to ${loopbackOnly ? '127.0.0.1' : '0.0.0.0'}:${port}`);
      this.serverSocket.init(port, loopbackOnly, -1);
      this.serverSocket.asyncListen(this.listener);
      this.isRunning = true;

      Zotero.debug(
        `[HttpServer] Successfully started HTTP server on port ${port}`,
      );

      // Initialize integrated MCP server if enabled
      this.initializeMCPServer();
      
      // Start session cleanup timer
      this.startSessionCleanup();
    } catch (e) {
      const errorMsg = `[HttpServer] Failed to start server on port ${port}: ${e}`;
      Zotero.debug(errorMsg);
      this.stop();
      throw new Error(errorMsg);
    }
  }

  private initializeMCPServer(): void {
    try {
      this.mcpServer = new StreamableMCPServer();
      ztoolkit.log(`[HttpServer] Integrated MCP server initialized`);
    } catch (error) {
      ztoolkit.log(`[HttpServer] Failed to initialize MCP server: ${error}`);
      // Don't throw error, HTTP server can still work without MCP
    }
  }

  public stop() {
    ztoolkit.log(`[HttpServer] stop() called - isRunning: ${this.isRunning}, hasSocket: ${!!this.serverSocket}`);

    if (!this.isRunning || !this.serverSocket) {
      ztoolkit.log("[HttpServer] Server is not running, nothing to stop");
      return;
    }

    // Stop session cleanup timer FIRST to prevent new cleanup cycles
    ztoolkit.log("[HttpServer] Stopping session cleanup timer...");
    this.stopSessionCleanup();

    // Close all active transports
    ztoolkit.log(`[HttpServer] Closing ${this.activeTransports.size} active transport connections...`);
    for (const transport of this.activeTransports) {
      try {
        transport.close(0);
      } catch (e) {
        // Ignore errors when closing individual transports
      }
    }
    this.activeTransports.clear();
    ztoolkit.log("[HttpServer] All transports closed");

    // Close server socket
    try {
      ztoolkit.log("[HttpServer] Closing server socket...");
      this.serverSocket.close();
      this.isRunning = false;
      ztoolkit.log("[HttpServer] Server socket closed successfully");
    } catch (e) {
      ztoolkit.log(`[HttpServer] Error closing server socket: ${e}`, 'error');
      this.isRunning = false;
    }

    // Clear active sessions
    this.activeSessions.clear();

    // Clean up MCP server
    this.cleanupMCPServer();
    ztoolkit.log("[HttpServer] stop() complete");
  }

  private cleanupMCPServer(): void {
    if (this.mcpServer) {
      this.mcpServer = null;
      ztoolkit.log("[HttpServer] MCP server cleaned up");
    }
  }

  /**
   * Generate a unique session ID for MCP connections
   */
  private generateSessionId(): string {
    return 'mcp-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Start session cleanup timer to remove expired sessions
   */
  private startSessionCleanup(): void {
    // Clear any existing interval first
    this.stopSessionCleanup();

    this.sessionCleanupInterval = setInterval(() => {
      const now = new Date();
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (now.getTime() - session.lastActivity.getTime() > this.sessionTimeout) {
          this.activeSessions.delete(sessionId);
          ztoolkit.log(`[HttpServer] Cleaned up expired session: ${sessionId}`);
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Stop session cleanup timer
   */
  private stopSessionCleanup(): void {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
      ztoolkit.log(`[HttpServer] Session cleanup timer stopped`);
    }
  }

  /**
   * Update session activity
   */
  private updateSessionActivity(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Determine if connection should be kept alive based on request
   */
  private shouldKeepAlive(requestText: string, path: string): boolean {
    // Current listener lifecycle handles one request per socket and closes
    // streams in finally. Do not advertise keep-alive for MCP endpoints.
    if (path === "/mcp" || path.startsWith("/mcp/")) {
      return false;
    }
    
    // Check for Connection header in request
    const connectionHeader = requestText.match(/Connection:\s*([^\r\n]+)/i);
    if (connectionHeader && connectionHeader[1].toLowerCase().includes('keep-alive')) {
      return true;
    }
    
    return false;
  }

  /**
   * Build appropriate HTTP headers with session and connection management
   */
  private buildHttpHeaders(result: any, keepAlive: boolean, sessionId?: string): string {
    const baseHeaders = `HTTP/1.1 ${result.status} ${result.statusText}\r\n` +
      `Content-Type: ${result.headers?.["Content-Type"] || "application/json; charset=utf-8"}\r\n`;
    
    let headers = baseHeaders;
    
    // Add session ID for MCP requests
    if (sessionId) {
      headers += `Mcp-Session-Id: ${sessionId}\r\n`;
    }
    
    // Add connection management headers
    if (keepAlive) {
      headers += `Connection: keep-alive\r\n` +
        `Keep-Alive: timeout=${this.keepAliveTimeout / 1000}, max=100\r\n`;
    } else {
      headers += `Connection: close\r\n`;
    }
    
    return headers;
  }

  private listener = {
    onSocketAccepted: async (_socket: any, transport: any) => {
      let input: any = null;
      let output: any = null;

      // Track this transport for cleanup on shutdown
      this.activeTransports.add(transport);

      ztoolkit.log(`[HttpServer] New connection accepted from transport: ${transport.host || 'unknown'}:${transport.port || 'unknown'}`);

      try {
        input = transport.openInputStream(0, 0, 0);
        output = transport.openOutputStream(0, 0, 0);

        // Collect the raw request bytes and decode ONCE at the end. The old
        // path decoded WHILE streaming via nsIConverterInputStream with
        // replacementChar=0 (decode errors throw); when a TCP segment split a
        // multi-byte UTF-8 sequence — near-certain with dense CJK — it threw,
        // and the raw-byte (Latin-1) fallback then spliced UTF-8 bytes into the
        // decoded string, permanently mojibake'ing the body → JSON.parse -32700.
        // A binary stream has no hidden decode buffer, so byte accounting is exact.
        const bis = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
          Ci.nsIBinaryInputStream,
        );
        bis.setInputStream(input);

        let requestText = "";
        let totalBytesRead = 0;
        let contentLength = 0;
        const maxRequestSize = 1024 * 1024; // 1MB max request size
        let waitAttempts = 0;
        const maxWaitAttempts = 50;

        // One growing byte buffer. The header terminator (\r\n\r\n) is scanned
        // incrementally over just the header prefix — each pass rescans only a
        // 3-byte tail overlap plus the new chunk, and findHeaderEnd short-circuits
        // on the first match — so scanning is O(bytes-before-terminator), never
        // O(n²). Once the body start is known, completion is pure byte counting
        // with NO further scanning, so a 1MB body costs nothing to scan.
        const buf: number[] = [];
        let bodyStartByte = -1; // index of the first body byte (after \r\n\r\n)
        let headerScanFrom = 0; // next index to scan for the terminator

        try {
          while (totalBytesRead < maxRequestSize) {
            // Done once headers are parsed AND the declared body has arrived.
            if (bodyStartByte >= 0 && totalBytesRead - bodyStartByte >= contentLength) {
              break;
            }

            const available = input.available();
            if (available === 0) {
              // A binary stream reports exactly the socket's readable bytes with
              // NO internal buffer, so available===0 genuinely means "nothing to
              // read yet". Wait briefly for more segments, then give up.
              waitAttempts++;
              if (waitAttempts > maxWaitAttempts) {
                ztoolkit.log(
                  `[HttpServer] Timeout waiting for data after ${waitAttempts} attempts, TotalBytes: ${totalBytesRead}`,
                  "warn",
                );
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 10));
              continue;
            }
            waitAttempts = 0;

            let toRead = Math.min(8192, maxRequestSize - totalBytesRead, available);
            if (bodyStartByte >= 0) {
              // Don't over-read past this request's body into a pipelined next one.
              toRead = Math.min(toRead, contentLength - (totalBytesRead - bodyStartByte));
            }
            if (toRead <= 0) break;

            const bytes = bis.readByteArray(toRead); // number[]
            if (!bytes || bytes.length === 0) break; // EOF
            buf.push(...bytes);
            totalBytesRead += bytes.length;

            // Scan for the header terminator only until it is found.
            if (bodyStartByte < 0) {
              const windowStart = Math.max(0, headerScanFrom);
              const rel = findHeaderEnd(new Uint8Array(buf.slice(windowStart)));
              if (rel >= 0) {
                bodyStartByte = windowStart + rel;
                // Headers are ASCII in practice; UTF-8 decode of the prefix is safe.
                const headerText = new TextDecoder("utf-8").decode(
                  new Uint8Array(buf.slice(0, bodyStartByte)),
                );
                contentLength = parseContentLength(headerText);
              } else {
                // Keep a 3-byte overlap so a terminator split across the next
                // chunk boundary is still caught on the following pass.
                headerScanFrom = Math.max(0, buf.length - 3);
              }
            }
          }
        } catch (readError) {
          ztoolkit.log(
            `[HttpServer] Error reading request: ${readError}, BytesRead: ${totalBytesRead}, InputStream available: ${input?.available ? input.available() : 'N/A'}`,
            "error",
          );
        }

        // Decode the whole message exactly once — no split-multibyte hazard.
        requestText = new TextDecoder("utf-8").decode(new Uint8Array(buf));

        ztoolkit.log(
          `[HttpServer] Total bytes read: ${totalBytesRead}, bodyStartByte: ${bodyStartByte}, contentLength: ${contentLength}, request text length: ${requestText.length}`,
        );

        // Handle empty connections (likely health checks or probes)
        if (totalBytesRead === 0 && requestText.length === 0) {
          ztoolkit.log(
            `[HttpServer] Empty connection detected - likely health check/probe. Closing gracefully.`,
            "info",
          );
          return; // Gracefully close without sending error response
        }

        const requestLine = requestText.split("\r\n")[0];
        ztoolkit.log(
          `[HttpServer] Received request: ${requestLine} (${requestText.length} bytes)`,
        );

        // 验证请求格式
        if (!requestLine || !requestLine.includes("HTTP/")) {
          ztoolkit.log(
            `[HttpServer] Invalid request format - RequestLine: "${requestLine || '<empty>'}", TotalBytes: ${totalBytesRead}, RequestLength: ${requestText.length}, RequestPreview: "${requestText.substring(0, 100).replace(/\r?\n/g, '\\n')}"`,
            "error",
          );
          try {
            const badRequestResult = {
              status: 400,
              statusText: "Bad Request",
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            };
            const badRequestHeaders = this.buildHttpHeaders(badRequestResult, false) +
              "Content-Length: 11\r\n" +
              "\r\n";
            const errorResponse = badRequestHeaders + "Bad Request";
            output.write(errorResponse, errorResponse.length);
          } catch (e) {
            ztoolkit.log(
              `[HttpServer] Error sending bad request response: ${e}`,
              "error",
            );
          }
          ztoolkit.log(
            `[HttpServer] Returned 400 Bad Request due to invalid format. Connection will be closed.`,
            "warn",
          );
          return;
        }

        try {
          const requestParts = requestLine.split(" ");
          const method = requestParts[0];
          const urlPath = requestParts[1];
          const url = new URL(urlPath, "http://127.0.0.1");
          const query = new URLSearchParams(url.search);
          const path = url.pathname;

          // ---- PSK auth guard: protect the MCP execution endpoint only ----
          // tools/list, tools/call, initialize all flow through POST /mcp.
          // Health/status endpoints stay open (they leak only version info).
          if (method === "POST" && path === "/mcp") {
            const origin = extractOriginHeader(requestText);
            if (!isOriginAllowed(origin)) {
              const forbidden = {
                status: 403,
                statusText: "Forbidden",
                headers: { "Content-Type": "application/json; charset=utf-8" },
              };
              const bodyStr = JSON.stringify({ error: "Forbidden: non-loopback Origin" });
              const respHeaders =
                this.buildHttpHeaders(forbidden, false) +
                `Content-Length: ${getByteLength(bodyStr)}\r\n` +
                "\r\n";
              const resp = respHeaders + bodyStr;
              output.write(resp, resp.length);
              ztoolkit.log(`[HttpServer] 403 Forbidden on POST /mcp (Origin: ${origin})`, "warn");
              return;
            }
            const authEnabled =
              Zotero.Prefs.get("extensions.zotero.zotero-agent.auth.enabled", true) !== false;
            if (authEnabled) {
              const expected = String(
                Zotero.Prefs.get("extensions.zotero.zotero-agent.auth.token", true) || "",
              );
              const provided = extractBearerToken(requestText);
              if (!expected || !provided || !tokensMatch(provided, expected)) {
                const unauthorized = {
                  status: 401,
                  statusText: "Unauthorized",
                  headers: { "Content-Type": "application/json; charset=utf-8" },
                };
                const bodyStr = JSON.stringify({
                  error: "Unauthorized: missing or invalid bearer token",
                });
                const respHeaders =
                  this.buildHttpHeaders(unauthorized, false) +
                  `Content-Length: ${getByteLength(bodyStr)}\r\n` +
                  "\r\n";
                const resp = respHeaders + bodyStr;
                output.write(resp, resp.length);
                ztoolkit.log("[HttpServer] 401 Unauthorized on POST /mcp (bad/missing PSK)", "warn");
                return;
              }
            }
          }

          // 提取POST请求的body
          let requestBody = "";
          if (method === "POST") {
            const bodyStart = requestText.indexOf("\r\n\r\n");
            if (bodyStart !== -1) {
              const rawBody = requestText.substring(bodyStart + 4);

              // Only consume the current request body. Extra bytes may belong to
              // a pipelined next request on the same socket.
              if (contentLength > 0) {
                requestBody = sliceByUtf8Bytes(rawBody, contentLength);
                const rawBodyBytes = getByteLength(rawBody);
                if (rawBodyBytes > contentLength) {
                  ztoolkit.log(
                    `[HttpServer] Detected trailing bytes after request body (${rawBodyBytes - contentLength} bytes), ignoring extra data for this request`,
                    "warn",
                  );
                }
              } else {
                requestBody = rawBody;
              }
            }
          }

          // Extract existing session ID or create new one for MCP requests
          let sessionId: string | undefined;
          const mcpSessionHeader = requestText.match(/Mcp-Session-Id:\s*([^\r\n]+)/i);
          
          if (path === "/mcp" || (path.startsWith("/mcp/") && !path.includes(".well-known"))) {
            if (mcpSessionHeader && mcpSessionHeader[1]) {
              sessionId = mcpSessionHeader[1].trim();
              this.updateSessionActivity(sessionId);
              ztoolkit.log(`[HttpServer] Using existing MCP session: ${sessionId}`);
            } else {
              sessionId = this.generateSessionId();
              this.activeSessions.set(sessionId, {
                createdAt: new Date(),
                lastActivity: new Date()
              });
              ztoolkit.log(`[HttpServer] Created new MCP session: ${sessionId}`);
            }
          }

          // Determine if connection should be kept alive
          const keepAlive = this.shouldKeepAlive(requestText, path);
          ztoolkit.log(`[HttpServer] Keep-alive for ${path}: ${keepAlive}`);

          let result;

          if (path === "/mcp") {
            if (method === "POST") {
              // Handle MCP requests via streamable HTTP
              if (this.mcpServer) {
                result = await this.mcpServer.handleMCPRequest(requestBody);
              } else {
                result = {
                  status: 503,
                  statusText: "Service Unavailable",
                  headers: { "Content-Type": "application/json; charset=utf-8" },
                  body: JSON.stringify({ error: "MCP server not enabled" }),
                };
              }
            } else if (method === "GET") {
              // Handle GET request to MCP endpoint - show endpoint info
              result = {
                status: 200,
                statusText: "OK",
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({
                  endpoint: "/mcp",
                  protocol: "MCP (Model Context Protocol)",
                  transport: "Streamable HTTP",
                  version: LATEST_PROTOCOL_VERSION,
                  description: "This endpoint accepts MCP protocol requests via POST method",
                  usage: {
                    method: "POST",
                    contentType: "application/json",
                    body: "MCP JSON-RPC 2.0 formatted requests"
                  },
                  status: this.mcpServer ? "available" : "disabled",
                  documentation: "Send POST requests with MCP protocol messages to interact with Zotero data"
                }),
              };
            } else {
              result = {
                status: 405,
                statusText: "Method Not Allowed",
                headers: { 
                  "Content-Type": "application/json; charset=utf-8",
                  "Allow": "GET, POST"
                },
                body: JSON.stringify({ 
                  error: `Method ${method} not allowed. Use GET for info or POST for MCP requests.` 
                }),
              };
            }
          } else if (path === "/mcp/status") {
            // MCP server status endpoint
            if (this.mcpServer) {
              result = {
                status: 200,
                statusText: "OK",
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify(this.mcpServer.getStatus()),
              };
            } else {
              result = {
                status: 503,
                statusText: "Service Unavailable",
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({ error: "MCP server not enabled", enabled: false }),
              };
            }
          } else if (path === "/mcp/capabilities" || path === "/capabilities" || path === "/help") {
            // Comprehensive capabilities discovery endpoint
            result = {
              status: 200,
              statusText: "OK",
              headers: { "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify(await this.getCapabilities()),
            };
          } else if (path === "/test/mcp") {
            const testResult = await testMCPIntegration();
            result = {
              status: 200,
              statusText: "OK",
              headers: { "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify(testResult),
            };
          } else if (path.startsWith("/ping")) {
            const pingResult = {
              status: 200,
              statusText: "OK",
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            };
            const pingHeaders = this.buildHttpHeaders(pingResult, keepAlive) +
              "Content-Length: 4\r\n" +
              "\r\n";
            const response = pingHeaders + "pong";
            output.write(response, response.length);
            return;
          } else {
            const notFoundBody = JSON.stringify({ error: "Not Found" });
            const notFoundBytes = getByteLength(notFoundBody);
            const notFoundResult = {
              status: 404,
              statusText: "Not Found",
              headers: { "Content-Type": "application/json; charset=utf-8" }
            };
            const notFoundHeaders = this.buildHttpHeaders(notFoundResult, false) +
              `Content-Length: ${notFoundBytes}\r\n` +
              "\r\n";
            const response = notFoundHeaders + notFoundBody;
            output.write(response, response.length);
            return;
          }

          const body = result.body || "";

          // Calculate UTF-8 byte length for Content-Length header
          const byteLength = getByteLength(body);

          // Build headers with session and connection management
          const finalHeaders = this.buildHttpHeaders(result, keepAlive, sessionId) +
            `Content-Length: ${byteLength}\r\n` +
            "\r\n";

          ztoolkit.log(`[HttpServer] Sending response: ${byteLength} bytes (chars: ${body.length})`);

          // Write headers (ASCII only, so length is safe)
          output.write(finalHeaders, finalHeaders.length);

          // Write body using converter stream for proper UTF-8 encoding
          if (byteLength > 0) {
            writeStringToStream(output, body);
          }

          // Ensure data is flushed
          try {
            output.flush();
          } catch (flushError) {
            // Some streams don't support flush, ignore
          }
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          ztoolkit.log(
            `[HttpServer] Error in request handling: ${error.message}`,
            "error",
          );
          const errorBody = JSON.stringify({ error: error.message });
          // Use getByteLength for accurate Content-Length with non-ASCII characters
          const errorByteLength = getByteLength(errorBody);
          const errorResult = {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "Content-Type": "application/json; charset=utf-8" }
          };
          const errorHeaders = this.buildHttpHeaders(errorResult, false) +
            `Content-Length: ${errorByteLength}\r\n` +
            "\r\n";
          output.write(errorHeaders, errorHeaders.length);
          writeStringToStream(output, errorBody);
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        ztoolkit.log(
          `[HttpServer] Error handling request: ${error.message}`,
          "error",
        );
        ztoolkit.log(`[HttpServer] Error stack: ${error.stack}`, "error");
        try {
          if (!output) {
            output = transport.openOutputStream(0, 0, 0);
          }
          const criticalErrorResult = {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          };
          const criticalErrorHeaders = this.buildHttpHeaders(criticalErrorResult, false) +
            "Content-Length: 21\r\n" +
            "\r\n";
          const errorResponse = criticalErrorHeaders + "Internal Server Error";
          output.write(errorResponse, errorResponse.length);
          ztoolkit.log(`[HttpServer] Error response sent`);
        } catch (closeError) {
          ztoolkit.log(
            `[HttpServer] Error sending error response: ${closeError}`,
            "error",
          );
        }
      } finally {
        // Remove transport from tracking
        this.activeTransports.delete(transport);

        // 确保资源清理
        try {
          if (output) {
            output.close();
            ztoolkit.log(`[HttpServer] Output stream closed`);
          }
        } catch (e) {
          ztoolkit.log(
            `[HttpServer] Error closing output stream: ${e}`,
            "error",
          );
        }

        try {
          if (input) {
            input.close();
            ztoolkit.log(`[HttpServer] Input stream closed`);
          }
        } catch (e) {
          ztoolkit.log(
            `[HttpServer] Error closing input stream: ${e}`,
            "error",
          );
        }
      }
    },
    onStopListening: (socket: any, status: any) => {
      ztoolkit.log(`[HttpServer] onStopListening called, status: ${status}`);
      this.isRunning = false;
    },
  };

/**
 * Get comprehensive capabilities and API documentation
 */
private async getCapabilities() {
  const toolsResp = this.mcpServer
    ? await this.mcpServer.handleMCPRequest(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }))
    : null;
  // ponytail: derive tool list from source of truth instead of maintaining a stale copy
  const tools = toolsResp ? (JSON.parse(toolsResp.body).result?.tools ?? []) : [];
  return {
    serverInfo: {
      name: "Zotero Agent",
      version: "1.1.0",
      description: "Model Context Protocol integration for Zotero research management",
      author: "Zotero Agent Team",
      repository: "https://github.com/zotero/zotero-mcp",
      documentation: "https://github.com/zotero/zotero-mcp/blob/main/README.md"
    },
    protocols: {
      mcp: {
        version: LATEST_PROTOCOL_VERSION,
        transport: "streamable-http",
        endpoint: "/mcp",
        description: "Full MCP protocol support for AI clients"
      },
      rest: {
        version: "1.1.0",
        description: "REST API for direct HTTP access",
        baseUrl: `http://127.0.0.1:${this.port}`
      }
    },
    capabilities: {
      search: {
        library: true,
        annotations: true,
        collections: true,
        fullText: true,
        advanced: true
      },
      retrieval: {
        items: true,
        annotations: true,
        pdfContent: true,
        collections: true,
        notes: true
      },
      formats: {
        json: true,
        text: true,
        markdown: false
      }
    },
    tools,
    endpoints: {
      mcp: {
        "/mcp": {
          method: "POST",
          description: "MCP protocol endpoint for AI clients",
          contentType: "application/json",
          protocol: `MCP ${LATEST_PROTOCOL_VERSION}`
        }
      },
      rest: {
        "/ping": {
          method: "GET",
          description: "Health check endpoint",
          response: "text/plain"
        },
        "/mcp/status": {
          method: "GET", 
          description: "MCP server status and capabilities",
          response: "application/json"
        },
        "/capabilities": {
          method: "GET",
          description: "This endpoint - comprehensive API documentation",
          response: "application/json"
        },
        "/help": {
          method: "GET",
          description: "Alias for /capabilities",
          response: "application/json"
        },
        "/test/mcp": {
          method: "GET",
          description: "MCP integration testing endpoint",
          response: "application/json"
        }
      }
    },
    usage: {
      gettingStarted: {
        mcp: {
          description: "Connect via MCP protocol",
          steps: [
            "Configure MCP client to connect to this server",
            "Use streamable HTTP transport",
            "Send MCP requests to /mcp endpoint",
            "Available tools will be listed via tools/list method"
          ]
        },
        rest: {
          description: "Use REST API directly", 
          examples: [
            "GET /capabilities - Get this documentation",
            "GET /ping - Health check",
            "GET /mcp/status - Check MCP server status"
          ]
        }
      },
      authentication: "Bearer PSK required on POST /mcp (Authorization header); see plugin preferences for the token",
      rateLimit: "No rate limiting currently implemented",
      cors: "CORS headers not currently set"
    },
    timestamp: new Date().toISOString(),
    status: this.mcpServer ? "ready" : "mcp-disabled"
  };
}
}

// 进程诊断 - 记录 HttpServer 单例创建时机
try {
  const runtime = Cc["@mozilla.org/xre/app-info;1"]?.getService(Ci.nsIXULRuntime) as any;
  ztoolkit.log(`[HttpServer] Singleton created - PID: ${runtime?.processID}, processType: ${runtime?.processType}`);
} catch (e) { /* ignore */ }

export const httpServer = new HttpServer();
