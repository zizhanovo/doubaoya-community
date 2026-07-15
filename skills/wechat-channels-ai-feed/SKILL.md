---
name: wechat-channels-ai-feed
description: AI 视频号信息源 · 按关键词扫描视频号平台 AI 方向的爆款作品，终端表格展示（标题/点赞）并按点赞量聚类成每日选题日报。当用户需要视频号 AI 日报、视频号每日 AI 热点、视频号 AI 爆款、视频号内容选题、做视频号 AI 赛道内容发现时使用。触发词：视频号 AI、视频号日报、视频号爆款、视频号选题、AI 视频号。
---

# AI 视频号信息源（都爆鸭）

本鸭帮你按关键词扫一遍视频号上 AI 方向的爆款作品——把当下视频号点赞最高的 AI 内容捞出来，终端铺成爆款表格，再帮你聚类成几个话题方向，攒成一份能直接用的视频号 AI 选题日报。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **每日视频号 AI 热点** | 用 `AI` 或 `大模型` 扫今天的爆款 | 一眼看清视频号 AI 圈今天在火什么 |
| **视频号 AI 选题日报** | 按方向扫一遍，按互动量聚类成几个话题 | 一份能直接选题的视频号日报 |
| **细分方向追踪** | 用 `AI绘画`、`数字人`、`AI变现` 等细词 | 锁定某个视频号 AI 细分赛道的爆款 |
| **爆款角度拆解** | 看高点赞作品的标题与切口 | 提炼视频号 AI 内容的爆款写法 |
| **素材沉淀** | 翻页多拉几屏攒库 | 攒一手视频号 AI 方向选题素材 |

---

## 工作流（4 步）

### 1. 定关键词
从用户描述里抽出一个 **AI 方向关键词**（必填），如 `AI`、`大模型`、`AI绘画`、`数字人`、`AI Agent`。词宽命中多、词细更聚焦，一次只扫一个关键词。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_sph_ai_feed.py" "AI"
```
翻页 / 调整每页条数（可选）：
```bash
python3 "$SKILL_PATH/scripts/fetch_sph_ai_feed.py" "大模型" --page 2 --size 30
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一参数重复调用。

### 3. 渲染爆款表格
从 `data.items`（作品数组）里取字段，铺成 Markdown 表格。视频号 AI feed 只返回 `title`（标题）/ `likeCount`（点赞）两个字段——做防御式读取，缺了就留空，别报错，也别脑补作者等接口没给的字段。**按点赞量从高到低排**。

> **重要：视频号平台规则限制，无法提供作品链接。** 因此标题**不要**渲染成可点链接，直接以纯文本展示。如用户想看原作品，可复制标题前往视频号搜索查看。

| 标题 | 点赞 |
|------|------|
| 一个 AI 工具搞定全套素材 | 8,600 |

### 4. 聚类成日报 + 一句洞察
把这批作品按话题方向**聚类**（如 工具教程 / AI绘画 / 数字人 / 变现玩法），每个方向挑出代表爆款（按点赞量），组成一份简短日报。结尾用本鸭口吻补一句**选题洞察**：今天视频号 AI 圈哪个方向最热、哪个角度还有空位。别堆套话，别反问用户目的。

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

- `POST https://doubaoya.com/api/apis/sph/shipinhao-ai-feed/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "AI", "pageNum": 1, "pageSize": 20 }`
  - `keyword`：字符串，必填
  - `pageNum`：整数，可选（默认 1，由 `--page` 控制）
  - `pageSize`：整数，可选（默认 20，由 `--size` 控制）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "likeCount": 8600 } ] },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 keyword 为空） | 修正关键词重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
wechat-channels-ai-feed/
├── SKILL.md                      # 本文件
└── scripts/
    └── fetch_sph_ai_feed.py      # 零依赖脚本（urllib），调用 doubaoya.com
```
