import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext, ChatClass } from "../types.js";

const Params = Type.Object({
  chat_id: Type.String({ description: "WeCom chat_id, or wechat-decrypt chatroom id" }),
});

export function createClassifyChatTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer_classify_chat",
    label: "客户会话分类",
    description: "Classify a chat (WeCom internal/external or WeChat legacy) into one of 12 classes (C1/C2/G1-G4/W1-W3/N1-N2/X1).",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      const row = ctx.db.prepare("SELECT classified_as FROM groupchat_index WHERE chat_id = ?").get(params.chat_id) as
        | { classified_as: ChatClass }
        | undefined;
      return jsonResult({
        chat_id: params.chat_id,
        chat_class: row?.classified_as ?? "UNKNOWN",
        source: row ? "index" : "miss",
      });
    },
  };
}
