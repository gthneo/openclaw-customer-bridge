import type { PluginContext } from "../types.js";

export function startIndexRunner(_ctx: PluginContext): void {
  // STUB: schedule a periodic refresh of groupchat_index from WeCom API.
  //
  // Implementation outline:
  // 1. Parse ctx.config.indexRefreshCron (default "0 * * * *")
  // 2. On each tick:
  //    a. Get access_token via wecom/access_token.ts
  //    b. Call externalcontact/groupchat/list (paginate) → list of chat_id
  //    c. For each chat_id, call externalcontact/groupchat/get (need_name=1)
  //    d. Build ChatFacts and call classifyChat() from classifier/rules
  //    e. Upsert into groupchat_index table
  // 3. Respect WeCom QPS (most APIs ~600/min) — throttle to <= 5/sec
  //
  // For the scaffold, we just no-op so the plugin loads without external calls.
  // To enable, uncomment the setInterval below and implement refresh().
  //
  // const intervalMs = 60 * 60 * 1000;
  // setInterval(() => refresh(_ctx).catch(console.error), intervalMs);
}

export async function refresh(_ctx: PluginContext): Promise<{ refreshed: number }> {
  // STUB
  return { refreshed: 0 };
}
