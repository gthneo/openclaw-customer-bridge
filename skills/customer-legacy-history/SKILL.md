---
name: customer-legacy-history
description: 给定 primary_id，从 wechat-decrypt MCP 拉取该客户的历史聊天消息（仅当 primary_id 已绑定 wxid_legacy）。只读，不写、不发。用于让 agent 在回复 WeCom 客户前回顾历史。
---

# 历史消息查询技能

## 何时使用

- agent 准备回复某个 WeCom 老客户前，先调用此 tool 拿到他在个人微信侧的最近 N 条对话，作为 context
- 客户问"上次我们说的那个事"时，回溯历史
- 周报/月报需要总结某客户的最近沟通脉络

## 调用

```
customer.legacy_history({
  "primary_id": "wmOgQhDgAA...",
  "limit": 50,
  "before_unix": 1761900000
})
```

## 返回

```json
{
  "messages": [
    { "ts": 1761800000, "from": "self", "content": "..." },
    { "ts": 1761801000, "from": "peer", "content": "..." }
  ]
}
```

或：

```json
{ "messages": [], "reason": "no wxid_legacy bound to this primary_id" }
```

## ⚠️ 边界

- 只读，绝不发消息回个人微信（合规红线）
- 如果客户从未在个人微信里出现过（仅 WeCom 新客户），返回空 + 原因
- 历史信息只能用于内部 context；引用客户原话时要谨慎措辞
