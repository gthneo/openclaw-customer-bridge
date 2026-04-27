---
name: customer-recent-signals
description: 从指定群的最近 N 小时消息中提取实体、关键词和整体情绪，用于行业雷达或售后群情绪监控。触发词：这个群最近在讨论什么 / 群里的热点 / 监控群情绪 / 行业群雷达 / 最近有没有提到竞品 / 扫描群信号 / 群关键词 / recent signals
---

# 群信号提取

## 何时使用

- **行业群（W3）定时雷达**：周期性扫描讨论热点、竞品动态
- **售后群（G4）情绪监控**：情绪持续负面时升级处理
- 想了解某个群最近在聊什么

## 调用

```
# 过去 24 小时（默认）
customer_recent_signals({ "chat_id": "wrOgQhDgAA..." })

# 自定义时间窗口
customer_recent_signals({ "chat_id": "wrOgQhDgAA...", "hours": 48 })
```

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `chat_id` | string | **必填** | WeCom chat_id 或 wechat chatroom_id |
| `hours` | number | 24 | 往前看多少小时 |

## 返回

```json
{
  "chat_id": "wrOgQhDgAA...",
  "window_hours": 24,
  "entities": [
    { "text": "竞品X", "type": "product", "count": 5 }
  ],
  "keywords": ["定价", "续费", "迁移"],
  "sentiment": "neutral"
}
```

`sentiment`：`positive` / `neutral` / `negative`

## ⚠️ 边界

- 个人微信群的信号分析**只能用于内部决策**，禁止把结果回写到群里
