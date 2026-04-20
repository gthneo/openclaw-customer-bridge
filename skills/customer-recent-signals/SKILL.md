---
name: customer-recent-signals
description: 从指定群（通常是 W3 行业学习群）的最近 N 小时消息中提取实体、关键词、整体情绪。用于"市场雷达"agent 周期性扫描行业讨论热点，不参与回复。
---

# 群信号提取技能

## 何时使用

- 行业群（W3 类）的定时雷达扫描
- 想了解某个群最近在讨论什么主题、有没有提到自家产品/竞品
- 售后群（G4）周期性情绪监控（情绪持续负面 → 升级）

## 调用

```
customer.recent_signals({
  "chat_id": "wrOgQhDgAA...",
  "hours": 24
})
```

## 返回

```json
{
  "chat_id": "...",
  "window_hours": 24,
  "entities": [{"text": "竞品X", "type": "product", "count": 5}],
  "keywords": ["定价", "续费", "迁移"],
  "sentiment": "neutral"
}
```

## ⚠️ 边界

- 个人微信群的信号提取**只能用于内部决策**，禁止把分析结果回写到群里
- W3 行业群不要泄漏其他客户隐私
