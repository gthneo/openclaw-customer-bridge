import type { PluginContext, ChatClass } from "../types.js";
import { callWecomApi } from "../wecom/access_token.js";
import { classifyChat, KEYWORDS, type ChatFacts } from "./rules.js";

interface GroupChatListResponse {
  errcode?: number;
  errmsg?: string;
  group_chat_list?: Array<{ chat_id: string; status: number }>;
  next_cursor?: string;
}

interface GroupChatGetResponse {
  errcode?: number;
  group_chat?: {
    chat_id: string;
    name: string;
    owner: string;
    create_time: number;
    member_list?: Array<{ userid: string; type: number; join_time?: number }>;
    admin_list?: Array<{ userid: string }>;
    notice?: string;
  };
}

let runnerStarted = false;

export function startIndexRunner(ctx: PluginContext): void {
  if (runnerStarted) return;
  runnerStarted = true;
  if (!ctx.config.wecomCorpId || !ctx.config.wecomSecret) return;
  const intervalMs = 60 * 60 * 1000;
  setInterval(() => {
    refresh(ctx).catch((e) => console.error("[customer-bridge] index refresh failed:", e));
  }, intervalMs);
}

export async function refresh(ctx: PluginContext): Promise<{ refreshed: number; total_seen: number; errors: string[] }> {
  if (!ctx.config.wecomCorpId || !ctx.config.wecomSecret) {
    return { refreshed: 0, total_seen: 0, errors: ["wecomCorpId/wecomSecret not configured"] };
  }

  const errors: string[] = [];
  const seenChatIds = new Set<string>();
  let cursor = "";
  let page = 0;

  while (true) {
    page++;
    const payload: Record<string, unknown> = { status_filter: 0, limit: 100 };
    if (cursor) payload.cursor = cursor;
    let listResp: GroupChatListResponse;
    try {
      listResp = await callWecomApi<GroupChatListResponse>(ctx.config, "externalcontact/groupchat/list", payload);
    } catch (e) {
      errors.push(`list page ${page}: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    for (const item of listResp.group_chat_list ?? []) {
      seenChatIds.add(item.chat_id);
    }
    if (!listResp.next_cursor) break;
    cursor = listResp.next_cursor;
    if (page > 50) {
      errors.push(`pagination > 50 pages, stopping`);
      break;
    }
  }

  const upsert = ctx.db.prepare(`INSERT INTO groupchat_index
    (chat_id, owner, member_count, name, classified_as, raw_json, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      owner = excluded.owner,
      member_count = excluded.member_count,
      name = excluded.name,
      classified_as = excluded.classified_as,
      raw_json = excluded.raw_json,
      refreshed_at = excluded.refreshed_at`);

  const selfUserids = new Set(ctx.config.selfUserids ?? []);
  const now = Math.floor(Date.now() / 1000);
  let refreshed = 0;

  for (const chat_id of seenChatIds) {
    let detail: GroupChatGetResponse;
    try {
      detail = await callWecomApi<GroupChatGetResponse>(ctx.config, "externalcontact/groupchat/get", { chat_id, need_name: 1 });
    } catch (e) {
      errors.push(`get ${chat_id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const gc = detail.group_chat;
    if (!gc) {
      errors.push(`get ${chat_id}: empty group_chat`);
      continue;
    }
    const memberList = gc.member_list ?? [];
    const facts: ChatFacts = {
      chat_id: gc.chat_id,
      source: "wecom_external",
      owner_is_self: selfUserids.size === 0 ? true : selfUserids.has(gc.owner),
      member_count: memberList.length,
      name: gc.name ?? "",
      has_aftersales_keyword: KEYWORDS.aftersales.some((k) => (gc.name ?? "").includes(k)),
      has_cohort_keyword: KEYWORDS.cohort.some((k) => (gc.name ?? "").includes(k)),
      has_project_keyword: KEYWORDS.project.some((k) => (gc.name ?? "").includes(k)),
      has_industry_keyword: KEYWORDS.industry.some((k) => (gc.name ?? "").includes(k)),
      created_at_unix: gc.create_time,
      has_external_member: memberList.some((m) => m.type === 2),
    };
    const chatClass: ChatClass = classifyChat(facts);
    upsert.run(gc.chat_id, gc.owner, memberList.length, gc.name ?? "", chatClass, JSON.stringify(gc), now);
    refreshed++;
    await new Promise((r) => setTimeout(r, 200));
  }

  return { refreshed, total_seen: seenChatIds.size, errors };
}
