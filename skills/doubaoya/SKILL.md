---
name: doubaoya
description: >-
  都爆鸭 (doubaoya / 本鸭) — 新媒体取数与创作总入口：一条 DOUBAOYA_API_KEY 调平台全部在架能力，按意图路由。也做要带出处的联网查资料 / 事实核查。Trigger words: 小红书：搜索/爬取/作品/创作/选题/标题/封面/排行/榜单/热榜/日榜/周榜/周排行/TOP/热门笔记/爆款笔记/笔记查询、公众号：取数/写作/爬虫/标题/封面/排行/榜单/爆文/黑马/违禁词/对标/发了什么、抖音：搜索/取数/评论/实时搜索/综合搜索、视频号：AI/日报/爆款/选题、爆款：文章/标题/封面/结构/仿写/复盘/排行/选题/笔记发现、选题：拆解/灵感/素材/角度/信号、封面：灵感/参考/套路/设计/选题、标题：灵感/优化/套路/生成、账号画像/账号体检/账号健康度/账号发文列表、对标：分析/作品/推荐/矩阵/账号/后再写、竞品：账号/诊断/跟踪/发文复盘、出海：选题/爆款/日报/流量风口、笔记：对标/拆解/生成/选题、内容：创作/灵感/出海、跨平台：选题/分析/热搜、热点：扫描/榜、今日热点/综合热点/追热点/蹭热点/借势选题/找选题/中线选题/短视频选题/全网热搜/热搜关键词/跨平台热搜/全网热榜/聚合热榜/热榜TOP10/每日榜/今日爆款/一周爆款/近期爆款/全平台爆款/低粉爆款/素人爆款/搜抖音爆款、低粉高赞/黑马笔记/黑马账号/头部账号/热门账号/相似账号/标杆账号/小号打法/冷启动对标/起号参考/公众号诊断/批量诊断/周度趋势/近30天作品/最新发布/最多点赞/持续走高/增长榜/阅读增长/增长率排行/流量风向/热度指数/追流量/追更/话题研究/看赛道热门内容、改图/配图/主视觉/文生图/图生图/生成图片/AI出图/首图灵感/高点击标题/起标题、过审/极限词/合规检测/敏感词/公众号违禁词、查出处/引用来源/联网搜索/联网查证/豆包搜索/社媒舆情/舆情监测/用户需求/评论分析/评论风向/看评论/扒评论区、解析链接/链接解析/作品详情/扒文章/扒抖音作品/写小红书/照着写小红书/找对标笔记/热门文章/批量爬公众号/盯公众号/订阅公众号/某公众号发了什么、AI视频号/小红书抖音公众号/文旅/短剧/赛道日报/每天在推什么/实时取数/公众号取数
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

本 Skill 是**总入口 / 上手向导**：一条 key 通到都爆鸭全部能力。用户通常不知道有哪些能力，
你（agent）的活是**听懂用户想干嘛 → 选对能力 → 调 → 把结果讲成人话**。

> 🔑 **这张速查表只回答「该调哪一条」，不回答「怎么填参数」。**
> 每行给三样东西：能力的 `operationKey`、一句用途、**详情端点**（`GET`，免鉴权免费）。
> 要发请求，先 `GET` 那个详情端点，从返回里读入参规格和 `execution` 的 `target`（§2.1）——
> **入参一律现拉，本文档一个字段名都不抄**。抄进来的字段会漂，而漂了没有任何地方会报错。

**公众号请求例外**：只要请求涉及公众号，先读
[`references/wechat-routing.json`](references/wechat-routing.json)，再按其优先级选 Skill。极简原则：
**要交付一篇完整文章（写 + 排版 + 存草稿）走写作交付链**；本地扫码、按号查最新 / 今日、拉正文或历史归档走
MP Ark；公开数据、互动指标和选题分析走都爆鸭云端能力。

**「帮我写一篇公众号文章」例外**：这不是一个 API 能干完的活，是**一条链**——
**本 Skill 自己接前四跳**（`api.gzh.hotArticle` 拉爆文样本 + 写正文；`api.gzh.cozeData` 起标题与
封面套路，要成品封面方案则用 `skill.wechat.coverDesign`；`skill.wechat.prohibitedWord` 出过审版正文）→
`wechat-article-pipeline`（排版 + 封面 + **存进用户自己的公众号草稿箱**）。
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

---

**选题 / 热点 —— 通用选题从这一档起手**

