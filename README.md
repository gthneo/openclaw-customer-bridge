# @gthneo/openclaw-customer-bridge-plugin

OpenClaw plugin: cross-channel customer identity bridge + 12-class chat classifier.

Bridges three identity spaces:
- `wxid` (legacy personal WeChat, sourced via `wechat` MCP server proxying wechat-decrypt)
- `external_userid` (WeCom external contact)
- `unionid` (WeChat Open Platform, when same-subject OA is bound)

## Requirements

- OpenClaw `>=2026.4.0`. On `2026.5.4+` the plugin declares `contracts.tools`
  (required by the new manifest gate) and ships a bundled `dist/index.js`
  with `openclaw` / `better-sqlite3` left external so the host's ESM
  resolver finds them.

## Install

```bash
openclaw plugins install github:gthneo/openclaw-customer-bridge#v0.3.4

# 1. WeCom credentials so refresh_index can hit the corp API
openclaw config set plugins.entries.openclaw-customer-bridge.config --strict-json \
  '{"wecomCorpId":"<corpid>","wecomAgentId":"<agentid>","wecomSecret":"<secret>"}'

# 2. CRITICAL: extend tools.allow if it exists (some installs set it to a strict
# allowlist e.g. ["wecom_mcp"]; without this our customer_* tools won't reach
# the agent). If tools.allow is unset, you can skip — empty/missing = allow all.
openclaw config set tools.allow --strict-json \
  '["wecom_mcp","customer_list","customer_search","customer_show","customer_identify","customer_merge","customer_classify_chat","customer_legacy_history","customer_recent_signals","customer_refresh_index","customer_import_legacy_contacts","customer_health"]'

systemctl --user restart openclaw-gateway
openclaw plugins doctor   # expect 0 errors
```

## Tools registered

| Tool name | Purpose |
|---|---|
| `customer_classify_chat` | classify a chat into one of 12 classes (C1/C2/G1-G4/W1-W3/N1-N2/X1) |
| `customer_identify` | resolve `external_userid`/`wxid` → unified `primary_id` with confidence |
| `customer_merge` | merge candidate IDs after human or auto confirmation |
| `customer_legacy_history` | retrieve chat history from wechat-decrypt for a `primary_id` |
| `customer_recent_signals` | extract entities/keywords from recent chat for a group |
| `customer_refresh_index` | cron-driven groupchat_index refresh from WeCom API |
| `customer_import_legacy_contacts` | import legacy WeChat contacts via the wechat MCP server |
| `customer_list` / `customer_search` / `customer_show` | read-side queries against `customer_map.db` |
| `customer_health` | self-check (db reachable, schema version, wechat MCP probe) |

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

## Build

```bash
npm install
npm run build       # esbuild bundle (externals: openclaw, better-sqlite3, sharp,
                    # @modelcontextprotocol/sdk, @sinclair/typebox, eventsource)
npm run typecheck   # tsc --noEmit
npm test            # node --import tsx --test tests/*.test.ts
```

`dist/index.js` is a single ESM bundle. `import "openclaw"` and `import "better-sqlite3"`
are preserved so the OpenClaw host resolves them at load time — do **not** add them
to the bundle. Verify with `grep 'from "openclaw' dist/index.js` (should match).

## Changelog

- **0.3.7** — declare `activation.onStartup: true` in `openclaw.plugin.json`
  so the gateway includes us in `startupPluginIds` and therefore runs our
  registered services from `startPluginServices()` post-attach. Without
  this the manifest classifier (`shouldConsiderForGatewayStartup` in OC
  `2026.5.7` channel-plugin-ids module) drops the plugin from the startup
  set entirely — `register()` is called for `inspect`/`doctor` but
  `service.start()` callbacks are never invoked, so the 0.3.6 deferred
  registration never fired. End-to-end POST verified on thfs .140
  2026-05-15: returns `HTTP 400 SCHEMA` (auth + route mounted) instead
  of 404. http server listening log now reports
  `2 plugins: openclaw-customer-bridge, wecom-openclaw-plugin`.
- **0.3.6** — ingest route registration moved out of `register()` and into
  a deferred `api.registerService({ id, start })` callback so it fires from
  `startPluginServices()` — the same lifecycle slot
  `startChannels()` uses for wecom / googlechat / bluebubbles / zalo
  webhook routes. The gateway calls `pinActivePluginHttpRouteRegistry()`
  **before** that slot, so routes registered there land on the pinned
  active runtime registry that the HTTP server actually reads at request
  time. The previous flow (0.3.5) wrote the route from `register()`,
  which runs **before** `setActivePluginRegistry()` swaps the registry —
  so the route ended up on an orphan pre-pin registry and 404'd even
  though the register call itself succeeded. Diagnosed on thfs .140
  2026-05-15.
- **0.3.5** — ingest HTTP route now registers via `registerPluginHttpRoute`
  from `openclaw/plugin-sdk/webhook-targets` (dynamic / active-registry
  path used by all channel-style plugins), replacing the previous
  `api.registerHttpRoute` call. The latter writes to the load-time
  registry which the gateway HTTP server can drift away from after a
  registry swap, leaving the route 404 even though the plugin loads
  cleanly. Diagnosed on thfs 2026-05-15.
- **0.3.4** — esbuild bundle with `--external:openclaw --external:better-sqlite3`;
  added `contracts.tools` to `openclaw.plugin.json` for OC `2026.5.4+` manifest gate.
  Fixes `ERR_MODULE_NOT_FOUND: Cannot find package 'openclaw'` and
  `plugin must declare contracts.tools before registering agent tools` on
  OpenClaw `2026.5.7`.
- **0.3.3** — `legacy_history` adds `summary`/`json` formats + size cap.
- **0.3.2** — fix `legacy_history` schema; add `customer_health` probe.
- **0.3.1** — rename `customer.*` tools to `customer_*` (LLM tool-name compat).
