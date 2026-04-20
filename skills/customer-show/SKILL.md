---
name: customer-show
description: 给定 primary_id，返回 customer_map 完整行，含解析后的 nickname_set 和 merged_from 历史。primary_id 不存在时返回 found:false。
---

# 客户详情

## 何时使用

- 在 list / search 拿到 primary_id 后，要看完整身份桥信息
- 准备 customer.merge 之前确认两边都正确
- 调试匹配问题、查 merged_from 审计

## 调用

```
customer.show({ "primary_id": "wxid_zsan" })
```

## 返回

```json
{
  "found": true,
  "primary_id": "wxid_zsan",
  "external_userid": "wm_OgXXX",
  "wxid_legacy": "wxid_zsan",
  "unionid": null,
  "phone_hash": null,
  "avatar_phash": null,
  "nickname_set": {
    "remark": "张三 客户A",
    "nicks": ["张哥"],
    "source": "wechat-decrypt-import",
    "imported_at": 1776700000
  },
  "confidence": 1,
  "bridge_method": "nickname",
  "merged_from": ["pending:1776600000"],
  "created_at_unix": 1776700000,
  "updated_at_unix": 1776700000
}
```

或：

```json
{ "found": false, "primary_id": "wxid_unknown" }
```
