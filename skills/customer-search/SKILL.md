---
name: customer-search
description: 在 customer_map 里按子串搜：跨 nickname_set（remark+昵称）/wxid_legacy/external_userid/unionid/primary_id。返回命中字段（matched_in），让 LLM 知道为什么命中。SQLite LIKE 大小写敏感（中文不受影响）。
---

# 客户搜索

## 何时使用

- 用户问"有没有一个客户叫 XXX / 找一下姓张的 / 这个 wxid 是谁"
- 在合并候选 / 概率匹配前，先用搜索缩小范围
- 验证导入后某个具体好友是否落库

## 调用

```
customer.search({ "query": "张三" })
customer.search({ "query": "wxid_abc", "limit": 5 })
customer.search({ "query": "建行" })
```

## 返回

```json
{
  "query": "张三",
  "returned": 2,
  "hits": [
    {
      "primary_id": "wxid_zsan",
      "display_name": "张三 客户A",
      "remark": "张三 客户A",
      "nicknames": ["张哥"],
      "wxid_legacy": "wxid_zsan",
      "external_userid": null,
      "matched_in": ["remark"]
    }
  ]
}
```

## 注意

- 中文搜索**字符级**子串匹配（"易链" 能命中"金信易链科技"）
- 字符级匹配可能误中：搜 "张" 会命中"张家界"；如需精确再加上下文过滤
- 命中后用 `customer.show({primary_id})` 看完整行
