import type { ChatClass } from "../types.js";

export interface ChatFacts {
  chat_id: string;
  source: "wecom_internal" | "wecom_external" | "wechat_legacy";
  owner_is_self: boolean;
  member_count: number;
  name: string;
  has_supplier_tag?: boolean;
  has_aftersales_keyword?: boolean;
  has_cohort_keyword?: boolean;
  has_project_keyword?: boolean;
  has_industry_keyword?: boolean;
  created_at_unix?: number;
  has_external_member?: boolean;
}

export function classifyChat(f: ChatFacts): ChatClass {
  const now = Math.floor(Date.now() / 1000);

  if (f.source === "wecom_internal") {
    if (!f.has_external_member) return "N1";
    return "N2";
  }

  if (f.source === "wecom_external") {
    if (f.created_at_unix && now - f.created_at_unix <= 7 * 86400) return "X1";
    if (f.has_supplier_tag) return "N2";
    if (f.has_aftersales_keyword) return "G4";
    if (f.has_cohort_keyword && f.member_count > 50) return "G3";
    if (f.has_project_keyword && f.member_count >= 20 && f.member_count <= 50) return "G2";
    if (f.owner_is_self && f.member_count < 20) return "G1";
    return "G2";
  }

  if (f.source === "wechat_legacy") {
    if (f.owner_is_self) return "W1";
    if (f.has_industry_keyword) return "W3";
    return "W2";
  }

  return "UNKNOWN";
}

export const KEYWORDS = {
  aftersales: ["售后", "售后服务", "support"],
  cohort: ["训练营", "期", "课程"],
  project: ["项目", "交付", "PRJ"],
  industry: ["学习", "同业", "交流"],
};
