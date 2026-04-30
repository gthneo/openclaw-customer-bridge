import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/customer_map/schema.ts';
import {
  classifyChatViaIndexOrFetch,
  type ChatFactsFetcher,
} from '../src/tools/classify_chat_core.ts';
import type { ChatFacts } from '../src/classifier/rules.ts';

/**
 * Tests for the upgraded classify_chat tool — Phase B (real-time classification).
 *
 * Decoupled the side-effecting MCP call from the rules logic via a
 * `ChatFactsFetcher` injection point. Production wires up a wechat-MCP-backed
 * fetcher; tests inject mock fetchers to drive every branch deterministically.
 *
 * Behavior contract:
 *   - chat_id present in groupchat_index → return cached classified_as (source: 'index')
 *   - chat_id missing AND fetcher returns ChatFacts → run classifyChat(),
 *     write groupchat_index, return result (source: 'live')
 *   - chat_id missing AND fetcher returns null → UNKNOWN (source: 'miss')
 *   - chat_id missing AND fetcher throws → UNKNOWN (source: 'error')
 *   - subsequent call after live classification hits index (no re-fetch)
 */

function makeTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

function seedIndex(
  db: Database.Database,
  chat_id: string,
  classified_as: string,
  args: { owner?: string; member_count?: number; name?: string } = {}
): void {
  db.prepare(`INSERT INTO groupchat_index
    (chat_id, owner, member_count, name, classified_as, raw_json, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      chat_id,
      args.owner ?? '',
      args.member_count ?? 0,
      args.name ?? '',
      classified_as,
      null,
      Math.floor(Date.now() / 1000)
    );
}

// ---- index hit (cached) --------------------------------------------------

test('classifyChatViaIndexOrFetch: index hit → returns cached class without invoking fetcher', async () => {
  const db = makeTestDb();
  seedIndex(db, 'chatX', 'G2');
  let fetcherCalled = 0;
  const fetcher: ChatFactsFetcher = async () => { fetcherCalled++; return null; };
  const r = await classifyChatViaIndexOrFetch(db, 'chatX', fetcher);
  assert.equal(r.chat_class, 'G2');
  assert.equal(r.source, 'index');
  assert.equal(fetcherCalled, 0, 'fetcher must not be called when index hits');
});

// ---- live classification (index miss + fetcher returns facts) ------------

test('classifyChatViaIndexOrFetch: index miss + fetcher returns ChatFacts → runs rules, writes index, returns "live"', async () => {
  const db = makeTestDb();
  const facts: ChatFacts = {
    chat_id: 'chatY',
    source: 'wechat_internal',
    owner_is_self: true,
    member_count: 4,
    name: 'family group'
  };
  const fetcher: ChatFactsFetcher = async () => facts;
  const r = await classifyChatViaIndexOrFetch(db, 'chatY', fetcher);
  assert.equal(r.chat_class, 'C1');   // owner_is_self → C1
  assert.equal(r.source, 'live');
  // Should have written to groupchat_index
  const row = db.prepare("SELECT classified_as FROM groupchat_index WHERE chat_id = ?").get('chatY') as { classified_as: string } | undefined;
  assert.equal(row?.classified_as, 'C1');
});

test('classifyChatViaIndexOrFetch: live classification persists facts (owner, member_count, name)', async () => {
  const db = makeTestDb();
  const facts: ChatFacts = {
    chat_id: 'chatZ',
    source: 'wechat_legacy',
    owner_is_self: false,
    member_count: 28,
    name: '老客户群',
    has_industry_keyword: true
  };
  const fetcher: ChatFactsFetcher = async () => facts;
  await classifyChatViaIndexOrFetch(db, 'chatZ', fetcher);
  const row = db.prepare("SELECT * FROM groupchat_index WHERE chat_id = ?").get('chatZ') as
    | { classified_as: string; owner: string; member_count: number; name: string }
    | undefined;
  assert.ok(row);
  assert.equal(row!.classified_as, 'W3');   // industry keyword
  assert.equal(row!.member_count, 28);
  assert.equal(row!.name, '老客户群');
});

// ---- subsequent call hits index (no re-fetch) ----------------------------

test('classifyChatViaIndexOrFetch: second call hits index, fetcher not invoked', async () => {
  const db = makeTestDb();
  const facts: ChatFacts = {
    chat_id: 'chatRepeat',
    source: 'wechat_internal',
    owner_is_self: true,
    member_count: 3,
    name: 'sample'
  };
  let fetcherCalls = 0;
  const fetcher: ChatFactsFetcher = async () => { fetcherCalls++; return facts; };

  await classifyChatViaIndexOrFetch(db, 'chatRepeat', fetcher);
  await classifyChatViaIndexOrFetch(db, 'chatRepeat', fetcher);

  assert.equal(fetcherCalls, 1, 'fetcher must be called only once; second call should hit index');
});

// ---- miss / error paths --------------------------------------------------

test('classifyChatViaIndexOrFetch: index miss + fetcher returns null → UNKNOWN miss', async () => {
  const db = makeTestDb();
  const fetcher: ChatFactsFetcher = async () => null;
  const r = await classifyChatViaIndexOrFetch(db, 'chatGhost', fetcher);
  assert.equal(r.chat_class, 'UNKNOWN');
  assert.equal(r.source, 'miss');
});

test('classifyChatViaIndexOrFetch: fetcher throws → UNKNOWN error (does not propagate)', async () => {
  const db = makeTestDb();
  const fetcher: ChatFactsFetcher = async () => { throw new Error('mcp connection refused'); };
  const r = await classifyChatViaIndexOrFetch(db, 'chatBoom', fetcher);
  assert.equal(r.chat_class, 'UNKNOWN');
  assert.equal(r.source, 'error');
  assert.match(r.reason ?? '', /mcp connection refused/);
});

// ---- index miss + no fetcher available -----------------------------------

test('classifyChatViaIndexOrFetch: missing fetcher → UNKNOWN no_mcp', async () => {
  const db = makeTestDb();
  const r = await classifyChatViaIndexOrFetch(db, 'chatNoMcp', null);
  assert.equal(r.chat_class, 'UNKNOWN');
  assert.equal(r.source, 'no_mcp');
});
