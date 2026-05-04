import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/customer_map/schema.ts';
import {
  handleIngest,
  validateIngestRequest,
  checkAuth,
  wrapMessageEnvelope,
  type IngestDeps,
  type IngestRequest,
  type IngestLogger,
  type OpenClawRpcClient,
  type IdentifierResolver,
} from '../src/ingest/endpoint.ts';
import { resolveSessionKey } from '../src/ingest/session_resolver.ts';
import { alreadyIngested, getIngestLog } from '../src/ingest/deduplicate.ts';

/**
 * Tests for the ingest endpoint pipeline.
 *
 * Architecture under test:
 *   handleIngest(deps, authHeader, body)
 *     → checkAuth → validate → dedup → identify → resolveSessionKey
 *     → rpc.chatInject → recordIngestLog
 *     → IngestResponse
 *
 * All side effects (db, rpc, identifier) go through `deps` so we drive every
 * branch deterministically without a live OpenClaw gateway.
 */

const VALID_TOKEN = 'test_secret_xyz';

function makeTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

function validBody(overrides: Partial<IngestRequest> = {}): IngestRequest {
  return {
    event_id: '01HX_EVENT_001',
    sender_wxid: 'wxid_alice',
    sender_nickname: 'Alice',
    chat_id: '12345@chatroom',
    chat_name: '客户群A',
    chat_type: 'group',
    message: '我们什么时候能签合同？',
    timestamp: 1730000000,
    source_msg_id: 'msg_001',
    trigger_reason: 'kw:合同',
    ...overrides,
  };
}

function makeDeps(args?: {
  db?: Database.Database;
  rpc?: OpenClawRpcClient;
  identifier?: IdentifierResolver;
}): IngestDeps {
  return {
    db: args?.db ?? makeTestDb(),
    rpc: args?.rpc ?? {
      chatInject: async () => ({ ok: true as const, messageId: 'msg_returned_001' }),
    },
    identifyCustomer: args?.identifier ?? (async () => 'primary_alice'),
    agentId: 'main',
    authToken: VALID_TOKEN,
  };
}

// ---- helper functions ----------------------------------------------------

test('checkAuth: valid Bearer token → true', () => {
  assert.equal(checkAuth(`Bearer ${VALID_TOKEN}`, VALID_TOKEN), true);
});

test('checkAuth: missing header → false', () => {
  assert.equal(checkAuth(undefined, VALID_TOKEN), false);
});

test('checkAuth: wrong token → false', () => {
  assert.equal(checkAuth('Bearer wrong', VALID_TOKEN), false);
});

test('checkAuth: empty expected token → false (defense)', () => {
  assert.equal(checkAuth('Bearer anything', ''), false);
});

test('checkAuth: case-insensitive Bearer prefix', () => {
  assert.equal(checkAuth(`bearer ${VALID_TOKEN}`, VALID_TOKEN), true);
});

test('validateIngestRequest: valid body returns request', () => {
  const v = validateIngestRequest(validBody());
  assert.ok(v);
  assert.equal(v!.sender_wxid, 'wxid_alice');
});

test('validateIngestRequest: missing event_id → null', () => {
  const v = validateIngestRequest({ ...validBody(), event_id: '' });
  assert.equal(v, null);
});

test('validateIngestRequest: invalid chat_type → null', () => {
  const v = validateIngestRequest({ ...validBody(), chat_type: 'channel' as never });
  assert.equal(v, null);
});

test('validateIngestRequest: non-numeric timestamp → null', () => {
  const v = validateIngestRequest({ ...validBody(), timestamp: '1730000000' as never });
  assert.equal(v, null);
});

test('wrapMessageEnvelope: prefers nickname over wxid', () => {
  const w = wrapMessageEnvelope(validBody());
  assert.equal(w, '[微信] Alice: 我们什么时候能签合同？');
});

test('wrapMessageEnvelope: falls back to wxid when nickname empty', () => {
  const w = wrapMessageEnvelope(validBody({ sender_nickname: '' }));
  assert.match(w, /^\[微信\] wxid_alice: /);
});

test('resolveSessionKey: shape agent:<id>:openclaw-weixin:chat:<lc>', () => {
  const k = resolveSessionKey({ agentId: 'main', chat_id: '12345@CHATROOM' });
  assert.equal(k, 'agent:main:openclaw-weixin:chat:12345@chatroom');
});

// ---- handleIngest happy path ---------------------------------------------

test('handleIngest: happy path → ok + message_id + session_key', async () => {
  const deps = makeDeps();
  const r = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.message_id, 'msg_returned_001');
    assert.match(r.session_key, /^agent:main:openclaw-weixin:chat:12345@chatroom$/);
  }
});

