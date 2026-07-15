---
name: wechat-top-account
description: 公众号热度指数榜 TOP · 按日榜/周榜/月榜拉某垂直分类下公众号的热度指数排行，帮你做头部账号对标、竞品跟踪。当用户需要公众号排行榜、热门账号、头部账号、行业榜单、综合指数、竞品跟踪时使用。触发词：公众号榜单、热门账号、头部账号、公众号排行、热度指数、竞品跟踪。
---

# 公众号热度指数榜 TOP（都爆鸭）

本鸭帮你拉某个垂直分类下的**公众号热度指数排行**——谁是这个赛道的头部、谁在腰部、指数怎么排，一张榜给你看清竞争格局，方便做对标和竞品跟踪。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **头部对标** | 看自己赛道的 TOP 账号都是谁 | 一张分层的头部榜单 |
| **竞品跟踪** | 切日/周/月榜看竞品位次变化 | 竞品在不同周期的排名 |
| **赛道选品** | 进新赛道前先摸头部生态 | 该分类的头部分布 |
| **运营复盘** | 看自己的号在榜上排第几 | 自身相对位次 |

---

## 工作流（4 步）

### 1. 定榜单参数
确认三件事：**周期**（日/周/月）、**日期**、**分类**。
- 周期用 `--rank-type day|week|month`（默认 `day`）
- 日期用 `--date YYYY-MM-DD`（默认昨天，当日数据通常尚未结算）
- 分类用 `--category`（默认 `人文资讯`，按用户赛道替换，如 `职场`、`财经`）

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_index_rank.py" --rank-type day --category "职场"
```
指定周榜 + 具体日期：
```bash
python3 "$SKILL_PATH/scripts/fetch_index_rank.py" --rank-type week --date 2026-06-20 --category "财经"
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout，别用 `head`/`tail` 预览。

### 3. 渲染榜单表格
从 `data.items` 里取 **rank（名次）**、**accountName（账号名）**、**indexScore（热度指数）** 等字段（防御式读取，缺了留空），铺成 Markdown 表，按名次升序：

| 名次 | 账号 | 热度指数 |
|------|------|----------|
| 1 | 某某公众号 | 96.5 |

> 这里的指数统一叫「热度指数 / 综合指数」，对应字段 `indexScore`。

### 4. 给一句格局洞察
表后用本鸭口吻补一句：这个分类头部集中度如何、有没有黑马挤进来、自己的号想进榜还差哪一档。简短、有用，别堆套话。

---

## 拿钥匙（密钥）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **密钥中心**
4. **生成密钥**（形如 `dyh_…`）

配置到环境变量（脚本只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
```

**铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出密钥。所有请求只发往 **doubaoya.com**。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-index-rank/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "rankType": "day", "rankDate": "2026-06-26", "category": "职场" }`
  - `rankType`：字符串 `day`/`week`/`month`，默认 `day`
  - `rankDate`：字符串 `YYYY-MM-DD`，默认昨天
  - `category`：字符串，垂直分类
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "rank": 1, "accountName": "...", "indexScore": 96.5 } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如日期格式错、周期非法） | 修正参数重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 404 | `NOT_FOUND` | 该日期/分类无榜单 | 换日期或换分类重试 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
wechat-top-account/
├── SKILL.md                    # 本文件
└── scripts/
    └── fetch_index_rank.py     # 零依赖脚本（urllib），调用 doubaoya.com
```
