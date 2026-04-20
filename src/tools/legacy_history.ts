import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";
import { callWechatTool, extractText, extractWechatMcpEndpoint } from "../wechat/mcp_client.js";

const Params = Type.Object({
  primary_id: Type.String(),
  limit: Type.Optional(Type.Number({ default: 50 })),
  before_unix: Type.Optional(Type.Number()),
});

export function createLegacyHistoryTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer.legacy_history",
    label: "历史聊天回溯",
    description: "READ-ONLY pull of historical chat messages for a primary_id from the wechat-decrypt MCP server. Requires wxid_legacy bound to the primary_id. Returns the raw text payload from get_chat_history. Never writes to the source.",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      const row = ctx.db.prepare("SELECT wxid_legacy FROM customer_map WHERE primary_id = ?").get(params.primary_id) as
        | { wxid_legacy: string | null }
        | undefined;
      if (!row?.wxid_legacy) {
        return jsonResult({ messages_text: "", reason: "no wxid_legacy bound to this primary_id" });
      }
      const cfg = ctx.api.runtime.config.loadConfig();
      const serverName = ctx.config.wechatMcpServerName ?? "wechat";
      const serverConfig = (cfg.mcp as { servers?: Record<string, unknown> } | undefined)?.servers?.[serverName];
      if (!serverConfig) {
        return jsonResult({ messages_text: "", reason: `mcp.servers.${serverName} not configured` });
      }
      const endpoint = extractWechatMcpEndpoint(serverConfig);
      if (!endpoint) {
        return jsonResult({ messages_text: "", reason: `cannot extract URL/headers from mcp.servers.${serverName}` });
      }

      const args: Record<string, unknown> = { talker: row.wxid_legacy, limit: params.limit ?? 50 };
      if (typeof params.before_unix === "number") args.before = params.before_unix;
      const result = await callWechatTool(endpoint, "get_chat_history", args);
      const text = extractText(result);
      return jsonResult({ wxid_legacy: row.wxid_legacy, primary_id: params.primary_id, messages_text: text });
    },
  };
}
