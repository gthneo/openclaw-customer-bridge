---
name: customer-import-legacy-contacts
description: 从 wechat-decrypt MCP 拉取个人微信好友列表，批量导入到 customer_map 数据库。只读，绝不写回微信。触发词：导入微信好友 / 把微信联系人灌进来 / 同步微信通讯录 / 初始化客户数据 / 把微信好友导入数据库 / 历史联系人导入 / import legacy contacts
---

# 导入微信好友

## 何时使用

- **首次部署**：customer_map.db 是空库，先跑这个填充数据
- 定期同步（已存在的只更新 nickname/remark，不重复插入）
- `customer_legacy_history` 报 `no wxid_legacy bound` 时，说明该联系人还没导入

## 调用

```
# 全量导入（默认最多 50000 条）
customer_import_legacy_contacts({})

# 限量
customer_import_legacy_contacts({ "limit": 1000 })

# 预览，不写库
customer_import_legacy_contacts({ "dry_run": true, "limit": 10 })

# 按关键字过滤再导入
customer_import_legacy_contacts({ "query": "李", "limit": 200 })
```

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | `""` | 昵称/备注关键字，传给 wechat MCP |
| `limit` | number | 50000 | 最大拉取条数 |
| `dry_run` | boolean | false | true=只解析不写库，用于预检 |

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

- **绝对只读**：只调 wechat MCP 的 `get_contacts`，禁止任何写操作
- 个人微信禁止自动化写操作（合规红线 + 封号风险）
