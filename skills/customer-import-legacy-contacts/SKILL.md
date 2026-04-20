---
name: customer-import-legacy-contacts
description: 从 wechat-decrypt MCP（.193）只读拉取个人微信好友，扁平导入到 customer_map（主键 wxid_legacy=wxid）。已存在则只更新 nickname/remark，绝不写回 .193。一次拉满（无分页 cursor），用 limit 控制最大值。
---

# 导入历史微信好友

## 何时使用

- 首次部署或定期同步个人微信好友数据到 customer_map
- 用户在 TUI 里说"把我所有微信好友灌进来 / 导入历史微信"
- 后续 customer.identify 概率匹配前的初始数据填充

## 调用

```
customer.import_legacy_contacts({})
# 或限定批量
customer.import_legacy_contacts({ "limit": 5000 })
# 先看不写
customer.import_legacy_contacts({ "dry_run": true, "limit": 10 })
# 按关键字过滤再导入
customer.import_legacy_contacts({ "query": "李", "limit": 100 })
```

## 返回

```json
{
  "ok": true,
  "total_reported": 3127,
  "parsed_count": 3127,
  "inserted": 3000,
  "updated": 127,
  "skipped": 0
}
```

## ⚠️ 硬约束

- **绝对只读**：调用 wechat MCP 时只能用 get_* / search_* 类 tool；插件代码内部已强制 allowlist，违反会抛 `WechatMcpWriteAttempted`
- 个人微信不允许任何自动化写操作（合规红线 + 封号风险）
- 本工具只把 .193 的数据**复制到** .178 的 customer_map.db，不修改 .193 任何内容
