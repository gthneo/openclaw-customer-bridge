import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";

const Params = Type.Object({
  query: Type.String({ minLength: 1, description: "Substring searched against nickname_set (remark + nicknames) and ID columns. Case-sensitive (sqlite default LIKE)." }),
  limit: Type.Optional(Type.Number({ default: 20, description: "Max results, default 20, max 200" })),
});

interface SearchHit {
  primary_id: string;
  display_name: string;
  remark: string | null;
  nicknames: string[];
  wxid_legacy: string | null;
  external_userid: string | null;
  matched_in: string[];
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

export function createSearchCustomersTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer_search",
    label: "客户搜索",
    description: "Search customer_map for a substring across nickname_set (remark + nickname), wxid_legacy, external_userid, unionid. Returns up to `limit` matches with the field that triggered the match.",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
      const q = params.query;
      const like = `%${q.replace(/[\\_%]/g, (m) => "\\" + m)}%`;
      const rows = ctx.db.prepare(`SELECT * FROM customer_map
        WHERE nickname_set LIKE ? ESCAPE '\\'
           OR wxid_legacy LIKE ? ESCAPE '\\'
           OR external_userid LIKE ? ESCAPE '\\'
           OR unionid LIKE ? ESCAPE '\\'
           OR primary_id LIKE ? ESCAPE '\\'
        ORDER BY updated_at DESC LIMIT ?`).all(like, like, like, like, like, limit) as Record<string, unknown>[];

      const hits: SearchHit[] = rows.map((row) => {
        const { nicks, remark } = decodeNicknameSet(row.nickname_set as string | null);
        const matched_in: string[] = [];
        if (remark && remark.includes(q)) matched_in.push("remark");
        if (nicks.some((n) => n.includes(q))) matched_in.push("nickname");
        if ((row.wxid_legacy as string | null)?.includes(q)) matched_in.push("wxid_legacy");
        if ((row.external_userid as string | null)?.includes(q)) matched_in.push("external_userid");
        if ((row.unionid as string | null)?.includes(q)) matched_in.push("unionid");
        if ((row.primary_id as string).includes(q)) matched_in.push("primary_id");
        const display_name = remark || nicks[0] || (row.wxid_legacy as string | null) || (row.external_userid as string | null) || (row.primary_id as string);
        return {
          primary_id: row.primary_id as string,
          display_name,
          remark,
          nicknames: nicks,
          wxid_legacy: (row.wxid_legacy as string | null) ?? null,
          external_userid: (row.external_userid as string | null) ?? null,
          matched_in,
        };
      });

      return jsonResult({ query: q, returned: hits.length, hits });
    },
  };
}
