---
name: doubaoya
description: >-
  都爆鸭 (doubaoya) — 新媒体爆款选题 / 追热点 / 写脚本的 AI 工作搭子。当用户要做爆款选题、找选题、追热点、看全网热榜、
  搜抖音 / 小红书 / 公众号内容、解析作品或文章、查达人账号、写开场脚本 / 短视频脚本、检测违禁词，或提到 doubaoya、都爆鸭、
  本鸭、DOUBAOYA_API_KEY 时使用本 Skill。它教 AI agent 用一条 DOUBAOYA_API_KEY 调用 doubaoya.com 的公开 API，
  把散乱搜索变成可直接用的选题信号和脚本。也覆盖小红书封面 / 标题 / 笔记对标 / 低粉爆款 / 周榜，公众号 10 万+ / 原创榜 / 头部账号榜 /
  追更发文列表 / 文旅短剧日报，视频号 AI 日报，以及全平台内容出海榜——这些原本各有一个薄壳 Skill，
  现已统一由本 Skill 按意图路由到对应数据能力（能力都还在架，只是不再各占一个包）。
  Trigger words: doubaoya / 都爆鸭 / 本鸭 / DOUBAOYA_API_KEY /
  爆款选题 / 选题 / 追热点 / 热点 / 全网热榜 / 写脚本 / 开场脚本 / 短视频脚本 /
  抖音 / 小红书 / 公众号 / 视频号 / 达人账号 / 违禁词 /
  小红书封面 / 首图 / 首图灵感 / 封面选题 / 封面套路 / 小红书标题 / 标题灵感 / 笔记分析 / 笔记拆解 / 笔记对标 /
  对标分析 / 选题拆解 / 爆款结构 / 爆款复盘 / 低粉爆款 / 素人爆款 / 黑马笔记 / 低粉高赞 / 小号打法 / 冷启动对标 /
  小红书周榜 / 小红书周排行 / 一周爆款 / 周度趋势 / 中线选题 / 持续走高 / 内容出海 / 出海爆款 / 出海日报 / 出海选题 /
  全平台爆款 / 出海流量风口 / 追更 / 盯公众号 / 订阅公众号 / 某公众号发了什么 / 账号发文列表 / 竞品发文复盘 /
  视频号爆款 / 视频号日报 / 视频号选题 / AI视频号 / 头部账号 / 热门账号 / 竞品跟踪 / 公众号排行 / 公众号榜单 / 热度指数 /
  A股公众号 / 股市大V / 股票公众号榜单 / 10万+ / 原创爆文 / 原创热文 / 原创热门榜 / 文旅 / 短剧。
compatibility: >-
  需要环境变量 DOUBAOYA_API_KEY（形如 dyh_…，在 doubaoya.com 密钥中心生成）；需要能对 https://doubaoya.com 发 HTTPS 请求。
  发现类端点（能力清单 / 详情）免鉴权也免费，调用类端点必须带 Bearer 且计费。
  正文里的 curl 示例只要 curl；可选的零依赖封装脚本 scripts/doubaoya.mjs 需要
  Node ≥ 18（用全局 fetch），不装任何 npm 包。
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
- **保命**：发布前检测违禁词，返回标注版正文与风险**类别**；命中词从标注定位，替换由你结合上下文给。
- **写脚本**：以上数据为素材，由你（agent）合成开场脚本 / 分镜。
- ~~**记进第二大脑**（`mera`）~~ —— ⛔ **已下架**，见 §3 的「第二大脑」小节。

---

## 0.5 用户该用哪个能力？（按"我想做什么"选）

本 Skill 是**总入口 / 上手向导**：一条 key 通到都爆鸭全部能力。用户通常不知道有哪些 slug，
你（agent）的活是**听懂用户想干嘛 → 选对能力 → 调 → 把结果讲成人话**。按下面这张"运营意图 → 能力"表对号入座：

**公众号请求例外**：只要请求涉及公众号，先读
[`references/wechat-routing.json`](references/wechat-routing.json)，再按其优先级选 Skill。极简原则：
**要交付一篇完整文章（写 + 排版 + 存草稿）走写作交付链**；本地扫码、按号查最新 / 今日、拉正文或历史归档走
MP Ark；公开数据、互动指标和选题分析走都爆鸭云端能力。

