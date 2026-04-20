---
name: customer-identify
description: 把 external_userid / wxid / unionid / 头像 phash / 昵称等任意识别信号解析为统一的 primary_id，返回 confidence 与匹配证据。强 ID 命中 confidence=1；仅软信号时走概率匹配，confidence < auto 阈值时返回 needs_review。
---

# 客户身份解析技能

## 何时使用

- 收到 WeCom `external_contact_add` 事件时，用 `external_userid` 调用以获取（或新建）`primary_id`
- 想对一个 wxid 与 external_userid 是否同一人做判断时（结果可能是 `merged: true` 或 `needs_review`）

## 调用

```
customer.identify({
  "external_userid": "wmOgQhDgAAj...",
  "nicknames": ["张三", "三哥"],
  "avatar_phash": "f8c1a5..."
})
```

任意字段都可缺失，至少给一个信号。

## 返回

```json
{
  "primary_id": "wmOgQhDgAAj...",
  "confidence": 0.93,
  "sources": ["auto_match"],
  "merged": true,
  "evidence": { "phash": 0.95, "nickname": 0.8 }
}
```

`sources` 可能取值：
- `external_userid` / `wxid` / `unionid` — 强 ID 命中，confidence=1
- `auto_match` — 概率匹配 ≥ mergeThresholdAuto，自动合并
- `needs_review` — 概率匹配在 review/auto 之间，需要人工确认（应进入复核队列）
- `new` — 视为新客户已落库

## 后续动作

- `merged: true` 但 `confidence < 1` → 写一条 audit log，便于事后回溯
- `sources: ["needs_review"]` → 调用 `customer.merge` 之前必须有人工确认
