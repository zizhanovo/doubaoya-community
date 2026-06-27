---
name: gzh-ai-feed
description: AI 公众号日报内容源 · 按关键词扫描 AI 方向的公众号爆款，终端表格展示（标题链接/点赞）并聚类成每日选题日报。当用户需要 AI 日报、每日 AI 热点、AI 公众号爆款、AI 内容选题、做 AI 赛道内容发现时使用。
---

# AI 公众号日报内容源（都爆鸭）

本鸭帮你按关键词扫一遍 AI 方向的公众号爆款——把当下 AI 圈跑得最火的文章捞出来，终端铺成可点的爆文表格，再帮你聚类成几个话题方向，攒成一份能直接用的 AI 选题日报。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **每日 AI 热点** | 用 `AI` 或 `大模型` 扫今天的爆款 | 一眼看清 AI 圈今天在聊什么 |
| **AI 选题日报** | 按方向扫一遍，聚类成几个话题 | 一份能直接选题的内容日报 |
| **细分方向追踪** | 用 `AI Agent`、`RAG`、`AI 绘画` 等细词 | 锁定某个 AI 细分赛道的爆款 |
| **爆款角度拆解** | 看高点赞文章的标题与切口 | 提炼 AI 内容的爆款写法 |
| **素材沉淀** | 翻页多拉几屏攒库 | 攒一手 AI 方向写作素材 |

---

## 工作流（4 步）

### 1. 定关键词
从用户描述里抽出一个 **AI 方向关键词**（必填），如 `AI`、`大模型`、`AI Agent`、`RAG`、`AI 绘画`。词宽命中多、词细更聚焦，一次只扫一个关键词。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_ai_feed.py" "AI Agent"
```
翻页 / 调整每页条数（可选）：
```bash
python3 "$SKILL_PATH/scripts/fetch_ai_feed.py" "大模型" --page 2 --size 30
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一参数重复调用。

### 3. 渲染爆文表格
从 `data.items`（文章数组）里取字段，铺成 Markdown 表格。字段做防御式读取——`title`（标题）/ `likeCount`（点赞）可能缺失，缺了就留空，别报错。标题渲染成**可点链接**（指向文章原文 URL）。

| 标题 | 点赞 |
|------|------|
| [示例 AI 爆文](https://mp.weixin.qq.com/s/xxx) | 1,200 |

### 4. 聚类成日报 + 一句洞察
把这批文章按话题方向**聚类**（如 Agent / 大模型 / 多模态 / 落地应用），每个方向挑出代表爆款，组成一份简短日报。结尾用本鸭口吻补一句**选题洞察**：今天 AI 圈哪个方向最热、哪个角度还有空位。别堆套话，别反问用户目的。

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

- `POST https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-ai-feed/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "AI Agent", "pageNum": 1, "pageSize": 20 }`
  - `keyword`：字符串，必填
  - `pageNum`：整数，可选（默认 1，由 `--page` 控制）
  - `pageSize`：整数，可选（默认 20，由 `--size` 控制）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "likeCount": 1200 } ] },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 keyword 为空） | 修正关键词重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
gzh-ai-feed/
├── SKILL.md                  # 本文件
└── scripts/
    └── fetch_ai_feed.py      # 零依赖脚本（urllib），调用 doubaoya.com
```
