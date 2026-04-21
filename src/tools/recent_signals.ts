import { Type, type Static } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";

const Params = Type.Object({
  chat_id: Type.String(),
  hours: Type.Optional(Type.Number({ default: 24 })),
});

export function createRecentSignalsTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer_recent_signals",
    label: "群信号提取",
    description: "Extract entities/keywords/sentiment signals from recent chat in a group (W3 industry-radar use case).",
    parameters: Params,
    async execute(_toolCallId: string, params: Static<typeof Params>) {
      void ctx;
      return jsonResult({
        chat_id: params.chat_id,
        window_hours: params.hours ?? 24,
        entities: [],
        keywords: [],
        sentiment: "neutral",
        reason: "stub — implement via wechat MCP + entity extraction",
      });
    },
  };
}
