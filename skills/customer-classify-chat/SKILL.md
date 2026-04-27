---
name: customer-classify-chat
description: 把一个企微群/个人微信群按业务属性分到 12 个类别之一（C1/C2/G1-G4/W1-W3/N1-N2/X1），用于路由到不同 agent。触发词：这个群是什么类型 / 群分类 / 判断一下这个群 / 这个 chat_id 是啥群 / 路由分类 / 给群打标签 / classify chat
---

# 会话分类

## 何时使用

- 收到任何 wecom 或 wechat MCP 的会话事件后，**第一步先分类**决定路由
- 想知道某个群属于客户群/内部群/行业群的哪一种
- 自动化路由规则依赖此工具的 `chat_class` 字段

## 调用

```
customer_classify_chat({ "chat_id": "<wecom_chat_id 或 chatroom_id>" })
```

## 返回

```json
{ "chat_id": "wrOgQhDgAAcwMHLm...", "chat_class": "G3", "source": "index" }
```

`source="index"` 命中本地缓存；返回 `"UNKNOWN"` 说明不在索引，先跑 `customer_refresh_index`。

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
| UNKNOWN | 未在索引中 | 先跑 `customer_refresh_index` |