| 用户这么说（运营白话） | 该调哪条 | 一句话用途 | 详情端点（`GET`，免鉴权免费） |
|---|---|---|---|
| "最近全网在火什么？给我点选题" —— 🔴 **不带关键词直取**，通用选题的正确起手 | `api.trend.hotSpotKeyword` | 全网热点聚合直取，通用选题首选 | `/api/apis/trend/trending-hub-keyword` |
| "全网热搜 / 热搜关键词 / 热榜TOP10 / 出一批热词当选题种子" | `api.trend.hotKeywords` | 全网热搜关键词 | `/api/apis/trend/hot-keywords` |
| "**我已经有一个话题了**，看它在各平台分别热成什么样 / 跨平台分析 / 出一份运营日报"（**带关键词**才用它；不带关键词的通用选题走本表首行） | `skill.trend.radar` | 跨平台趋势雷达：一次请求聚合多平台热点，产出选题方向与运营日报 | `/api/skills/trend-radar` |
| "某个词近 30 天在各平台被讨论成什么样 / 近30天作品 / 社媒舆情 / 舆情监测" | `api.multi.workSearch` | 全平台近30天作品聚合 | `/api/apis/multi/cn30-multi-search` |
| "这个词的跨平台讨论量趋势"（CN 版近 30 天，与上一条是两条能力） | `skill.social.last30Days` | Last 30 Days—CN版 | `/api/skills/cn-last30days` |
| "内容出海 / 出海爆款 / 出海日报 / 出海选题 / 出海流量风口 / 全平台爆款" | `api.multi.contentExportTop` | 全平台内容出海Top榜 | `/api/apis/multi/multi-content-export-top` |

**小红书**

| 用户这么说（运营白话） | 该调哪条 | 一句话用途 | 详情端点（`GET`，免鉴权免费） |
|---|---|---|---|
| "我这个赛道在涨啥 / 爆款笔记发现 / 小红书热门笔记 / 找对标笔记" | `skill.xhs.viralNotes` | 小红书爆款笔记发现 | `/api/skills/xiaohongshu-viral-notes` |
| "搜小红书笔记 / 小红书搜索 / 小红书笔记查询 / 小红书爬取" | `api.xhs.searchNote` | 搜索小红书笔记 | `/api/apis/xiaohongshu/search-note` |
| "搜小红书作品 / 照着写小红书 / 对标后再写（先取数再动笔）" | `api.xhs.searchWork` | 搜索小红书作品 | `/api/apis/xiaohongshu/search-work` |
| "批量爬小红书作品 / 小红书爬虫 / 小红书作品采集" | `api.xhs.crawlWork` | 小红书作品采集 | `/api/apis/xiaohongshu/crawl-work` |
| "小红书封面怎么做 / 首图套路 / 封面选题 / 起个小红书标题 / 笔记拆解 / 笔记对标 / 对标分析 / 选题拆解 / 爆款结构" | `api.xhs.cozeData` | 小红书爆款封面/标题/笔记分析数据 | `/api/apis/xiaohongshu/xiaohongshu-coze` |
| "小红书日榜 / 小红书 TOP / 今日爆款笔记" | `api.xhs.cozeDailyTop` | 小红书日榜 | `/api/apis/xiaohongshu/xiaohongshu-daily-top` |
| "小红书周榜 / 小红书周排行 / 一周爆款 / 周度趋势 / 中线选题" | `api.xhs.cozeWeeklyTop` | 小红书周榜 | `/api/apis/xiaohongshu/xiaohongshu-weekly-top` |
| "低粉爆款 / 素人爆款 / 黑马笔记 / 低粉高赞 / 小号打法 / 冷启动对标" | `api.xhs.cozeLowFansTop` | 小红书低粉爆款榜 | `/api/apis/xiaohongshu/xiaohongshu-low-fans-top` |

**抖音**

| 用户这么说（运营白话） | 该调哪条 | 一句话用途 | 详情端点（`GET`，免鉴权免费） |
|---|---|---|---|
| "搜抖音作品 / 抖音搜索 / 抖音综合搜索 / 扒抖音作品 / 短视频选题" | `api.douyin.searchWork` | 搜索抖音作品 | `/api/apis/douyin/search-work` |
| "抖音实时搜索 / 抖音最新发布 / 刚发出来的那批" | `api.douyin.realtimeSearch` | 抖音实时搜索 | `/api/apis/douyin/realtime-search` |
| "扒评论区 / 抖音评论 / 评论分析 / 评论风向 / 用户需求" | `api.douyin.comments` | 抖音作品评论 | `/api/apis/douyin/comments` |

