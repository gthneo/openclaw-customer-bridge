import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { openCustomerMapDb } from "./customer_map/repository.js";
import { startIndexRunner } from "./classifier/index_runner.js";
import { createClassifyChatTool } from "./tools/classify_chat.js";
import { createIdentifyTool } from "./tools/identify.js";
import { createMergeTool } from "./tools/merge.js";
import { createLegacyHistoryTool } from "./tools/legacy_history.js";
import { createRecentSignalsTool } from "./tools/recent_signals.js";
import { createRefreshIndexTool } from "./tools/refresh_index.js";
import type { CustomerBridgeConfig, PluginContext } from "./types.js";

const plugin = {
  id: "openclaw-customer-bridge",
  name: "Customer Bridge",
  description: "Cross-channel customer identity bridge + 12-class chat classifier",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {},
  },
  register(api: OpenClawPluginApi): void {
    const cfg = api.runtime.config.loadConfig();
    const config = ((cfg.channels as Record<string, unknown> | undefined)?.["customer-bridge"] ?? {}) as CustomerBridgeConfig;
    const db = openCustomerMapDb(resolveDbPath(config.dbPath));
    const ctx: PluginContext = { api, config, db };

    api.registerTool(createClassifyChatTool(ctx));
    api.registerTool(createIdentifyTool(ctx));
    api.registerTool(createMergeTool(ctx));
    api.registerTool(createLegacyHistoryTool(ctx));
    api.registerTool(createRecentSignalsTool(ctx));
    api.registerTool(createRefreshIndexTool(ctx));

    startIndexRunner(ctx);
  },
};

function resolveDbPath(p?: string): string {
  const raw = p ?? "~/.openclaw/customer_map.db";
  if (raw.startsWith("~/")) {
    const home = process.env.HOME ?? "";
    return raw.replace(/^~/, home);
  }
  return raw;
}

export default plugin;
