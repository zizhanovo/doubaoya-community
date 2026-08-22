---
name: dby-api
description: >-
  都爆鸭 (doubaoya / 本鸭) — 新媒体取数与创作总入口：一条 DOUBAOYA_API_KEY 调平台全部在架能力，按意图路由。也做要带出处的联网查资料 / 事实核查。Trigger words: 小红书：搜索/爬取/作品/创作/选题/标题/封面/排行/榜单/热榜/日榜/周榜/周排行/TOP/热门笔记/爆款笔记/笔记查询、公众号：取数/写作/爬虫/标题/封面/排行/榜单/爆文/黑马/违禁词/对标/发了什么、抖音：搜索/取数/评论/实时搜索/综合搜索、视频号：AI/日报/爆款/选题、爆款：文章/标题/封面/结构/仿写/复盘/排行/选题/笔记发现、选题：拆解/灵感/素材/角度/信号、封面：灵感/参考/套路/设计/选题、标题：灵感/优化/套路/生成、账号画像/账号体检/账号健康度/账号发文列表、对标：分析/作品/推荐/矩阵/账号/后再写、竞品：账号/诊断/跟踪/发文复盘、出海：选题/爆款/日报/流量风口、笔记：对标/拆解/生成/选题、内容：创作/灵感/出海、跨平台：选题/分析/热搜、热点：扫描/榜、今日热点/综合热点/追热点/蹭热点/借势选题/找选题/中线选题/短视频选题/全网热搜/热搜关键词/跨平台热搜/全网热榜/聚合热榜/热榜TOP10/每日榜/今日爆款/一周爆款/近期爆款/全平台爆款/低粉爆款/素人爆款/搜抖音爆款、低粉高赞/黑马笔记/黑马账号/头部账号/热门账号/相似账号/标杆账号/小号打法/冷启动对标/起号参考/公众号诊断/批量诊断/周度趋势/近30天作品/最新发布/最多点赞/持续走高/增长榜/阅读增长/增长率排行/流量风向/热度指数/追流量/追更/话题研究/看赛道热门内容、改图/配图/主视觉/文生图/图生图/生成图片/AI出图/首图灵感/高点击标题/起标题、过审/极限词/合规检测/敏感词/公众号违禁词、查出处/引用来源/联网搜索/联网查证/豆包搜索/社媒舆情/舆情监测/用户需求/评论分析/评论风向/看评论/扒评论区、解析链接/链接解析/作品详情/扒文章/扒抖音作品/写小红书/照着写小红书/找对标笔记/热门文章/批量爬公众号/盯公众号/订阅公众号/某公众号发了什么、AI视频号/小红书抖音公众号/文旅/短剧/赛道日报/每天在推什么/实时取数/公众号取数
compatibility: >-
  需要环境变量 DOUBAOYA_API_KEY（形如 dyh_…，在 doubaoya.com 密钥中心生成）；需要能对 https://doubaoya.com 发 HTTPS 请求。
  发现类端点（能力清单 / 详情）免鉴权也免费，调用类端点必须带 Bearer 且计费。
  正文里的 curl 示例只要 curl；可选的零依赖封装脚本 scripts/doubaoya.mjs 需要
  Node ≥ 18（用全局 fetch），不装任何 npm 包。
---
# 都爆鸭 · doubaoya

新媒体取数总入口：一条 `DOUBAOYA_API_KEY` 通到平台全部在架能力。
你（agent）的活是**听懂用户想干嘛 → 选对能力 → 调 → 把结果讲成人话**。

调用走 **`scripts/doubaoya.mjs`**。别自己拼路径——平台有两个不相交的能力集合、
两条互不回落的路由，还有几条专用路由方法不是 POST，硬拼必 404。脚本先拉详情
拿到 `execution.target` 再照着打，这些都不用你操心。

---

## 怎么调

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"    # 绝不打印、不写文件、不回显给用户
D=~/.claude/skills/dby-api/scripts/doubaoya.mjs   # 按实际安装位置改

# 发现：两个集合一起拉／搜（免 key、免费）
node "$D" list
node "$D" search 小红书 爆款

# 🔴 先 describe 再 invoke —— 入参规格现拉，一个字段名都别照记忆拼
node "$D" describe trend/trending-hub-keyword

# 调用（计费）。<ref> = <slug> 或 <platform>/<slug>
node "$D" invoke trend/trending-hub-keyword '<照 describe 拉到的入参规格填>'
node "$D" invoke xiaohongshu-viral-notes '<照 describe 拉到的入参规格填>'