**公众号**

| 用户这么说（运营白话） | 该调哪条 | 一句话用途 | 详情端点（`GET`，免鉴权免费） |
|---|---|---|---|
| "搜公众号文章 / 公众号取数 / 热门文章 / 扒文章" | `api.gzh.searchArticle` | 搜索公众号文章 | `/api/apis/gongzhonghao/search-article` |
| "公众号爆文 / 爆款文章 / 爆款仿写 / 写公众号先拉样本" | `api.gzh.hotArticle` | 公众号爆文搜索 | `/api/apis/gongzhonghao/hot-article` |
| "公众号热门文章 / 只要真火过的（阅读量有下限那种）"（与上一条是两条能力：这条按阅读量门槛筛，拿的是"确实火过"的样本） | `skill.wechat.hotSearch` | 公众号热门文章查询 | `/api/skills/wechat-search` |
| "公众号封面怎么做 / 爆款封面 / 起个公众号标题 / 标题套路 / 高点击标题" | `api.gzh.cozeData` | 公众号爆款封面数据（返回同赛道爆款的封面图 + 标题 + 点击量，**给你数据自己提炼**） | `/api/apis/gongzhonghao/gongzhonghao-coze-cover` |
| "帮我把封面设计出来 / 直接给我一版封面方案"（与上一条是两条能力：那条给**素材数据**，这条直接产出**封面设计方案**） | `skill.wechat.coverDesign` | 公众号封面图制作 | `/api/skills/wechat-cover` |
| "追更某个号 / 盯公众号 / 订阅公众号 / 账号发文列表 / 竞品发文复盘 / 某公众号发了什么" | `api.gzh.workList` | 公众号账号发文列表 | `/api/apis/gongzhonghao/gongzhonghao-work-list` |
| "公众号 10 万+ / 原创爆文 / 原创热文 / 原创热门榜" | `api.gzh.categoryTime` | 公众号10万+/原创榜 | `/api/apis/gongzhonghao/category-time-hot` |
| "头部账号 / 公众号排行 / 公众号榜单 / 热度指数 / 热门账号" | `api.gzh.indexRank` | 公众号热门账号榜 | `/api/apis/gongzhonghao/gongzhonghao-index-rank` |
| "公众号阅读增长 / 增长榜 / 增长率排行 / 持续走高"（要**账号级**的增量与名次） | `api.gzh.raiseRank` | 公众号阅读增长榜 | `/api/apis/gongzhonghao/gongzhonghao-raise-rank` |
| "黑马账号 / 公众号黑马 / 流量风向 / 增长榜里每个号给我一篇代表作"（与上一条同一条上游线，但**是两条能力**：这条按作者去重、每人只出最高阅读那篇，标题可直达原文） | `skill.wechat.fastestGrowing` | 公众号黑马账号推荐 | `/api/skills/wechat-fastest-growing` |
| "公众号 AI 这块在发什么 / 公众号 AI 日报" | `api.gzh.aiFeed` | 公众号AI日报源 | `/api/apis/gongzhonghao/gongzhonghao-ai-feed` |
| "公众号文旅 / 短剧这块在发什么 / 每日榜" | `api.gzh.playletFeed` | 公众号文旅/短剧日报源 | `/api/apis/gongzhonghao/gongzhonghao-playlet-feed` |
| "按名字找公众号 / 这个号叫什么 ID"（三步编排的第一步，见下方 A 股例子） | `api.gzh.searchUser` | 公众号账号搜索 | `/api/apis/gongzhonghao/gongzhonghao-search-user` |
| "某天各号发了什么 / 每日发文查询" | `api.gzh.dailyPublish` | 公众号每日发文查询 | `/api/apis/gongzhonghao/gongzhonghao-daily-publish` |
| "我这个公众号做得怎么样 / 账号体检 / 账号健康度 / 账号画像 / 公众号诊断 / 批量诊断 / 竞品诊断"（给**账号名**，拉粉丝、发文、阅读等真实运营指标，用数据看清现状与体量） | `skill.wechat.accountAnalyzer` | 公众号账号诊断 | `/api/skills/wechat-account-analyzer` |
| "给我找几个同赛道的号对标 / 公众号对标 / 相似账号 / 对标推荐 / 对标矩阵 / 竞品账号 / 起号参考"（3 层加权匹配，同时给**同阶对标号**与**高阶标杆号**） | `skill.wechat.similarAccount` | 公众号相似账号推荐 | `/api/skills/wechat-similar-account` |
| "短剧赛道的公众号热门文章日报"（产品化 Skill 侧，与上面的日报源是两条） | `skill.playlet.wechatFeed` | 短剧-公众号信息源 | `/api/skills/playlet-wechat-feed` |

