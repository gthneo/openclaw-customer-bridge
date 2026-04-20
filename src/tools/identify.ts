import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";
import { findByExternalUserid, findByWxid, findByUnionid, upsertCustomer } from "../customer_map/repository.js";
import { scoreCandidates } from "../customer_map/matcher.js";

const Params = Type.Object({
  external_userid: Type.Optional(Type.String()),
  wxid: Type.Optional(Type.String()),
  unionid: Type.Optional(Type.String()),
  avatar_phash: Type.Optional(Type.String()),
  nicknames: Type.Optional(Type.Array(Type.String())),
});

export function createIdentifyTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer.identify",
    label: "客户身份解析",
    description: "Resolve a customer identity (external_userid / wxid / unionid) to a unified primary_id, with confidence and source list.",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      if (params.external_userid) {
        const hit = findByExternalUserid(ctx.db, params.external_userid);
        if (hit) return jsonResult({ primary_id: hit.primary_id, confidence: 1, sources: ["external_userid"], merged: false });
      }
      if (params.wxid) {
        const hit = findByWxid(ctx.db, params.wxid);
        if (hit) return jsonResult({ primary_id: hit.primary_id, confidence: 1, sources: ["wxid"], merged: false });
      }
      if (params.unionid) {
        const hit = findByUnionid(ctx.db, params.unionid);
        if (hit) return jsonResult({ primary_id: hit.primary_id, confidence: 1, sources: ["unionid"], merged: false });
      }

      const candidates = scoreCandidates(ctx.db, params);
      const auto = ctx.config.mergeThresholdAuto ?? 0.9;
      const review = ctx.config.mergeThresholdReview ?? 0.5;
      const top = candidates[0];
      if (top && top.score >= auto) {
        return jsonResult({ primary_id: top.row.primary_id, confidence: top.score, sources: ["auto_match"], merged: true, evidence: top.evidence });
      }
      if (top && top.score >= review) {
        return jsonResult({ primary_id: top.row.primary_id, confidence: top.score, sources: ["needs_review"], merged: false, evidence: top.evidence });
      }

      const primary_id = params.external_userid ?? params.wxid ?? params.unionid ?? `pending:${Date.now()}`;
      upsertCustomer(ctx.db, {
        primary_id,
        external_userid: params.external_userid ?? null,
        wxid_legacy: params.wxid ?? null,
        unionid: params.unionid ?? null,
        avatar_phash: params.avatar_phash ?? null,
        nickname_set: JSON.stringify(params.nicknames ?? []),
        confidence: params.external_userid || params.wxid || params.unionid ? 1 : 0,
      });
      return jsonResult({ primary_id, confidence: 1, sources: ["new"], merged: false });
    },
  };
}
