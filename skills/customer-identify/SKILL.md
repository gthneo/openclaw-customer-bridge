---
name: customer-identify
description: 把任意识别信号（企微 external_userid / 微信 wxid / unionid / 头像 / 昵称）解析为统一 primary_id，判断是否同一人，返回置信度。触发词：这个人是谁 / 识别客户 / 查一下这个 external_userid / 这个 wxid 是哪个客户 / 判断是不是同一人 / 打通身份 / identify customer
---

# 客户身份解析

## 何时使用

- 收到 WeCom `external_contact_add` 事件，查是否已有记录
- 想判断某个微信 wxid 和企微 external_userid 是不是同一人
- 导入数据后把新信号关联到已有客户

## 调用

```
customer_identify({
  "external_userid": "wmOgQhDgAAj...",   // 任选其一或组合
  "wxid": "wxid_zhangsan",
  "unionid": "oXXXX",
  "nicknames": ["张三", "三哥"],
  "avatar_phash": "f8c1a5..."
})
```

至少给一个信号，其余可缺省。

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

| `sources` 值 | 含义 |
|---|---|
| `external_userid` / `wxid` / `unionid` | 强 ID 直接命中，confidence=1 |
| `auto_match` | 概率 ≥ mergeThresholdAuto，已自动合并 |
| `needs_review` | 概率在 review/auto 之间，**需人工确认**后再调 `customer_merge` |
| `new` | 新客户，已落库 |
