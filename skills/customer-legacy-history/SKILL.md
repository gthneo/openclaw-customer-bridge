---
name: customer-legacy-history
description: 查询某个客户在个人微信侧的历史聊天记录（需先有 primary_id 且该客户绑定了 wxid_legacy）。只读。触发词：查历史消息 / 看聊天记录 / 这个客户之前说了什么 / 回溯对话 / 最近聊了什么 / 看一下和 XXX 的微信记录 / 拉聊天历史 / legacy history
---

# 历史消息查询

## 何时使用

- 准备回复某个老客户前，先拉他在个人微信侧的最近对话作上下文
- 客户问"上次我们说的那个事"时，回溯历史
- 周期性总结某客户的最近沟通脉络

## 前置条件

`primary_id` 必须已在 `customer_map` 中且绑定了 `wxid_legacy`。  
若没有，先跑 `customer_import_legacy_contacts`。

## 调用

```
# 最简（最近 20 条，summary 格式）
customer_legacy_history({ "primary_id": "wxid_zhangsan" })

# 指定条数和格式
customer_legacy_history({
  "primary_id": "wxid_zhangsan",
  "limit": 50,
  "format": "summary"     // text | summary | json
})

# 按时间段
customer_legacy_history({
  "primary_id": "wxid_zhangsan",
  "start_time": "2026-04-01",
  "end_time": "2026-04-27"
})
```

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `primary_id` | string | **必填** | customer_map 主键 |
| `limit` | number | 20 | 最多返回条数 |
| `offset` | number | 0 | 翻页偏移 |
| `start_time` | string | `""` | YYYY-MM-DD，空=不限下界 |
| `end_time` | string | `""` | YYYY-MM-DD，空=不限上界 |
| `format` | string | `"summary"` | `summary`=压缩去噪；`text`=原始；`json`=结构数组 |
| `max_chars` | number | 8000 | 返回文本硬上限，超出截断 |
| `per_msg_chars` | number | 200 | summary 模式单条字符上限 |

## 返回

```json
{
  "ok": true,
  "wxid_legacy": "wxid_zhangsan",
  "format": "summary",
  "truncated": false,
  "messages_text": "2026-04-20 张三: 这个方案可以...\n..."
}
```

## ⚠️ 边界

- 只读，绝不发消息回微信
- 若客户无 wxid_legacy 绑定，返回 `{ok:false, reason:"no wxid_legacy bound"}`
