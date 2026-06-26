---
name: douyin-weekly-surge
description: 抖音点赞飙升周榜 · 按分类拉抖音点赞飙升内容，聚焦周榜，帮你看清一周里持续走高的作品、判断中长线趋势、抓稳定起势的爆款赛道。当用户需要抖音飙升周榜、抖音一周趋势、抖音周度上升榜、抖音中线趋势时使用。触发词：抖音飙升周榜、一周趋势、周度上升榜、中线趋势、持续走高。
---

# 抖音点赞飙升周榜（都爆鸭）

本鸭帮你按分类拉**抖音点赞飙升周榜**——聚焦 **weeklyRank（周榜）**，专看一周里持续走高、不是一日游的作品，让你判断中长线趋势、抓稳定起势的爆款赛道。

> 同一接口也带日榜，本技能**只聚焦周榜**视角；想要日 + 周双榜请用 `douyin-content-surge`。
> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 拿钥匙（口令）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **口令中心**
4. **生成口令**（形如 `dyh_…`）

```bash
export DOUBAOYA_API_KEY="dyh_你的口令"
```

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**。

---

## 跑脚本

零依赖，标准库即可（Python 3）。

```bash
# 默认：美食分类，昨天
python3 "$SKILL_PATH/scripts/fetch_weekly_surge.py"

# 指定分类 + 日期
python3 "$SKILL_PATH/scripts/fetch_weekly_surge.py" --type 美食 --start-time 2026-06-23
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--type` | 内容分类 | `美食` |
| `--start-time` | 榜单日期 `YYYY-MM-DD` | 昨天 |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

---

## 工作流（3 步）

1. **定分类 + 日期**：默认美食、昨天。
2. **调脚本拿数据**：返回里取 **weeklyRank（周榜）**，每条 `item` 含 `title`、`category`、`share_url`，外层有 `rank`。（同包里也有 dailyRank，本技能聚焦周榜。）
3. **铺周榜 + 给中线洞察**：按 `rank` 升序铺周榜表，表后用本鸭口吻补一句——这一周哪些选题在持续走高、属于稳定趋势还是短期热点、值不值得押注。

| 名次 | 标题 | 分类 | 链接 |
|------|------|------|------|
| 1 | … | … | … |

字段防御式读取（缺了留空）。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/douyin/douyin-content-surge/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "type": "美食", "startTime": "2026-06-23" }`
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "weeklyRank": { "items": [ { "rank": 1, "item": { "title": "...", "category": "...", "share_url": "..." } } ] }, "dailyRank": { "items": [ ... ] } }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误码

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法 | 修正 `--type` / `--start-time` 重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

---

## 目录结构

```
douyin-weekly-surge/
├── SKILL.md                     # 本文件
└── scripts/
    └── fetch_weekly_surge.py    # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：和 douyin-content-surge 什么区别？**
A：同一接口、同一份数据；本技能**聚焦周榜视角**，content-surge 是日 + 周双榜一起看。

**Q：报 `502 PROVIDER_FAILED`？**
A：上游临时抖动，系统已自动退款，直接重跑即可。