**「帮我写一篇公众号文章」例外**：这不是一个 API 能干完的活，是**一条跨 5 个 Skill 的链**——
`wechat-hot-write`（拉爆文样本 + 写正文）→ `wechat-title`（标题）/ `wechat-cover`（封面）→
`wechat-banned-words`（合规）→ `wechat-article-pipeline`（排版 + 封面 + **存进用户自己的公众号草稿箱**）。
🔴 **先问清用户要的终态，再决定走到链上哪一站**：只要成稿，写完正文就结束；
要**排版好的公众号 HTML** 或要**文章进自己的草稿箱**，就得一路走到 `wechat-article-pipeline`。
交一段 Markdown 就默认收尾，是这条链最常见的断头；反过来，用户只要成稿时擅自去写他的公众号后台
同样不对——`wechat-article-pipeline` 有真实副作用。拿不准就问一句。
逐跳导航（做完这一步该走哪一步）由 `dby` 负责，它有完整的**任务后导航图**；把交棒说清楚再交过去，
用户没装 `dby` 时就按上面这条链自己接续。

**「我自己的东西」例外 —— ⛔ 该能力已下架**：请求指向用户**自己**的内容（帮我记一下 / 我的笔记 /
我之前说过 / 我是个什么样的人）时，过去走 `mera` 第二大脑；**该能力已下架，现在调不通**（判据与
失效条件见 [`references/mera-routing.json`](references/mera-routing.json) 的 `retired` 字段）。
**如实告诉用户这个能力下架了**，别拿公开平台搜索去顶替——公开搜索看不见用户自己的笔记，
只会拿陌生人的内容糊弄他，那比直说「没有这个能力」更糟。

| 用户这么说（运营白话） | 该走哪类能力 | 典型起手（**完整路径**，别当它是 slug 去拼） |
|------------------------|--------------|---------------|
| "最近全网在火什么？给我点选题" | 综合热点选题（无关键词直取 + 结合IP匹配） | `POST /api/apis/trend/trending-hub-keyword/call` |
| "我这个赛道（如减脂早餐）在涨啥？" | 平台爆款搜索 | `POST /api/skills/xiaohongshu-viral-notes/invoke`、各平台日报源（`GET /api/apis` 里搜 `ai-feed`） |
| "这条链接为什么火？拆给我看" | 作品解析 | `POST /api/apis/tool/parse-content-detail/call` |
| "帮我把这段文案过一遍，别违规" | 内容安全 | `POST /api/skills/content-safety-check/invoke` |
| "给我配张图" | 创作助手 | `POST /api/skills/gpt-image-gen/invoke` |
| "把这条爆款改写成我的文案" | 改写（纯本地，不联网、不要 key） | Skill `wechat-rewrite`（公众号）/ `xiaohongshu-rewrite`（小红书）；没装就用搜来的素材由你合成 |
| **"帮我写一篇公众号文章 / 写完要排版发草稿"** | **公众号写作交付链**（跨 Skill，不是单个 slug；**先问终态**：只要成稿 vs 要进草稿箱） | Skill `wechat-hot-write` → `wechat-title` / `wechat-cover` → `wechat-banned-words` → `wechat-article-pipeline`（要草稿箱才走到这站）；逐跳导航问 `dby` |
| "小红书封面怎么做 / 首图套路 / 封面选题 / 起个小红书标题 / 帮我拆这篇笔记 / 笔记拆解 / 笔记对标 / 对标分析 / 选题拆解 / 爆款结构" | 小红书爆款封面（首图）/ 标题 / 笔记分析 · 对标数据 | `POST /api/apis/xiaohongshu/xiaohongshu-coze/call` |
| "公众号 10 万+ 有啥 / 原创爆文 / 原创热门榜 / 原创热文榜" | 公众号分类时段热文榜（10万+ / 原创） | `POST /api/apis/gongzhonghao/category-time-hot/call` |
| "公众号文旅 / 短剧这块在发什么" | 公众号文旅 / 短剧日报源 | `POST /api/apis/gongzhonghao/gongzhonghao-playlet-feed/call` |
| 🔴 **"视频号最近什么在爆 / 视频号上 AI（或 XX）这块在火什么 / 视频号日报 / 视频号选题"** | **视频号 AI 日报源**（高热作品聚类） | `POST /api/apis/sph/shipinhao-ai-feed/call`；搜作品 / 账号走 `/api/apis/sph/search-work`、`/api/apis/sph/search-user` |
| "低粉爆款 / 素人爆款 / 黑马笔记 / 低粉高赞 / 小号打法 / 冷启动对标" | 小红书低粉爆款榜（小号也能起量的选题） | `POST /api/apis/xiaohongshu/xiaohongshu-low-fans-top/call` |
| "小红书周榜 / 一周爆款 / 周度趋势 / 中线选题" | 小红书周榜（比日榜更适合定中线选题） | `POST /api/apis/xiaohongshu/xiaohongshu-weekly-top/call` |
| "内容出海 / 出海爆款 / 出海日报 / 出海选题" | 全平台内容出海 Top 榜 | `POST /api/apis/multi/multi-content-export-top/call` |
| "追更某个号 / 盯公众号 / 订阅公众号 / 账号发文列表 / 竞品发文复盘" | 公众号账号发文列表（按号拉时段发文） | `POST /api/apis/gongzhonghao/gongzhonghao-work-list/call` |
| "头部账号 / 公众号排行 / 公众号榜单 / 热度指数" | 公众号热门账号榜 | `POST /api/apis/gongzhonghao/gongzhonghao-index-rank/call` |
| "A股公众号 / 股市大V / 股票公众号榜单" | 没有单条能力，**三步编排**：搜号 → 拉发文 → 找爆文 | `POST /api/apis/gongzhonghao/gongzhonghao-search-user/call` → `.../gongzhonghao-work-list/call`（或 `gongzhonghao-daily-publish`）→ `.../hot-article/call` |
| ~~"帮我记一下 / 存进笔记 / 查查我的笔记 / 我是个什么样的人"~~ | ⛔ **第二大脑（`mera`）已下架** | 无替代能力：如实告知已下架，**别拿公开搜索顶替**（见上方「我自己的东西」例外） |

