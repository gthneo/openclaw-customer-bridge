import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChat, type ChatFacts } from '../src/classifier/rules.ts';

/**
 * Tests for the 12-class chat classifier.
 *
 * 11 existing classes (G1-G4 / W1-W3 / N1-N2 / X1) are already implemented;
 * pin them with regression tests so the C1/C2 addition (per user 2026-04-30
 * decision: C1 = 本人是群主, C2 = 他人) doesn't accidentally break them.
 *
 * The C1/C2 implementation also introduces an extensible InternalGroupRule[]
 * structure with priority, leaving comment-marked extension points for
 * future maturation (group size, name keywords, member composition,
 * activity score). This file pins the v1 behavior; future tests will pin
 * extensions when those are turned on.
 */

function fixture(overrides: Partial<ChatFacts> = {}): ChatFacts {
  return {
    chat_id: 'fake_chat',
    source: 'wechat_internal',
    owner_is_self: false,
    member_count: 5,
    name: 'fake group',
    ...overrides
  };
}

// ---- C1 / C2 (NEW — wechat 自己人内部群) ---------------------------------

test('C1: wechat_internal + owner_is_self=true → C1 (本人是群主)', () => {
  const f = fixture({ source: 'wechat_internal', owner_is_self: true });
  assert.equal(classifyChat(f), 'C1');
});

test('C2: wechat_internal + owner_is_self=false → C2 (他人是群主)', () => {
  const f = fixture({ source: 'wechat_internal', owner_is_self: false });
  assert.equal(classifyChat(f), 'C2');
});

test('C1/C2: independent of member_count (single rule for v1)', () => {
  // The v1 rule is deliberately just owner_is_self — size and other
  // dimensions are reserved as future extension points (see InternalGroupRule
  // priority table). Pin both cases so refactors keep this stable.
  assert.equal(classifyChat(fixture({ source: 'wechat_internal', owner_is_self: true,  member_count: 3 })), 'C1');
  assert.equal(classifyChat(fixture({ source: 'wechat_internal', owner_is_self: true,  member_count: 50 })), 'C1');
  assert.equal(classifyChat(fixture({ source: 'wechat_internal', owner_is_self: false, member_count: 3 })), 'C2');
  assert.equal(classifyChat(fixture({ source: 'wechat_internal', owner_is_self: false, member_count: 50 })), 'C2');
});

// ---- Regression for the 11 existing classes ------------------------------

test('N1: wecom_internal + no external member', () => {
  const f = fixture({ source: 'wecom_internal', has_external_member: false });
  assert.equal(classifyChat(f), 'N1');
});

test('N2: wecom_internal + has external member', () => {
  const f = fixture({ source: 'wecom_internal', has_external_member: true });
  assert.equal(classifyChat(f), 'N2');
});

test('X1: wecom_external + created within last 7 days', () => {
  const now = Math.floor(Date.now() / 1000);
  const f = fixture({ source: 'wecom_external', created_at_unix: now - 3 * 86400 });
  assert.equal(classifyChat(f), 'X1');
});

test('G4: wecom_external + aftersales keyword', () => {
  const f = fixture({ source: 'wecom_external', has_aftersales_keyword: true, created_at_unix: 0 });
  assert.equal(classifyChat(f), 'G4');
});

test('G3: wecom_external + cohort keyword + >50 members', () => {
  const f = fixture({ source: 'wecom_external', has_cohort_keyword: true, member_count: 80, created_at_unix: 0 });
  assert.equal(classifyChat(f), 'G3');
});

test('G2: wecom_external + project keyword + 20-50 members', () => {
  const f = fixture({ source: 'wecom_external', has_project_keyword: true, member_count: 30, created_at_unix: 0 });
  assert.equal(classifyChat(f), 'G2');
});

test('G1: wecom_external + owner_is_self + small (<20)', () => {
  const f = fixture({ source: 'wecom_external', owner_is_self: true, member_count: 10, created_at_unix: 0 });
  assert.equal(classifyChat(f), 'G1');
});

test('G2 default: wecom_external + nothing else matches → G2', () => {
  const f = fixture({ source: 'wecom_external', member_count: 100, created_at_unix: 0 });
  assert.equal(classifyChat(f), 'G2');
});

test('N2 supplier override: wecom_external + supplier tag → N2', () => {
  const f = fixture({ source: 'wecom_external', has_supplier_tag: true, created_at_unix: 0 });
  assert.equal(classifyChat(f), 'N2');
});

test('W1: wechat_legacy + owner_is_self', () => {
  const f = fixture({ source: 'wechat_legacy', owner_is_self: true });
  assert.equal(classifyChat(f), 'W1');
});

test('W3: wechat_legacy + industry keyword', () => {
  const f = fixture({ source: 'wechat_legacy', has_industry_keyword: true });
  assert.equal(classifyChat(f), 'W3');
});

test('W2 default: wechat_legacy + nothing else → W2', () => {
  const f = fixture({ source: 'wechat_legacy' });
  assert.equal(classifyChat(f), 'W2');
});

// ---- Unknown fallback ----------------------------------------------------

test('UNKNOWN: source not recognized', () => {
  // Type-cast — this state can only happen when an upstream upgrades the
  // source enum and we haven't caught up. The classifier must degrade
  // gracefully rather than throw.
  const f = fixture({ source: 'something_new_we_dont_know' as ChatFacts['source'] });
  assert.equal(classifyChat(f), 'UNKNOWN');
});
