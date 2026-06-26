---
name: doubaoya
description: >-
  都爆鸭 (doubaoya) — 新媒体爆款选题 / 追热点 / 写脚本的 AI 工作搭子。当用户要做爆款选题、找选题、追热点、看全网热榜、
  搜抖音 / 小红书 / 公众号内容、解析作品或文章、查达人账号、写开场脚本 / 短视频脚本、检测违禁词，或提到 doubaoya、都爆鸭、
  本鸭、DOUBAOYA_API_KEY 时使用本 Skill。它教 AI agent 用一条 DOUBAOYA_API_KEY 调用 doubaoya.com 的公开 API，
  把散乱搜索变成可直接用的选题信号和脚本。Trigger words: 爆款选题 / 选题 / 追热点 / 热点 / 全网热榜 / 写脚本 /
  开场脚本 / 短视频脚本 / 抖音 / 小红书 / 公众号 / 视频号 / 达人账号 / 违禁词 / doubaoya / 都爆鸭 / 本鸭 / DOUBAOYA_API_KEY。
---

# 都爆鸭 · doubaoya

本鸭是给新媒体 / 运营准备的爆款工作搭子。你（AI agent）拿一条 `DOUBAOYA_API_KEY`，
就能替用户**挖爆款选题、追全网热点、搜三大平台内容、解析作品、写开场脚本、检测违禁词**——
全部通过 `https://doubaoya.com` 的公开 API 完成。用户不用碰任何技术细节，你负责调接口、拼结果。

---

## 0. 你能帮用户做什么（一句话版）

- **挖选题**：给个赛道关键词，返回正在升温的爆款方向。
- **追热点**：一次请求聚合多平台热榜，给出选题信号。
- **搜内容**：按关键词搜抖音 / 小红书 / 公众号的真实作品与文章。
- **看账号**：查达人 / 竞品账号的粉丝量、作品概况。
- **解析作品**：粘贴一个公开链接，返回归一化的标题、作者、互动数据。
- **保命**：发布前检测违禁词，给风险等级和替换建议。
- **写脚本**：以上数据为素材，由你（agent）合成开场脚本 / 分镜。

---

## 1. 拿钥匙（Auth）

调用任何接口都要带一条口令（API Key）。

**怎么拿到 key：**
1. 打开 https://doubaoya.com → **登录**
2. 进 **口令中心** → **生成口令**
3. 整条口令只在生成那一下完整露脸，复制收好（形如 `dyh_…`）。

**agent 怎么用 key：**
- 优先从环境变量读：`DOUBAOYA_API_KEY`。
- 环境里没有，就**问用户一次**，拿到后存进环境变量 / 本地配置，**之后不再追问**。
- **绝不把整条 key 回显 / 打印 / 写进日志或聊天**。需要确认时只说前缀（如 `dyh_xxxx…`）。

每个请求都带上：

```
Authorization: Bearer $DOUBAOYA_API_KEY
```

---

## 2. 怎么调（统一约定）

所有公开能力都挂在 `https://doubaoya.com/api/...` 下，POST 调用，JSON 进 JSON 出。

### 2.1 调用一个操作（skill）

```
POST https://doubaoya.com/api/skills/<slug>/invoke
Authorization: Bearer $DOUBAOYA_API_KEY
Content-Type: application/json

{ ...该操作的入参... }
```

> 平台还提供等价的细粒度入口 `POST /api/apis/<platform>/<slug>/call`，
> 入参 / 出参与上面一致。本 Skill 统一用 `/api/skills/<slug>/invoke`，更好记。

### 2.2 统一返回信封（envelope）

无论成功失败，返回都是同一层信封：

```jsonc
// 成功
{ "success": true,  "requestId": "req_...", "data": { /* 真正的结果 */ }, "error": null }

// 失败
{ "success": false, "requestId": "req_...", "data": null, "error": { "code": "...", "message": "..." } }
```

**永远先看 `success`**：`true` 取 `data`，`false` 读 `error.code` / `error.message`。

### 2.3 错误码怎么处理