**首次上手三句话**（用户第一次用时，可主动这么引导）：
1. 先确认有没有 key（没有就带他走 §1 拿 key，一次就好）。
2. 问一句"你现在想做选题、追热点、还是查账号？"——把模糊需求收敛到上面某一类。
3. 选一个能力先跑一次出结果，**让用户看到真东西**，再顺势引导下一步 / 订阅。

> 别一上来甩一长串 slug 清单给用户看——用户要的是"帮我做事"，不是 API 目录。slug 是你内部选路用的。

> ⚠️ **上面这一列是路径，不是 slug。** 平台有两个不相交的能力集合，走两条不同的路由（见 §2.1）；
> 拿路径尾巴上那截当 slug 去拼另一条路由，必然 404。拿不准就先跑发现接口（§4）。

> ❌ **选题铁律：不要拿用户的账号名 / IP 名当关键词去搜。**
> 用户的公众号/账号名（如「菜籽油」）是**他是谁**（领域/人设/受众），不是搜索词——搜它只会搜到字面同名内容。
> **综合热点用无关键词的热榜接口直取（`POST /api/apis/trend/trending-hub-keyword/call`），IP 名字只用于匹配筛选。**
> 做通用选题**别用**跨平台趋势雷达（`/api/skills/trend-radar/invoke`）或全网热榜聚合
> （`/api/apis/trend/hot-topics/call`）——它们是关键词搜索的搬运号 feed，热度常为空、多「未命名内容」；
> 通用综合热点一律走 trending-hub-keyword（无关键词直取）。

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

所有公开能力都挂在 `https://doubaoya.com/api/...` 下，JSON 进 JSON 出。绝大多数是 POST；
少数专用路由用 `PUT` / `GET`，**方法以能力自己的 `execution.target.method` 为准**（见 §2.1）。

> ⚙️ 本节讲的是够用的约定。**只在协议这一层卡住时**再往下翻一层：两条互不回落的路由到底怎么选、
> 统一信封怎么解、`SKILL_NOT_FOUND` / `ENDPOINT_NOT_FOUND` / `DEDICATED_ROUTE` / `NO_RESULT`
> 分别该怎么办、以及「入参规格调用前现拉、别照记忆或本地文档拼」这条纪律——都在 `doubaoya-gateway` 里。
> 它只回答**怎么把一次调用打出去**，不承接业务意图；要做的事本身该走哪个能力，看 §3 与 `dby`。

### 2.1 调用一个操作：先发现，再照 `execution.target` 打

平台有**两个能力集合，各管一半，彼此不回落**：

| 集合 | 发现接口 | 调用路由 | 量级 |
|------|----------|----------|---------|
| 产品化 Skill | `GET /api/skills` | `POST /api/skills/<slug>/invoke` | 十几条 |
| 平台数据能力 | `GET /api/apis` | `POST /api/apis/<platform>/<slug>/call` | 七八十条（数量上的大头） |

> 这一列**只给量级、不给准数**：能力会上新、也会下架（下架的条目会从发现接口里滤掉），
> 准数永远以你这一次实拉发现接口的 `total` 为准。别把某个数字抄进你的判断里。

