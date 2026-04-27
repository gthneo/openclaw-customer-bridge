---
name: customer-show
description: 按 primary_id 查看 customer_map 中某个客户的完整信息，包括所有身份桥 ID、昵称集、置信度和合并历史。触发词：看一下这个客户详情 / 查 primary_id 的信息 / 这个人的完整资料 / 客户详情 / 看看这个 ID / 这个客户绑了哪些 ID / show customer
---

# 客户详情

## 何时使用

- 在 `customer_search` 或 `customer_list` 拿到 `primary_id` 后，查完整记录
- 准备执行 `customer_merge` 之前，确认两边 primary_id 都正确
- 排查身份匹配问题，查看 `merged_from` 审计轨迹
- 确认某个客户是否同时有企微 ID 和微信 wxid

## 调用

```
customer_show({ "primary_id": "wxid_zhangsan" })
```

## 返回（找到时）

```json
{
  "found": true,
  "primary_id": "wxid_zhangsan",
  "external_userid": "wm_OgXXX",
  "wxid_legacy": "wxid_zhangsan",
  "unionid": null,
  "phone_hash": null,
  "avatar_phash": "f8c1a5...",
  "nickname_set": {
    "remark": "张三 客户A",
    "nicks": ["张哥"],
    "source": "wechat-decrypt-import"
  },
  "confidence": 1,
  "bridge_method": "nickname",
  "merged_from": ["pending:1776600000"],
  "created_at_unix": 1776700000,
  "updated_at_unix": 1776700000
}
```

## 返回（未找到时）

```json
{ "found": false, "primary_id": "wxid_unknown" }
```

## 字段说明

| 字段 | 说明 |
|---|---|
| `external_userid` | 企微外部联系人 ID |
| `wxid_legacy` | 个人微信 wxid（wechat-decrypt 侧）|
| `unionid` | 微信开放平台 unionid |
| `confidence` | 身份桥置信度，1=强 ID 直接匹配 |
| `bridge_method` | 最后一次合并方法 |
| `merged_from` | 被合并进来的历史 ID 列表（审计用）|
