---
name: customer-merge
description: 把若干 source primary_id 合并到一个 primary_id 下，将 source 行的非空 ID 字段（external_userid / wxid_legacy / unionid / phone_hash）coalesce 进 primary，删除 source 行，并把 source_id 追加到 merged_from 列以便审计回溯。
---

# 客户合并技能

## 何时使用

- 收到 `customer.identify` 返回 `sources: ["needs_review"]` 且人工确认是同一人时
- 通过同主体公众号 unionid 反查后，发现两条历史记录可以打通时
- 手工运维时，需要把误判的 split 客户合并

## 调用

```
customer.merge({
  "primary_id": "wmOgQhDgAA-保留",
  "source_ids": ["wxid_zhangsan", "pending:1761910000"],
  "bridge_method": "unionid_strict"
})
```

`bridge_method` 可选值：
- `manual` — 人工合并
- `phash` — 头像 pHash 高相似
- `nickname` — 昵称 + 备注名匹配
- `unionid_strict` — 同主体公众号 unionid 反查（最可信）
- `phone` — 手机号哈希匹配

## 返回

```json
{ "ok": true, "primary_id": "wmOgQhDgAA-保留", "merged_count": 2 }
```

## ⚠️ 注意

- 合并是**事务性的且不可逆**（source 行被删除）
- 必须确保 `bridge_method` 真实反映合并依据；这是审计字段
- `merged_from` 列保留 source ID 列表，紧急情况可手动还原（但相关 wxid/external_userid 关系已 coalesce 进 primary）
