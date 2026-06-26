---
name: douyin-daily-hot
description: 抖音每日点赞 TOP 榜 · 按分类 + 日期拉抖音当天点赞最高的作品，帮你看清这个赛道当天哪条最吸赞、出自哪个账号，快速锁定可对标的爆款。当用户需要抖音点赞榜、抖音每日 TOP、抖音吸赞作品、抖音日榜、抖音爆款榜时使用。触发词：抖音点赞榜、每日 TOP、吸赞作品、抖音日榜、点赞排行、爆款榜。
---

# 抖音每日点赞 TOP 榜（都爆鸭）

本鸭帮你按**分类 + 日期**拉抖音每日点赞 TOP 榜——一眼看清这个赛道当天哪条作品最吸赞、出自哪个账号，顺手锁定可对标的爆款。

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
python3 "$SKILL_PATH/scripts/fetch_daily_hot.py"

# 指定分类 + 日期区间
python3 "$SKILL_PATH/scripts/fetch_daily_hot.py" --type 美食 --start-time 2026-06-23 --end-time 2026-06-23
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--type` | 内容分类 | `美食` |
| `--start-time` | 起始日期 `YYYY-MM-DD` | 昨天 |
| `--end-time` | 结束日期 `YYYY-MM-DD` | 昨天 |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

---

## 工作流（3 步）

1. **定分类 + 日期**：默认美食、昨天（当日数据通常尚未结算）。
2. **调脚本拿数据**：榜单在 `data.items`，每条含 `title`（标题）、`accountName`（账号名）、`category`（分类）、`workUrl`（作品链接）。
3. **铺榜 + 给洞察**：按点赞高低铺成 Markdown 表，表后用本鸭口吻补一句——当天这个赛道靠什么内容吸赞、哪些账号在量产爆款、能不能迁到自己的号。

| 名次 | 标题 | 账号 | 链接 |
|------|------|------|------|
| 1 | … | … | … |

字段防御式读取（缺了留空）。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/douyin/douyin-likes-rank/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "type": "美食", "startTime": "2026-06-23", "endTime": "2026-06-23" }`
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "title": "...", "accountName": "...", "category": "...", "workUrl": "..." } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误码

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法 | 修正 `--type` / `--start-time` / `--end-time` 重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

---

## 目录结构

```
douyin-daily-hot/
├── SKILL.md                  # 本文件
└── scripts/
    └── fetch_daily_hot.py    # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：提示缺少 `DOUBAOYA_API_KEY`？**
A：先 `export DOUBAOYA_API_KEY="dyh_…"`（去 doubaoya.com → 登录 → 口令中心 → 生成口令）。

**Q：报 `502 PROVIDER_FAILED`？**
A：上游临时抖动，系统已自动退款，直接重跑即可。
