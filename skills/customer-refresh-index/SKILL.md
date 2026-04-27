---
name: customer-refresh-index
description: 手动触发从企业微信 API 全量刷新群聊索引，使群分类能识别新建或改名的群。触发词：刷新群索引 / 更新群列表 / 有个群识别不出来 / classify chat 返回 UNKNOWN / 群分类不准 / 同步企微群信息 / 重建索引 / refresh index
---

# 群索引刷新

## 何时使用

- `customer_classify_chat` 返回 `UNKNOWN` 且群在企微后台确实存在
- 刚批量改了客户群名，想让分类立即生效
- 排查某个群为什么没被自动路由
- 后台 cron 失败、索引明显落后时手动补跑

## 调用

```
customer_refresh_index({})
```

无参数，全量刷新。

## 返回

```json
{ "ok": true, "refreshed": 47 }
```

`refreshed` = 本次写入/更新的群数量。

## ⚠️ 注意

- 全量刷新消耗企微 QPS，频繁调用会被限流
- 正常情况下后台每小时自动跑（`indexRefreshCron` 配置），通常不需要手动触发
- 若 `refreshed` 长期为 0，检查 `wecomCorpId / wecomAgentId / wecomSecret` 配置

## 依赖配置

```bash
openclaw config set plugins.entries.openclaw-customer-bridge.config --strict-json \
  '{"wecomCorpId":"<corpid>","wecomAgentId":"<agentid>","wecomSecret":"<secret>"}'
```