🔴 **这两条路由不是同一批能力的两个别名，是两个不相交的集合。**
拿数据能力的 slug 去打 `/api/skills/<slug>/invoke` 一律 404 `SKILL_NOT_FOUND`（数量上的大头
——八成以上的能力——全在这一侧），反过来同样 404 `ENDPOINT_NOT_FOUND`。**别靠记忆猜某个能力
属于哪一半。**

**唯一正确姿势：从发现接口（§4）拿到能力对象，直接读它的 `execution.target`，照着打。**
每条能力（两个集合都一样）都带这么一块：

```jsonc
"execution": {
  "mode": "generic",          // generic=通用调用代理 / dedicated=专用路由 / unavailable=当前不可调
  "sideEffect": "read",       // read / generate / write_internal / write_external
  "target": { "method": "POST", "path": "/api/apis/trend/trending-hub-keyword/call" }
}
```

- `mode: "generic"` → 按 `target.method` + `target.path` 发请求，body 就是该能力的入参。
- `mode: "dedicated"` → 同样照 `target` 打，但它是专用路由，**方法未必是 POST**
  （如号章程是 `PUT /api/ip-profile/:id/charter`）。误走通用 `/invoke` 会 400 `DEDICATED_ROUTE`，
  错误信息里直接写着该走哪条。
- `mode: "unavailable"`（**这时没有 `target` 字段**）→ 该能力正在维护或已下架，**别调**；
  硬调返回 503 `CAPABILITY_UNAVAILABLE`，`availability.note` 是可以转述给用户的原因。

`target.path` 是**完整路径**，前面拼上 `https://doubaoya.com` 就能发；**不要自己再去拼
`/api/skills/…`**——本文档历史上就是这么把整整一侧的数据能力全写成必然 404 的。

```
POST https://doubaoya.com<execution.target.path>
Authorization: Bearer $DOUBAOYA_API_KEY
Content-Type: application/json

{ ...该操作的入参... }
```

### 2.2 统一返回信封（envelope）

无论成功失败，返回都是同一层信封：

```jsonc
// 成功
{ "success": true,  "requestId": "req_...", "data": { /* 真正的结果 */ }, "error": null }

// 失败
{ "success": false, "requestId": "req_...", "data": null, "error": { "code": "...", "message": "..." } }
```

**永远先看 `success`**：`true` 取 `data`，`false` 读 `error.code` / `error.message`。

成功信封上还可能多出三个可选字段（缺席是常态，别当异常）：

- `noResult`：`{ "code": "NO_RESULT", "message": "…" }`。**查询合法、就是没查到数据**，
  这次**已不计费**。别把它当失败重试，也别当"接口坏了"——如实告诉用户没结果，
  建议换关键词 / 时间范围 / 筛选条件。
- `notice`：关于本 Skill 有更新的提示，**原样转达给用户**，不影响本次结果，不用重试。
- `detailUrl`：这次调用结果在 doubaoya.com 上的详情页链接，可以给用户点。

### 2.3 错误码怎么处理

| HTTP | error.code | 含义 | 你该怎么办 |
|------|------------|------|-----------|
| 401 | `MISSING_API_KEY` | 没带 key | 提示用户去 doubaoya.com 密钥中心生成，并设进 `DOUBAOYA_API_KEY` |
| 401 | `UNAUTHORIZED` | key 无效 / 已撤销 | 让用户在**密钥中心**撤销并**重新生成**，更新环境变量 |
| 400 | `VALIDATION_ERROR` | 入参不合法 | 看 `message` 修正入参（如缺 `keyword`） |
| 400 | `DEDICATED_ROUTE` | 这条能力有专用路由，你走了通用代理 | `message` 里就写着该打哪条；照 `execution.target` 重发（§2.1） |
| 402 | `INSUFFICIENT_CREDITS` | 额度不够 | 提示用户去 doubaoya.com 充值额度 |
| 404 | `SKILL_NOT_FOUND` | 这个 slug 不在 **skills** 集合里 | 见下方「404 怎么破」 |
| 404 | `ENDPOINT_NOT_FOUND` | 这个 platform/slug 不在 **apis** 集合里 | 见下方「404 怎么破」 |
| 503 | `CAPABILITY_UNAVAILABLE` | 能力维护中 / 已下架（`execution.mode` 是 `unavailable`） | **别重试**：换一条能力，或如实告诉用户这个能力暂时用不了 |
| 502 | `PROVIDER_FAILED` | 上游临时失败（**已自动退还额度**） | 稍后重试；重试前不用补额度 |

> 小贴士：`PROVIDER_FAILED` 时额度会自动退回，放心重试即可，别重复扣费焦虑。

