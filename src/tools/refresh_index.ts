import { Type } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/core";
import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { PluginContext } from "../types.js";
import { refresh } from "../classifier/index_runner.js";

const Params = Type.Object({});

export function createRefreshIndexTool(ctx: PluginContext): AnyAgentTool {
  return {
    name: "customer.refresh_index",
    label: "群索引刷新",
    description: "Manually trigger a refresh of groupchat_index from WeCom externalcontact/groupchat/* APIs.",
    parameters: Params,
    async execute() {
      return jsonResult(await refresh(ctx));
    },
  };
}
