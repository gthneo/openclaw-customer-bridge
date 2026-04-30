import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleIngest, type IngestDeps, type IngestResponse, type OpenClawRpcClient, type IdentifierResolver } from "./endpoint.js";
import type Database from "better-sqlite3";
import { findByExternalUserid, findByWxid, upsertCustomer } from "../customer_map/repository.js";

/**
 * Wire `handleIngest` into OpenClaw's HTTP route system, so powerdata can
 * POST events to a stable URL and have them flow through the pipeline.
 *
 * URL: POST /plugins/openclaw-customer-bridge/ingest
 * Auth: Bearer token (matched against `config.ingestAuthToken`)
 * Body: see endpoint.ts IngestRequest interface
 */

const INGEST_PATH = "/plugins/openclaw-customer-bridge/ingest";

/**
 * Default identifier — looks up customer by wxid (the most natural key for
 * inbound wechat messages); upserts a new primary_id row when not found.
 */
function defaultIdentifyCustomer(db: Database.Database): IdentifierResolver {
  return async (wxid: string): Promise<string> => {
    const hit = findByWxid(db, wxid);
    if (hit) return hit.primary_id;
    const primaryId = wxid;   // first-seen → use the wxid itself as primary_id
    upsertCustomer(db, {
      primary_id: primaryId,
      wxid_legacy: wxid,
      confidence: 1,
      bridge_method: null,
    });
    return primaryId;
  };
}

/**
 * Stub RPC client — v1 returns success with a synthetic messageId without
 * actually invoking OpenClaw's chat.inject. Enables wire-level e2e (powerdata
 * POST → endpoint → 200 + ingest_log row written) before the real chat.inject
 * integration is in place.
 *
 * TODO(next): replace with a real OpenClaw RPC client. Needs investigating
 * whether plugin-runtime exposes an in-process gateway client, or if we
 * need to reach out via the plugin's own HTTP loopback.
 */
function stubRpcClient(): OpenClawRpcClient {
  return {
    chatInject: async (args) => {
      const messageId = `stub_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      console.log(`[customer-bridge] STUB chat.inject sessionKey=${args.sessionKey} label=${args.label ?? '-'} bytes=${args.message.length}`);
      return { ok: true, messageId };
    },
  };
}

function mapStatus(r: IngestResponse): number {
  if (r.ok) return 200;
  switch (r.error_code) {
    case "AUTH":             return 401;
    case "SCHEMA":           return 400;
    case "RATE_LIMIT":       return 429;
    case "DUPLICATE":        return 200;   // dedup is a success outcome
    case "IDENTIFY_FAILED":  return 502;
    case "GATEWAY_FAIL":     return 502;
    default:                 return 500;
  }
}

export interface RegisterIngestRouteOpts {
  api: OpenClawPluginApi;
  db: Database.Database;
  agentId: string;
  authToken: string;
  /** Optional override — production wires real OpenClaw chat.inject here. */
  rpc?: OpenClawRpcClient;
  /** Optional override — defaults to wxid-keyed customer lookup. */
  identifyCustomer?: IdentifierResolver;
}

export function registerIngestRoute(opts: RegisterIngestRouteOpts): void {
  if (!opts.authToken) {
    console.warn("[customer-bridge] ingest route NOT registered: ingestAuthToken not configured");
    return;
  }

  const deps: IngestDeps = {
    db: opts.db,
    rpc: opts.rpc ?? stubRpcClient(),
    identifyCustomer: opts.identifyCustomer ?? defaultIdentifyCustomer(opts.db),
    agentId: opts.agentId,
    authToken: opts.authToken,
  };

  opts.api.registerHttpRoute({
    path: INGEST_PATH,
    auth: "plugin",
    match: "exact",
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<boolean | void> => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error_code: "METHOD", error_message: "POST only" }));
        return true;
      }

      // Read body
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf-8");

      let body: unknown = null;
      try {
        body = raw.length ? JSON.parse(raw) : null;
      } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error_code: "SCHEMA", error_message: "invalid JSON" }));
        return true;
      }

      const result = await handleIngest(deps, req.headers["authorization"], body);
      res.statusCode = mapStatus(result);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return true;
    },
  });

  console.log(`[customer-bridge] ingest route registered at POST ${INGEST_PATH}`);
}