**视频号**

| 用户这么说（运营白话） | 该调哪条 | 一句话用途 | 详情端点（`GET`，免鉴权免费） |
|---|---|---|---|
| "视频号最近什么在爆 / 视频号上 AI 这块在火什么 / 视频号日报 / 视频号选题" | `api.sph.aiFeed` | 视频号AI日报源 | `/api/apis/sph/shipinhao-ai-feed` |
| "搜视频号作品 / 视频号爆款" | `api.sph.searchWork` | 搜索视频号作品 | `/api/apis/sph/search-work` |
| "找视频号账号" | `api.sph.searchUser` | 搜索视频号账号 | `/api/apis/sph/search-user` |
| "AI 视频号信息源"（产品化 Skill 侧，与 api.sph.aiFeed 是两条） | `skill.wechatChannels.aiFeed` | AI视频号信息源 | `/api/skills/wechat-channels-ai-feed` |

**解析 / 合规 / 素材 / 查证**

| 用户这么说（运营白话） | 该调哪条 | 一句话用途 | 详情端点（`GET`，免鉴权免费） |
|---|---|---|---|
| "这条链接为什么火 / 解析链接 / 链接解析 / 作品详情 / 拆给我看" | `tool.content.parseDetail` | 解析作品/文章详情 | `/api/apis/tool/parse-content-detail` |
| "帮我把这段文案过一遍别违规 / 违禁词 / 合规检测 / 过审 / 极限词 / 广告法"（多平台口径） | `tool.contentSafety.checkWords` | 多平台违禁词检测 | `/api/skills/content-safety-check` |
| "公众号这篇能不能发 / 公众号违禁词"（公众号口径，与上一条是两条） | `skill.wechat.prohibitedWord` | 公众号违禁词检测 | `/api/skills/wechat-prohibited-word` |
| "给我配张图 / AI 出图 / 文生图 / 图生图 / 改图 / 生成图片 / 主视觉" | `skill.ai.imageGen` | AI 生图 / 改图（慢操作，单请求内等结果） | `/api/skills/gpt-image-gen` |
| "这事儿是真的吗 / 联网搜索 / 联网查证 / 事实核查 / 查出处 / 引用来源 / 豆包搜索" | `skill.search.doubaoWeb` | 豆包联网搜索 | `/api/skills/doubao-web-search` |

> ⏳ **生图这条要等**：通常 **1–2 分钟**，最长 **4 分钟**（服务端上限 240 秒）。
> 用命令行调用就把客户端超时留到 **≥5 分钟**——**客户端超时必须晚于服务端上限**：
> 服务端超时会退款，客户端提前放弃**不会**退，请求照样在服务端跑完、照样扣费，
> 而你只看到一句「超时」。慢是预期，别因为慢就重试（重试才是重复扣费）。

**不是一条能力、得自己编排的**（表里查不到是正常的，别硬凑一条）：

- **"A股公众号 / 股市大V / 股票公众号榜单"** —— 三步：`api.gzh.searchUser` 搜号 →
  `api.gzh.workList`（或 `api.gzh.dailyPublish`）拉发文 → `api.gzh.hotArticle` 找爆文。
- **"把这条爆款改写成我的文案"** —— 不调接口：Skill `wechat-rewrite`（公众号）/
  `xiaohongshu-rewrite`（小红书）/ `multi-rewrite`（一稿多发），纯本地、不要 key。
  没装就用搜来的素材由你合成。
- ~~**"帮我记一下 / 查查我的笔记 / 我是个什么样的人"**~~ —— ⛔ **第二大脑（`mera`）已下架**，
  无替代能力：如实告知，**别拿公开搜索顶替**（见上方「我自己的东西」例外）。
- ⛔ **`seedream-lite`（Seedream 5.0 lite）已于 2026-08-10 下架**，调用一律 503，
  所以它不在上表里。要出图走 `skill.ai.imageGen`，要公众号封面走 `api.gzh.cozeData`。

