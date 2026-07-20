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

## 0.5 用户该用哪个能力？（按"我想做什么"选）

本 Skill 是**总入口 / 上手向导**：一条 key 通到都爆鸭全部能力。用户通常不知道有哪些 slug，
你（agent）的活是**听懂用户想干嘛 → 选对能力 → 调 → 把结果讲成人话**。按下面这张"运营意图 → 能力"表对号入座：

**公众号请求例外**：只要请求涉及公众号，先读
[`references/wechat-routing.json`](references/wechat-routing.json)，再按其优先级选 Skill。极简原则：
本地扫码、按号查最新 / 今日、拉正文或历史归档走 MP Ark；公开数据、互动指标和选题分析走都爆鸭云端能力。

| 用户这么说（运营白话） | 该走哪类能力 | 典型起手 slug |
|------------------------|--------------|---------------|
| "最近全网在火什么？给我点选题" | 综合热点选题（无关键词直取 + 结合IP匹配） | `trending-hub` |
| "我这个赛道（如减脂早餐）在涨啥？" | 平台爆款搜索 | `xiaohongshu-viral-notes`、各平台 `*-ai-feed` |
| "这条链接为什么火？拆给我看" | 作品解析 | `content-parse` |
| "帮我把这段文案过一遍，别违规" | 内容安全 | `content-safety-check` |
| "给我配张图" | 创作助手 | `gpt-image-gen`、`seedream-lite` |
| "把这条爆款改写成我的文案" | 改写（多在本地 agent 侧完成） | 用搜来的素材，由你合成 |

**首次上手三句话**（用户第一次用时，可主动这么引导）：
1. 先确认有没有 key（没有就带他走 §1 拿 key，一次就好）。
2. 问一句"你现在想做选题、追热点、还是查账号？"——把模糊需求收敛到上面某一类。
3. 选一个能力先跑一次出结果，**让用户看到真东西**，再顺势引导下一步 / 订阅。

> 别一上来甩一长串 slug 清单给用户看——用户要的是"帮我做事"，不是 API 目录。slug 是你内部选路用的。

> ❌ **选题铁律：不要拿用户的账号名 / IP 名当关键词去搜。**
> 用户的公众号/账号名（如「菜籽油」）是**他是谁**（领域/人设/受众），不是搜索词——搜它只会搜到字面同名内容。
> **综合热点用无关键词的热榜接口直取（`trending-hub`），IP 名字只用于匹配筛选。**
> 做通用选题**别用** `trend-radar` / `hot-topics`（它们是关键词搜索的搬运号 feed，热度常为空、多「未命名内容」）；
> 通用综合热点一律走 `trending-hub`（无关键词直取）。

---

## 1. 拿钥匙（Auth）

调用任何接口都要带一条密钥（API Key）。

**怎么拿到 key：**
1. 打开 https://doubaoya.com → **登录**
2. 进 **密钥中心** → **生成密钥**
3. 整条密钥只在生成那一下完整露脸，复制收好（形如 `dyh_…`）。

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
| 401 | `MISSING_API_KEY` | 没带 key | 提示用户去 doubaoya.com 密钥中心生成，并设进 `DOUBAOYA_API_KEY` |
| 401 | `UNAUTHORIZED` | key 无效 / 已撤销 | 让用户在**密钥中心**撤销并**重新生成**，更新环境变量 |
| 400 | `VALIDATION_ERROR` | 入参不合法 | 看 `message` 修正入参（如缺 `keyword`） |
| 402 | `INSUFFICIENT_CREDITS` | 额度不够 | 提示用户去 doubaoya.com 充值额度 |
| 404 | `SKILL_NOT_FOUND` / `ENDPOINT_NOT_FOUND` | slug 写错 | 先调发现接口（见 §4）确认 slug |
| 502 | `PROVIDER_FAILED` | 上游临时失败（**已自动退还额度**） | 稍后重试；重试前不用补额度 |

> 小贴士：`PROVIDER_FAILED` 时额度会自动退回，放心重试即可，别重复扣费焦虑。

---

## 3. 能力清单（操作 = slug）

下面是本鸭常用的公开操作。`slug` 用于 `POST /api/skills/<slug>/invoke`。

### 综合热点选题（无关键词直取 + 结合IP匹配）

做选题的**正确起手**：先无关键词直取综合热点，再结合用户IP定位智能匹配。**别用账号名/IP名当关键词。**

| slug | 能力 | 关键入参 |
|------|------|---------|
| `trending-hub` | **综合热点直取**（首选）：`trend/trending-hub-keyword` **不带关键词**拉当下全网最热的一批（微博/抖音/B站） | `{ "platforms": [2,5,8] }`（**不传 keywords**） |
| `hot-keywords`（seed，可选） | **全网热搜关键词**：`trend/hot-keywords` 出 20 个热词 + 所属平台，用作选题名的种子 | `{}`（回溯时带 `startDate`/`endDate`） |
| `cn-last30days` | **近 30 天中文社媒讨论**：某个词的跨平台舆情趋势（这是「查某词」，不是通用选题） | `{ "keyword", "days": 30, "platforms": ["xiaohongshu","douyin"] }` |

