import type Database from "better-sqlite3";
import { alreadyIngested, getIngestLog, recordIngestLog } from "./deduplicate.js";
import { resolveSessionKey } from "./session_resolver.js";

/**
 * The HTTP-level contract powerdata.notify_filter calls. POST body shape +
 * envelope wrapping defined here so the test suite drives the *whole*
 * pipeline through a single function (`handleIngest`) — no live HTTP
 * server needed for the unit tests.
 */

export interface IngestRequest {
  event_id: string;            // ULID, dedup key (powerdata is at-least-once)
  sender_wxid: string;         // who sent the message
  sender_nickname?: string;    // for nicer envelope display
  chat_id: string;             // group: 12345@chatroom; DM: equals sender_wxid
  chat_name?: string;          // optional group name
  chat_type: "single" | "group";
  message: string;             // raw text content
  timestamp: number;           // unix seconds
  source_msg_id: string;       // powerdata's internal msg id (audit / fallback dedup)
  trigger_reason: string;      // 'vip:wxid_xxx' / 'kw:合同' / 'class:W3' / ...
}

export type IngestErrorCode =
  | "AUTH"
  | "SCHEMA"
  | "RATE_LIMIT"
  | "DUPLICATE"
  | "IDENTIFY_FAILED"
  | "GATEWAY_FAIL";

export type IngestResponse =
  | { ok: true; message_id: string; session_key: string }
  | { ok: false; error_code: IngestErrorCode; error_message: string };

/**
 * OpenClaw RPC subset this ingest path needs. Real impl wraps the gateway
 * client; tests inject a stub. Returning a discriminated `{ok, ...}` shape
 * (rather than throwing) lets handleIngest distinguish gateway errors from
 * auth/schema errors uniformly.
 */
export interface OpenClawRpcClient {
  chatInject(args: { sessionKey: string; message: string; label?: string }):
    Promise<{ ok: true; messageId: string } | { ok: false; error: string }>;
  /** Optional — not called in v1 (chat.inject creates session if missing per OpenClaw audit). */
  sessionsCreate?(args: { key?: string; agentId?: string }):
    Promise<{ ok: true } | { ok: false; error: string }>;
}

/** Resolves wxid → unified primary_id; injection seam for tests. */
export type IdentifierResolver = (wxid: string) => Promise<string>;

export interface IngestDeps {
  db: Database.Database;
  rpc: OpenClawRpcClient;
  identifyCustomer: IdentifierResolver;
  agentId: string;             // which agent owns the openclaw-weixin sessions
  authToken: string;           // Bearer token shared with powerdata
}

export function checkAuth(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader || !expectedToken) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m !== null && m[1] === expectedToken;
}

export function validateIngestRequest(body: unknown): IngestRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const reqStr = (k: string): string | null =>
    typeof b[k] === "string" && (b[k] as string).length > 0 ? (b[k] as string) : null;

  const event_id = reqStr("event_id");
  const sender_wxid = reqStr("sender_wxid");
  const chat_id = reqStr("chat_id");
  const message = reqStr("message");
  const source_msg_id = reqStr("source_msg_id");
  const trigger_reason = reqStr("trigger_reason");
  if (!event_id || !sender_wxid || !chat_id || !message || !source_msg_id || !trigger_reason) return null;

  if (b.chat_type !== "single" && b.chat_type !== "group") return null;
  if (typeof b.timestamp !== "number") return null;

  return {
    event_id,
    sender_wxid,
    sender_nickname: typeof b.sender_nickname === "string" ? b.sender_nickname : undefined,
    chat_id,
    chat_name: typeof b.chat_name === "string" ? b.chat_name : undefined,
    chat_type: b.chat_type,
    message,
    timestamp: b.timestamp,
    source_msg_id,
    trigger_reason,
  };
}

/**
 * Wrap message in `[微信]` envelope. Per plan §"Decisions" #2:
 *   "[微信] <sender_nickname or wxid>: <message>"
 *
 * Compatible with GeniusClaw `parseUpstreamMessage.ts` which already
 * handles `[<channel>]` envelope across feishu/wecom/etc.
 */
export function wrapMessageEnvelope(req: IngestRequest): string {
  const sender = req.sender_nickname?.trim() || req.sender_wxid;
  return `[微信] ${sender}: ${req.message}`;
}

/**
 * Pure orchestration of the ingest pipeline. All side effects go through
 * `deps` (db / rpc / identifyCustomer) so unit tests can drive every branch.
 */
export async function handleIngest(
  deps: IngestDeps,
  authHeader: string | undefined,
  body: unknown
): Promise<IngestResponse> {
  // 1. auth — bearer token must match
  if (!checkAuth(authHeader, deps.authToken)) {
    return { ok: false, error_code: "AUTH", error_message: "invalid bearer token" };
  }

  // 2. validate request schema
  const req = validateIngestRequest(body);
  if (!req) {
    return { ok: false, error_code: "SCHEMA", error_message: "invalid request body" };
  }

  // 3. dedup on event_id — powerdata is at-least-once
  if (alreadyIngested(deps.db, req.event_id)) {
    const prev = getIngestLog(deps.db, req.event_id);
    if (prev?.status === "ok" && prev.message_id) {
      return { ok: true, message_id: prev.message_id, session_key: prev.session_key };
    }
    // prior attempt errored — let it fall through to retry the gateway call
  }

  // 4. resolve customer (creates new primary_id on first sight)
  let primaryId: string;
  try {
    primaryId = await deps.identifyCustomer(req.sender_wxid);
  } catch (err) {
    return {
      ok: false,
      error_code: "IDENTIFY_FAILED",
      error_message: err instanceof Error ? err.message : String(err),
    };
  }

  // 5. resolve sessionKey
  const sessionKey = resolveSessionKey({ agentId: deps.agentId, chat_id: req.chat_id });

  // 6. inject the wrapped message
  const wrapped = wrapMessageEnvelope(req);
  const injectRes = await deps.rpc.chatInject({
    sessionKey,
    message: wrapped,
    label: req.trigger_reason,
  });
  if (!injectRes.ok) {
    recordIngestLog(deps.db, {
      event_id: req.event_id,
      primary_id: primaryId,
      session_key: sessionKey,
      status: "error",
      error_message: injectRes.error,
    });
    return { ok: false, error_code: "GATEWAY_FAIL", error_message: injectRes.error };
  }

  // 7. record success in ingest_log
  recordIngestLog(deps.db, {
    event_id: req.event_id,
    primary_id: primaryId,
    session_key: sessionKey,
    message_id: injectRes.messageId,
    status: "ok",
  });

  return { ok: true, message_id: injectRes.messageId, session_key: sessionKey };
}
