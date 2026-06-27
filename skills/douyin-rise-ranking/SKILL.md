---
name: douyin-rise-ranking
description: 抖音涨粉账号榜 · 按日期拉抖音粉丝增量 TOP 榜，帮你挖出近期起势的黑马达人、看清哪些赛道在猛涨。当用户需要抖音涨粉榜、抖音粉丝增长排行、抖音黑马达人、抖音起势账号、抖音涨粉风向、抖音潜力达人时使用。触发词：抖音涨粉榜、抖音粉丝增长、抖音黑马、抖音起势、涨粉排行、粉丝增量。
---

# 抖音涨粉账号榜 · 黑马达人（都爆鸭）

本鸭帮你按日期拉**抖音粉丝增量排行**——专挑近期涨粉最猛的「黑马达人」，让你一眼看到谁正在起势、哪个赛道在猛涨，顺手判断抖音的涨粉风向。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **发现黑马** | 拉最新涨粉榜看谁在猛涨 | 一批高增长黑马达人 |
| **涨粉风向** | 看涨粉账号集中在哪些赛道 | 当下真实的涨粉风向 |
| **对标起势号** | 找正在起量的达人研究打法 | 可迁移的涨粉策略 |
| **分类挖宝** | 按行业分类锁定细分赛道黑马 | 细分赛道潜力达人 |

---

## 工作流（4 步）

### 1. 定维度 + 日期
先定**榜单周期**（`--period`：`day` 日榜 / `week` 周榜 / `month` 月榜，默认周榜）和**行业分类**（`--category`，默认「全部」；常见可选如 数码科技 / 美食 / 化妆美容 / 三农 / 情感 / 游戏 等）。日期默认拉**昨天**（当日数据通常尚未结算），`--date` 接受具体 `YYYY-MM-DD`。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_rise_rank.py"
```
指定维度与分类：
```bash
python3 "$SKILL_PATH/scripts/fetch_rise_rank.py" --period week --date 2026-06-25 --category 美食
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout，别用 `head`/`tail` 预览。

> 遇到「指定日无数据」时，可以让主 Agent 主动把 `--date` 往前挪一天再跑，直到拿到数据。

### 3. 渲染涨粉榜表格
从 `data.items` 里取 **rank（名次）**、**accountName（账号名）**、**riseFans（粉丝增量）** 等字段（防御式读取，缺了留空），铺成 Markdown 表，按名次升序：

| 名次 | 账号 | 粉丝增量 |
|------|------|----------|
| 1 | 某某达人 | +xxx |

> 粉丝增量读 `riseFans` 字段，对外展示叫「粉丝增量」。

### 4. 给一句风向洞察
表后用本鸭口吻补一句：这批黑马达人集中在哪些赛道、是借了什么内容形态或热点起来的、哪些涨粉打法能迁移到自己的号或其他平台。简短、有用，别堆套话。

---

## 拿钥匙（口令）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **口令中心**
4. **生成口令**（形如 `dyh_…`）

配置到环境变量（脚本只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的口令"
```

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/douyin/douyin-rise-fans-rank/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "period": "week", "rankDate": "2026-06-26", "category": "全部" }`
  - `period`：榜单周期，枚举 `day` / `week` / `month`，默认 `week`
  - `rankDate`：字符串 `YYYY-MM-DD`，默认昨天
  - `category`：行业分类，默认 `全部`（另有 数码科技 / 美食 / 化妆美容 / 三农 / 情感 / 游戏 等多个细分赛道可选）
  - `rankDate` 请传**真实、较近的日期**（当地区域的最近日期），别编造或填未来日期；空结果通常说明该日期窗口还没数据，往前挪一天再试。
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "rank": 1, "accountName": "...", "riseFans": "..." } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如日期格式错） | 修正 `--date` / `--period` 重试 |
| —  | `NO_DATA` | 该日无榜单 | 换个日期，或确认数据窗口 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
douyin-rise-ranking/
├── SKILL.md                 # 本文件
└── scripts/
    └── fetch_rise_rank.py   # 零依赖脚本（urllib），调用 doubaoya.com
```