**404 怎么破**（🔴 别原地换着花样重试同一条路由——两条路由查的是两个不相交的集合，
在错的那一半上试一百次也还是 404）：

1. **两个集合都查一遍**：`GET /api/skills` 和 `GET /api/apis`（§4）。八成是能力在另一半，
   路由挑错了。
2. 用 `GET /api/skills/search?query=…` 或 `POST /api/skills/recommend` 按意图找（只覆盖 skills 那一侧）。
3. 找到之后**照它的 `execution.target.path` 打**，不要自己拼路径。
4. 两个集合都没有 → 这个能力**不存在**（或已下架）。如实告诉用户，别再猜别的 slug。

> ⚠️ 你脑子里 / 本文里记住的 slug 只是**起手线索**；能不能调、怎么调，以发现接口的返回为准。
> 尤其别把**技能包目录名**（`npx skills add` 装进来的那个文件夹名，如 `trending-hub`、
> `content-parse`、`douyin-search`）当成调用 slug——它们**不是**，打过去必 404。

---

## 3. 常用能力起手表（**路径已核对，slug 不是目录名**）

下面这张表给的是**完整调用路径**，不是"slug"——因为一条能力走哪条路由，取决于它在哪个集合里（§2.1）。
表里每条都已对着平台目录核过，可以直接打。

> 🔴 **这张表只是起手线索，不是清单。** 平台现有 **100** 条能力（17 skills + 83 apis），
> 这里只列最常用的十来条。要全量、要最新、要准确入参，**运行时用发现接口拉**（§4）。

### 综合热点选题（无关键词直取 + 结合IP匹配）

做选题的**正确起手**：先无关键词直取综合热点，再结合用户IP定位智能匹配。**别用账号名/IP名当关键词。**

| 能力 | 怎么调（完整路径） | 关键入参 |
|------|-------------------|---------|
| **综合热点直取**（首选）：**不带关键词**拉当下全网最热的一批（微博/抖音/B站） | `POST /api/apis/trend/trending-hub-keyword/call` | `{ "platforms": [2,5,8] }`（**不传 keywords**） |
| **全网热搜关键词**（seed，可选）：出一批热词 + 所属平台，用作选题名的种子 | `POST /api/apis/trend/hot-keywords/call` | `{}`（**别带日期**：上游只供最新一批，带日期区间必返 0 条） |
| **近 30 天中文社媒讨论**：某个词的跨平台舆情趋势（这是「查某词」，不是通用选题） | `POST /api/skills/cn-last30days/invoke` | `{ "keyword", "days": 30, "platforms": ["xiaohongshu","douyin"] }` |

> ⚠️ 通用综合热点**别用**跨平台趋势雷达（`POST /api/skills/trend-radar/invoke`）或全网热榜聚合
> （`POST /api/apis/trend/hot-topics/call`）——它们是关键词搜索的搬运号 feed（热度常为 `null`、
> 多「未命名内容」），只在明确要「按某个词搜同名内容 feed」的窄场景才考虑。

### 搜内容（各平台）

| 能力 | 怎么调（完整路径） | 关键入参 |
|------|-------------------|---------|
| **小红书爆款笔记发现**：高互动笔记 | `POST /api/skills/xiaohongshu-viral-notes/invoke` | `{ "keyword", "page"? }` |
| **抖音作品搜索**：关键词批量搜抖音作品，铺表选题 | `POST /api/apis/douyin/search-work/call` | `{ "keyword", "page"? }` |
| **公众号信息源**（短剧赛道示例）：热门文章日报 | `POST /api/skills/playlet-wechat-feed/invoke` | `{ "keyword", "dateRange"?, "minReadCount"? }` |
| **视频号信息源**：高热作品聚类日报 | `POST /api/skills/wechat-channels-ai-feed/invoke` | `{ "keyword", "limit"?, "minLikeCount"? }` |

> 小红书 / 抖音 / 公众号 / 视频号 / B站 / 快手 / TikTok 的搜索、账号、榜单、日报源加起来有 80 多条，
> 全在 `GET /api/apis` 里。**要找某个平台的某种数据，先去那儿翻，别在这张短表里找不到就放弃。**

### 解析 / 合规 / 素材

