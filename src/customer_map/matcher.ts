import type Database from "better-sqlite3";
import type { CustomerRow } from "../types.js";

export interface MatchCandidate {
  row: CustomerRow;
  score: number;
  evidence: {
    phash?: number;
    nickname?: number;
    remark?: number;
    co_groups?: number;
  };
}

export interface MatchInput {
  external_userid?: string;
  wxid?: string;
  avatar_phash?: string;
  nicknames?: string[];
  remark?: string;
}

const WEIGHTS = {
  phash: 0.5,
  nickname: 0.2,
  remark: 0.15,
  co_groups: 0.15,
};

/**
 * Probabilistic identity matcher across legacy wxid customers.
 *
 * Algorithm:
 *   1. Pull all customer_map rows where wxid_legacy IS NOT NULL — only legacy
 *      customers participate in fuzzy matching (a row tracked solely via
 *      external_userid has no signals to fuzzy-match against).
 *   2. For each candidate, compute four similarity dimensions, each ∈ [0,1]:
 *        a. avatar pHash similarity = 1 - (Hamming distance / max length)
 *        b. nickname_set Jaccard similarity (with `remark` union'd in if the
 *           caller supplied one — many imports stash remarks alongside nicks).
 *        c. exact remark match → 1, else 0
 *        d. co-group overlap — DEFERRED (always 0 in v1; depends on
 *           groupchat_index + wechat MCP, will be wired in next iteration)
 *   3. Weighted sum (WEIGHTS); candidates with score=0 are filtered out
 *      (signal-to-noise).
 *   4. Return sorted desc by score.
 *
 * Max achievable v1 score = 0.5 + 0.2 + 0.15 + 0 = 0.85, which fits the
 * `customer.identify` review-threshold (0.5) but doesn't auto-merge (0.9).
 * That's intentional for v1 — auto-merge needs co-group corroboration.
 */
export function scoreCandidates(db: Database.Database, input: MatchInput): MatchCandidate[] {
  // 1. Pull legacy candidates
  const candidates = db
    .prepare("SELECT * FROM customer_map WHERE wxid_legacy IS NOT NULL")
    .all() as CustomerRow[];
  if (candidates.length === 0) return [];

  // Treat nicknames as their own dimension (independent of remark) — mixing
  // remark into the nickname set caused asymmetric Jaccard against candidate
  // rows that store remark separately. Keep them separate.
  const inputNicks = normalizeNicknames(input.nicknames);
  const out: MatchCandidate[] = [];

  for (const row of candidates) {
    const evidence: MatchCandidate["evidence"] = {};

    // 2a. pHash similarity
    let phashSim = 0;
    if (input.avatar_phash && row.avatar_phash) {
      const d = hammingDistance(input.avatar_phash, row.avatar_phash);
      const maxLen = Math.max(input.avatar_phash.length, row.avatar_phash.length) || 1;
      phashSim = clamp01(1 - d / maxLen);
      evidence.phash = phashSim;
    }

    // 2b. nickname Jaccard (with remark folded in if available)
    let nicknameSim = 0;
    if (inputNicks.length > 0) {
      const rowNicks = normalizeNicknames(parseNicknameSet(row.nickname_set));
      if (rowNicks.length > 0) {
        nicknameSim = jaccardSim(inputNicks, rowNicks);
        evidence.nickname = nicknameSim;
      }
    }

    // 2c. remark exact match
    let remarkSim = 0;
    if (input.remark) {
      const rowRemark = extractRemark(row.nickname_set);
      if (rowRemark && rowRemark === input.remark) {
        remarkSim = 1;
        evidence.remark = 1;
      } else if (rowRemark) {
        evidence.remark = 0;
      }
    }

    // 2d. co-group overlap (DEFERRED to next iteration; always 0 here)
    // When implemented, this should:
    //   - read both customers' group memberships from groupchat_index
    //     (or from wechat MCP get_chat_history → resolve members)
    //   - compute Jaccard on group sets
    //   - normalize to [0,1]
    const coGroupsSim = 0;
    evidence.co_groups = 0;

    const score =
      phashSim * WEIGHTS.phash +
      nicknameSim * WEIGHTS.nickname +
      remarkSim * WEIGHTS.remark +
      coGroupsSim * WEIGHTS.co_groups;

    if (score > 0) {
      out.push({ row, score, evidence });
    }
  }

  // 3. Sort desc by score
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Parse the `nickname_set` JSON column. It can be either:
 *   - a JSON array of strings (legacy format)
 *   - a JSON object {nicks: string[], remark?: string, source?: string, imported_at?: number}
 * Returns just the nicks array (remark extraction is separate via extractRemark).
 */
function parseNicknameSet(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.nicks)) {
      return parsed.nicks.filter((x: unknown) => typeof x === "string");
    }
  } catch {
    /* ignore — corrupt JSON, treat as empty */
  }
  return [];
}

function extractRemark(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.remark === "string") {
      return parsed.remark;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Normalize a nickname list: trim, drop empties, dedupe. */
function normalizeNicknames(nicks: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const n of nicks ?? []) {
    const t = (n ?? "").trim();
    if (t) out.add(t);
  }
  return [...out];
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) d++;
  }
  return d;
}

export function jaccardSim(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const intersection = new Set([...sa].filter((x) => sb.has(x)));
  const union = new Set([...sa, ...sb]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}
