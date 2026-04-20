import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";

const Params = Type.Object({
  primary_id: Type.String(),
});

function safeParse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export function createShowCustomerTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer.show",
    label: "客户详情",
    description: "Return the full customer_map row for a given primary_id, including parsed nickname_set and merged_from history. Returns {found: false} if the primary_id is unknown.",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      const row = ctx.db.prepare("SELECT * FROM customer_map WHERE primary_id = ?").get(params.primary_id) as Record<string, unknown> | undefined;
      if (!row) return jsonResult({ found: false, primary_id: params.primary_id });
      return jsonResult({
        found: true,
        primary_id: row.primary_id,
        external_userid: row.external_userid ?? null,
        wxid_legacy: row.wxid_legacy ?? null,
        unionid: row.unionid ?? null,
        phone_hash: row.phone_hash ?? null,
        avatar_phash: row.avatar_phash ?? null,
        nickname_set: safeParse(row.nickname_set as string | null),
        confidence: row.confidence ?? 0,
        bridge_method: row.bridge_method ?? null,
        merged_from: safeParse(row.merged_from as string | null),
        created_at_unix: row.created_at,
        updated_at_unix: row.updated_at,
      });
    },
  };
}
