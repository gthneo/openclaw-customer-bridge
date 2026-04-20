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

export function scoreCandidates(_db: Database.Database, _input: MatchInput): MatchCandidate[] {
  // STUB: probabilistic identity match — pHash + nickname Jaccard + remark match + co-group overlap
  // Implementation steps:
  // 1. Pull all customer_map rows that have wxid_legacy populated (legacy-only candidates)
  // 2. For each candidate, compute Hamming distance on avatar pHash → normalized [0,1]
  // 3. Jaccard similarity on nickname_set (parse JSON array)
  // 4. Exact match on remark name → 1.0 else 0
  // 5. Co-group overlap requires querying both wechat-decrypt and groupchat_index
  // 6. Weighted sum using WEIGHTS, return sorted desc
  void WEIGHTS;
  return [];
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