**首次上手三句话**（用户第一次用时，可主动这么引导）：
1. 先确认有没有 key（没有就带他走 §1 拿 key，一次就好）。
2. 问一句"你现在想做选题、追热点、还是查账号？"——把模糊需求收敛到上面某一类。
3. 选一个能力先跑一次出结果，**让用户看到真东西**，再顺势引导下一步 / 订阅。

> 别一上来甩一长串能力清单给用户看——用户要的是"帮我做事"，不是 API 目录。
> `operationKey` 是你内部选路用的。

> ⚠️ **第四列是详情端点，不是调用地址。** 平台有两个不相交的能力集合、两条互不回落的路由，
> 而且有三条走专用路由（方法未必是 POST），照详情端点拼调用地址必然出错。
> **调用地址只有一个来源：详情响应里的 `execution` 的 `target`**（§2.1）。
> 表里没有你要的能力时，先跑一遍发现接口（§4）再下结论——本表是起手线索，不是全量清单。

> 📖 **想看全量、或者撞上选路的坑**：装了 `doubaoya-gateway` 的话，
> [`doubaoya-gateway/references/capability-index.md`](../doubaoya-gateway/references/capability-index.md)
> 是从发现接口生成的**全量索引**（本表只列最常用的那批）；
> [`doubaoya-gateway/references/routing-pitfalls.md`](../doubaoya-gateway/references/routing-pitfalls.md)
> 装的是**只有踩过才知道**的选路知识（哪条 `operationKey` 撞名、哪两条能力不该混用）。
> 没装网关也不影响本节使用——那两份是补充，不是前置。

> ❌ **选题铁律：不要拿用户的账号名 / IP 名当关键词去搜。**
> 用户的公众号/账号名（如「菜籽油」）是**他是谁**（领域/人设/受众），不是搜索词——搜它只会搜到字面同名内容。
> **综合热点用无关键词的 `api.trend.hotSpotKeyword` 直取，IP 名字只用于匹配筛选。**
> 通用综合热点一律走 `api.trend.hotSpotKeyword`（无关键词直取）。
> 跨平台趋势雷达（`skill.trend.radar`）与全网热榜聚合（`api.trend.hotTopics`）是**另一种活**：
> 它们按关键词搜，**手里已经有话题**时用它们看这个词在各平台分别热成什么样（雷达还能直接产出
> 运营日报）；**没有话题、要它给你想选题**时才不该用——那时它们退化成搬运号 feed，
> 热度常为空、多「未命名内容」。

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
- 🔴 **key 一个字符都不许回显 / 打印 / 写进日志或聊天——前缀也是密钥内容。**
  要报状态只许说「已设置 / 没设置」，别打印任何截断形式（`${KEY:0:6}` 这种写法就是在打印密钥）。

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
> 它只回答**怎么把一次调用打出去**，不承接业务意图；要做的事本身该走哪个能力，看 §0.5 与 `dby`。

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
> `dby`、`wechat-article-pipeline`）当成调用 slug——它们**不是**，打过去必 404。

---

## 3. 选路知识（哪条不该用、哪条已下架）

**该调哪一条在 §0.5**，那张表按用户话术铺开，每行给 `operationKey` + 用途 + 详情端点。
本节不重复它，只装两样 §0.5 装不下的东西：**已知的选路坑**，和**已下架的能力**。

> 🔴 **本文档里所有能力清单都是起手线索，不是全量。** 平台会上新、也会下架，
> **准数永远以你这一次实拉发现接口的 `total` 为准**——别把任何一个数字抄进你的判断里（§4）。
> 小红书 / 抖音 / 公众号 / 视频号 / B站 / 快手 / TikTok 的搜索、账号、榜单、日报源加起来是
> 数量上的大头，全在 `GET /api/apis` 里。**要找某个平台的某种数据，先去那儿翻，
> 别在 §0.5 那张短表里找不到就放弃。**

### 已知的选路坑

- ⚠️ **趋势雷达 / 热榜聚合是「已有话题」那一档，不是「帮我想选题」那一档**：
  `skill.trend.radar` 与 `api.trend.hotTopics` **按关键词搜**。手里已经有一个词、要看它在
  各平台分别热成什么样（雷达还能直接产出运营日报），它们正是干这个的——雷达在生产上是
  第二活跃的能力，别因为下面这句话就不敢用。但**没有话题、指望它给你想选题**时不该用它们：
  那时它们退化成搬运号 feed，热度常为空、多「未命名内容」。通用选题一律走
  `api.trend.hotSpotKeyword` 的**无关键词直取**（§0.5 首行）。
