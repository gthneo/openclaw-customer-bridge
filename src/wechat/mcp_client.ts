import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * READ-ONLY ALLOWLIST. Hard-coded — never broaden without revisiting the
 * project rule "Never write to .193 wechat-decrypt MCP". The personal WeChat
 * account on .193 must remain untouched (any write would risk 封号).
 */
export const WECHAT_MCP_READONLY_TOOLS = new Set<string>([
  "get_recent_sessions",
  "get_chat_history",
  "search_messages",
  "get_contacts",
  "get_contact_tags",
  "get_tag_members",
  "get_new_messages",
  "decode_image",
  "get_chat_images",
  "get_date_stats",
  "health",
]);

export interface WechatMcpEndpoint {
  url: string;
  headers: Record<string, string>;
}

/**
 * Pull the wechat MCP server config out of the openclaw config and normalize
 * it to a {url, headers} shape. Handles both encodings we have seen on .178:
 *   A. {type: "sse", url, headers}
 *   B. {command: "mcp-proxy", args: [url, "--transport", "sse", "-H", k, v]}
 */
export function extractWechatMcpEndpoint(serverConfig: unknown): WechatMcpEndpoint | null {
  if (!serverConfig || typeof serverConfig !== "object") return null;
  const sc = serverConfig as Record<string, unknown>;

  if (sc.type === "sse" && typeof sc.url === "string") {
    const headers = (sc.headers && typeof sc.headers === "object") ? (sc.headers as Record<string, string>) : {};
    return { url: sc.url, headers };
  }

  if (Array.isArray(sc.args)) {
    const args = sc.args as string[];
    let url: string | undefined;
    const headers: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-H" && i + 2 < args.length) {
        headers[args[i + 1]] = args[i + 2];
        i += 2;
        continue;
      }
      if (a === "--transport" && i + 1 < args.length) { i += 1; continue; }
      if (!a.startsWith("-") && !url) url = a;
    }
    if (url) return { url, headers };
  }

  return null;
}

let cachedClient: Client | null = null;
let cachedKey = "";

async function getClient(endpoint: WechatMcpEndpoint): Promise<Client> {
  const key = endpoint.url + "|" + JSON.stringify(endpoint.headers);
  if (cachedClient && cachedKey === key) return cachedClient;
  if (cachedClient) {
    try { await cachedClient.close(); } catch {}
  }
  const headers = endpoint.headers;
  const transport = new SSEClientTransport(new URL(endpoint.url), {
    eventSourceInit: { fetch: ((u: URL | string, init?: RequestInit) => fetch(u as string, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } })) as unknown as typeof fetch },
    requestInit: { headers },
  });
  const client = new Client({ name: "openclaw-customer-bridge", version: "0.3.0" }, { capabilities: {} });
  await client.connect(transport);
  cachedClient = client;
  cachedKey = key;
  return client;
}

export class WechatMcpWriteAttempted extends Error {
  constructor(toolName: string) {
    super(`wechat MCP write tools are forbidden by project rule (attempted: ${toolName}). Allowed: ${[...WECHAT_MCP_READONLY_TOOLS].join(", ")}`);
    this.name = "WechatMcpWriteAttempted";
  }
}

export async function callWechatTool(
  endpoint: WechatMcpEndpoint,
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  if (!WECHAT_MCP_READONLY_TOOLS.has(toolName)) {
    throw new WechatMcpWriteAttempted(toolName);
  }
  const client = await getClient(endpoint);
  return client.callTool({ name: toolName, arguments: args }) as Promise<CallToolResult>;
}

/**
 * Extract the plain-text payload from a CallToolResult. wechat MCP returns its
 * data as `content: [{type: "text", text: "..."}]`. We concatenate all text
 * blocks. Returns "" if there is no text content.
 */
export function extractText(result: CallToolResult): string {
  const content = result.content ?? [];
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof (c as { text?: unknown }).text === "string")
    .map((c) => c.text)
    .join("\n");
}
