---
name: gzh-astock-top
description: A股公众号大V榜 · 一条命令编排「账号发现 → 账号数据 → 当日发文」，给出 A股领域头部公众号大V 名单、综合指数/平均阅读等账号画像，以及各账号当日发文。当用户提到 A股公众号、股市大V、股票公众号榜单、A股账号画像、A股公众号大V时使用。
---

# A股公众号大V榜（都爆鸭）

本鸭帮你一条命令摸清 A股领域的公众号头部大V——先按关键词把 A股公众号**发现**出来，再拉一遍每个账号的**数据画像**（综合指数、平均阅读等），最后查一遍这些大V**当日发了什么**。三步在一个脚本里串好，吐一份合并 JSON，你直接拿去铺榜单。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **A股大V榜单** | 默认跑一次，看 A股头部公众号名单 | 一份带数据的 A股大V榜 |
| **账号画像对标** | 看各账号综合指数 / 平均阅读 | 摸清谁是 A股内容头部 |
| **当日动向追踪** | 指定 `--date` 看这些大V今天发了什么 | 一眼掌握 A股大V当日内容 |
| **细分关键词** | 换 `--keyword 港股`/`基金` 等 | 复用同一套编排查其它金融赛道 |
| **爆文加挂（可选）** | 加 `--with-hot` 拉各账号近期爆文 | 看大V最近的代表性爆款 |

---

## 工作流（编排逻辑）

本技能是一个**组合编排**脚本，单脚本按顺序串起多个接口：

1. **账号发现**（搜索账号）：用 `--keyword`（默认 `A股`）搜出 A股公众号，取前 N 个（默认 30）账号名。**这一步失败 = 没有账号 → 直接退出 1。**
2. **账号画像**（账号诊断）：把这批账号名喂给账号分析接口，拿到综合指数、平均阅读等数据。
3. **当日发文**：按 `--date`（默认今天）查这批账号当天发了什么。
4. **（可选）账号爆文**：加 `--with-hot` 时，逐个账号拉近期爆文。

后续单步（2/3/4）若某一步失败，**不中断整轮**，把该步错误收进结果的 `errors` 字段，其余数据照常返回。

### 调用脚本
```bash
# 默认：关键词 A股，日期今天，前 30 个账号
python3 "$SKILL_PATH/scripts/fetch_astock_top.py"

# 指定日期 / 关键词 / 账号数量
python3 "$SKILL_PATH/scripts/fetch_astock_top.py" --keyword A股 --date 2026-06-20 --top 30

# 额外拉各账号近期爆文（多花若干次调用）
python3 "$SKILL_PATH/scripts/fetch_astock_top.py" --with-hot
```
脚本把合并后的 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一参数重复调用。

### 渲染榜单 + 一句洞察
从合并 JSON 里取数铺 Markdown 榜单：账号名、综合指数、平均阅读、当日发文标题（渲染成**可点链接**）。字段做防御式读取，缺了留空。结尾用本鸭口吻补一句 A股内容洞察：哪个大V在跑量、当日有没有共振话题。别堆套话。

### 合并 JSON 形状
```json
{
  "keyword": "A股",
  "date": "2026-06-27",
  "accounts": ["大V账号1", "大V账号2"],
  "analysis": { /* 账号诊断 data */ },
  "dailyPublish": { /* 当日发文 data */ },
  "hotArticles": { /* 仅 --with-hot 时存在，按账号名归集 */ },
  "errors": { /* 仅有子步失败时存在，按步骤名归集 */ }
}
```

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

本技能编排以下接口（均 `POST`，鉴权头 `Authorization: Bearer $DOUBAOYA_API_KEY`）：

| 步骤 | 接口 | 请求体 |
|------|------|--------|
| 1 账号发现 | `https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-search-user/call` | `{ "keyword": "A股", "page": 1 }` |
| 2 账号画像 | `https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-account-analyzer/call` | `{ "accountNames": ["账号1", "账号2"] }` |
| 3 当日发文 | `https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-daily-publish/call` | `{ "date": "2026-06-27", "accountNames": ["账号1"] }` |
| 4 账号爆文（可选 `--with-hot`） | `https://doubaoya.com/api/apis/gongzhonghao/hot-article/call` | `{ "keyword": "账号名", "startDate": "...", "endDate": "..." }` |

- 每个子调用都走同一套**信封**：先看 `success===true` 才读 `data`，否则读 `error.code` / `error.message`。
- 步骤 1 是整轮地基：拿不到账号就以退出码 1 结束；步骤 2/3/4 的失败收进 `errors`，不影响其余结果。
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { ... }, "error": null }
  ```

---

## 错误处理

脚本失败（步骤 1 失败或缺口令）时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。子步失败则进 `errors` 字段、不退出。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如日期格式错） | 修正关键词/日期重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
gzh-astock-top/
├── SKILL.md                      # 本文件
└── scripts/
    └── fetch_astock_top.py       # 零依赖编排脚本（urllib），调用 doubaoya.com
```
