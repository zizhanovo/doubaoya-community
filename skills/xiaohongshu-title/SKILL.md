---
name: xiaohongshu-title
description: 小红书标题选题数据 · 按关键词拉一批小红书爆款数据（低粉爆款 / 点赞 TOP500 / 单日互动 / 七日增长），帮你从真实爆款标题里拆解钩子套路、产出能跑量的标题方向。当用户需要小红书标题、小红书爆款标题、小红书标题套路、小红书起标题、标题钩子时使用。触发词：小红书标题、爆款标题、标题套路、起标题、标题钩子、标题灵感。
---

# 小红书标题选题数据（都爆鸭）

本鸭帮你按**关键词**拉一批小红书爆款数据（低粉爆款 / 点赞 TOP500 / 单日互动 / 七日增长），从真实跑量的笔记标题里拆解**钩子套路**，产出能跑量的标题方向。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。
> 小贴士：如遇暂时取不到数据，是上游波动，稍后再试（不扣费）。

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
# 默认：起始日期 30 天前
python3 "$SKILL_PATH/scripts/fetch_title_data.py" --keyword 露营

# 指定起始日期
python3 "$SKILL_PATH/scripts/fetch_title_data.py" --keyword 露营 --start-date 2026-06-01
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--keyword` | 关键词（**必填**） | — |
| `--start-date` | 起始日期 `YYYY-MM-DD` | 30 天前 |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

---

## 工作流（3 步）

1. **定关键词 + 起始日期**：围绕你要做的赛道给一个核心词。
2. **调脚本拿数据**：多榜数据在 `data` 下，条目 `item` 含 `title`、`likedCount` 等，外层有 `rank`。
3. **拆标题套路 + 产标题**：从高赞标题里归纳钩子（数字 / 痛点 / 反差 / 身份代入 / 清单等），用本鸭口吻给 5 条可直接用的爆款标题候选。

字段防御式读取（缺了留空）。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-coze/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "露营", "startDate": "2026-06-01" }`
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "rank": 1, "item": { "title": "...", "likedCount": 123 } } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误码

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如关键词为空） | 修正 `--keyword` / `--start-date` 重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

---

## 目录结构

```
xiaohongshu-title/
├── SKILL.md                  # 本文件
└── scripts/
    └── fetch_title_data.py   # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：和 xiaohongshu-cover 什么区别？**
A：同一份爆款数据；本技能聚焦从标题里拆钩子产标题，cover 聚焦封面套路。

**Q：暂时取不到数据？**
A：上游波动，稍后再试即可（不扣费）。
