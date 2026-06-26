---
name: douyin-content-surge
description: 抖音点赞飙升榜（日 + 周）· 按分类拉抖音点赞飙升内容，一次同时返回日榜 + 周榜，帮你抓住正在起飞、点赞猛涨的作品，第一时间锁定可复制的爆款。当用户需要抖音飙升榜、抖音点赞飙升、抖音起飞内容、抖音黑马作品、抖音上升榜时使用。触发词：抖音飙升榜、点赞飙升、起飞内容、上升榜、黑马作品、日榜周榜。
---

# 抖音点赞飙升榜 · 日 + 周（都爆鸭）

本鸭帮你按分类拉**抖音点赞飙升榜**——一次同时给你**日榜（dailyRank）**和**周榜（weeklyRank）**，专抓那些点赞正在猛涨、刚起飞的作品，让你第一时间锁定可复制的爆款苗子。

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
python3 "$SKILL_PATH/scripts/fetch_content_surge.py"

# 指定分类 + 日期
python3 "$SKILL_PATH/scripts/fetch_content_surge.py" --type 美食 --start-time 2026-06-23
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--type` | 内容分类 | `美食` |
| `--start-time` | 榜单日期 `YYYY-MM-DD` | 昨天 |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

---

## 工作流（3 步）

1. **定分类 + 日期**：默认美食、昨天（当日数据通常尚未结算）。
2. **调脚本拿数据**：返回里同时有 **dailyRank（日榜）** 和 **weeklyRank（周榜）**，每条 `item` 含 `title`、`category`、`share_url`，外层有 `rank`。
3. **铺两张榜 + 给洞察**：分别按日榜、周榜铺表（`rank` 升序），表后用本鸭口吻补一句——哪些选题正在飙升、是借了什么形态起飞的、能不能迁到自己的号。

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
  { "success": true, "requestId": "...", "data": { "dailyRank": { "items": [ { "rank": 1, "item": { "title": "...", "category": "...", "share_url": "..." } } ] }, "weeklyRank": { "items": [ ... ] } }, "error": null }
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
douyin-content-surge/
├── SKILL.md                      # 本文件
└── scripts/
    └── fetch_content_surge.py    # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：提示缺少 `DOUBAOYA_API_KEY`？**
A：先 `export DOUBAOYA_API_KEY="dyh_…"`（去 doubaoya.com → 登录 → 口令中心 → 生成口令）。

**Q：报 `502 PROVIDER_FAILED`？**
A：上游临时抖动，系统已自动退款，直接重跑即可。
