import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { scoreCandidates, hammingDistance, jaccardSim } from '../src/customer_map/matcher.ts';
import { SCHEMA_SQL } from '../src/customer_map/schema.ts';

/**
 * Tests for `scoreCandidates()` — the probabilistic identity matcher.
 *
 * Algorithm (from existing inline comments):
 *   1. Pull all customer_map rows with wxid_legacy populated (legacy candidates)
 *   2. For each candidate:
 *      - avatar_phash Hamming → normalized to [0,1]   (weight 0.5)
 *      - nickname_set Jaccard similarity              (weight 0.2)
 *      - remark exact match → 0/1                     (weight 0.15)
 *      - co-group overlap (deferred — return 0 for now, weight 0.15)
 *   3. Weighted sum + sort desc
 *
 * v1 (this iteration) implements 3 of 4 dimensions; co_groups is wired but
 * always returns 0 because it depends on groupchat_index + wechat MCP and
 * is the most complex to test reliably. With co_groups=0, max achievable
 * score is 0.85 — `customer.identify`'s auto-threshold (0.9) won't trigger
 * yet, but the review-threshold (0.5) will, which is what we want for v1.
 */

function makeTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

function insertCustomer(
  db: Database.Database,
  args: {
    primary_id: string;
    wxid_legacy?: string;
    external_userid?: string;
    avatar_phash?: string;
    nicknames?: string[];
    remark?: string;
  }
): void {
  const nicknameSet = args.remark
    ? JSON.stringify({ nicks: args.nicknames ?? [], remark: args.remark })
    : JSON.stringify(args.nicknames ?? []);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO customer_map
    (primary_id, external_userid, wxid_legacy, unionid, phone_hash, avatar_phash, nickname_set, confidence, bridge_method, merged_from, created_at, updated_at)
    VALUES (@primary_id, @external_userid, @wxid_legacy, NULL, NULL, @avatar_phash, @nickname_set, 1, NULL, '[]', @now, @now)`)
    .run({
      primary_id: args.primary_id,
      external_userid: args.external_userid ?? null,
      wxid_legacy: args.wxid_legacy ?? null,
      avatar_phash: args.avatar_phash ?? null,
      nickname_set: nicknameSet,
      now,
    });
}

// ---- helpers — keep helpers green (regression) ---------------------------

test('hammingDistance: identical strings → 0', () => {
  assert.equal(hammingDistance('abc', 'abc'), 0);
});

test('hammingDistance: completely different → length', () => {
  assert.equal(hammingDistance('abc', 'xyz'), 3);
});

test('jaccardSim: identical sets → 1', () => {
  assert.equal(jaccardSim(['a', 'b'], ['a', 'b']), 1);
});

test('jaccardSim: disjoint sets → 0', () => {
  assert.equal(jaccardSim(['a', 'b'], ['c', 'd']), 0);
});

test('jaccardSim: partial overlap', () => {
  // {a,b,c} ∩ {b,c,d} = {b,c} (size 2)
  // {a,b,c} ∪ {b,c,d} = {a,b,c,d} (size 4)
  assert.equal(jaccardSim(['a', 'b', 'c'], ['b', 'c', 'd']), 0.5);
});

// ---- scoreCandidates: empty / no-op cases --------------------------------

test('scoreCandidates: empty input → []', () => {
  const db = makeTestDb();
  const r = scoreCandidates(db, {});
  assert.deepEqual(r, []);
});

test('scoreCandidates: empty DB → []', () => {
  const db = makeTestDb();
  const r = scoreCandidates(db, { wxid: 'wxid_x', avatar_phash: 'aaaa' });
  assert.deepEqual(r, []);
});

test('scoreCandidates: candidates without wxid_legacy are excluded', () => {
  // Customers tracked only via external_userid (no legacy bridge yet) should
  // NOT participate in fuzzy matching — they have nothing to fuzzy-match against.
  const db = makeTestDb();
  insertCustomer(db, {
    primary_id: 'p_external_only',
    external_userid: 'ext_x',
    avatar_phash: 'a'.repeat(16),
  });
  const r = scoreCandidates(db, { avatar_phash: 'a'.repeat(16) });
  assert.equal(r.length, 0);
});

// ---- scoreCandidates: phash dimension ------------------------------------

test('scoreCandidates: identical pHash → high score (~ 0.5 from phash alone)', () => {
  const db = makeTestDb();
  const phash = 'a'.repeat(64);   // 64 hex chars = 256 bits, common pHash size
  insertCustomer(db, { primary_id: 'p1', wxid_legacy: 'wxid_a', avatar_phash: phash });
  const r = scoreCandidates(db, { avatar_phash: phash });
  assert.equal(r.length, 1);
  // phash dimension contributes weight=0.5 when distance=0 → score ≈ 0.5
  assert.ok(r[0]!.score >= 0.49 && r[0]!.score <= 0.51, `score=${r[0]!.score}`);
  assert.equal(r[0]!.evidence.phash, 1);   // normalized phash similarity = 1
});

test('scoreCandidates: opposite pHash → near-zero phash contribution (with weak nickname signal so candidate survives the score>0 filter)', () => {
  const db = makeTestDb();
  const a = 'a'.repeat(64);
  const z = '0'.repeat(64);   // very different
  insertCustomer(db, {
    primary_id: 'p1',
    wxid_legacy: 'wxid_a',
    avatar_phash: a,
    nicknames: ['老王'],
  });
  // Add a weak nickname overlap so the candidate isn't filtered out (score=0 is filtered).
  // We then verify the phash *dimension* itself is near zero.
  const r = scoreCandidates(db, { avatar_phash: z, nicknames: ['老王'] });
  assert.equal(r.length, 1, 'candidate should survive thanks to nickname signal');
  assert.ok(r[0]!.evidence.phash !== undefined && r[0]!.evidence.phash < 0.5, `phash=${r[0]!.evidence.phash}`);
});

// ---- scoreCandidates: nickname dimension ---------------------------------

test('scoreCandidates: identical nicknames → score includes 0.2 nickname weight', () => {
  const db = makeTestDb();
  insertCustomer(db, {
    primary_id: 'p1',
    wxid_legacy: 'wxid_a',
    nicknames: ['老王', 'Wang'],
  });
  const r = scoreCandidates(db, { nicknames: ['老王', 'Wang'] });
  assert.equal(r.length, 1);
  // nickname Jaccard = 1 → contributes 0.2
  // phash = undefined → contributes 0
  // remark = undefined → contributes 0
  // co_groups = 0 (deferred)
  assert.ok(r[0]!.score >= 0.19 && r[0]!.score <= 0.21, `score=${r[0]!.score}`);
  assert.equal(r[0]!.evidence.nickname, 1);
});

test('scoreCandidates: disjoint nicknames → nickname dim = 0', () => {
  const db = makeTestDb();
  insertCustomer(db, {
    primary_id: 'p1',
    wxid_legacy: 'wxid_a',
    nicknames: ['张三'],
  });
  const r = scoreCandidates(db, { nicknames: ['李四'] });
  // No phash on either side, no remark, no nickname overlap → score = 0
  assert.ok(r.length === 0 || r[0]!.score === 0, `unexpected ${JSON.stringify(r)}`);
});

// ---- scoreCandidates: remark dimension -----------------------------------

test('scoreCandidates: exact remark match → adds 0.15 to score', () => {
  const db = makeTestDb();
  insertCustomer(db, {
    primary_id: 'p1',
    wxid_legacy: 'wxid_a',
    remark: '客户A',
  });
  const r = scoreCandidates(db, { remark: '客户A' });
  assert.equal(r.length, 1);
  // remark match = 1 → contributes 0.15
  assert.ok(r[0]!.score >= 0.14 && r[0]!.score <= 0.16, `score=${r[0]!.score}`);
  assert.equal(r[0]!.evidence.remark, 1);
});

test('scoreCandidates: different remark → remark dim = 0', () => {
  const db = makeTestDb();
  insertCustomer(db, { primary_id: 'p1', wxid_legacy: 'wxid_a', remark: '客户A' });
  const r = scoreCandidates(db, { remark: '客户B' });
  assert.ok(r.length === 0 || r[0]!.evidence.remark === 0);
});

// ---- scoreCandidates: weighted-sum + ordering ----------------------------

test('scoreCandidates: weighted-sum sums dimensions correctly', () => {
  const db = makeTestDb();
  const phash = 'a'.repeat(64);
  insertCustomer(db, {
    primary_id: 'p_combined',
    wxid_legacy: 'wxid_combined',
    avatar_phash: phash,
    nicknames: ['老王'],
    remark: 'VIP',
  });
  const r = scoreCandidates(db, {
    avatar_phash: phash,           // phash: 1.0 → 0.5
    nicknames: ['老王'],            // nickname: 1.0 → 0.2
    remark: 'VIP',                  // remark: 1 → 0.15
    // co_groups: 0 → 0.0
  });
  assert.equal(r.length, 1);
  // Total: 0.5 + 0.2 + 0.15 + 0 = 0.85
  assert.ok(r[0]!.score >= 0.84 && r[0]!.score <= 0.86, `score=${r[0]!.score}`);
});

test('scoreCandidates: returns candidates sorted by score desc', () => {
  const db = makeTestDb();
  const phash = 'a'.repeat(64);
  insertCustomer(db, {
    primary_id: 'p_high',
    wxid_legacy: 'wxid_high',
    avatar_phash: phash,
    nicknames: ['老王'],
    remark: 'VIP',
  });
  insertCustomer(db, {
    primary_id: 'p_low',
    wxid_legacy: 'wxid_low',
    nicknames: ['张三'],   // nothing else matches input
  });
  const r = scoreCandidates(db, {
    avatar_phash: phash,
    nicknames: ['老王'],
    remark: 'VIP',
  });
  assert.equal(r.length >= 1, true);
  // p_high should come first
  assert.equal(r[0]!.row.primary_id, 'p_high');
});

// ---- scoreCandidates: zero-score candidates filtered out -----------------

test('scoreCandidates: candidates with score=0 are filtered out (signal-to-noise)', () => {
  // Adding pure-noise candidates shouldn't bloat results.
  const db = makeTestDb();
  insertCustomer(db, { primary_id: 'p_noise', wxid_legacy: 'wxid_noise' });
  insertCustomer(db, {
    primary_id: 'p_signal',
    wxid_legacy: 'wxid_signal',
    nicknames: ['老王'],
  });
  const r = scoreCandidates(db, { nicknames: ['老王'] });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.row.primary_id, 'p_signal');
});
