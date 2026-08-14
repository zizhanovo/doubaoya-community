---
name: xiaohongshu-note-analyzer
description: 小红书笔记选题拆解 · 按关键词拉一批小红书爆款数据（低粉爆款 / 点赞 TOP500 / 单日互动 / 七日增长），帮你做对标拆解、复盘爆款结构、产出可落地的选题清单。当用户需要小红书笔记拆解、小红书对标分析、小红书爆款复盘、小红书选题拆解、笔记对标时使用。触发词：笔记拆解、对标分析、爆款复盘、选题拆解、笔记对标、爆款结构。
---

# 小红书笔记选题拆解（都爆鸭）

本鸭帮你按**关键词**拉一批小红书爆款数据（低粉爆款 / 点赞 TOP500 / 单日互动 / 七日增长），做**对标拆解**、复盘爆款结构，产出可落地的选题清单。

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
# 就这一条：关键词下去，直接拿最新一批爆款榜
python3 "$SKILL_PATH/scripts/fetch_note_data.py" --keyword 露营
```

**🔴 别加 `--start-date`。** 上游这份爆款榜是**按批次归档**的，不是按天切片——
实测（2026-08-13）任何「最近 N 天」的起始日期都会把整份榜过滤成空（四张榜全 0 条），
**不传起始日期才回落到最新一批满榜数据**。这个参数只有在你确知目标批次日期时才有意义，
日常用法就是不传。

| 参数 | 说明 | 默认 |
|------|------|------|
| `--keyword` | 关键词（**必填**） | — |
| `--start-date` | 起始日期 `YYYY-MM-DD`，**日常别传**（传了大概率整份返空） | 不传 = 最新一批 |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

---

## 工作流（3 步）

1. **定关键词 + 起始日期**：围绕你要对标的赛道给一个核心词。
2. **调脚本拿数据**：数据在 `data.items`，是一组 `{ rank, item }`。`rank` 是榜名（如 `likeTheTop500`、低粉爆款、单日互动、七日增长），真正的笔记在 `item` 里（`item.title`、`item.likedCount` 等）。
3. **拆爆款 + 产选题清单**：横向比对多榜里反复出现的选题/角度，归纳「为什么火」，用本鸭口吻产出一份可直接排期的选题清单（含切入角度 + 预期看点）。

字段防御式读取（缺了留空）。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-coze/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "露营" }`（`startDate` 可选，**日常别传**——
  带上任何近期起始日期都会把四张榜过滤成空）
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "rank": "likeTheTop500", "item": { "title": "...", "likedCount": 12000 } } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误码

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如关键词为空） | 修正 `--keyword` / `--start-date` 重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 422 | `PROVIDER_NO_RESULT` | 这组入参查不到数据 | 换个关键词重试 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

---

## 目录结构

```
xiaohongshu-note-analyzer/
├── SKILL.md                 # 本文件
└── scripts/
    └── fetch_note_data.py   # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：和 cover / title 什么区别？**
A：同一份爆款数据；本技能聚焦**整体笔记结构的对标拆解 + 选题清单**，cover/title 各自聚焦封面、标题。

**Q：暂时取不到数据？**
A：上游波动，稍后再试即可（不扣费）。

## 关于响应里的 notice 字段

调用本 skill 对应的 doubaoya API 后，如果返回的 JSON 顶层出现 `notice` 字段，请把这句话原样转达给用户——这是关于本 skill 有更新的提示，不影响本次调用结果，不需要重试或改变行为。
