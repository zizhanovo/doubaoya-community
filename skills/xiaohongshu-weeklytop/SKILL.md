---
name: xiaohongshu-weeklytop
description: 小红书周榜 · 按日期 + 分类拉小红书一周里持续走高的笔记，帮你看清中线趋势、避开一日游热点、押注稳定起势的选题方向。当用户需要小红书周榜、小红书一周爆款、小红书周度趋势、小红书中线选题、小红书周排行时使用。触发词：小红书周榜、一周爆款、周度趋势、中线选题、小红书周排行、持续走高。
---

# 小红书周榜（都爆鸭）

本鸭帮你按**日期 + 分类**拉小红书周榜——看一周里持续走高、不是一日游的笔记，帮你判断中线趋势、押注稳定起势的选题方向。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。
> 小贴士：如遇 `502 PROVIDER_FAILED` 暂时取不到数据，是上游临时波动，稍后再试即可——失败已自动退款，不扣费。

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
python3 "$SKILL_PATH/scripts/fetch_weekly_top.py"

# 指定日期 + 分类
python3 "$SKILL_PATH/scripts/fetch_weekly_top.py" --rank-date 2026-06-23 --category 综合
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--rank-date` | 榜单日期 `YYYY-MM-DD` | 昨天 |
| `--category` | 分类 | `综合` |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

---

## 工作流（3 步）

1. **定日期 + 分类**：默认综合、昨天。
2. **调脚本拿数据**：榜单在 `data.items`，每条含 `title`（标题）、`likedCount`（点赞数）。
3. **铺榜 + 给中线洞察**：按 `likedCount` 降序铺表，表后用本鸭口吻补一句——这一周哪些选题在持续走高、是稳定趋势还是短期热点、值不值得押注。

| 名次 | 标题 | 点赞 |
|------|------|------|
| 1 | … | … |

字段防御式读取（缺了留空）。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-weekly-top/call`
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
xiaohongshu-weeklytop/
├── SKILL.md                   # 本文件
└── scripts/
    └── fetch_weekly_top.py    # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：和日榜什么区别？**
A：周榜看一周持续表现，更能反映中线趋势；日榜抓当天最火。

**Q：暂时取不到数据？**
A：上游波动，稍后再试即可（不扣费）。
