---
name: douyin-subscribe
description: 抖音订阅追更 · 按抖音号 + 发布时间窗口拉作品列表，帮你每天盯住订阅的对标账号、第一时间发现它们的新作品、做追更复盘。当用户需要抖音订阅、抖音追更、盯抖音号、抖音账号新作品、抖音号每日更新、对标账号监控时使用。触发词：抖音订阅、抖音追更、盯账号、新作品、每日更新、对标监控。
---

# 抖音订阅追更 · 按抖音号拉作品（都爆鸭）

本鸭帮你按**抖音号 + 发布时间窗口**拉作品列表——每天盯住你订阅的对标账号，第一时间发现它们发了什么新作品，做追更复盘。

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
# 默认：拉今天 00:00:00 ~ 23:59:59 该抖音号的新作品
python3 "$SKILL_PATH/scripts/fetch_work_list.py" --account-id 样例抖音号

# 指定发布时间窗口
python3 "$SKILL_PATH/scripts/fetch_work_list.py" --account-id 样例抖音号 --start "2026-06-23 00:00:00" --end "2026-06-23 23:59:59"
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--account-id` | 抖音号（**必填**） | — |
| `--start` | 发布时间窗口起 `"YYYY-MM-DD HH:MM:SS"` | 今天 00:00:00 |
| `--end` | 发布时间窗口止 `"YYYY-MM-DD HH:MM:SS"` | 今天 23:59:59 |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

> ⚠️ `--account-id` 要是**真实存在**的抖音号，时间窗也要是**真实的日期**（默认就是今天一整天）——别凭空捏一个抖音号或编一个日期来"试一下"。手上没有确切抖音号时，先向用户要真实的抖音号。

---

## 工作流（3 步）

1. **定抖音号 + 时间窗**：默认拉今天一整天；做日更监控就每天跑一次默认窗口。
2. **调脚本拿数据**：作品在 `data.items`，每条含 `title`（标题）、`accountName`（账号名）、`workUrl`（作品链接）。
3. **铺新作品表 + 给追更提醒**：铺成 Markdown 表，表后用本鸭口吻补一句——这个号今天更了什么、有没有踩中新热点、值不值得马上跟一条。

| 标题 | 账号 | 链接 |
|------|------|------|
| … | … | … |

字段防御式读取（缺了留空）。窗口内没新作品就如实说明「今天没更新」。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/douyin/douyin-work-list/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "accountId": "样例抖音号", "publishTimeStart": "2026-06-23 00:00:00", "publishTimeEnd": "2026-06-23 23:59:59" }`
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "title": "...", "accountName": "...", "workUrl": "..." } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误码

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如抖音号为空） | 修正 `--account-id` / 时间窗重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

---

## 目录结构

```
douyin-subscribe/
├── SKILL.md                 # 本文件
└── scripts/
    └── fetch_work_list.py   # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：怎么做每日追更？**
A：每天跑一次默认窗口（今天一整天）即可；要补历史就改 `--start` / `--end`。

**Q：窗口内没作品？**
A：说明该号当天没更新，如实告知即可。

**Q：报 `502 PROVIDER_FAILED`？**
A：上游临时抖动，系统已自动退款，直接重跑即可。
