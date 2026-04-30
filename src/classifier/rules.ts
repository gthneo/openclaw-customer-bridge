import type { ChatClass } from "../types.js";

/**
 * Facts a chat needs to be classified into one of 12 ChatClass codes.
 *
 * `source` discriminates the chat's origin platform:
 *   - `wechat_internal`: 个人微信 自己人内部群（自己 + 同事 / 家人 / 合伙人等）
 *   - `wechat_legacy`:    个人微信 客户群（外部客户 + 我方）
 *   - `wecom_internal`:   企业微信 内部群
 *   - `wecom_external`:   企业微信 客户群（含外部联系人）
 */
export interface ChatFacts {
  chat_id: string;
  source: "wecom_internal" | "wecom_external" | "wechat_legacy" | "wechat_internal";
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

/**
 * Classifier context — pluggable so rules can read user / org config without
 * each rule re-parsing PluginContext. Currently only carries `selfUserids`
 * for the 本人是群主 check; will grow as the InternalGroupRule extension
 * points get filled in (group keywords list, activity baselines, etc.).
 */
export interface ClassifierContext {
  selfUserids?: string[];
}

/**
 * One internal-group classification rule. Higher `priority` evaluates first;
 * the first rule whose `test()` returns true wins. The default-bucket rule
 * has priority 0 and `test: () => true`.
 *
 * v1 (2026-04-30) only ships the owner-is-self rule. The structure is in
 * place so the future extension dimensions (size / name keywords / member
 * composition / activity) can drop in without touching `classifyChat()`.
 */
export interface InternalGroupRule {
  /** Higher = evaluated first. Ties resolved by array order. */
  priority: number;
  test: (facts: ChatFacts, ctx: ClassifierContext) => boolean;
  classify: (facts: ChatFacts) => ChatClass;
  /** Short label for debug/logging only. */
  label: string;
}

/**
 * v1 rules for `wechat_internal` 群（自己人微信群）.
 *
 * Per user 2026-04-30 decision: C1 = 本人是群主, C2 = 他人.
 *
 * Reserved extension points (commented; activate when the data + business
 * rules are clear):
 *   - P50 size:        小群 (member_count ≤ 10) ← 重点关注 / 大群
 *   - P50 keywords:    "团队"/"家人"/"客户" 等群名分桶
 *   - P30 composition: 全内部 vs 含外部联系人
 *   - P30 activity:    高频/偶尔（活跃度评分需要 wechat MCP 实时统计）
 *
 * To add a rule: write {priority, test, classify, label} entry, ensure
 * it doesn't conflict with v1 P100 (owner_is_self → C1), and add a test
 * pinning the new behavior.
 */
const INTERNAL_GROUP_RULES: InternalGroupRule[] = [
  {
    priority: 100,
    label: "owner_is_self → C1",
    test: (f) => f.owner_is_self === true,
    classify: () => "C1",
  },
  // ---- Future extension slots (do NOT activate without business sign-off) ----
  // {
  //   priority: 50,
  //   label: "small group (≤10) → C1 default",
  //   test: (f) => f.member_count <= 10,
  //   classify: () => "C1",
  // },
  // {
  //   priority: 50,
  //   label: "name keyword 团队/家人 → C1",
  //   test: (f) => /团队|家人|合伙人/.test(f.name),
  //   classify: () => "C1",
  // },
  {
    priority: 0,
    label: "default → C2 (他人主导)",
    test: () => true,
    classify: () => "C2",
  },
];

function classifyWechatInternal(facts: ChatFacts, ctx: ClassifierContext): ChatClass {
  // Sort rules by priority desc; first match wins. Done at call time so the
  // rules array can be augmented at runtime in the future without re-sorting.
  const sorted = [...INTERNAL_GROUP_RULES].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (rule.test(facts, ctx)) return rule.classify(facts);
  }
  return "UNKNOWN";
}

/**
 * Top-level classifier. Routes by `facts.source` to the per-source ruleset.
 *
 * `ctx` is optional — when omitted, rules that depend on configuration
 * (e.g. selfUserids for cross-checking owner) fall back to whatever the
 * facts already carry. This keeps the function pure / testable.
 */
export function classifyChat(f: ChatFacts, ctx: ClassifierContext = {}): ChatClass {
  const now = Math.floor(Date.now() / 1000);

  if (f.source === "wechat_internal") {
    return classifyWechatInternal(f, ctx);
  }

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
