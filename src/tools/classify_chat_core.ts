import type Database from "better-sqlite3";
import type { ChatClass } from "../types.js";
import { classifyChat, type ChatFacts } from "../classifier/rules.js";

/** Outcome of classifying a chat — discriminates how the result was reached. */
export interface ClassifyChatResult {
  chat_id: string;
  chat_class: ChatClass;
  source: "index" | "live" | "miss" | "no_mcp" | "error";
  reason?: string;
}

/**
 * A `ChatFactsFetcher` resolves a chat_id to ChatFacts using whatever
 * outside-world data is reachable (wechat MCP, wecom API, etc.). Returns
 * null when the chat is not found in any data source.
 *
 * Injection point so tests can drive every branch deterministically without
 * needing a live MCP server.
 */
export type ChatFactsFetcher = (chat_id: string) => Promise<ChatFacts | null>;

/**
 * Index-or-fetch classification — pure-ish (only side effect is writing to
 * groupchat_index on a successful live fetch).
 *
 * Lives in its own file (not classify_chat.ts) so tests can import it
 * without dragging in wechat MCP (and its SSE client, fetch shim, etc.).
 */
export async function classifyChatViaIndexOrFetch(
  db: Database.Database,
  chat_id: string,
  fetcher: ChatFactsFetcher | null,
  ctx?: { selfUserids?: string[] }
): Promise<ClassifyChatResult> {
  // 1. Index hit — return cached class without re-fetching.
  const indexed = db
    .prepare("SELECT classified_as FROM groupchat_index WHERE chat_id = ?")
    .get(chat_id) as { classified_as: ChatClass } | undefined;
  if (indexed) {
    return { chat_id, chat_class: indexed.classified_as, source: "index" };
  }

  // 2. No fetcher available (e.g., wechat MCP not configured). Cannot live-classify.
  if (!fetcher) {
    return { chat_id, chat_class: "UNKNOWN", source: "no_mcp" };
  }

  // 3. Live fetch.
  let facts: ChatFacts | null;
  try {
    facts = await fetcher(chat_id);
  } catch (err) {
    return {
      chat_id,
      chat_class: "UNKNOWN",
      source: "error",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  if (!facts) {
    return { chat_id, chat_class: "UNKNOWN", source: "miss" };
  }

  // 4. Run the rules + persist into groupchat_index for next time.
  const chatClass = classifyChat(facts, { selfUserids: ctx?.selfUserids });
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT OR REPLACE INTO groupchat_index
    (chat_id, owner, member_count, name, classified_as, raw_json, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      chat_id,
      facts.owner_is_self ? "self" : "other",
      facts.member_count,
      facts.name,
      chatClass,
      JSON.stringify(facts),
      now
    );

  return { chat_id, chat_class: chatClass, source: "live" };
}
