---
name: customer-list
description: 分页浏览 customer_map。每行返回 primary_id + display_name (remark > nickname > wxid 优先级) + 三种身份桥 ID + confidence。可按是否含 external_userid / wxid_legacy / unionid 过滤。默认 20 行一页，按 updated_at 倒序。
---

# 客户列表

## 何时使用

- 用户在 TUI 里说"看下都有哪些客户 / 列表 / 总共多少"
- 想了解 customer_map 当前规模与数据组成
- 翻页查看时（`offset` 递增）

## 调用

```
customer.list({})
customer.list({ "limit": 50, "offset": 0 })
# 只看已经在企微外部联系人里的
customer.list({ "only_with_external_userid": true })
# 只看老微信好友
customer.list({ "only_with_wxid_legacy": true, "limit": 100 })
```

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
      "remark": "张三 客户A",
      "nicknames": ["张哥"],
      "external_userid": null,
      "wxid_legacy": "wxid_xxx",
      "unionid": null,
      "confidence": 1,
      "bridge_method": null,
      "created_at_unix": 1776700000,
      "updated_at_unix": 1776700000
    }
  ]
}
```

## TUI 展示建议

把 rows 渲染成简洁的表格：`显示名 | wxid | 企微 | 备注源`。total/limit/offset 用一行总结。