# 离线自检（不联网、不需要 key）
node "$D" selfcheck
```

结果打 stdout，`notice` / `noResult` 打 stderr，失败以 `code: message` 非零退出。

🔴 **入参一律现拉。** `describe` 返回里的 `requestSchema` / `inputSchema` 是**示例值不是 JSON Schema**，
照它的键名和值的形状填。上游对错入参**一律静默返空或给误导性报错**——
拿不到数据时先回 `describe` 核一遍入参，别急着判「接口挂了」。

---

## 拿钥匙

doubaoya.com → 登录 → 密钥中心 → 生成密钥（形如 `dyh_…`，只在生成那一下完整露脸）。
环境里没有就**问用户一次**，存进环境变量，之后不再追问。

🔴 **key 一个字符都不许回显 / 打印 / 写日志——前缀也是密钥内容。**
报状态只许说「已设置 / 没设置」（`${KEY:0:6}` 这种写法就是在打印密钥）。

---
## 0.5 用户该用哪个能力？（按"我想做什么"选）

本 Skill 是**总入口 / 上手向导**：一条 key 通到都爆鸭全部能力。用户通常不知道有哪些能力，
你（agent）的活是**听懂用户想干嘛 → 选对能力 → 调 → 把结果讲成人话**。

> 🔑 **这张速查表只回答「该调哪一条」，不回答「怎么填参数」。**
> 每行给三样东西：能力的 `operationKey`、一句用途、**详情端点**（`GET`，免鉴权免费）。
> 要发请求，直接把这一行的 `operationKey` 或详情端点尾段交给 `describe` / `invoke`，
> 脚本会去拉规格与调用路径——
> **入参一律现拉，本文档一个字段名都不抄**。抄进来的字段会漂，而漂了没有任何地方会报错。

**公众号请求例外**：只要请求涉及公众号，先读
[`references/wechat-routing.json`](references/wechat-routing.json)，再按其优先级选 Skill。极简原则：
**要交付一篇完整文章（写 + 排版 + 存草稿）走写作交付链**；本地扫码、按号查最新 / 今日、拉正文或历史归档走
MP Ark；公开数据、互动指标和选题分析走都爆鸭云端能力。

**「帮我写一篇公众号文章」例外**：这不是一个 API 能干完的活，是**一条链**——
**本 Skill 自己接前四跳**（`api.gzh.hotArticle` 拉爆文样本 + 写正文；`api.gzh.cozeData` 起标题与
封面套路，要成品封面方案则用 `skill.wechat.coverDesign`；`skill.wechat.prohibitedWord` 出过审版正文）→
`dby-publish`（排版 + 封面 + **存进用户自己的公众号草稿箱**）。
🔴 **先问清用户要的终态，再决定走到链上哪一站**：只要成稿，写完正文就结束；
要**排版好的公众号 HTML** 或要**文章进自己的草稿箱**，就得一路走到 `dby-publish`。
交一段 Markdown 就默认收尾，是这条链最常见的断头；反过来，用户只要成稿时擅自去写他的公众号后台
同样不对——`dby-publish` 有真实副作用。拿不准就问一句。
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
| "最近全网在火什么？给我点选题" —— 🔴 **不带关键词、但要收窄时间窗口**，通用选题的正确起手 | `api.trend.hotSpotKeyword` | 全网热点聚合直取，通用选题首选。⚠️ 不收窄时间窗口时返的是近 30 天池子、中位 15 天前（实测），要「今天」必须按详情端点里的起止时间字段收窄 | `/api/apis/trend/trending-hub-keyword` |
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
| "给我配张图 / AI 出图 / 文生图 / 图生图 / 改图 / 生成图片 / 主视觉" | → **走 `dby-image`** | 出图有自己一套等待与重试纪律，全写在那个包里 | — |
| "这事儿是真的吗 / 联网搜索 / 联网查证 / 事实核查 / 查出处 / 引用来源 / 豆包搜索" | `skill.search.doubaoWeb` | 豆包联网搜索 | `/api/skills/doubao-web-search` |

> 🖼 **出图不在本包**：`dby-image` 是它的 owner。等待时长、客户端超时下限、
> 「超时永不重试」、返回是 base64 而不是图片 URL——这几条只写在那个包里，
> 本文件**不复述**（复述必漂）。用户要图就点名 `dby-image`。

**不是一条能力、得自己编排的**（表里查不到是正常的，别硬凑一条）：

- **"A股公众号 / 股市大V / 股票公众号榜单"** —— 三步：`api.gzh.searchUser` 搜号 →
  `api.gzh.workList`（或 `api.gzh.dailyPublish`）拉发文 → `api.gzh.hotArticle` 找爆文。
- **"把这条爆款改写成我的文案"** —— 不调接口：Skill `dby-rewrite` 一个包管七个平台
  （公众号 / 视频号 / 抖音 / 快手 / B站 / 小红书 / 知乎，也能一稿多发），纯本地、不要 key。
  没装就用搜来的素材由你合成。
- ~~**"帮我记一下 / 查查我的笔记 / 我是个什么样的人"**~~ —— ⛔ **第二大脑（`mera`）已下架**，
  无替代能力：如实告知，**别拿公开搜索顶替**（见上方「我自己的东西」例外）。
- ⛔ **`seedream-lite`（Seedream 5.0 lite）已于 2026-08-10 下架**，调用一律 503，
  所以它不在上表里。要出图走 `skill.ai.imageGen`，要公众号封面走 `api.gzh.cozeData`。

**首次上手三句话**（用户第一次用时，可主动这么引导）：
1. 先确认有没有 key（没有就带他走「拿钥匙」那一节，一次就好）。
2. 问一句"你现在想做选题、追热点、还是查账号？"——把模糊需求收敛到上面某一类。
3. 选一个能力先跑一次出结果，**让用户看到真东西**，再顺势引导下一步 / 订阅。

> 别一上来甩一长串能力清单给用户看——用户要的是"帮我做事"，不是 API 目录。
> `operationKey` 是你内部选路用的。

> ⚠️ **第四列是详情端点，不是调用地址。** 平台有两个不相交的能力集合、两条互不回落的路由，
> 而且有三条走专用路由（方法未必是 POST），照详情端点拼调用地址必然出错。
> **调用地址只有一个来源：详情响应里的 `execution` 的 `target`**——让脚本去拿，别自己拼。
> 表里没有你要的能力时，先 `node "$D" list` 把两个集合都翻一遍再下结论——
> 本表是起手线索，不是全量清单。

> 📖 **想看全量、或者撞上选路的坑**：装了 `dby-gateway` 的话，
> [`dby-gateway/references/capability-index.md`](../dby-gateway/references/capability-index.md)
> 是从发现接口生成的**全量索引**（本表只列最常用的那批）；
> [`dby-gateway/references/routing-pitfalls.md`](../dby-gateway/references/routing-pitfalls.md)
> 装的是**只有踩过才知道**的选路知识（哪条 `operationKey` 撞名、哪两条能力不该混用）。
> 没装网关也不影响本节使用——那两份是补充，不是前置。

> ❌ **选题铁律：不要拿用户的账号名 / IP 名当关键词去搜。**
> 用户的公众号/账号名（如「菜籽油」）是**他是谁**（领域/人设/受众），不是搜索词——搜它只会搜到字面同名内容。
> **综合热点用无关键词的 `api.trend.hotSpotKeyword` 直取，IP 名字只用于匹配筛选。**
> ⚠️ 「不带关键词」说的是**关键词**——**时间窗口该收窄还是要收窄**（见 Gotchas 第一条），
> 两件事别混：不收窄你拿到的是上上周的热榜。
> 通用综合热点一律走 `api.trend.hotSpotKeyword`（无关键词直取）。
> 跨平台趋势雷达（`skill.trend.radar`）与全网热榜聚合（`api.trend.hotTopics`）是**另一种活**：
> 它们按关键词搜，**手里已经有话题**时用它们看这个词在各平台分别热成什么样（雷达还能直接产出
> 运营日报）；**没有话题、要它给你想选题**时才不该用——那时它们退化成搬运号 feed，
> 热度常为空、多「未命名内容」。

---
---

## 判断题：这四种「失败」各该怎么办

脚本会把错误原样抛给你，但**怎么办是你的判断**：

| 情况 | 计费 | 你该怎么办 |
|---|---|---|
| `noResult`（成功信封上的可选字段） | **不计费** | 查询合法、就是没查到。别当失败重试，如实告诉用户，建议换关键词 / 时间范围 |
| `502 PROVIDER_FAILED` | **已自动退还** | 上游临时失败，可以重试，不用先充值 |
| `503 CAPABILITY_UNAVAILABLE` | 不计费 | 能力维护中或已下架，**别重试**，换一条或如实告知 |
| `404 SKILL_NOT_FOUND` / `ENDPOINT_NOT_FOUND` | — | 🔴 **别原地换花样重试**：两条路由是两个不相交的集合，在错的那一半上试一百次也还是 404。跑 `list` 两个集合都看一遍；都没有就是真没有 |

其余错误码（401 / 400 / 402）看 `message` 照做即可。

> 协议层的完整说明（两条路由为什么不回落、信封结构、`DEDICATED_ROUTE` 之类）
> 归 `dby-gateway`，本文件不复述——复述必漂。它只回答「怎么把一次调用打出去」，
> 不承接业务意图；该做的事走哪条能力看上面那张表。

---

## Gotchas

- 🔴 **热点直取不收窄时间窗口 = 拿到半个月前的「热点」。** 2026-08-21 实测
  `api.trend.hotSpotKeyword`：不收窄时返 350 条，**中位年龄 15 天、最旧 29 天，只有 18% 在 3 天内**；
  按详情端点里那对起止时间字段收成 3 天窗口后，350 条**全部**在 3 天内。
  ⇒ 用户问「今天该做什么选题」时**必须收窄时间窗口**，否则你交的是上上周的热榜。
  （「要害是不带关键词」说的是**关键词**，不是时间——两件事别混。）
- ⚠️ **`api.trend.hotKeywords` 恰恰相反：别收窄时间。** 上游只供最新一批，带时间区间必返 0 条。
  ⇒ 这两条能力的时间语义是反的，别互相套用。字段名一律去详情端点现拉。
- ⚠️ **趋势雷达 / 热榜聚合是「已有话题」那一档。** `skill.trend.radar` 与 `api.trend.hotTopics`
  **按关键词搜**：手里已经有词、要看它在各平台分别热成什么样时用它们（雷达在生产上是第二活跃的能力）。
  **没有话题、指望它给你想选题**时不该用——那时它们退化成搬运号 feed，热度常为空、多「未命名内容」。
- 🔴 **有一条 `operationKey` 全局撞名**（多平台违禁词检测在两个集合里各有一条，上表已分成两行）。
  点名能力时**连详情端点一起给**，只报 `operationKey` 定位不了。
- ⚠️ **技能包目录名 ≠ 调用 slug。** `npx skills add` 装进来的文件夹名（`dby-theme`、`dby-publish`…）
  打过去必 404。脚本找不到时会明说「两个集合都查过了」并提醒你可能拿的是包目录名。
- ⛔ **第二大脑（`mera`）六条能力已下架**，调不通且**没有替代**。
  别拿公开搜索去顶替——公开能力看不见用户自己的笔记，冒充他的记忆比直说「没这个能力」更糟。
  判据与何时作废见 [`references/mera-routing.json`](references/mera-routing.json) 的 `retired` 字段。
  ⚠️ 别拿发现接口当判据：下架条目会被滤掉，但更早的部署仍可能列出它们——**看得见也不等于调得通**。

---

## 交付回执（每次交付都随手带一份）

用户事后问「你刚才用了哪些能力」时再回忆，答出来的必然不准——**回执在交付时写，不是事后补**。

动手前先说清这一次要交到哪一档，**目标停在哪一档就在哪一档收手**。写作链的终态是一道阶梯：

> ① Markdown 成稿 → ② 排版好的公众号 HTML → ③ 存进用户自己的公众号草稿箱

用户只要 ① 时**不跑 `dby-publish` 是正确行为**，不是漏跑——那一步会写进用户自己的公众号后台。
反过来，用户要 ③ 却交一段 Markdown 就收尾才是断头。拿不准就问一句。

交付末尾附上，四行，别合并：

```
查阅：<读了哪份路由 / 参考了哪张表>
执行：<真正调了哪些能力>
质检：<跑了哪些检查>
跳过：<发现了但没跑的> —— 原因：<为什么不该跑>
```

- **「执行」只写真跑过的**；跑了但失败的写在这里并注明失败，不许挪进「跳过」粉饰。
- **「跳过」只列「发现了、但判断不该跑」的**，压根没发现的不必列。带副作用的尤其不能省。
- 🔴 **只许写能证明的量。** 括号里的结论必须回指这一次真实返回里确实有的东西。
  （违禁词检测回的是风险**类别**数组，所以「命中 N 类」可证；它**不回**等级 / 评分 / 命中词清单，
  所以「0 高危」「低风险」就是编的。）拿不准就回 `describe` 看一眼出参示例。

---

## 硬规则

1. **绝不回显 / 打印 / 记录 key 的任何一部分**——前缀也是。
2. **只通过 `https://doubaoya.com` 的公开接口取数**；不向用户描述、猜测或暴露上游数据来源 / 内部服务。
   对用户而言，能力来自「都爆鸭」。
3. **入参现拉、路径现拉**（用 `describe` / 让脚本去拿），别照记忆或本文档拼——
   本文档历史上就是这么把整整一侧的数据能力全写成必然 404 的。
4. **写脚本以真实数据为素材**，把热点 / 爆款的真实角度落进去，别脱离数据空写。
5. **交付带回执**，四行，「执行」只写真跑过的。

---

## 下一步

| 拿到数据之后 | 去哪 |
|---|---|
| 要出图 / 配图 / 改图 | `dby-image` |
| 要把稿子排版、存进公众号草稿箱 | `dby-publish` |
| 要把爆款改写成自己的文案（不调接口、不要 key） | `dby-rewrite` |
| 要立人设 / 取品牌事实 | `dby-charter` |
| 逐跳导航（做完这一步该走哪一步） | `dby` |
| 协议层卡住了（路由 / 信封 / 错误码的完整说明） | `dby-gateway` |