| HTTP | error.code | 含义 | 你该怎么办 |
|------|------------|------|-----------|
| 401 | `MISSING_API_KEY` | 没带 key | 提示用户去 doubaoya.com 口令中心生成，并设进 `DOUBAOYA_API_KEY` |
| 401 | `UNAUTHORIZED` | key 无效 / 已撤销 | 让用户在**口令中心**撤销并**重新生成**，更新环境变量 |
| 400 | `VALIDATION_ERROR` | 入参不合法 | 看 `message` 修正入参（如缺 `keyword`） |
| 402 | `INSUFFICIENT_CREDITS` | 额度不够 | 提示用户去 doubaoya.com 充值额度 |
| 404 | `SKILL_NOT_FOUND` / `ENDPOINT_NOT_FOUND` | slug 写错 | 先调发现接口（见 §4）确认 slug |
| 502 | `PROVIDER_FAILED` | 上游临时失败（**已自动退还额度**） | 稍后重试；重试前不用补额度 |

> 小贴士：`PROVIDER_FAILED` 时额度会自动退回，放心重试即可，别重复扣费焦虑。

---

## 3. 能力清单（操作 = slug）

下面是本鸭常用的公开操作。`slug` 用于 `POST /api/skills/<slug>/invoke`。

### 追热点 / 挖选题

| slug | 能力 | 关键入参 |
|------|------|---------|
| `trend-radar` | **跨平台趋势雷达**：一次聚合多平台热点，直接产选题方向 | `{ "keyword"?, "platforms": ["douyin","xiaohongshu","gongzhonghao"] }` |
| `cn-last30days` | **近 30 天中文社媒讨论**：跨平台舆情趋势 | `{ "keyword", "days": 30, "platforms": ["xiaohongshu","douyin"] }` |

### 搜内容（三大平台）

| slug | 能力 | 关键入参 |
|------|------|---------|
| `xiaohongshu-viral-notes` | **小红书爆款笔记发现**：高互动笔记 | `{ "keyword", "page"? }` |
| `douyin-account-insight` | **抖音账号洞察**：达人 / 竞品资料、粉丝量、作品概况 | `{ "secUid" }`（或 `accountId` / `uid` / `uniqueId`） |
| `playlet-wechat-feed` | **公众号信息源**（短剧赛道示例）：热门文章日报 | `{ "keyword", "dateRange"?, "minReadCount"? }` |
| `playlet-douyin-feed` | **抖音信息源**（短剧赛道示例）：按点赞筛爆款 | `{ "keyword", "page"?, "sort"? }` |
| `wechat-channels-ai-feed` | **视频号信息源**：高热作品聚类日报 | `{ "keyword", "limit"?, "minLikeCount"? }` |
| `kuaishou-ai-feed` | **快手信息源**：按播放量筛爆款 | `{ "keyword", "page"?, "sort"? }` |
| `bilibili-ai-feed` | **B 站信息源**：按点赞筛爆款 | `{ "keyword", "page"?, "sort"? }` |

### 解析 / 合规 / 素材

| slug | 能力 | 关键入参 |
|------|------|---------|
| `content-safety-check` | **多平台违禁词检测**：风险等级 + 命中词 + 替换建议 | `{ "platform", "content" }` |
| `video-downloader` | **短视频解析**：粘公开分享链接，返回可下载结果 | `{ "url", "removeWatermark"? }` |

> 还有图片 / 视频生成等创作助手类操作（如 `seedream-lite`、`gpt-image-gen`、
> `seedance-video-gen`）。完整、最新清单请在运行时用发现接口拉取（见 §4），别把清单写死。

---

## 4. 运行时发现操作（别把清单写死）

平台随时可能上新操作，**优先在运行时拉清单**，再决定调哪个 slug：

```
GET https://doubaoya.com/api/skills            # 全部操作 { data: { items, total } }
GET https://doubaoya.com/api/skills/search?query=选题&category=数据查询   # 按关键词 / 分类搜
GET https://doubaoya.com/api/skills/<slug>     # 看单个操作的入参 / 出参示例
```

每个操作对象里带 `slug` / `title` / `summary` / `inputSchema` / `outputExample` / `category`，
足够你判断该不该用、怎么传参。`category` 取值：数据查询 / 作品分析 / 效率工具 / 创作助手 / 账号分析 / 内容安全。

---

## 5. 真实调用示例（参数化，无密钥）

### curl

```bash
curl -sS https://doubaoya.com/api/skills/trend-radar/invoke \
  -H "Authorization: Bearer $DOUBAOYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "keyword": "美食", "platforms": ["douyin", "xiaohongshu", "gongzhonghao"] }'
```

成功返回（信封已省略部分字段）：