- ⚠️ **`api.trend.hotKeywords` 别带日期**：上游只供最新一批，带日期区间必返 0 条。
  ——这类「参数对了才有结果」的坑，正是**入参规格必须调用前现拉**的理由：
  详情端点会告诉你哪些字段可选、取值什么形状，凭记忆拼必踩。
- ⚠️ **上游对错入参一律静默返空或给误导性报错**，别据此判「接口挂了」。
  先回详情端点核一遍入参规格，再看是不是真的没数据（`noResult`，§2.2）。
- 🔴 **有一条 `operationKey` 全局撞名**（多平台违禁词检测在两个集合里各有一条，
  §0.5 已分成两行、各带各的详情端点）。**点名能力时连详情端点一起给**，
  只报 `operationKey` 在这一条上不足以定位。装了网关的话，
  [`doubaoya-gateway/references/routing-pitfalls.md`](../doubaoya-gateway/references/routing-pitfalls.md)
  有这条的完整来龙去脉和其余踩过的坑。

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
GET  https://doubaoya.com/api/skills/search              → 按意图搜（查询串 / 分类 / 条数三个查询参数）
POST https://doubaoya.com/api/skills/recommend          → 按意图推荐（body 带一句自然语言查询）
                                                        → data: 首选一条 + 候选若干 + 判定依据

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
| `unitPrice` | ✓ | ✓ | 本次调用要扣的点数。**以这个字段的实时值为准**，别照记忆或文档里的数字算钱——计价口径改过不止一次 |
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

## 5. 一次调用长什么样（**两步：先拉规格，再发请求**）

示例里**没有任何一条能力的字段名**，这是有意的：入参规格以你这一刻从详情端点拉到的为准。

### curl

```bash
# ① 先拉详情：免鉴权、免费，返回里带入参规格和 execution 的 target
curl --silent --show-error https://doubaoya.com/api/apis/trend/trending-hub-keyword

# ② 再照 execution 的 target 发请求；body 就是①里那份入参规格
curl --silent --show-error https://doubaoya.com<第①步读到的 target 的 path> \
  -H "Authorization: Bearer $DOUBAOYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '<照第①步的入参规格填>'
```

返回永远是同一层信封（§2.2），先看 `success`，`true` 就取 `data`：

```jsonc
{ "success": true, "requestId": "req_abc123", "data": { /* 这条能力自己的结果结构 */ }, "error": null }
```

> `data` 里面长什么样**因能力而异**，本文档不抄——第①步的出参示例（`outputExample` /
> `responseExample`）就是用来对齐「我要读哪几个字段」的，读它，别猜。

### Node（zero-dep，key 从环境变量读）

