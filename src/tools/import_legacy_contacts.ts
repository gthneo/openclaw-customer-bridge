import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";
import { callWechatTool, extractText, extractWechatMcpEndpoint } from "../wechat/mcp_client.js";
import { parseContactsText, type ParsedContact } from "../wechat/parse_contacts.js";

const Params = Type.Object({
  query: Type.Optional(Type.String({ default: "", description: "Optional substring filter passed through to wechat MCP get_contacts" })),
  limit: Type.Optional(Type.Number({ default: 50000, description: "Max contacts to fetch in one batch (wechat MCP has no pagination cursor)" })),
  dry_run: Type.Optional(Type.Boolean({ default: false, description: "If true, parse but do not write to customer_map" })),
});

interface NicknameSetEnvelope {
  nicks: string[];
  remark?: string;
  source: "wechat-decrypt-import";
  imported_at: number;
}

export function createImportLegacyContactsTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer_import_legacy_contacts",
    label: "导入历史微信好友",
    description: "READ-ONLY pull from the wechat MCP server (.193 wechat-decrypt) and bulk-upsert into customer_map keyed by wxid_legacy. Skip rows that already have wxid_legacy set; never modifies the source. Returns import counts.",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      const serverName = ctx.config.wechatMcpServerName ?? "wechat";
      const serverConfig = (ctx.api.config.mcp as { servers?: Record<string, unknown> } | undefined)?.servers?.[serverName];
      if (!serverConfig) {
        return jsonResult({ ok: false, reason: `mcp.servers.${serverName} not configured` });
      }
      const endpoint = extractWechatMcpEndpoint(serverConfig);
      if (!endpoint) {
        return jsonResult({ ok: false, reason: `cannot extract URL/headers from mcp.servers.${serverName}` });
      }

      const result = await callWechatTool(endpoint, "get_contacts", {
        query: params.query ?? "",
        limit: params.limit ?? 50000,
      });
      const text = extractText(result);
      const parsed = parseContactsText(text);

      if (params.dry_run) {
        return jsonResult({
          ok: true,
          dry_run: true,
          total_reported: parsed.total_reported,
          parsed_count: parsed.contacts.length,
          sample: parsed.contacts.slice(0, 5),
        });
      }

      const now = Math.floor(Date.now() / 1000);
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      const findByWxid = ctx.db.prepare("SELECT primary_id FROM customer_map WHERE wxid_legacy = ?");
      const insert = ctx.db.prepare(`INSERT INTO customer_map
        (primary_id, external_userid, wxid_legacy, unionid, phone_hash, avatar_phash, nickname_set, confidence, bridge_method, merged_from, created_at, updated_at)
        VALUES (?, NULL, ?, NULL, NULL, NULL, ?, 1, NULL, '[]', ?, ?)`);
      const updateRemarkNick = ctx.db.prepare(`UPDATE customer_map SET nickname_set = ?, updated_at = ? WHERE primary_id = ?`);

      const tx = ctx.db.transaction((contacts: ParsedContact[]) => {
        for (const c of contacts) {
          if (!c.wxid) {
            skipped++;
            continue;
          }
          const envelope: NicknameSetEnvelope = {
            nicks: c.nickname ? [c.nickname] : [],
            remark: c.remark,
            source: "wechat-decrypt-import",
            imported_at: now,
          };
          const env_json = JSON.stringify(envelope);
          const existing = findByWxid.get(c.wxid) as { primary_id: string } | undefined;
          if (existing) {
            updateRemarkNick.run(env_json, now, existing.primary_id);
            updated++;
          } else {
            insert.run(c.wxid, c.wxid, env_json, now, now);
            inserted++;
          }
        }
      });
      tx(parsed.contacts);

      return jsonResult({
        ok: true,
        total_reported: parsed.total_reported,
        parsed_count: parsed.contacts.length,
        inserted,
        updated,
        skipped,
      });
    },
  };
}
