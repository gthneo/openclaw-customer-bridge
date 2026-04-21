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

## Status

**Scaffold only.** All tool handlers are stubs. Business logic to be filled in iteratively.
