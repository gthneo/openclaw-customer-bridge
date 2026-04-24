import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";
import { callWechatTool, extractText, extractWechatMcpEndpoint } from "../wechat/mcp_client.js";
import { parseChatHistoryText, renderSummaryText } from "../wechat/parse_chat_history.js";

const Params = Type.Object({
  primary_id: Type.String(),
  limit: Type.Optional(Type.Number({ default: 20, description: "Max messages, default 20 (was 50; reduced to keep TUI from hitting message-too-large)" })),
  offset: Type.Optional(Type.Number({ default: 0 })),
  start_time: Type.Optional(Type.String({ default: "", description: "ISO date or YYYY-MM-DD; empty = no lower bound" })),
  end_time: Type.Optional(Type.String({ default: "", description: "ISO date or YYYY-MM-DD; empty = no upper bound" })),
  format: Type.Optional(Type.Union([
    Type.Literal("text"),
    Type.Literal("summary"),
    Type.Literal("json"),
  ], { default: "summary", description: "text=raw passthrough, summary=compact each line + strip 链接 noise (default), json=structured array" })),
  max_chars: Type.Optional(Type.Number({ default: 8000, description: "Hard cap on returned text size (text/summary mode); excess truncated with notice" })),
  per_msg_chars: Type.Optional(Type.Number({ default: 200, description: "summary mode: per-message char cap" })),
});

export function createLegacyHistoryTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer_legacy_history",
    label: "历史聊天回溯",
    description: "READ-ONLY pull of historical chat messages for a primary_id from the wechat-decrypt MCP server. Requires wxid_legacy bound to the primary_id. Default format=summary keeps responses small (good for TUI / reasoning). Use format=text for raw passthrough, format=json for structured iteration. Never writes to the source.",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      const row = ctx.db.prepare("SELECT wxid_legacy FROM customer_map WHERE primary_id = ?").get(params.primary_id) as
        | { wxid_legacy: string | null }
        | undefined;
      if (!row?.wxid_legacy) {
        return jsonResult({ ok: false, messages_text: "", reason: "no wxid_legacy bound to this primary_id" });
      }
      const cfg = ctx.api.runtime.config.loadConfig();
      const serverName = ctx.config.wechatMcpServerName ?? "wechat";
      const serverConfig = (cfg.mcp as { servers?: Record<string, unknown> } | undefined)?.servers?.[serverName];
      if (!serverConfig) {
        return jsonResult({ ok: false, messages_text: "", reason: `mcp.servers.${serverName} not configured` });
      }
      const endpoint = extractWechatMcpEndpoint(serverConfig);
      if (!endpoint) {
        return jsonResult({ ok: false, messages_text: "", reason: `cannot extract URL/headers from mcp.servers.${serverName}` });
      }

      const args: Record<string, unknown> = {
        chat_name: row.wxid_legacy,
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      };
      if (params.start_time) args.start_time = params.start_time;
      if (params.end_time) args.end_time = params.end_time;

      let raw: string;
      try {
        const result = await callWechatTool(endpoint, "get_chat_history", args);
        raw = extractText(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return jsonResult({
          ok: false,
          wxid_legacy: row.wxid_legacy,
          primary_id: params.primary_id,
          messages_text: "",
          reason: `wechat MCP call failed: ${msg}`,
        });
      }

      const format = params.format ?? "summary";
      const maxChars = params.max_chars ?? 8000;
      const perMsgChars = params.per_msg_chars ?? 200;

      if (format === "json") {
        const parsed = parseChatHistoryText(raw);
        return jsonResult({
          ok: true,
          wxid_legacy: row.wxid_legacy,
          primary_id: params.primary_id,
          format: "json",
          header: parsed.header,
          message_count: parsed.messages.length,
          messages: parsed.messages,
        });
      }

      let body: string;
      if (format === "text") {
        body = raw;
      } else {
        // summary
        const parsed = parseChatHistoryText(raw);
        body = renderSummaryText(parsed, perMsgChars);
      }

      let truncated = false;
      if (body.length > maxChars) {
        body = body.slice(0, maxChars) + `\n…[truncated at ${maxChars} chars; pass max_chars to lift]`;
        truncated = true;
      }

      return jsonResult({
        ok: true,
        wxid_legacy: row.wxid_legacy,
        primary_id: params.primary_id,
        format,
        truncated,
        size_bytes: body.length,
        messages_text: body,
      });
    },
  };
}
