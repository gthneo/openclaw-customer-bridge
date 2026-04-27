---
name: customer-merge
description: 把多个重复/分裂的客户记录合并为一条，将各行的身份 ID coalesce 进主记录，删除源行并保留审计轨迹。不可逆。触发词：合并客户 / 这两个是同一个人 / 合并重复记录 / 把这几个人并成一个 / 客户去重 / 手动合并 / merge customers
---

# 客户合并

## 何时使用

- `customer_identify` 返回 `sources:["needs_review"]`，人工确认是同一人后执行
- 发现 customer_map 有重复条目（同一客户导入了两次）
- 通过 unionid 反查确认两条历史记录可以打通

## 调用

```
customer_merge({
  "primary_id": "wmOgQhDgAA-保留这个",
  "source_ids": ["wxid_zhangsan", "pending:1761910000"],
  "bridge_method": "manual"
})
```

## 参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `primary_id` | string | **保留**的主记录 ID |
| `source_ids` | string[] | **被合并删除**的记录 ID 列表 |
| `bridge_method` | string | 合并依据（见下表） |

`bridge_method` 取值：`manual` / `phash` / `nickname` / `unionid_strict` / `phone`

## 返回

```json
{ "ok": true, "primary_id": "wmOgQhDgAA-保留这个", "merged_count": 2 }
```

## ⚠️ 注意

- **不可逆**：source 行被删除，`merged_from` 列保留 source ID 供审计
- 合并前务必用 `customer_show` 确认两边 primary_id 正确
- 合并后原 source_ids 的历史消息可通过新 primary_id 查询
