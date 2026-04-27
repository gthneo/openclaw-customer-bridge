---
name: customer-search
description: 在 customer_map 里按昵称/备注/wxid/企微ID 做子串模糊搜索，返回命中的客户列表及匹配字段。触发词：查找客户 / 搜一下 XXX / 有没有叫 XX 的客户 / 找一下姓张的 / 这个 wxid 是谁 / 搜索联系人 / 这个人在不在库里 / search customer
---

# 客户搜索

## 何时使用

- 用户问"有没有一个客户叫 XXX"
- 做身份合并前，先搜索缩小候选范围
- 验证某个微信好友是否已成功导入
- 用 wxid 或 external_userid 反查客户信息

## 调用

```
customer_search({ "query": "张三" })
customer_search({ "query": "wxid_abc123" })
customer_search({ "query": "建行", "limit": 5 })
```

## 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | **必填** | 搜索关键词，最少 1 字符 |
| `limit` | number | 20 | 最大返回数，最大 200 |

搜索范围：`remark`、`nicknames`、`wxid_legacy`、`external_userid`、`unionid`、`primary_id`

## 返回

```json
{
  "query": "张三",
  "returned": 2,
  "hits": [
    {
      "primary_id": "wxid_zsan",
      "display_name": "张三 客户A",
      "wxid_legacy": "wxid_zsan",
      "external_userid": null,
      "matched_in": ["remark"]
    }
  ]
}
```

`matched_in` 说明命中了哪个字段。命中后用 `customer_show` 查完整记录。

## 注意

- 字符级子串匹配：搜"易链"能命中"金信易链科技"
- 搜单字可能结果很多，建议加 `limit` 控制
