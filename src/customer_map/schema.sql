CREATE TABLE IF NOT EXISTS customer_map (
  primary_id        TEXT PRIMARY KEY,
  external_userid   TEXT UNIQUE,
  wxid_legacy       TEXT UNIQUE,
  unionid           TEXT UNIQUE,
  phone_hash        TEXT,
  avatar_phash      TEXT,
  nickname_set      TEXT NOT NULL DEFAULT '[]',
  confidence        REAL NOT NULL DEFAULT 0,
  bridge_method     TEXT,
  merged_from       TEXT NOT NULL DEFAULT '[]',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_map_external ON customer_map(external_userid);
CREATE INDEX IF NOT EXISTS idx_customer_map_wxid     ON customer_map(wxid_legacy);
CREATE INDEX IF NOT EXISTS idx_customer_map_unionid  ON customer_map(unionid);
CREATE INDEX IF NOT EXISTS idx_customer_map_phone    ON customer_map(phone_hash);

CREATE TABLE IF NOT EXISTS groupchat_index (
  chat_id        TEXT PRIMARY KEY,
  owner          TEXT NOT NULL,
  member_count   INTEGER NOT NULL DEFAULT 0,
  name           TEXT NOT NULL DEFAULT '',
  classified_as  TEXT NOT NULL DEFAULT 'UNKNOWN',
  raw_json       TEXT,
  refreshed_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groupchat_class ON groupchat_index(classified_as);

CREATE TABLE IF NOT EXISTS merge_proposal (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_id      TEXT NOT NULL,
  source_ids      TEXT NOT NULL,
  confidence      REAL NOT NULL,
  evidence        TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      INTEGER NOT NULL,
  resolved_at     INTEGER,
  resolved_by     TEXT
);

CREATE INDEX IF NOT EXISTS idx_merge_status ON merge_proposal(status);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, strftime('%s','now'));
