---
name: wechat-fastest-growing
description: 公众号阅读增长榜（黑马账号）· 按日期拉公众号阅读增长率 TOP 榜，帮你发现近期增速最快的黑马账号、判断流量风向。当用户需要公众号黑马账号、阅读增长榜、增长率排行、流量风向、高增长账号、起势账号时使用。触发词：公众号黑马、增长榜、阅读增长、增长率排行、流量风向、黑马账号。
---

# 公众号阅读增长榜 · 黑马账号（都爆鸭）

本鸭帮你按日期拉**公众号阅读增长率排行**——专挑近期增速最猛的「黑马」，让你一眼看到哪些号正在起势、哪个赛道在涨，顺手判断当下的流量风向。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **发现黑马** | 拉最新增长榜看谁在猛涨 | 一批高增长账号 |
| **流量风向** | 看增长账号集中在哪些赛道 | 当下真实的流量风向 |
| **对标起势号** | 找正在起量的号研究打法 | 可迁移的增长策略 |
| **每日速览** | 每天扫一遍增长榜 | 当日黑马清单 |

---

## 工作流（4 步）

### 1. 定日期
默认拉**昨天**的榜（当日数据通常尚未结算）。`--date` 接受口语化 `yesterday` / `today`，也接受具体 `YYYY-MM-DD`。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_growth_rank.py"
```
指定日期：
```bash
python3 "$SKILL_PATH/scripts/fetch_growth_rank.py" --date 2026-06-25
```
若某天没数据，加 `--auto-back` 让脚本自动向前逐天追溯（最多 7 天），找到即停：
```bash
python3 "$SKILL_PATH/scripts/fetch_growth_rank.py" --date yesterday --auto-back
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout，别用 `head`/`tail` 预览。

> 即便不加 `--auto-back`，遇到「指定日无数据」时也可以让主 Agent 主动把 `--date` 往前挪一天再跑，直到拿到数据。

### 3. 渲染增长榜表格
从 `data.items` 里取 **rank（名次）**、**accountName（账号名）**、**readRaise（阅读增长）** 等字段（防御式读取，缺了留空），铺成 Markdown 表，按名次升序：

| 名次 | 账号 | 阅读增长 |
|------|------|----------|
| 1 | 某某公众号 | +xxx% |

> `readRaise` 是阅读增长（增量或增长率，按返回值原样展示），别脑补接口没给的指数字段。

### 4. 给一句风向洞察
表后用本鸭口吻补一句：这批黑马集中在哪些赛道、是借了什么热点起来的、哪些打法能迁移到自己的号或其他平台。简短、有用，别堆套话。

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

- `POST https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-raise-rank/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "rankDate": "2026-06-26" }`
  - `rankDate`：字符串 `YYYY-MM-DD`，默认昨天（脚本把 `yesterday`/`today` 映射成具体日期）
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "rank": 1, "accountName": "...", "readRaise": "..." } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如日期格式错） | 修正 `--date` 重试 |
| —  | `NO_DATA` | 追溯多天仍无榜单 | 换个日期，或确认数据窗口 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
wechat-fastest-growing/
├── SKILL.md                    # 本文件
└── scripts/
    └── fetch_growth_rank.py    # 零依赖脚本（urllib），调用 doubaoya.com
```
