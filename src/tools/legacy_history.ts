import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";

const Params = Type.Object({
  primary_id: Type.String(),
  limit: Type.Optional(Type.Number({ default: 50 })),
  before_unix: Type.Optional(Type.Number()),
});

export function createLegacyHistoryTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer.legacy_history",
    label: "历史聊天回溯",
    description: "Retrieve historical chat messages for a primary_id from the wechat-decrypt MCP server (read-only).",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      // STUB: should call the registered wechat MCP server (named via config.wechatMcpServerName, default "wechat")
      // Pseudocode:
      //   const mcp = ctx.api.runtime.mcp.getServer(ctx.config.wechatMcpServerName ?? "wechat");
      //   return jsonResult(await mcp.callTool("get_chat_history", { talker: row.wxid_legacy, limit, before }));
      const row = ctx.db.prepare("SELECT wxid_legacy FROM customer_map WHERE primary_id = ?").get(params.primary_id) as
        | { wxid_legacy: string | null }
        | undefined;
      if (!row?.wxid_legacy) {
        return jsonResult({ messages: [], reason: "no wxid_legacy bound to this primary_id" });
      }
      return jsonResult({ messages: [], reason: "stub — wire to wechat MCP server" });
    },
  };
}
