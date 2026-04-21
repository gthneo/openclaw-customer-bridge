import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";
import { callWechatTool, extractText, extractWechatMcpEndpoint } from "../wechat/mcp_client.js";

const Params = Type.Object({
  primary_id: Type.String(),
  limit: Type.Optional(Type.Number({ default: 50, description: "Max messages, default 50" })),
  offset: Type.Optional(Type.Number({ default: 0, description: "Offset for pagination, default 0" })),
  start_time: Type.Optional(Type.String({ default: "", description: "ISO date or YYYY-MM-DD; empty = no lower bound" })),
  end_time: Type.Optional(Type.String({ default: "", description: "ISO date or YYYY-MM-DD; empty = no upper bound" })),
});

export function createLegacyHistoryTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer_legacy_history",
    label: "历史聊天回溯",
    description: "READ-ONLY pull of historical chat messages for a primary_id from the wechat-decrypt MCP server. Requires wxid_legacy bound to the primary_id. Returns the raw text payload from wechat MCP get_chat_history. Never writes to the source.",
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

      const args: Record<string, unknown> = {
        chat_name: row.wxid_legacy,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      };
      if (params.start_time) args.start_time = params.start_time;
      if (params.end_time) args.end_time = params.end_time;

      try {
        const result = await callWechatTool(endpoint, "get_chat_history", args);
        const text = extractText(result);
        return jsonResult({ wxid_legacy: row.wxid_legacy, primary_id: params.primary_id, messages_text: text });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return jsonResult({
          wxid_legacy: row.wxid_legacy,
          primary_id: params.primary_id,
          messages_text: "",
          ok: false,
          reason: `wechat MCP call failed: ${msg}`,
        });
      }
    },
  };
}
