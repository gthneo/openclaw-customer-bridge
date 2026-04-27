---
name: customer-health
description: 检查 customer bridge 整体健康状态：customer_map 数据库连通性与行数、wechat MCP 连通性与延迟。触发词：健康检查 / 连接测试 / bridge 状态 / 检查一下 wechat mcp / 数据库多少条 / bridge 能用吗 / customer bridge ok 吗 / health check
---

# Customer Bridge 健康检查

## 何时使用

- 其他 customer_* 工具报错（超时、连接拒绝、401）时，**第一步先跑这个**
- 刚重启 openclaw-gateway 后确认插件正常
- 想知道 customer_map 当前有多少条记录
- 确认 wechat MCP（192.168.1.175:8765）是否可达

## 调用

```
customer_health({})
```

无参数。

## 返回

```json
{
  "customer_map": {
    "ok": true,
    "row_count": 3127,
    "db_path": "/home/dbos-user/.openclaw/customer_map.db"
  },
  "wechat_mcp": {
    "ok": true,
    "latency_ms": 42,
    "server": "wechat"
  }
}
```

## 诊断速查

| 现象 | 可能原因 | 下一步 |
|---|---|---|
| `customer_map.ok=false` | SQLite 文件权限/损坏 | 检查 `~/.openclaw/customer_map.db` |
| `wechat_mcp ECONNREFUSED` | .175 MCP service 未启动 | 去 .175 控制台 → Start |
| `wechat_mcp 401` | token 过期或被替换 | `openclaw config set mcp.servers.wechat` 更新 token |
| `row_count=0` | 未导入联系人 | 先跑 `customer_import_legacy_contacts` |
