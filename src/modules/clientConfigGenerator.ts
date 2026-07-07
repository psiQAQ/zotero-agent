/**
 * Client Configuration Generator for MCP Server
 * Generates JSON configurations for different AI clients.
 * Every config carries the PSK as an `Authorization: Bearer <psk>` header
 * (falls back to a `<YOUR_PSK>` placeholder when the token isn't available).
 */

declare let ztoolkit: ZToolkit;
import { getString } from "../utils/locale";

const PSK_PLACEHOLDER = "<YOUR_PSK>";

export interface ClientConfig {
  name: string;
  displayName: string;
  description: string;
  configTemplate: (port: number, serverName?: string, psk?: string) => any;
  renderConfig?: (port: number, serverName?: string, psk?: string) => string;
  configLanguage?: string;
  getInstructions?: (port?: number) => string[];
}

export class ClientConfigGenerator {
  private static readonly CLIENT_CONFIGS: ClientConfig[] = [
    {
      name: "codex-desktop",
      displayName: "Codex App",
      description: "OpenAI Codex desktop app (GUI: Settings → MCP Servers → Add server)",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        "MCP server name": serverName,
        "Transport": "Streamable HTTP",
        "URL": `http://127.0.0.1:${port}/mcp`,
        "Header · Authorization": `Bearer ${psk || PSK_PLACEHOLDER}`,
        "Header · Content-Type": "application/json"
      }),
      getInstructions: () => getString("codex-desktop-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "codex",
      displayName: "Codex CLI",
      description: "OpenAI Codex command line interface",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcp_servers: {
          [serverName]: {
            enabled: true,
            url: `http://127.0.0.1:${port}/mcp`,
            http_headers: {
              Authorization: `Bearer ${psk || PSK_PLACEHOLDER}`,
              "Content-Type": "application/json"
            }
          }
        }
      }),
      renderConfig: (port: number, serverName = "zotero-mcp", psk?: string) => {
        // TOML bare key allows A-Za-z0-9_- , only quote when needed
        const key = /^[A-Za-z0-9_-]+$/.test(serverName)
          ? serverName
          : `"${ClientConfigGenerator.escapeTomlBasicString(serverName)}"`;
        return `[mcp_servers.${key}]
enabled = true
url = "http://127.0.0.1:${port}/mcp"
http_headers = { Authorization = "Bearer ${psk || PSK_PLACEHOLDER}", "Content-Type" = "application/json" }`;
      },
      configLanguage: "toml",
      getInstructions: () => getString("codex-cli-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "claude-code",
      displayName: "Claude Code",
      description: "Anthropic's Claude Code CLI tool",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        type: "http",
        url: `http://127.0.0.1:${port}/mcp`,
        headers: {
          Authorization: `Bearer ${psk || PSK_PLACEHOLDER}`,
          "Content-Type": "application/json"
        }
      }),
      renderConfig: (port: number, serverName = "zotero-mcp", psk?: string) => {
        return `claude mcp add --transport http ${serverName} http://127.0.0.1:${port}/mcp --scope user --header "Authorization: Bearer ${psk || PSK_PLACEHOLDER}" --header "Content-Type: application/json"`;
      },
      configLanguage: "bash",
      getInstructions: (port: number = 23120) => [
        "══════════════════════════════════════════════════════════",
        "  Claude Code MCP 配置指南",
        "══════════════════════════════════════════════════════════",
        "",
        "▶ 添加服务器（复制上方命令执行即可）",
        "──────────────────────────────────────────────────────────",
        "   上方命令已带 PSK 认证头（Authorization: Bearer）。",
        "   PSK 从本插件偏好页的 PSK 字段复制；命令里的占位会自动填入当前 PSK。",
        "",
        "   在本项目目录内运行、且只想当前项目可用时，去掉 `--scope user`。",
        "",
        "▶ 管理命令",
        "──────────────────────────────────────────────────────────",
        "   查看已添加:   claude mcp list",
        `   查看详情:     claude mcp get ${"zotero-mcp"}`,
        "   移除服务器:   claude mcp remove zotero-mcp",
        "   检查状态:     /mcp (在 Claude Code 中)",
        "",
        "▶ 前提条件",
        "──────────────────────────────────────────────────────────",
        "   ✓ Zotero 必须正在运行",
        "   ✓ MCP 插件服务已启用",
        "   ✓ 添加后无需重启 Claude Code",
        "",
        "══════════════════════════════════════════════════════════"
      ]
    },
    {
      name: "claude-desktop",
      displayName: "Claude Desktop",
      description: "Anthropic's Claude Desktop application",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcpServers: {
          [serverName]: {
            command: "npx",
            args: ["mcp-remote", `http://127.0.0.1:${port}/mcp`, "--header", `Authorization: Bearer ${psk || PSK_PLACEHOLDER}`],
            env: {}
          }
        }
      }),
      getInstructions: () => getString("claude-desktop-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "cline-vscode",
      displayName: "Cline (VS Code)",
      description: "Cline extension for Visual Studio Code",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcpServers: {
          [serverName]: {
            command: "npx",
            args: ["mcp-remote", `http://127.0.0.1:${port}/mcp`, "--header", `Authorization: Bearer ${psk || PSK_PLACEHOLDER}`],
            env: {},
            alwaysAllow: ["*"],
            disabled: false
          }
        }
      }),
      getInstructions: () => getString("cline-vscode-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "continue-dev",
      displayName: "Continue.dev",
      description: "Continue coding assistant",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        experimental: {
          modelContextProtocolServers: [
            {
              name: serverName,
              transport: {
                type: "stdio",
                command: "npx",
                args: ["mcp-remote", `http://127.0.0.1:${port}/mcp`, "--header", `Authorization: Bearer ${psk || PSK_PLACEHOLDER}`]
              }
            }
          ]
        }
      }),
      getInstructions: () => getString("continue-dev-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "cursor",
      displayName: "Cursor",
      description: "AI-powered code editor",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcpServers: {
          [serverName]: {
            command: "npx",
            args: ["mcp-remote", `http://127.0.0.1:${port}/mcp`, "--header", `Authorization: Bearer ${psk || PSK_PLACEHOLDER}`],
            env: {}
          }
        }
      }),
      getInstructions: () => getString("cursor-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "cherry-studio",
      displayName: "Cherry Studio",
      description: "AI assistant desktop application",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcpServers: {
          [serverName]: {
            type: "streamableHttp",
            url: `http://127.0.0.1:${port}/mcp`,
            headers: {
              Authorization: `Bearer ${psk || PSK_PLACEHOLDER}`,
              "Content-Type": "application/json"
            }
          }
        }
      }),
      getInstructions: () => getString("cherry-studio-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "gemini-cli",
      displayName: "Gemini CLI",
      description: "Google Gemini command line interface",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcpServers: {
          [serverName]: {
            httpUrl: `http://127.0.0.1:${port}/mcp`,
            headers: {
              Authorization: `Bearer ${psk || PSK_PLACEHOLDER}`,
              "Content-Type": "application/json"
            },
            timeout: 60000,
            trust: true
          }
        }
      }),
      getInstructions: () => getString("gemini-cli-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "chatbox",
      displayName: "Chatbox",
      description: "Desktop AI chat application",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcpServers: {
          [serverName]: {
            url: `http://127.0.0.1:${port}/mcp`,
            headers: {
              Authorization: `Bearer ${psk || PSK_PLACEHOLDER}`
            }
          }
        }
      }),
      getInstructions: () => getString("chatbox-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "workbuddy",
      displayName: "WorkBuddy",
      description: "Desktop AI assistant",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcpServers: {
          [serverName]: {
            command: "npx",
            args: ["mcp-remote", `http://127.0.0.1:${port}/mcp`, "--header", `Authorization: Bearer ${psk || PSK_PLACEHOLDER}`],
            env: {}
          }
        }
      }),
      getInstructions: () => getString("workbuddy-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "trae-ai",
      displayName: "Trae AI",
      description: "AI-powered development assistant",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcpServers: {
          [serverName]: {
            command: "npx",
            args: ["mcp-remote", `http://127.0.0.1:${port}/mcp`, "--header", `Authorization: Bearer ${psk || PSK_PLACEHOLDER}`],
            env: {}
          }
        }
      }),
      getInstructions: () => getString("trae-ai-instructions").split("\n").filter(s => s.trim())
    },
    {
      name: "qwen-code",
      displayName: "Qwen Code",
      description: "Qwen Code CLI - AI-powered coding assistant",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        mcpServers: {
          [serverName]: {
            command: "npx",
            args: ["mcp-remote", `http://127.0.0.1:${port}/mcp`, "--header", `Authorization: Bearer ${psk || PSK_PLACEHOLDER}`],
            env: {}
          }
        }
      }),
      getInstructions: (port: number = 23120) => [
        "1. Use Qwen Code's MCP add command (PSK from the plugin preferences panel):",
        `   qwen mcp add zotero-mcp http://127.0.0.1:${port}/mcp -t http -H 'Authorization: Bearer <YOUR_PSK>' -H 'Content-Type: application/json' --trust`,
        "",
        "2. Verify the server was added:",
        "   qwen mcp list",
        "",
        "3. Start using the tools with @ syntax:",
        "   Example: /analyze @zotero:search_library term:\"machine learning\"",
        "",
        "4. Use /mcp command to verify MCP server is active",
        "",
        "Note: Ensure Zotero is running and the MCP plugin server is enabled",
        "Configuration file location: ~/.qwen/settings.json or .qwen/settings.json"
      ]
    },
    {
      name: "custom-http",
      displayName: "自定义 HTTP 客户端",
      description: "通用 HTTP MCP 客户端配置",
      configTemplate: (port: number, serverName = "zotero-mcp", psk?: string) => ({
        name: serverName,
        description: "Zotero Agent Server - Research management and citation tools",
        transport: {
          type: "http",
          endpoint: `http://127.0.0.1:${port}/mcp`,
          method: "POST",
          headers: {
            Authorization: `Bearer ${psk || PSK_PLACEHOLDER}`,
            "Content-Type": "application/json"
          }
        },
        capabilities: {
          tools: true,
          resources: false,
          prompts: false
        },
        connectionTest: `curl -X POST http://127.0.0.1:${port}/mcp -H "Authorization: Bearer ${psk || PSK_PLACEHOLDER}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}'`
      }),
      getInstructions: () => getString("custom-http-instructions").split("\n").filter(s => s.trim())
    }
  ];

  static getAvailableClients(): ClientConfig[] {
    return this.CLIENT_CONFIGS;
  }

  static generateConfig(clientName: string, port: number, serverName?: string, psk?: string): string {
    const client = this.CLIENT_CONFIGS.find(c => c.name === clientName);
    if (!client) {
      throw new Error(`Unsupported client: ${clientName}`);
    }

    if (client.renderConfig) {
      return client.renderConfig(port, serverName || "zotero-mcp", psk);
    }

    const config = client.configTemplate(port, serverName || "zotero-mcp", psk);
    return JSON.stringify(config, null, 2);
  }

  static getInstructions(clientName: string, port?: number): string[] {
    const client = this.CLIENT_CONFIGS.find(c => c.name === clientName);
    return client?.getInstructions?.(port) || [];
  }

  static generateFullGuide(clientName: string, port: number, serverName?: string, psk?: string): string {
    const client = this.CLIENT_CONFIGS.find(c => c.name === clientName);
    if (!client) {
      throw new Error(`Unsupported client: ${clientName}`);
    }

    const config = this.generateConfig(clientName, port, serverName, psk);
    const instructions = this.getInstructions(clientName, port);
    const actualServerName = serverName || "zotero-mcp";
    const codeLanguage = client.configLanguage || "json";

    return `${getString("config-guide-header", { args: { clientName: client.displayName } })}

${getString("config-guide-server-info")}
${getString("config-guide-server-name", { args: { serverName: actualServerName } })}
${getString("config-guide-server-port", { args: { port: port.toString() } })}
${getString("config-guide-server-endpoint", { args: { port: port.toString() } })}

${getString("config-guide-json-header")}
\`\`\`${codeLanguage}
${config}
\`\`\`

${getString("config-guide-steps-header")}
${instructions.map(instruction => instruction).join('\n')}

${getString("config-guide-tools-header")}
${getString("config-guide-tools-list")}

${getString("config-guide-troubleshooting-header")}
${getString("config-guide-troubleshooting-list")}

${getString("config-guide-generated-time", { args: { time: new Date().toLocaleString() } })}
`;
  }

  private static escapeTomlBasicString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  static async copyToClipboard(text: string): Promise<boolean> {
    try {
      // Try Zotero's built-in clipboard API first
      if (typeof Zotero !== 'undefined' && Zotero.Utilities && Zotero.Utilities.Internal && Zotero.Utilities.Internal.copyTextToClipboard) {
        Zotero.Utilities.Internal.copyTextToClipboard(text);
        return true;
      }

      // Try standard clipboard API
      const globalNav = (globalThis as any).navigator;
      if (globalNav && globalNav.clipboard) {
        await globalNav.clipboard.writeText(text);
        return true;
      }

      // Try with global document
      if (typeof ztoolkit !== 'undefined' && ztoolkit.getGlobal) {
        const globalWindow = ztoolkit.getGlobal('window');
        if (globalWindow && globalWindow.document) {
          const textArea = globalWindow.document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          globalWindow.document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          const result = globalWindow.document.execCommand('copy');
          globalWindow.document.body.removeChild(textArea);
          return result;
        }
      }

      return false;
    } catch (error) {
      ztoolkit.log(`[ClientConfigGenerator] Failed to copy to clipboard: ${error}`, "error");
      return false;
    }
  }
}