test('handleIngest: writes to ingest_log on success', async () => {
  const db = makeTestDb();
  const deps = makeDeps({ db });
  await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  const log = getIngestLog(db, '01HX_EVENT_001');
  assert.ok(log);
  assert.equal(log!.status, 'ok');
  assert.equal(log!.primary_id, 'primary_alice');
  assert.equal(log!.message_id, 'msg_returned_001');
});

// ---- handleIngest error paths --------------------------------------------

test('handleIngest: missing auth → AUTH error', async () => {
  const r = await handleIngest(makeDeps(), undefined, validBody());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error_code, 'AUTH');
});

test('handleIngest: wrong auth → AUTH error', async () => {
  const r = await handleIngest(makeDeps(), 'Bearer wrong', validBody());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error_code, 'AUTH');
});

test('handleIngest: invalid body schema → SCHEMA error', async () => {
  const r = await handleIngest(makeDeps(), `Bearer ${VALID_TOKEN}`, { not: 'valid' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error_code, 'SCHEMA');
});

test('handleIngest: identifier throws → IDENTIFY_FAILED error', async () => {
  const deps = makeDeps({
    identifier: async () => { throw new Error('db locked'); },
  });
  const r = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error_code, 'IDENTIFY_FAILED');
    assert.match(r.error_message, /db locked/);
  }
});

test('handleIngest: chatInject fails → GATEWAY_FAIL + records error log', async () => {
  const db = makeTestDb();
  const rpc: OpenClawRpcClient = {
    chatInject: async () => ({ ok: false, error: 'session not found' }),
  };
  const deps = makeDeps({ db, rpc });
  const r = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error_code, 'GATEWAY_FAIL');
    assert.match(r.error_message, /session not found/);
  }
  // Error log persisted so we can audit failures later.
  const log = getIngestLog(db, '01HX_EVENT_001');
  assert.equal(log?.status, 'error');
  assert.equal(log?.error_message, 'session not found');
});

// ---- handleIngest dedup --------------------------------------------------

test('handleIngest: same event_id twice → both succeed; second skips RPC call', async () => {
  const db = makeTestDb();
  let injectCount = 0;
  const rpc: OpenClawRpcClient = {
    chatInject: async () => { injectCount++; return { ok: true, messageId: 'msg_first' }; },
  };
  const deps = makeDeps({ db, rpc });

  const r1 = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  const r2 = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (r1.ok && r2.ok) {
    assert.equal(r2.message_id, r1.message_id, 'second response should reuse first messageId');
  }
  assert.equal(injectCount, 1, 'rpc.chatInject must be called only once for duplicate event_id');
});

test('handleIngest: prior error_log → retry attempts the gateway again', async () => {
  // First call: rpc fails → log status=error
  // Second call (same event_id): rpc succeeds → should re-attempt, not skip
  const db = makeTestDb();
  let attempt = 0;
  const rpc: OpenClawRpcClient = {
    chatInject: async () => {
      attempt++;
      if (attempt === 1) return { ok: false, error: 'transient' };
      return { ok: true, messageId: 'msg_retry_ok' };
    },
  };
  const deps = makeDeps({ db, rpc });

  const r1 = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.equal(r1.ok, false);

  const r2 = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.message_id, 'msg_retry_ok');
  assert.equal(attempt, 2, 'gateway must be retried after a prior error');
});

// ---- handleIngest passes envelope-wrapped message to RPC -----------------

test('handleIngest: chat.inject receives envelope-wrapped message', async () => {
  let captured: { sessionKey: string; message: string; label?: string } | null = null;
  const rpc: OpenClawRpcClient = {
    chatInject: async (args) => {
      captured = args;
      return { ok: true, messageId: 'msg_x' };
    },
  };
  const deps = makeDeps({ rpc });
  await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.ok(captured);
  assert.equal((captured as any).message, '[微信] Alice: 我们什么时候能签合同？');
  assert.equal((captured as any).label, 'kw:合同');
});

// ---- ingest_log table integration ---------------------------------------

test('ingest_log: alreadyIngested returns false for unknown event_id', () => {
  const db = makeTestDb();
  assert.equal(alreadyIngested(db, 'never_seen'), false);
});

test('ingest_log: schema migration applied on db open (v2 marker)', () => {
  const db = makeTestDb();
  const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all() as { version: number }[];
  assert.deepEqual(versions.map((v) => v.version), [1, 2]);
});

// ---- per-request observability log ---------------------------------------

interface CapturedLogger extends IngestLogger {
  okCalls: Parameters<IngestLogger['ok']>[0][];
  dedupHitCalls: Parameters<IngestLogger['dedupHit']>[0][];
  failCalls: Parameters<IngestLogger['fail']>[0][];
  suspiciousCalls: Parameters<IngestLogger['suspicious']>[0][];
}

