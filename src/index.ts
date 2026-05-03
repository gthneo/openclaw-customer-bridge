import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { openCustomerMapDb } from "./customer_map/repository.js";
import { startIndexRunner } from "./classifier/index_runner.js";
import { createClassifyChatTool } from "./tools/classify_chat.js";
import { createIdentifyTool } from "./tools/identify.js";
import { createMergeTool } from "./tools/merge.js";
import { createLegacyHistoryTool } from "./tools/legacy_history.js";
import { createRecentSignalsTool } from "./tools/recent_signals.js";
import { createRefreshIndexTool } from "./tools/refresh_index.js";
import { createImportLegacyContactsTool } from "./tools/import_legacy_contacts.js";
import { createListCustomersTool } from "./tools/list_customers.js";
import { createSearchCustomersTool } from "./tools/search_customers.js";
import { createShowCustomerTool } from "./tools/show_customer.js";
import { createHealthTool } from "./tools/health.js";
import { registerIngestRoute } from "./ingest/route.js";
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
    const config = (api.pluginConfig ?? {}) as unknown as CustomerBridgeConfig;
    const db = openCustomerMapDb(resolveDbPath(config.dbPath));
    const ctx: PluginContext = { api, config, db };

    api.registerTool(createClassifyChatTool(ctx));
    api.registerTool(createIdentifyTool(ctx));
    api.registerTool(createMergeTool(ctx));
    api.registerTool(createLegacyHistoryTool(ctx));
    api.registerTool(createRecentSignalsTool(ctx));
    api.registerTool(createRefreshIndexTool(ctx));
    api.registerTool(createImportLegacyContactsTool(ctx));
    api.registerTool(createListCustomersTool(ctx));
    api.registerTool(createSearchCustomersTool(ctx));
    api.registerTool(createShowCustomerTool(ctx));
    api.registerTool(createHealthTool(ctx));

    startIndexRunner(ctx);

    // Register ingest webhook route (POST /plugins/openclaw-customer-bridge/ingest).
    // Powerdata.notify_filter on the WeChat-host side calls this when a wechat
    // message matches its filter rules; the result lands in OpenClaw sessions
    // and surfaces in GeniusClaw ▾ 算料.
    if (config.ingestAuthToken) {
      registerIngestRoute({
        api,
        db,
        agentId: config.ingestDefaultAgentId ?? "main",
        authToken: config.ingestAuthToken,
        stubMode: config.ingestStubMode === true,
      });
    }
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
