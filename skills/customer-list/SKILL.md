---
name: customer-list
description: 分页列出 customer_map 里所有客户，支持按身份桥过滤（只看有企微ID的/只看有微信wxid的）。触发词：列出客户 / 看客户列表 / 有多少客户 / 所有联系人 / 客户总数 / 翻页查看客户 / 数据库里有哪些人 / list customers
---

# 客户列表

## 何时使用

- 了解 customer_map 当前规模和数据组成
- 翻页浏览所有客户
- 筛选只看已和企微打通的客户，或只看老微信好友

## 调用

```
# 默认：前 20 条，按 updated_at 倒序
customer_list({})

# 翻页
customer_list({ "limit": 50, "offset": 50 })

# 只看已绑企微 external_userid 的
customer_list({ "only_with_external_userid": true })

# 只看老微信好友（有 wxid_legacy）
customer_list({ "only_with_wxid_legacy": true, "limit": 100 })

# 只看打通了 unionid 的
customer_list({ "only_with_unionid": true })
```

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `limit` | number | 20 | 页大小，最大 200 |
| `offset` | number | 0 | 翻页偏移 |
| `only_with_external_userid` | boolean | false | 只返回有企微 ID 的行 |
| `only_with_wxid_legacy` | boolean | false | 只返回有个人微信 wxid 的行 |
| `only_with_unionid` | boolean | false | 只返回有 unionid 的行 |

## 返回

```json
{
  "total": 3142,
  "limit": 20,
  "offset": 0,
  "returned": 20,
  "rows": [
    {
      "primary_id": "wxid_xxx",
      "display_name": "张三 客户A",
      "external_userid": null,
      "wxid_legacy": "wxid_xxx",
      "unionid": null,
      "confidence": 1,
      "updated_at_unix": 1776700000
    }
  ]
}
```
