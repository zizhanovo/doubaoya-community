---
name: xiaohongshu-dailytop
description: 小红书日榜 · 按日期 + 分类拉小红书当天最火的笔记，帮你看清这个分类今天谁在霸榜、靠什么内容跑量、有哪些可对标的爆款。当用户需要小红书日榜、小红书今日爆款、小红书热门笔记、小红书排行榜、小红书每日榜时使用。触发词：小红书日榜、今日爆款、热门笔记、小红书排行、每日榜、小红书 TOP。
---

# 小红书日榜（都爆鸭）

本鸭帮你按**日期 + 分类**拉小红书日榜——一眼看清这个分类今天谁在霸榜、靠什么内容跑量，顺手锁定可对标的爆款。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。
> 小贴士：如遇暂时取不到数据，是上游波动，稍后再试（不扣费）。

---

## 拿钥匙（密钥）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **密钥中心**
4. **生成密钥**（形如 `dyh_…`）

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
```

**铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出密钥。所有请求只发往 **doubaoya.com**。

---

## 跑脚本

零依赖，标准库即可（Python 3）。

```bash
# 默认：综合分类，昨天
python3 "$SKILL_PATH/scripts/fetch_daily_top.py"

# 指定日期 + 分类
python3 "$SKILL_PATH/scripts/fetch_daily_top.py" --rank-date 2026-06-23 --category 综合
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--rank-date` | 榜单日期 `YYYY-MM-DD` | 昨天 |
| `--category` | 分类 | `综合` |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

---

## 工作流（3 步）

1. **定日期 + 分类**：默认综合、昨天（当日数据通常尚未结算）。
2. **调脚本拿数据**：榜单在 `data.items`，每条含 `title`（标题）、`likedCount`（点赞数）。
3. **铺榜 + 给洞察**：按 `likedCount` 降序铺成 Markdown 表，表后用本鸭口吻补一句——今天这个分类靠什么选题/形式跑量、能不能迁到自己的号。

| 名次 | 标题 | 点赞 |
|------|------|------|
| 1 | … | … |

字段防御式读取（缺了留空）。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-daily-top/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "rankDate": "2026-06-23", "category": "综合" }`
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "title": "...", "likedCount": 123 } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误码

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法 | 修正 `--rank-date` / `--category` 重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

---

## 目录结构

```
xiaohongshu-dailytop/
├── SKILL.md                  # 本文件
└── scripts/
    └── fetch_daily_top.py    # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：提示缺少 `DOUBAOYA_API_KEY`？**
A：先 `export DOUBAOYA_API_KEY="dyh_…"`（去 doubaoya.com → 登录 → 密钥中心 → 生成密钥）。

**Q：暂时取不到数据？**
A：上游波动，稍后再试即可（不扣费）。