| 能力 | 怎么调（完整路径） | 关键入参 |
|------|-------------------|---------|
| **多平台违禁词检测**：命中标注 + 风险类别 | `POST /api/skills/content-safety-check/invoke` | `{ "platform", "content" }` |
| **作品 / 文章解析**：粘公开链接，返回归一化详情，拆「为什么火」 | `POST /api/apis/tool/parse-content-detail/call` | `{ "url" }` |
| **AI 生图 / 改图**：出配图、素材、封面图 | `POST /api/skills/gpt-image-gen/invoke` | `{ "prompt", "size"? }`（慢操作，单请求内等结果） |

### ⛔ 第二大脑（`mera` · **已下架，别调**）

`mera` 平台下的六条能力（`note-write` / `note-status` / `note-search` / `source-read` / `ask` / `self`）
**已经下架**，本节只说明为什么、以及你该怎么办——**调用路径故意不再列出，避免你照抄**。

**为什么**（历史事实，可自行复核）：第二大脑的后端服务随 **2026-08-10** 的服务器迁移留在旧机并进入
退役流程，生产环境没有它；域名 `mera.doubaoya.com` 的 DNS 记录已被移除（`dig` 返回 NXDOMAIN）。

**调用会怎样**：一律拿不到结果——要么在**扣点前**被可用性闸拦下返 `503 CAPABILITY_UNAVAILABLE`
（**根本不计费**），要么连不通返 `502 PROVIDER_FAILED`（**已扣的点自动退回**）。两条路都不会白扣
用户的点，但重试、换密钥、换参数都没有意义。

> ⚠️ **别拿发现接口当判据，两个方向都别**：这 6 条已被标为下架（hidden），发现接口会把下架条目
> 从 `GET /api/apis` 里滤掉、`GET /api/apis/mera/<slug>` 与「压根不存在」同为 404；而早于这次
> 标注的部署仍会照旧列出它们（带价格）。所以你按 §4 拉清单时**可能看得见、也可能看不见**，
> 两种情况的结论完全一样：**「清单里有」不等于「调得通」，「清单里没了」也不等于「过会儿再试」**。
> 判据以本节为准，不看清单。
>
> ⚠️ **没有替代能力，也不许降级**：第二大脑装的是用户**自己的**私人笔记。本文档里所有「往外看」的
> 公开平台能力都看不见它——拿公开搜索去回答「我之前说过什么」，等于拿陌生人的内容冒充用户自己的
> 记忆。**如实告知能力已下架**，再问用户要不要改做别的事。
>
> ♻️ **本结论何时作废**：`dig mera.doubaoya.com` 不再返回 NXDOMAIN，且 `mera` 的能力真的能返回数据
> （而不是 503 / 502）时，本节即过期，应当重新写回调用契约。

---

## 4. 运行时发现操作（别把清单写死）

平台随时可能上新操作，**优先在运行时拉清单**，再决定调哪条。

🔴 **发现面有两条，必须两条都拉。** 只拉 `/api/skills` 你只看得见小的那一半，
另一侧（数量上的大头）在你的世界里根本不存在——**不会报错，只会沉默地少掉一大半能力**。
这正是本文档过去犯的错。

```
# ① 产品化 Skill
GET  https://doubaoya.com/api/skills                    → data: { items, total }
GET  https://doubaoya.com/api/skills/<slug>             → data: 单条详情（不存在 / 已下架同为 404）
GET  https://doubaoya.com/api/skills/search?query=选题&category=数据查询&limit=12
                                                        → data: { items, total, categories, query, category }
POST https://doubaoya.com/api/skills/recommend          body: { "query": "帮我找选题", "category"?: "全部", "limit"?: 6 }
                                                        → data: { primary, candidates, decisionSummary, signals }

# ② 平台数据能力（数量上的大头，别漏）
GET  https://doubaoya.com/api/apis                      → data: { items, total }
GET  https://doubaoya.com/api/apis/<platform>/<slug>    → data: 单条详情
```

`platform` 现有取值：`douyin` / `xiaohongshu` / `gongzhonghao` / `sph`（视频号）/ `bilibili` /
`kuaishou` / `tiktok` / `trend` / `tool` / `multi` / ~~`mera`~~（⛔ 已下架，调不通；清单里看不看得见都不是判据，见 §3）。

**每个条目里有什么：**

| 字段 | skills | apis | 说明 |
|------|--------|------|------|
| `slug` | ✓ | ✓ | apis 还多一个 `platform`，两个一起才定位一条 |
| `title` / `summary` / `tags` | ✓ | ✓ | 判断该不该用 |
| `unitPrice` | ✓ | ✓ | 本次调用要扣的点数（¥1 = 100 点） |
| 入参示例 | `inputSchema` | `requestSchema` | ⚠️ **是一份示例值，不是 JSON Schema**——照着它的键名和值的形状传 |
| 出参示例 | `outputExample` | `responseExample` | 同上，用来对齐你要读哪些字段 |
| `execution` | ✓ | ✓ | 🔑 **`execution.target.path` 就是这条能力的完整调用路径**（见 §2.1） |
| `availability` | 可选 | 可选 | 出现即表示维护中（`status: "maintenance"` + `note`），配合 `execution.mode === "unavailable"` |

