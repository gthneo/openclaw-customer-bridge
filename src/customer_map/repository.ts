import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CustomerRow } from "../types.js";

const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "schema.sql");

export function openCustomerMapDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

export function findByExternalUserid(db: Database.Database, externalUserid: string): CustomerRow | undefined {
  return db.prepare("SELECT * FROM customer_map WHERE external_userid = ?").get(externalUserid) as CustomerRow | undefined;
}

export function findByWxid(db: Database.Database, wxid: string): CustomerRow | undefined {
  return db.prepare("SELECT * FROM customer_map WHERE wxid_legacy = ?").get(wxid) as CustomerRow | undefined;
}

export function findByUnionid(db: Database.Database, unionid: string): CustomerRow | undefined {
  return db.prepare("SELECT * FROM customer_map WHERE unionid = ?").get(unionid) as CustomerRow | undefined;
}

export function upsertCustomer(db: Database.Database, row: Partial<CustomerRow> & { primary_id: string }): void {
  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare("SELECT primary_id FROM customer_map WHERE primary_id = ?").get(row.primary_id);
  if (existing) {
    const fields = Object.keys(row).filter((k) => k !== "primary_id");
    if (fields.length === 0) return;
    const setClause = fields.map((k) => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE customer_map SET ${setClause}, updated_at = @updated_at WHERE primary_id = @primary_id`)
      .run({ ...row, updated_at: now });
  } else {
    db.prepare(`INSERT INTO customer_map
      (primary_id, external_userid, wxid_legacy, unionid, phone_hash, avatar_phash, nickname_set, confidence, bridge_method, merged_from, created_at, updated_at)
      VALUES (@primary_id, @external_userid, @wxid_legacy, @unionid, @phone_hash, @avatar_phash, @nickname_set, @confidence, @bridge_method, @merged_from, @created_at, @updated_at)`)
      .run({
        primary_id: row.primary_id,
        external_userid: row.external_userid ?? null,
        wxid_legacy: row.wxid_legacy ?? null,
        unionid: row.unionid ?? null,
        phone_hash: row.phone_hash ?? null,
        avatar_phash: row.avatar_phash ?? null,
        nickname_set: row.nickname_set ?? "[]",
        confidence: row.confidence ?? 0,
        bridge_method: row.bridge_method ?? null,
        merged_from: row.merged_from ?? "[]",
        created_at: now,
        updated_at: now,
      });
  }
}

export function recordMergeProposal(
  db: Database.Database,
  args: { primary_id: string; source_ids: string[]; confidence: number; evidence: Record<string, unknown> }
): number {
  const now = Math.floor(Date.now() / 1000);
  const info = db.prepare(`INSERT INTO merge_proposal
    (primary_id, source_ids, confidence, evidence, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(args.primary_id, JSON.stringify(args.source_ids), args.confidence, JSON.stringify(args.evidence), now);
  return Number(info.lastInsertRowid);
}
