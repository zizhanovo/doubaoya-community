---
name: astock-social-feed
description: A股社媒每日信息源 · 一键扫「小红书 + 抖音 + 公众号」上的 A股讨论，内置一批 A股核心关键词、默认近7天，跨平台对比股市舆情、做盘后复盘与情绪监测。当用户需要研究 A股舆情、股市讨论、大盘分析、选股策略、涨跌复盘、股市情绪监测时使用。触发词：A股、A股舆情、股市新闻、大盘分析、涨停、选股、A股复盘、股票讨论、股市热点、盘后复盘。
dependency:
  python: []
  system:
---

# A股社媒每日信息源（都爆鸭）

嘎！本鸭一次帮你扫遍**小红书、抖音、公众号**上的 A股讨论——内置一批 A股核心关键词、默认拉近7天，三平台一起看股市舆情：散户在聊什么、自媒体在追什么热点、深度号在复盘什么。盘后复盘、情绪监测，一条命令铺开。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **每日股市舆情** | 直接跑（不带关键词），扫内置 A股核心词 | 一次掌握三平台股市风向 |
| **盘后 / 周度复盘** | `--days 7` 看近一周讨论沉淀 | 哪个题材在持续发酵 |
| **定向题材跟踪** | 传关键词如 `半导体`、`券商` | 聚焦单一题材的跨平台讨论 |
| **情绪监测** | 对比三平台口径与热度 | 散户情绪 vs 自媒体追评 vs 深度复盘 |

> 平台信号速读：小红书 = 散户分享 / 炒股心得；抖音 = 盘中速评 / 涨停解读 / 情绪传播；公众号 = 深度复盘 / 策略研报。三平台交叉验证最稳。

---

## 工作流（4 步）

### 1. 决定查什么
- **默认（不带关键词）**：脚本自动遍历内置 A股核心关键词，逐个查询——零配置即用，适合每日舆情扫描。
- **定向（带关键词）**：用户明确给了题材（如 `半导体`、`新能源`、`券商`），就把它作为位置参数传入，只查这一个词。
- 默认回溯近7天；用户要别的口径用 `--days N` 覆盖。

内置关键词：`A股`、`大盘`、`涨停`、`选股`、`牛市`、`券商`、`北交所`、`科创板`、`题材股`、`龙头股`、`加仓`、`复盘`。

### 2. 调用脚本
```bash
# 默认：遍历内置 A股关键词，近7天
python3 "$SKILL_PATH/scripts/fetch_astock_feed.py"

# 定向题材：
python3 "$SKILL_PATH/scripts/fetch_astock_feed.py" "半导体"

# 自定义回溯天数：
python3 "$SKILL_PATH/scripts/fetch_astock_feed.py" "券商" --days 3
```
脚本把结果以 JSON 打到 stdout，结构为 `{"range": {...}, "results": { 关键词: data, ... }}`，每个 `data` 内含三组数组。遍历多词时**一次脚本调用即可**，别对同一组词重复跑；直接读完整 stdout，别用 `head` / `tail`。

### 3. 渲染三平台表格
每个关键词的 `data` 内含三组数组（防御式读取，缺字段留空别报错）：

| 数组键 | 平台 | 典型字段 |
|--------|------|----------|
| `xhsResult` | 小红书 | `title` / `authorName` / `likeCount` / `commentCount` / `publishTime` / 链接 |
| `dyResult` | 抖音 | `title` / `authorName` / 点赞 / 评论 / 分享 / `publishTime` / 链接 |
| `gzhResult` | 公众号 | `title` / `accountName` / 阅读 / 点赞 / `publishTime` / 链接 |

**展示方式**：按 公众号 → 小红书 → 抖音 顺序分平台铺表，或合并成一张 `平台 / 标题 / 互动 / 发布时间` 表横向比对。多关键词时可按题材分节，每节给三平台速览。标题渲染成可点链接。

### 4. 给一句复盘洞察
表格之后，用本鸭口吻补一句**股市舆情洞察**：哪个题材在三平台同时升温、散户情绪偏多还是偏空、深度号在提示什么风险。简短有用，不堆套话。

> ⚠️ 本鸭只搬运公开社媒讨论数据，不构成任何投资建议；互动数为采集时刻快照、可能仍在变化。

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

- `POST https://doubaoya.com/api/apis/multi/cn30-multi-search/call`（与「全网近30天作品聚合」同一聚合接口，此处主题化为 A股）
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体（每个关键词一次）：`{ "keyword": "...", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }`
  - `keyword`：字符串，必填
  - `startDate` / `endDate`：脚本按 `--days` 自动算出（`endDate` = 今天，`startDate` = 今天 - days）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": {
      "xhsResult": [ { "title": "...", "authorName": "...", "publishTime": "..." } ],
      "dyResult":  [ { "title": "...", "authorName": "...", "publishTime": "..." } ],
      "gzhResult": [ { "title": "...", "accountName": "...", "publishTime": "..." } ]
    },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。
- 字段防御：三组数组里字段命名可能略有差异、也可能缺失，一律「取不到给默认值」。

---

## 错误处理

脚本对每个关键词失败时向 stderr 打 `[error] CODE: message（关键词「…」）`；遍历多词时单词失败不影响其它词，**仅当全部关键词都失败**才以退出码 1 结束（成功的词照常进 `results`，失败的词进 `errors`）。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成（不要回显口令） |
| 400 | `VALIDATION_ERROR` | 参数不合法 | 修正参数重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值 / 续额 |
| 404 | `ENDPOINT_NOT_FOUND` | 接口路径不对 | 一般是脚本被改动，恢复默认端点路径 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |
| — | `NETWORK_ERROR` | 连不上 doubaoya.com | 检查网络后重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
astock-social-feed/
├── SKILL.md                  # 本文件
└── scripts/
    └── fetch_astock_feed.py  # 零依赖脚本（urllib + datetime），调用 doubaoya.com
```