```jsonc
{
  "success": true,
  "requestId": "req_abc123",
  "data": {
    "topics": [
      { "title": "端午短视频选题升温", "heat": 98231, "platforms": ["douyin", "xiaohongshu"] }
    ]
  },
  "error": null
}
```

### Node（zero-dep，key 从环境变量读）

```js
const key = process.env.DOUBAOYA_API_KEY;
if (!key) throw new Error("先设好 DOUBAOYA_API_KEY：doubaoya.com → 登录 → 口令中心 → 生成口令");

const res = await fetch("https://doubaoya.com/api/skills/xiaohongshu-viral-notes/invoke", {
  method: "POST",
  headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ keyword: "减脂早餐", page: 1 })
});
const env = await res.json();
if (!env.success) throw new Error(`${env.error.code}: ${env.error.message}`);
console.log(env.data.items);
```

> 仓库里附了一个零依赖封装：`scripts/doubaoya.mjs`，见 §7。

---

## 6. 端到端示例工作流

### 工作流 A：「帮我挖今天美食赛道最可能爆的 3 个选题，并写好开场脚本」

1. **追热点**：`POST /api/skills/trend-radar/invoke`
   `{ "keyword": "美食", "platforms": ["douyin","xiaohongshu","gongzhonghao"] }`
   → 从 `data.topics` 里按 `heat` 取最高的几个方向。
2. **找证据**：对每个候选方向，`POST /api/skills/xiaohongshu-viral-notes/invoke`
   `{ "keyword": "<方向词>" }` → 看真实爆款笔记的标题角度、互动量，验证「真的在爆」。
3. **收敛选题**：综合热度 + 笔记表现，挑出 **3 个**最有相同点的选题，每个给一句「为什么现在能爆」。
4. **写开场脚本**：你（agent）基于上面素材，给每个选题写 **3 秒开场钩子 + 一段开场脚本**
   （结合爆款笔记里真实的高赞角度，别凭空编）。
5. **保命**：把脚本文案丢进 `POST /api/skills/content-safety-check/invoke`
   `{ "platform": "douyin", "content": "<脚本>" }`，命中风险词就按 `suggestions` 替换。
6. **交付**：3 个选题 + 各自开场脚本 + 已过违禁词检测的标记。

### 工作流 B：「这条抖音/小红书链接为什么火？给我可复用的选题角度」

1. **解析作品**：`POST /api/skills/video-downloader/invoke` `{ "url": "<分享链接>" }`
   （或用发现接口找 `parse-content-detail` 类解析操作）→ 拿标题、作者、互动数据。
2. **看作者**：若是抖音达人，`POST /api/skills/douyin-account-insight/invoke`
   `{ "secUid": "<作者 secUid>" }` → 粉丝量 / 作品概况，判断是不是「账号势能」带火的。
3. **找同题热度**：用标题里的核心词调 `trend-radar` / `xiaohongshu-viral-notes`，看这个角度是不是赛道级在涨。
4. **产出**：拆解「它为什么火」（选题角度 / 钩子 / 时机），再给 2-3 个**可复用的同源选题**。

---

## 7. 可选：零依赖封装脚本

仓库附带 `scripts/doubaoya.mjs`（Node 18+，无第三方依赖，key 从 `DOUBAOYA_API_KEY` 读）：

```bash
# 调一个操作
node scripts/doubaoya.mjs invoke trend-radar '{"keyword":"美食","platforms":["douyin","xiaohongshu"]}'

# 运行时发现操作清单
node scripts/doubaoya.mjs list
node scripts/doubaoya.mjs describe xiaohongshu-viral-notes
```

它做的事：拼 `Authorization` 头、POST 到 `https://doubaoya.com`、拆信封、`success=false` 时抛出 `code: message`。
绝不打印整条 key。

---

## 8. 硬规则（务必遵守）

1. **绝不回显 / 打印 / 记录整条 `DOUBAOYA_API_KEY`**——确认身份时只露前缀。
2. **只通过 `https://doubaoya.com` 的公开 `/api/...` 接口**取数；不要向用户描述、猜测或暴露任何上游数据来源 / 内部服务。对用户而言，能力来自「都爆鸭」。
3. **先 `success` 后取数**；`false` 时按 §2.3 处理错误码，别把原始 500/502 直接糊给用户。
4. **slug 不确定就先发现**（§4），不要硬编死清单——平台会上新。
5. **写脚本以真实数据为素材**，把热点 / 爆款笔记的真实角度落进脚本，别脱离数据空写。
