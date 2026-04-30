import type Database from "better-sqlite3";

/**
 * Idempotent ingest log — tracks every event_id powerdata POSTs to us.
 *
 * Why: powerdata is at-least-once (it doesn't track ack on its end). When
 * a webhook retry happens or the same event arrives twice, we must NOT
 * inject the message twice into OpenClaw — the user would see duplicates.
 *
 * Schema lives in customer_map/schema.ts:
 *   ingest_log(event_id PK, primary_id, session_key, message_id?,
 *              status, error_message?, ingested_at)
 */

export interface IngestLogRow {
  event_id: string;
  primary_id: string;
  session_key: string;
  message_id: string | null;
  status: "ok" | "dropped" | "error";
  error_message: string | null;
  ingested_at: number;
}

export function alreadyIngested(db: Database.Database, eventId: string): boolean {
  const r = db.prepare("SELECT 1 FROM ingest_log WHERE event_id = ?").get(eventId);
  return r !== undefined;
}

export function getIngestLog(db: Database.Database, eventId: string): IngestLogRow | undefined {
  return db.prepare("SELECT * FROM ingest_log WHERE event_id = ?").get(eventId) as IngestLogRow | undefined;
}

export function recordIngestLog(
  db: Database.Database,
  args: {
    event_id: string;
    primary_id: string;
    session_key: string;
    message_id?: string;
    status?: "ok" | "dropped" | "error";
    error_message?: string;
  }
): void {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT OR REPLACE INTO ingest_log
    (event_id, primary_id, session_key, message_id, status, error_message, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      args.event_id,
      args.primary_id,
      args.session_key,
      args.message_id ?? null,
      args.status ?? "ok",
      args.error_message ?? null,
      now
    );
}