> ⚠️ 通用综合热点**别用** `trend-radar` / `hot-topics`——它们是关键词搜索的搬运号 feed（热度常为 `null`、多「未命名内容」），只在明确要「按某个词搜同名内容 feed」的窄场景才考虑。

### 搜内容（三大平台）

| slug | 能力 | 关键入参 |
|------|------|---------|
| `xiaohongshu-viral-notes` | **小红书爆款笔记发现**：高互动笔记 | `{ "keyword", "page"? }` |
| `douyin-search` | **抖音爆款搜索**：关键词批量搜抖音作品，铺表选题 | `{ "keyword", "page"? }` |
| `playlet-wechat-feed` | **公众号信息源**（短剧赛道示例）：热门文章日报 | `{ "keyword", "dateRange"?, "minReadCount"? }` |
| `wechat-channels-ai-feed` | **视频号信息源**：高热作品聚类日报 | `{ "keyword", "limit"?, "minLikeCount"? }` |

### 解析 / 合规 / 素材

| slug | 能力 | 关键入参 |
|------|------|---------|
| `content-safety-check` | **多平台违禁词检测**：风险等级 + 命中词 + 替换建议 | `{ "platform", "content" }` |
| `content-parse` | **作品 / 文章解析**：粘公开链接，返回归一化详情，拆「为什么火」 | `{ "url" }` |

> 还有图片生成等创作助手类操作（如 `seedream-lite`、`gpt-image-gen`）。
> 完整、最新清单请在运行时用发现接口拉取（见 §4），别把清单写死。

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
# 综合热点直取：不带关键词，把当下全网最热的一批拉下来
curl -sS https://doubaoya.com/api/apis/trend/trending-hub-keyword/call \
  -H "Authorization: Bearer $DOUBAOYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "platforms": [2, 5, 8] }'
```

成功返回（信封已省略部分字段；条目常分组在 `wbList`/`dyList`/`bzList`）：

```jsonc
{
  "success": true,
  "requestId": "req_abc123",
  "data": {
    "wbList": [ { "title": "样例热点", "hotCount": 98231, "index": 1, "url": "https://…" } ],
    "dyList": [ /* … */ ],
    "bzList": [ /* … */ ]
  },
  "error": null
}
```

### Node（zero-dep，key 从环境变量读）

```js
const key = process.env.DOUBAOYA_API_KEY;
if (!key) throw new Error("先设好 DOUBAOYA_API_KEY：doubaoya.com → 登录 → 密钥中心 → 生成密钥");

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

### 工作流 A：「我这个号（如公众号叫 X）今天该做什么选题？」

> 核心：**综合热点无关键词直取 → 结合这个IP定位智能匹配 → 产选题**。
> ❌ **绝不**把用户的账号名/IP名当关键词去搜（那只会搜到字面同名内容）。

1. **直取综合热点（无关键词）**：`POST /api/apis/trend/trending-hub-keyword/call`
   `{ "platforms": [2,5,8] }`（**不传 keywords**）→ 拿当下全网最热的一批（`wbList`/`dyList`/`bzList`，看 `hotCount`/`index`/`url`）。
2. **明确IP定位**：用户的账号名/IP名是**他是谁**（领域/人设/角度/受众），不是搜索词。
   从用户或其身份资料拿到这份定位；**不清楚就问用户**。
3. **智能匹配**：扫综合热榜，挑出这个IP能**可信借势**的 2–3 条热点（`hotCount` 高 + 跨平台撞榜 + IP契合），
   每条给出这个IP的**独家切角**；必要时用 `xiaohongshu-viral-notes` / `*-ai-feed` 验证「真的在爆」。
4. **写开场脚本**：基于选中的热点 + IP独家切角，给每个选题写 **3 秒开场钩子 + 一段开场脚本**（别脱离数据空写）。
5. **保命**：脚本丢进 `POST /api/skills/content-safety-check/invoke`
   `{ "platform": "douyin", "content": "<脚本>" }`，命中风险词按 `suggestions` 替换。
6. **交付**：3–5 个选题（每个：蹭哪条热点 + 我这IP的独家切角 + 为什么现在能爆）+ 各自开场脚本 + 已过违禁词检测。

### 工作流 B：「这条抖音/小红书链接为什么火？给我可复用的选题角度」

1. **解析作品**：`POST /api/skills/content-parse/invoke` `{ "url": "<分享链接>" }`
   → 拿标题、作者、互动数据。
2. **找同题热度**：用标题里的核心词调 `xiaohongshu-viral-notes` / 各平台 `*-ai-feed`，看这个角度是不是赛道级在涨（这一步是**明确按某个词查证据**，与通用选题的无关键词热榜直取不同）。
3. **产出**：拆解「它为什么火」（选题角度 / 钩子 / 时机），再给 2-3 个**可复用的同源选题**。

---

## 7. 可选：零依赖封装脚本

仓库附带 `scripts/doubaoya.mjs`（Node 18+，无第三方依赖，key 从 `DOUBAOYA_API_KEY` 读）：

```bash
# 调一个操作
node scripts/doubaoya.mjs invoke xiaohongshu-viral-notes '{"keyword":"减脂早餐","page":1}'

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
