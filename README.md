# @gthneo/openclaw-customer-bridge-plugin

OpenClaw plugin: cross-channel customer identity bridge + 12-class chat classifier.

Bridges three identity spaces:
- `wxid` (legacy personal WeChat, sourced via `wechat` MCP server proxying wechat-decrypt)
- `external_userid` (WeCom external contact)
- `unionid` (WeChat Open Platform, when same-subject OA is bound)

## Install

```bash
openclaw plugins install github:gthneo/openclaw-customer-bridge#v0.3.1

# 1. WeCom credentials so refresh_index can hit the corp API
openclaw config set plugins.entries.openclaw-customer-bridge.config --strict-json \
  '{"wecomCorpId":"<corpid>","wecomAgentId":"<agentid>","wecomSecret":"<secret>"}'

# 2. CRITICAL: extend tools.allow if it exists (some installs set it to a strict
# allowlist e.g. ["wecom_mcp"]; without this our customer_* tools won't reach
# the agent). If tools.allow is unset, you can skip — empty/missing = allow all.
openclaw config set tools.allow --strict-json \
  '["wecom_mcp","customer_list","customer_search","customer_show","customer_identify","customer_merge","customer_classify_chat","customer_legacy_history","customer_recent_signals","customer_refresh_index","customer_import_legacy_contacts"]'

systemctl --user restart openclaw-gateway
```

## Tools registered

| Tool name | Purpose |
|---|---|
| `customer.classify_chat` | classify a chat into one of 12 classes (C1/C2/G1-G4/W1-W3/N1-N2/X1) |
| `customer.identify` | resolve `external_userid`/`wxid` → unified `primary_id` with confidence |
| `customer.merge` | merge candidate IDs after human or auto confirmation |
| `customer.legacy_history` | retrieve chat history from wechat-decrypt for a `primary_id` |
| `customer.recent_signals` | extract entities/keywords from recent chat for a group |
| `customer.refresh_index` | cron-driven groupchat_index refresh from WeCom API |

## Storage

SQLite at `dbPath` (default `~/.openclaw/customer_map.db`). Schema in `src/customer_map/schema.sql`.

## Operational visibility (ingest endpoint)

When `ingestAuthToken` is configured, the plugin registers `POST /plugins/openclaw-customer-bridge/ingest`. Every request emits a single-line log to the gateway journal so ops can scan for upstream wiring bugs without sqlite forensics.

### Log line shapes

```
# success (real-transcript-write OR stub):
[customer-bridge] inject ok mode=real session_key=agent:main:openclaw-weixin:chat:<id> message_id=<8hex> trigger=kw:合同 sender_nickname="Alice" bytes=42

# duplicate event_id (short-circuit):
[customer-bridge] inject dedup-hit event_id=<ulid> session_key=<sk> message_id=<mid>

# rpc.chatInject returned ok:false (warn level):
[customer-bridge] inject FAIL mode=real event_id=<ulid> err=<error message>

# soft schema-sanity warn (non-blocking; payload still injects):
[customer-bridge] suspicious: sender_nickname == chat_id, likely upstream wiring bug event_id=<ulid> chat_id=<chat_id>
[customer-bridge] suspicious: sender_nickname == chat_name in group, possible upstream sender/chat-level confusion event_id=<ulid> chat_id=<chat_id>
```

**`sender_nickname` is the highest-value field for ops.** If it looks like a `chat_id` (`xxx@chatroom`) or matches `chat_name` for a group, the upstream powerdata side has wired chat-level metadata into the sender slot — the symptom that hid for half a day on 2026-05-03 before sqlite spelunking.

### ingest_log table (forensic backup)

When the live log isn't enough (e.g. retroactive triage), every accepted request also lands in `customer_map.db.ingest_log`:

| Column         | Meaning                                                              |
|----------------|----------------------------------------------------------------------|
| `event_id`     | dedup key (powerdata ULID)                                           |
| `primary_id`   | resolved customer primary identity                                   |
| `session_key`  | OpenClaw session key (`agent:<id>:openclaw-weixin:chat:<chat_id_lc>`)|
| `message_id`   | 8-hex id returned by chat.inject (only for `status=ok`)              |
| `status`       | `ok` \| `error`                                                      |
| `error_message`| populated on `status=error`                                          |
| `ingested_at`  | unix epoch seconds                                                   |

Triage cookbook:

```bash
# Recent 20 ingests (newest first), human-friendly time
sqlite3 ~/.openclaw/customer_map.db "SELECT datetime(ingested_at,'unixepoch','localtime'), substr(session_key,1,50), substr(message_id,1,12), status FROM ingest_log ORDER BY ingested_at DESC LIMIT 20"

# Errors only
sqlite3 ~/.openclaw/customer_map.db "SELECT datetime(ingested_at,'unixepoch','localtime'), event_id, error_message FROM ingest_log WHERE status='error' ORDER BY ingested_at DESC"

# Find a specific event by session
sqlite3 ~/.openclaw/customer_map.db "SELECT * FROM ingest_log WHERE session_key LIKE '%<chat_id>%'"
```

Tail live ingest activity on a host:

```bash
# lobster.lan / cats178.lan (Linux, gateway as systemd --user):
journalctl --user -u openclaw-gateway -f | grep -E '\[customer-bridge\] inject|\[customer-bridge\] suspicious'
```

## Status

**Scaffold only.** All tool handlers are stubs. Business logic to be filled in iteratively.
