---
name: customer-classify-chat
description: 将一个会话（企业微信内部群/外部客户群/wechat-decrypt 个人微信群）映射到 12 个分类 (C1/C2/G1-G4/W1-W3/N1-N2/X1) 中的一个，便于按群类分发到对应 agent。先查 groupchat_index 缓存，未命中返回 UNKNOWN。
---

# 会话分类技能

## 何时使用

- 接到任何来自 wecom 或 wechat MCP 的会话事件后，第一步先调用此 tool 决定路由目标
- 路由器规则按 `chat_class` 字段分发到不同 agent

## 调用

`customer.classify_chat({"chat_id": "<wecom_chat_id 或 chatroom_id>"})`

## 返回

```json
{ "chat_id": "wrOgQhDgAAcwMHLm...", "chat_class": "G3", "source": "index" }
```

## 12 个分类

| Class | 含义 | 路由建议 |
|---|---|---|
| C1 | 个人微信核心 1 对 1 | agent.legacy_kol（只读）|
| C2 | WeCom 已迁老客户 1 对 1 | agent.vip_handler |
| G1 | 高净值客户群（小群）| agent.vip_handler |
| G2 | 项目交付群 | agent.delivery_assistant |
| G3 | 课程训练营群 | agent.cohort_ops |
| G4 | 售后群 | agent.support_l1 |
| W1 | 个人微信群（你是群主）| agent.legacy_kol（只读）|
| W2 | 个人微信群（你是成员）| agent.observer（只读）|
| W3 | 行业学习群 | agent.market_radar |
| N1 | 内部协作群 | agent.internal_ops |
| N2 | 外部供应商混合群 | agent.procurement |
| X1 | 拉新活动临时群 | agent.campaign_ops |
| UNKNOWN | 未在索引中 | 调 `customer.refresh_index` 后重试 |
