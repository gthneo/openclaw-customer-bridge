import { Type } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";
import { callWechatTool, extractText, extractWechatMcpEndpoint } from "../wechat/mcp_client.js";

const Params = Type.Object({});

export function createHealthTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer_health",
    label: "健康检查",
    description: "Probe both data sources: customer_map sqlite + wechat MCP server (.193). Returns row counts and per-source ok/reason. Use this when other customer_* tools start returning timeout / connection errors.",
    parameters: Params,
    async execute() {
      const out: Record<string, unknown> = {};

      try {
        const customers = ctx.db.prepare("SELECT COUNT(*) AS n FROM customer_map").get() as { n: number };
        const groups = ctx.db.prepare("SELECT COUNT(*) AS n FROM groupchat_index").get() as { n: number };
        out.customer_map = { ok: true, customers: customers.n, groupchats: groups.n };
      } catch (e) {
        out.customer_map = { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }

      const cfg = ctx.api.runtime.config.loadConfig();
      const serverName = ctx.config.wechatMcpServerName ?? "wechat";
      const serverConfig = (cfg.mcp as { servers?: Record<string, unknown> } | undefined)?.servers?.[serverName];
      if (!serverConfig) {
        out.wechat_mcp = { ok: false, reason: `mcp.servers.${serverName} not configured` };
      } else {
        const endpoint = extractWechatMcpEndpoint(serverConfig);
        if (!endpoint) {
          out.wechat_mcp = { ok: false, reason: `cannot extract URL/headers from mcp.servers.${serverName}` };
        } else {
          const t0 = Date.now();
          try {
            const r = await callWechatTool(endpoint, "health", {});
            out.wechat_mcp = { ok: true, url: endpoint.url, latency_ms: Date.now() - t0, payload: extractText(r).slice(0, 500) };
          } catch (e) {
            out.wechat_mcp = { ok: false, url: endpoint.url, latency_ms: Date.now() - t0, reason: e instanceof Error ? e.message : String(e) };
          }
        }
      }

      out.wecom_api = { ok: !!(ctx.config.wecomCorpId && ctx.config.wecomSecret), corpid_set: !!ctx.config.wecomCorpId, secret_set: !!ctx.config.wecomSecret };

      return jsonResult(out);
    },
  };
}
