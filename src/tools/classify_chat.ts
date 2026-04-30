import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";
import type { ChatFacts } from "../classifier/rules.js";
import {
  callWechatTool,
  extractText,
  extractWechatMcpEndpoint,
  type WechatMcpEndpoint,
} from "../wechat/mcp_client.js";
import {
  classifyChatViaIndexOrFetch,
  type ChatFactsFetcher,
} from "./classify_chat_core.js";

const Params = Type.Object({
  chat_id: Type.String({ description: "WeCom chat_id, or wechat-decrypt chatroom id" }),
});

/**
 * Production fetcher: drive `wechat_internal` / `wechat_legacy` chats via
 * powerdata MCP. Returns null when the chat isn't in wechat (could be a
 * wecom chat_id that `customer.refresh_index` should handle separately).
 *
 * v1 returns a minimal ChatFacts; future iterations should enrich `source`
 * (wechat_internal vs wechat_legacy) by inspecting member-list externality.
 */
export async function fetchWechatChatFacts(
  endpoint: WechatMcpEndpoint,
  chat_id: string,
  selfUserids: string[] = []
): Promise<ChatFacts | null> {
  // 1. Look up chat in recent sessions list — get name + member count signals.
  let chatName = "";
  let memberCount = 0;
  try {
    const recentRes = await callWechatTool(endpoint, "get_recent_sessions", { limit: 200 });
    const recentText = extractText(recentRes);
    for (const line of recentText.split("\n")) {
      if (line.includes(chat_id)) {
        chatName = chat_id;
        const m = /(\d+)\s*member/i.exec(line);
        if (m) memberCount = Number(m[1]);
        break;
      }
    }
    if (!chatName) {
      // Not in recent sessions → probe with search_messages to confirm presence.
      const searchRes = await callWechatTool(endpoint, "search_messages", {
        keyword: " ",
        chat_name: chat_id,
        limit: 1,
      });
      const searchText = extractText(searchRes);
      if (searchText.length === 0) return null;
      chatName = chat_id;
    }
  } catch {
    return null;
  }

  // 2. Pull recent messages to inspect for keywords + sender identity.
  let messages = "";
  try {
    const histRes = await callWechatTool(endpoint, "get_chat_history", {
      chat_name: chatName,
      limit: 30,
    });
    messages = extractText(histRes);
  } catch {
    /* keep messages = ""; classifier still runs */
  }

  // 3. Heuristic: has_industry_keyword if any of KEYWORDS.industry appears in text.
  const industryKeywords = ["学习", "同业", "交流"];
  const hasIndustryKeyword = industryKeywords.some((k) => messages.includes(k));

  // 4. owner_is_self: any selfUserid appears as sender → owner_is_self.
  let ownerIsSelf = false;
  if (selfUserids.length > 0) {
    ownerIsSelf = selfUserids.some((u) => messages.includes(u));
  }

  // 5. Default source: wechat_legacy unless we can prove otherwise.
  return {
    chat_id,
    source: "wechat_legacy",
    owner_is_self: ownerIsSelf,
    member_count: memberCount,
    name: chatName,
    has_industry_keyword: hasIndustryKeyword,
  };
}

export function createClassifyChatTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer_classify_chat",
    label: "客户会话分类",
    description: "Classify a chat (WeCom internal/external or WeChat legacy/internal) into one of 12 classes (C1/C2/G1-G4/W1-W3/N1-N2/X1). Hits the index first; falls back to live classification via wechat MCP for unindexed chats.",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      const serverName = ctx.config.wechatMcpServerName ?? "wechat";
      const serverConfig = (ctx.api.config.mcp as { servers?: Record<string, unknown> } | undefined)?.servers?.[serverName];
      const endpoint = serverConfig ? extractWechatMcpEndpoint(serverConfig) : null;

      const fetcher: ChatFactsFetcher | null = endpoint
        ? (chat_id) => fetchWechatChatFacts(endpoint, chat_id, ctx.config.selfUserids ?? [])
        : null;

      const r = await classifyChatViaIndexOrFetch(ctx.db, params.chat_id, fetcher, {
        selfUserids: ctx.config.selfUserids,
      });
      return jsonResult(r);
    },
  };
}

// Re-export core types so consumers can import a single module if they want.
export type { ChatFactsFetcher, ClassifyChatResult } from "./classify_chat_core.js";
