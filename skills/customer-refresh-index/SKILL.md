---
name: customer-refresh-index
description: 手动触发 groupchat_index 全量刷新。从 WeCom externalcontact/groupchat/list + groupchat/get 拉取所有外部客户群，运行 12 类分类规则，写入本地 SQLite。正常情况下后台 cron 每小时跑，仅当怀疑索引落后时手动触发。
---

# 群索引刷新技能

## 何时使用

- `customer.classify_chat` 返回 `chat_class: "UNKNOWN"` 且确认该群已在 WeCom 后台存在
- 你刚批量改了客户群名（比如加了「售后」后缀），想立即让分类生效
- 排查为什么某个群没被自动路由

## 调用

`customer.refresh_index({})`

## 返回

```json
{ "refreshed": 47 }
```

## ⚠️ 注意

- 全量刷新会消耗 WeCom QPS，频繁调用会被限流
- 默认后台每小时跑一次（`indexRefreshCron` 配置），通常不需要手动
- 如果返回 `refreshed: 0` 长期不变，检查 `wecomCorpId / wecomAgentId / wecomSecret` 是否配置正确
