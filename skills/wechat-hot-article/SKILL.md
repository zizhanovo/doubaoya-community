---
name: wechat-hot-article
description: 公众号爆文搜索 · 按关键词 + 时间区间拉同主题的微信公众号爆款文章，带阅读/在看/点赞热度，终端铺表 + 给爆款洞察。当用户需要找公众号爆文、看近期爆款、追热点爆文、按时间段挖高阅读文章、做爆款规律分析时使用。触发词：公众号爆文、爆款文章、热门文章、高阅读、近期爆款、爆款排行。
---

# 公众号爆文搜索（都爆鸭）

本鸭按**关键词 + 时间区间**给你捞同主题的公众号**爆款**——不只是有没有，而是哪几篇真的跑出了阅读量。带阅读 / 在看 / 点赞，终端铺成热度榜，再给一句爆款洞察：这波谁在领跑、靠的是什么。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。
>
> 只想扫一批文章不看热度，用 `gzh-search`；想拿这批爆文直接辅助写作起标题，用 `wechat-hot-write`。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **近期爆款盘点** | 搜 `AI 工具`，默认看最近 7 天 | 这周这条赛道谁跑出了量 |
| **指定时段挖爆文** | 搜 `大模型 --start 2026-06-01 --end 2026-06-20` | 某段时间的高阅读文章 |
| **爆款规律分析** | 看头部几篇的标题/角度共性 | 摸清这波爆款的套路 |
| **追热点找切口** | 搜热点词看谁已经写爆 | 判断还有没有空位可跟 |
| **竞品爆文监测** | 定期搜竞品主题看其爆文 | 盯对手的内容打法 |

---

## 工作流（4 步）

### 1. 提炼关键词
抽出**核心关键词**，精简 2~6 字最佳（如 `AI 工具`、`大模型`、`职场`）。一次只搜一个关键词。

### 2. 调用爆文脚本
```bash
# 默认：最近 7 天（end=今天，start=今天往前 6 天）
python3 "$SKILL_PATH/scripts/hot_article.py" "AI 工具"

# 指定时间区间
python3 "$SKILL_PATH/scripts/hot_article.py" "AI 工具" --start 2026-06-01 --end 2026-06-20
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次**，直接读完整 stdout，别预览、别重复调用。

### 3. 铺成爆文热度榜
从 `data.items` 取字段铺 Markdown 表，按热度（阅读量）降序排。字段做**防御式读取**——缺失就留空别报错。热度字段：`clicksCount`（阅读）/ `watchCount`（在看）/ `likeCount`（点赞）。

| 标题 | 阅读 | 在看 | 点赞 |
|------|------|------|------|
| 示例爆文 | 10.0w | 1.2k | 3.4k |

> 万级以上阅读数可格式化成 `10.0w` 更醒目——展示层加工，不改接口调用。

### 4. 给一句爆款洞察
表格之后补一句：这波爆文在抢什么角度、头部几篇的标题/选题有什么共性、还有没有空位可跟。简短、有据，别堆套话。

---

## 拿钥匙（口令）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **口令中心**
4. **生成口令**（形如 `dyh_…`）

配进环境变量（脚本只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的口令"
```

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/gongzhonghao/hot-article/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "AI 工具", "startDate": "2026-06-21", "endDate": "2026-06-27" }`
  - `keyword`：字符串，必填
  - `startDate` / `endDate`：`YYYY-MM-DD`。脚本默认 `endDate=今天`、`startDate=今天往前 6 天`，可用 `--start` / `--end` 覆盖。
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "clicksCount": 0, "watchCount": 0, "likeCount": 0 } ] },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 keyword 为空、日期格式错） | 修正后重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试安全，不会重复扣费。

---

## 目录结构

```
wechat-hot-article/
├── SKILL.md                  # 本文件
└── scripts/
    └── hot_article.py        # 零依赖爆文脚本（urllib），调用 doubaoya.com
```
