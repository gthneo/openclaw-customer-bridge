/**
 * Resolve OpenClaw sessionKey for an incoming wechat message.
 *
 * Shape: `agent:<agentId>:openclaw-weixin:chat:<chat_id_lc>`
 *
 * The middle segments mirror OpenClaw's routing convention (per
 * openclaw-knowledge/data-model.md §1):
 *   - "openclaw-weixin" matches the channel id registered by the
 *     channel-side plugin; downstream consumers (GeniusClaw UI) already
 *     use this for ▾ 算料 grouping.
 *   - chat_id is lowercased for routing-stability (OpenClaw's classifier
 *     normalizes chat ids to lowercase). Outbound calls back to wechat
 *     need the original-cased chat_id; that path doesn't use this
 *     resolver.
 */
export function resolveSessionKey(args: { agentId: string; chat_id: string }): string {
  const lc = args.chat_id.toLowerCase();
  return `agent:${args.agentId}:openclaw-weixin:chat:${lc}`;
}