`category`（只有 skills 有）不用背，`GET /api/skills/search` 的返回里就带一份实时的 `categories` 数组。

**几条实测得来的注意事项：**

- 四条 `GET` 发现接口**不需要 key** 就能拉（但带上也无妨）。
- `POST /api/skills/recommend` **务必带上 `Authorization` 头**：它本身不校验身份，
  但没有 Bearer 头的 POST 会被跨站防护挡成 403 `CSRF_FORBIDDEN`。`query` 为空会 400 `INVALID_PARAMS`。
- `recommend` / `search` **只在 skills 那一侧排序**，看不见 apis 那一侧。
  当"拿不准先问一嘴"用可以，**别拿它当全量目录**——全量在 `GET /api/skills` + `GET /api/apis` 两条里。
- 已下架的能力不会出现在任何发现接口里（列表里没有 ≠ 你搜错了，是真没有）。

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
   `{ "platform": "douyin", "content": "<脚本>" }`——返回 `content`（标注版）/ `originalContent`（原文）/
   `prohibitedWordsType`（风险类别）；命中词从 `content` 的标注定位，替换建议由你结合上下文给。
   🔴 这三个字段都读不到时如实说「没拿到检测结果」，别当成合规放行。
6. **交付选题**：3–5 个选题（每个：蹭哪条热点 + 我这IP的独家切角 + 为什么现在能爆）+ 各自开场脚本 + 已过违禁词检测。
7. **选题落地成文章**（用户要的是**公众号文章**而不是短视频脚本时，第 6 步之后还有路）：
   选定一个选题 → `wechat-hot-write` 拉同主题爆文样本写正文 → `wechat-title` 起标题 /
   `wechat-cover` 定封面套路 → `wechat-banned-words` 出过审版正文 →
   **`wechat-article-pipeline` 排版 + 配封面 + 存进用户自己的公众号草稿箱**（只存草稿、绝不群发）。
   > 🔴 **走到哪一站由用户要的终态决定**：只要选题和脚本，第 6 步就是终点；要成稿，写完正文就结束；
   > 要**排版好的公众号 HTML** 或要**文章进自己的草稿箱**，才一路走到 `wechat-article-pipeline`
   > （它会写进用户自己的公众号后台，别在他没提过这个意图时替他跑）。逐跳导航交给 `dby`。

### 工作流 B：「这条抖音/小红书链接为什么火？给我可复用的选题角度」

1. **解析作品**：`POST /api/apis/tool/parse-content-detail/call` `{ "url": "<分享链接>" }`
   → 拿标题、作者、互动数据。
2. **找同题热度**：用标题里的核心词调 `POST /api/skills/xiaohongshu-viral-notes/invoke` 或对应平台的日报源
   （`GET /api/apis` 里搜 `ai-feed`），看这个角度是不是赛道级在涨（这一步是**明确按某个词查证据**，
   与通用选题的无关键词热榜直取不同）。
3. **产出**：拆解「它为什么火」（选题角度 / 钩子 / 时机），再给 2-3 个**可复用的同源选题**。

---

## 7. 可选：零依赖封装脚本

仓库附带 `scripts/doubaoya.mjs`（Node 18+，无第三方依赖，key 从 `DOUBAOYA_API_KEY` 读）：

```bash
# 运行时发现（两个集合都拉，不需要 key）
node scripts/doubaoya.mjs list                  # 两个集合一起拉，每行直接给出完整调用路径
node scripts/doubaoya.mjs list --apis           # 只看平台数据能力
node scripts/doubaoya.mjs search 小红书 爆款      # 两个集合一起搜
node scripts/doubaoya.mjs describe trending-hub-keyword

# 调一条能力：<ref> = <slug> 或 <platform>/<slug>
node scripts/doubaoya.mjs invoke xiaohongshu-viral-notes '{"keyword":"减脂早餐","page":1}'
node scripts/doubaoya.mjs invoke trend/trending-hub-keyword '{"platforms":[2,5,8]}'

# 离线自检（不联网、不需要 key）
node scripts/doubaoya.mjs selfcheck
```