function makeCapturedLogger(): CapturedLogger {
  const okCalls: Parameters<IngestLogger['ok']>[0][] = [];
  const dedupHitCalls: Parameters<IngestLogger['dedupHit']>[0][] = [];
  const failCalls: Parameters<IngestLogger['fail']>[0][] = [];
  const suspiciousCalls: Parameters<IngestLogger['suspicious']>[0][] = [];
  return {
    ok: (i) => { okCalls.push(i); },
    dedupHit: (i) => { dedupHitCalls.push(i); },
    fail: (i) => { failCalls.push(i); },
    suspicious: (i) => { suspiciousCalls.push(i); },
    okCalls, dedupHitCalls, failCalls, suspiciousCalls,
  };
}

test('logger: ok path emits inject ok with mode + sender_nickname + bytes', async () => {
  const logger = makeCapturedLogger();
  const deps = { ...makeDeps(), mode: 'real' as const, logger };
  const r = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.equal(r.ok, true);
  assert.equal(logger.okCalls.length, 1);
  const got = logger.okCalls[0]!;
  assert.equal(got.mode, 'real');
  assert.equal(got.session_key, 'agent:main:openclaw-weixin:chat:12345@chatroom');
  assert.equal(got.message_id, 'msg_returned_001');
  assert.equal(got.trigger, 'kw:合同');
  assert.equal(got.sender_nickname, 'Alice');
  assert.ok(got.bytes > 0, 'bytes must be set');
  assert.equal(logger.failCalls.length, 0);
  assert.equal(logger.suspiciousCalls.length, 0);
});

test('logger: dedup-hit path emits dedupHit and NOT ok again', async () => {
  const db = makeTestDb();
  const logger = makeCapturedLogger();
  const deps = { ...makeDeps({ db }), mode: 'stub' as const, logger };
  // first call → ok
  await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.equal(logger.okCalls.length, 1);
  // second identical call → dedup short-circuit
  const r2 = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.equal(r2.ok, true);
  assert.equal(logger.dedupHitCalls.length, 1);
  assert.equal(logger.dedupHitCalls[0]!.event_id, '01HX_EVENT_001');
  assert.equal(logger.okCalls.length, 1, 'ok must not fire again on dedup hit');
});

test('logger: fail path emits inject FAIL warn with mode + error', async () => {
  const rpc: OpenClawRpcClient = {
    chatInject: async () => ({ ok: false, error: 'transient gateway hiccup' }),
  };
  const logger = makeCapturedLogger();
  const deps = { ...makeDeps({ rpc }), mode: 'real' as const, logger };
  const r = await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  assert.equal(r.ok, false);
  assert.equal(logger.failCalls.length, 1);
  assert.equal(logger.failCalls[0]!.mode, 'real');
  assert.equal(logger.failCalls[0]!.event_id, '01HX_EVENT_001');
  assert.match(logger.failCalls[0]!.error, /transient gateway hiccup/);
  assert.equal(logger.okCalls.length, 0);
});

test('logger: suspicious warn fires when sender_nickname == chat_id', async () => {
  const logger = makeCapturedLogger();
  const deps = { ...makeDeps(), logger };
  const body = validBody({ sender_nickname: '12345@chatroom' });   // == chat_id
  await handleIngest(deps, `Bearer ${VALID_TOKEN}`, body);
  assert.equal(logger.suspiciousCalls.length, 1);
  assert.match(logger.suspiciousCalls[0]!.reason, /sender_nickname == chat_id/);
  // request still completes (warn only, no reject)
  assert.equal(logger.okCalls.length, 1);
});

test('logger: suspicious warn fires when sender_nickname == chat_name in group', async () => {
  const logger = makeCapturedLogger();
  const deps = { ...makeDeps(), logger };
  const body = validBody({ sender_nickname: '客户群A', chat_name: '客户群A', chat_type: 'group' });
  await handleIngest(deps, `Bearer ${VALID_TOKEN}`, body);
  assert.equal(logger.suspiciousCalls.length, 1);
  assert.match(logger.suspiciousCalls[0]!.reason, /sender_nickname == chat_name in group/);
  // request still completes
  assert.equal(logger.okCalls.length, 1);
});

test('logger: clean payload emits NO suspicious warn', async () => {
  const logger = makeCapturedLogger();
  const deps = { ...makeDeps(), logger };
  await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());   // sender=Alice, chat=12345@chatroom
  assert.equal(logger.suspiciousCalls.length, 0);
  assert.equal(logger.okCalls.length, 1);
});

test('logger: defaults to consoleIngestLogger when not injected (smoke — no throws)', async () => {
  const deps = makeDeps();
  // Spy on console.log to ensure something gets emitted
  const original = console.log;
  let captured = '';
  console.log = (msg: unknown) => { captured += String(msg); };
  try {
    await handleIngest(deps, `Bearer ${VALID_TOKEN}`, validBody());
  } finally {
    console.log = original;
  }
  assert.match(captured, /\[customer-bridge\] inject ok/);
  assert.match(captured, /sender_nickname=/);
});
