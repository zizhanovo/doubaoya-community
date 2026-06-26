---
name: multi-content-feed
description: 全网内容出海信息源 · 一次扫遍全平台（公众号/抖音/视频号/小红书/快手/B站）内容出海 Top 榜爆款作品，按平台铺表看标题、作者、点赞、封面，挖内容出海选题与流量风口。支持按平台、关键词、时间范围定向查询。当用户需要内容出海日报、内容出海爆款、内容出海热点、出海创作趋势、全平台爆款追踪时使用。触发词：内容出海、出海爆款、出海日报、出海选题、全平台爆款、出海流量风口。
dependency:
  python: []
  system:
---

# 全网内容出海信息源（都爆鸭）

嘎！本鸭一次帮你扫遍**公众号 / 抖音 / 视频号 / 小红书 / 快手 / B站**六大平台的内容出海 Top 榜——爆款作品按平台铺成表，标题、作者、点赞、封面一眼看全，帮做内容出海的你抓住每天的流量风口。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

> ⚠️ **数据节奏**：每日 15:00 更新前一天的数据。目标日期若尚未到更新时间、可能没有数据——这种情况先告知用户、确认后再查，别硬拉空结果。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **内容出海选题参考** | 默认全平台扫一遍 | 各平台高热度爆款，找选题方向 |
| **定向平台监控** | `--platforms 3,1` 只看小红书 + 抖音 | 聚焦核心平台的爆款 |
| **竞品 / 题材追踪** | `--keyword 品牌出海` | 定向匹配标题 / 作者的爆款 |
| **趋势分析** | `--start-time` / `--end-time` 框定时间窗 | 一段时间内的内容出海趋势 |

---

## 平台编号速查

请求与返回都用平台整数编号：

| 编号 | 平台 |
|------|------|
| `0` | 公众号 |
| `1` | 抖音 |
| `2` | 视频号 |
| `3` | 小红书 |
| `4` | 快手 |
| `6` | B站 |

> 注意没有 `5`。默认查全平台 = `0,1,2,3,4,6`。

---

## 工作流（4 步）

### 1. 决定查什么
- **默认**：不带 `--platforms`，扫全平台 Top 榜。
- **定向平台**：`--platforms 0,1,3` 只看指定平台（逗号分隔）。
- **定向关键词**：`--keyword "品牌出海"` 按标题 / 作者模糊匹配。
- **时间范围**：`--start-time` / `--end-time`（`YYYY-MM-DD`）框定窗口；不传则取最新。查询前若目标日期可能未到 15:00 更新点，先和用户确认。

### 2. 调用脚本
```bash
# 默认：全平台 Top 榜
python3 "$SKILL_PATH/scripts/fetch_content_export_top.py"

# 只看小红书 + 抖音
python3 "$SKILL_PATH/scripts/fetch_content_export_top.py" --platforms 3,1

# 关键词 + 时间范围
python3 "$SKILL_PATH/scripts/fetch_content_export_top.py" \
  --keyword 品牌出海 --start-time 2026-06-10 --end-time 2026-06-15
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head` / `tail` 预览或重复调用。

### 3. 按平台渲染表格
返回的 `data` 里，作品按平台分组——通常是一组条目，每个条目带 `platform`（平台整数）+ 一个作品列表（`list` / `items`）。防御式读取，缺字段留空别报错。**每个平台一张表**，公众号按阅读量、其余按点赞量排序：

| 标题 | 作者 | 点赞 | 封面 |
| ---- | ---- | ---- | ---- |
| [示例爆款标题](https://...) | 某作者 | 12.3w | （封面图 URL） |

> 把平台整数翻译成中文平台名（见上表）作为分节标题。标题渲染成可点链接（用作品返回的 `url`）。互动数为采集时刻快照，可能仍在增长。

### 4. 给一句出海洞察
表格之后，用本鸭口吻补一句**内容出海洞察**：哪个平台 / 题材在起量、跨平台有没有可迁移的爆款角度、值不值得跟。简短有用，不堆套话。

---

## 拿钥匙（口令）

1. 打开 **doubaoya.com**
2. **登录**（没有账号先注册）
3. 进 **口令中心**
4. **生成口令**（形如 `dyh_…`）

配置到环境变量（脚本只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的口令"
```

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**，不要把口令带去任何其他域名。

依赖：仅用 Python 3 标准库，无需安装任何第三方包。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/multi/multi-content-export-top/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "platforms": [0,1,2,3,4,6], "startTime": "", "endTime": "" }`，可选带 `keyword`
  - `platforms`：整数数组，平台编号（见上表）
  - `startTime` / `endTime`：`YYYY-MM-DD` 字符串；**不传时也要带这两个键、传空字符串 `""`**（服务端要求 key 存在）
  - `keyword`：字符串，可选——只在用户给了关键词时才带上
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": {
      "items": [
        { "platform": 0, "list": [ { "title": "...", "author": "...", "likeCount": 0, "cover": "...", "url": "..." } ] },
        { "platform": 3, "list": [ { "title": "...", "author": "...", "likeCount": 0, "cover": "...", "url": "..." } ] }
      ]
    },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。
- 字段防御：分组结构与作品字段命名可能略有差异、也可能缺失，一律「取不到给默认值」。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成（不要回显口令） |
| 400 | `VALIDATION_ERROR` | 参数不合法（如平台编号非整数） | 修正参数重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值 / 续额 |
| 404 | `ENDPOINT_NOT_FOUND` | 接口路径不对 | 一般是脚本被改动，恢复默认端点路径 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |
| — | `NETWORK_ERROR` | 连不上 doubaoya.com | 检查网络后重试 |

> 查不到数据时先想想是不是目标日期还没到每日 15:00 的更新点；`502 PROVIDER_FAILED` 会自动退款，重试安全。

---

## 目录结构

```
multi-content-feed/
├── SKILL.md                          # 本文件
└── scripts/
    └── fetch_content_export_top.py   # 零依赖脚本（urllib），调用 doubaoya.com
```