它做的事：**先解析 `<ref>`**（裸 slug 先查 skills 集合，查不到再在 apis 集合里找；跨平台同名会要求你写全
`<platform>/<slug>`），**拿到该能力的 `execution.target` 再照着发请求**——不自己拼路径，所以两个集合
都够得着，专用路由的 `PUT`/`GET` 也不会被硬拗成 POST。其余：拼 `Authorization` 头、拆信封、
把 `notice` / `noResult` 打到 stderr、`success=false` 时以 `code: message` 退出。**绝不打印整条 key。**

> ⚠️ 找不到某条能力时它会明说「两个集合都查过了」并提醒你可能拿的是**技能包目录名**——
> 别再换着花样重试同一条路由。

---

## 7.5 交付回执（每次交付都随手带一份）

用户事后问「你刚才用了哪些能力 / 哪些 skill」时才去回忆，答出来的必然不准——
**回执在交付时写下，不是事后补**。它让你的选路可被复核，也让用户看得见还有哪条路没走。

### 先声明终态，再选能力

动手前先说清这一次要交到哪一档，**目标停在哪一档就在哪一档收手**。
写作链的终态是一道阶梯（§0.5 同口径）：

> ① Markdown 成稿 → ② 排版好的公众号 HTML → ③ 存进用户自己的公众号草稿箱

用户只要 ① 时**不跑 `wechat-article-pipeline` 是正确行为**，不是漏跑——那一步会写进用户自己的
公众号后台，有真实副作用。反过来，用户要 ③ 却交一段 Markdown 就收尾才是断头。拿不准就问一句。

### 格式

交付末尾附上，四种状态**分开写**，几行就够：

```
查阅：<读了哪份路由 / 参考了哪张表>
执行：<真正调了哪些能力 / 跑了哪些 skill>
质检：<跑了哪些检查>
跳过：<发现了但没跑的能力 / skill> —— 原因：<为什么不该跑>
```

### 硬性规则

- **四行别合并。**「执行」只写**真的跑过**的；没跑的一律不许出现在这一行。
- **「跳过」区分两件事**：*压根没发现* 的不必列；**发现了、但判断不该跑** 的**必须**列并写明原因。
  带副作用的尤其不能省（`wechat-article-pipeline` / `wechat-draft-publish` 会写进用户自己的公众号后台）；
  ⛔ 已下架的能力（如 `mera`，见 §3）如果用户的需求点到了它，也写进「跳过」并说明已下架。
- **如实**：跑了但失败的写在「执行」并注明失败，不许挪进「跳过」粉饰；没做质检就写「无」。
- **回执里只许写能证明的量。** 括号里的结论必须回指某个**真实返回的字段**（如违禁词检测的
  `prohibitedWordsType` 是个类别数组，「命中 N 类」可证；接口**不回**风险等级 / 评分 / 命中词清单，
  「0 高危」「低风险」这类就是编的）。拿不准是不是真字段，就别在回执里写这个量。
- **简短**：这是交付的一部分，不是另一份报告。四行以内，别展开成段落。

---

## 8. 硬规则（务必遵守）

1. **绝不回显 / 打印 / 记录整条 `DOUBAOYA_API_KEY`**——确认身份时只露前缀。
2. **只通过 `https://doubaoya.com` 的公开 `/api/...` 接口**取数；不要向用户描述、猜测或暴露任何上游数据来源 / 内部服务。对用户而言，能力来自「都爆鸭」。
3. **先 `success` 后取数**；`false` 时按 §2.3 处理错误码，别把原始 500/502 直接糊给用户。
4. **调用路径以发现接口返回的 `execution.target` 为准**，不要自己拼、不要硬编死清单（§2.1 / §4）。
   发现面**有两条**（`GET /api/skills` + `GET /api/apis`），只拉一条你会沉默地少看见大半能力。
   技能包目录名 ≠ 调用 slug。
5. **写脚本以真实数据为素材**，把热点 / 爆款笔记的真实角度落进脚本，别脱离数据空写。
6. **第二大脑（`mera`）已下架**（§3）：别调，也**别拿公开搜索去顶替**——公开能力看不见用户自己的
   笔记，冒充他的记忆比直说「没这个能力」更糟。如实告知即可。
   （下架前的红线仍然记在这里，供日后恢复时参考：私人内容只回答用户本人、不得外传到别的服务；
   写入没拿到 `status=done` 之前绝不说「已保存」。）
7. **交付时带回执**（§7.5）：`查阅 / 执行 / 质检 / 跳过` 四行。「执行」只许写真的跑过的；
   **发现了但按终态判断不该跑的，写进「跳过」并说明原因**，别让用户事后靠追问才知道。
