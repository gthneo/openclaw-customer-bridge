import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";

const Params = Type.Object({
  limit: Type.Optional(Type.Number({ default: 20, description: "Page size, default 20, max 200" })),
  offset: Type.Optional(Type.Number({ default: 0 })),
  only_with_external_userid: Type.Optional(Type.Boolean({ default: false })),
  only_with_wxid_legacy: Type.Optional(Type.Boolean({ default: false })),
  only_with_unionid: Type.Optional(Type.Boolean({ default: false })),
});

interface CustomerRowSummary {
  primary_id: string;
  display_name: string;
  remark: string | null;
  nicknames: string[];
  external_userid: string | null;
  wxid_legacy: string | null;
  unionid: string | null;
  confidence: number;
  bridge_method: string | null;
  created_at_unix: number;
  updated_at_unix: number;
}

function decodeNicknameSet(raw: string | null): { nicks: string[]; remark: string | null } {
  if (!raw) return { nicks: [], remark: null };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { nicks: parsed.filter((s) => typeof s === "string"), remark: null };
    if (parsed && typeof parsed === "object") {
      const nicks = Array.isArray(parsed.nicks) ? parsed.nicks.filter((s: unknown): s is string => typeof s === "string") : [];
      const remark = typeof parsed.remark === "string" ? parsed.remark : null;
      return { nicks, remark };
    }
  } catch { /* fall through */ }
  return { nicks: [], remark: null };
}

function summarize(row: Record<string, unknown>): CustomerRowSummary {
  const { nicks, remark } = decodeNicknameSet(row.nickname_set as string | null);
  const display_name = remark || nicks[0] || (row.wxid_legacy as string | null) || (row.external_userid as string | null) || (row.primary_id as string);
  return {
    primary_id: row.primary_id as string,
    display_name,
    remark,
    nicknames: nicks,
    external_userid: (row.external_userid as string | null) ?? null,
    wxid_legacy: (row.wxid_legacy as string | null) ?? null,
    unionid: (row.unionid as string | null) ?? null,
    confidence: typeof row.confidence === "number" ? row.confidence : 0,
    bridge_method: (row.bridge_method as string | null) ?? null,
    created_at_unix: typeof row.created_at === "number" ? row.created_at : 0,
    updated_at_unix: typeof row.updated_at === "number" ? row.updated_at : 0,
  };
}

export function createListCustomersTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer_list",
    label: "客户列表",
    description: "Paginated browse of customer_map. Returns compact rows suitable for display in TUI: primary_id, display_name (remark > nickname > wxid), and identity bridges. Supports filtering by which bridge IDs are populated.",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
      const offset = Math.max(params.offset ?? 0, 0);
      const where: string[] = [];
      if (params.only_with_external_userid) where.push("external_userid IS NOT NULL");
      if (params.only_with_wxid_legacy) where.push("wxid_legacy IS NOT NULL");
      if (params.only_with_unionid) where.push("unionid IS NOT NULL");
      const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const total = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM customer_map ${whereClause}`).get() as { n: number }).n;
      const rows = ctx.db.prepare(`SELECT * FROM customer_map ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(limit, offset) as Record<string, unknown>[];

      return jsonResult({
        total,
        limit,
        offset,
        returned: rows.length,
        rows: rows.map(summarize),
      });
    },
  };
}
