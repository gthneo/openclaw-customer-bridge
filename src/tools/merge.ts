import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";

const Params = Type.Object({
  primary_id: Type.String(),
  source_ids: Type.Array(Type.String()),
  bridge_method: Type.Union([
    Type.Literal("manual"),
    Type.Literal("phash"),
    Type.Literal("nickname"),
    Type.Literal("unionid_strict"),
    Type.Literal("phone"),
  ]),
});

export function createMergeTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer.merge",
    label: "客户合并",
    description: "Merge candidate customer rows into one primary_id (after auto-confidence pass or human review).",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      const now = Math.floor(Date.now() / 1000);
      const tx = ctx.db.transaction(() => {
        const primary = ctx.db.prepare("SELECT * FROM customer_map WHERE primary_id = ?").get(params.primary_id) as
          | { merged_from: string }
          | undefined;
        if (!primary) {
          throw new Error(`primary_id ${params.primary_id} not found`);
        }
        const mergedFrom = JSON.parse(primary.merged_from) as string[];
        for (const sid of params.source_ids) {
          if (sid === params.primary_id) continue;
          const source = ctx.db.prepare("SELECT * FROM customer_map WHERE primary_id = ?").get(sid) as
            | Record<string, unknown>
            | undefined;
          if (!source) continue;
          ctx.db.prepare(`UPDATE customer_map SET
            external_userid = COALESCE(external_userid, (SELECT external_userid FROM customer_map WHERE primary_id = ?)),
            wxid_legacy     = COALESCE(wxid_legacy,     (SELECT wxid_legacy     FROM customer_map WHERE primary_id = ?)),
            unionid         = COALESCE(unionid,         (SELECT unionid         FROM customer_map WHERE primary_id = ?)),
            phone_hash      = COALESCE(phone_hash,      (SELECT phone_hash      FROM customer_map WHERE primary_id = ?)),
            bridge_method   = ?,
            updated_at      = ?
            WHERE primary_id = ?`).run(sid, sid, sid, sid, params.bridge_method, now, params.primary_id);
          ctx.db.prepare("DELETE FROM customer_map WHERE primary_id = ?").run(sid);
          mergedFrom.push(sid);
        }
        ctx.db.prepare("UPDATE customer_map SET merged_from = ? WHERE primary_id = ?")
          .run(JSON.stringify(mergedFrom), params.primary_id);
      });
      tx();
      return jsonResult({ ok: true, primary_id: params.primary_id, merged_count: params.source_ids.length });
    },
  };
}