```js
const key = process.env.DOUBAOYA_API_KEY;
if (!key) throw new Error("先设好 DOUBAOYA_API_KEY：doubaoya.com → 登录 → 密钥中心 → 生成密钥");

// ① 详情端点：拿 execution 的 target 和入参规格（不需要 key）
const detail = await fetch("https://doubaoya.com/api/skills/xiaohongshu-viral-notes").then(r => r.json());
if (!detail.success) throw new Error(`${detail.error.code}: ${detail.error.message}`);
const { method, path } = detail.data.execution.target;

// ② 照 target 发请求。body 照 detail.data 里的入参示例填，别照记忆拼。
const res = await fetch(`https://doubaoya.com${path}`, {
  method,
  headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify(/* 照 ① 的入参规格填 */ {})
});
const env = await res.json();
if (!env.success) throw new Error(`${env.error.code}: ${env.error.message}`);
console.log(env.data);
```

> 🔴 第②步用的是 `method`，不是写死的 `"POST"`——**有三条能力走专用路由，方法未必是 POST**（§2.1）。
> 仓库里附了一个把这两步封好的零依赖脚本：`scripts/doubaoya.mjs`，见 §7。

---

## 6. 端到端示例工作流

### 工作流 A：「我这个号（如公众号叫 X）今天该做什么选题？」

> 核心：**综合热点无关键词直取 → 结合这个IP定位智能匹配 → 产选题**。
> ❌ **绝不**把用户的账号名/IP名当关键词去搜（那只会搜到字面同名内容）。

1. **直取综合热点（无关键词）**：`api.trend.hotSpotKeyword`（详情端点
   `/api/apis/trend/trending-hub-keyword`）→ 拿当下全网最热的一批。
   🔴 **这一步的要害是「不带关键词」**——具体哪个字段控制平台范围、怎么表示「不搜词」，
   照详情端点这一刻返回的入参规格填（§5 的两步）。
2. **明确IP定位**：用户的账号名/IP名是**他是谁**（领域/人设/角度/受众），不是搜索词。
   从用户或其身份资料拿到这份定位；**不清楚就问用户**。
3. **智能匹配**：扫综合热榜，挑出这个IP能**可信借势**的 2–3 条热点（热度高 + 跨平台撞榜 + IP契合），
   每条给出这个IP的**独家切角**；必要时用 `skill.xhs.viralNotes` 或对应平台的日报源验证「真的在爆」。
4. **写开场脚本**：基于选中的热点 + IP独家切角，给每个选题写 **3 秒开场钩子 + 一段开场脚本**（别脱离数据空写）。
5. **保命**：脚本丢进违禁词检测（`tool.contentSafety.checkWords`，详情端点
   `/api/skills/content-safety-check`）。它回三样东西：**一份标注版正文**（命中处被标出来）、
   **一份未标注原文**、**一个风险类别数组**——命中词从标注版与原文的差异定位，
   替换建议由你结合上下文给。
   🔴 **接口不回风险等级、不回评分、不回命中词清单**，别编一个出来。
   这三样都读不到时如实说「没拿到检测结果」，**别当成合规放行**。
6. **交付选题**：3–5 个选题（每个：蹭哪条热点 + 我这IP的独家切角 + 为什么现在能爆）+ 各自开场脚本 + 已过违禁词检测。
7. **选题落地成文章**（用户要的是**公众号文章**而不是短视频脚本时，第 6 步之后还有路）：
   选定一个选题 → 用 `api.gzh.hotArticle` 拉同主题爆文样本写正文 → 用 `api.gzh.cozeData` 起标题 /
   定封面套路 → 用 `skill.wechat.prohibitedWord` 出过审版正文 →
   **`wechat-article-pipeline` 排版 + 配封面 + 存进用户自己的公众号草稿箱**（只存草稿、绝不群发）。
   > 🔴 **走到哪一站由用户要的终态决定**：只要选题和脚本，第 6 步就是终点；要成稿，写完正文就结束；
   > 要**排版好的公众号 HTML** 或要**文章进自己的草稿箱**，才一路走到 `wechat-article-pipeline`
   > （它会写进用户自己的公众号后台，别在他没提过这个意图时替他跑）。逐跳导航交给 `dby`。

### 工作流 B：「这条抖音/小红书链接为什么火？给我可复用的选题角度」

1. **解析作品**：`tool.content.parseDetail`（详情端点 `/api/apis/tool/parse-content-detail`），
   把用户给的公开分享链接丢进去 → 拿归一化的标题、作者、互动数据。
2. **找同题热度**：用标题里的核心词调 `skill.xhs.viralNotes` 或对应平台的日报源
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

# 🔴 先 describe 再 invoke：describe 打的就是详情端点，入参规格从它的返回里读
node scripts/doubaoya.mjs describe trending-hub-keyword

# 调一条能力：<ref> = <slug> 或 <platform>/<slug>
node scripts/doubaoya.mjs invoke xiaohongshu-viral-notes '<照 describe 拉到的入参规格填>'
node scripts/doubaoya.mjs invoke trend/trending-hub-keyword '<照 describe 拉到的入参规格填>'

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
- **回执里只许写能证明的量。** 括号里的结论必须回指这一次**真实返回里确实有的东西**
  （违禁词检测就是个现成例子：它回的是一个风险**类别**数组，所以「命中 N 类」可证；
  它**不回**风险等级 / 评分 / 命中词清单，所以「0 高危」「低风险」这类就是编的）。
  拿不准接口到底回没回这个量，就**回详情端点看一眼出参示例**，别凭印象写。
- **简短**：这是交付的一部分，不是另一份报告。四行以内，别展开成段落。

---

## 8. 硬规则（务必遵守）

1. **绝不回显 / 打印 / 记录 `DOUBAOYA_API_KEY` 的任何一部分**——前缀也是密钥内容，
   要报状态只许说「已设置 / 没设置」。
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
