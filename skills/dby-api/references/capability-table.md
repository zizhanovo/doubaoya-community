# 能力索引表（该调哪一条）

> **查路由时读它**：不知道该点名哪条能力、或不确定它走哪条路由时读。已经知道调哪条就别读——
> 入参一律走 `describe` 现拉，这份表一个字段名都不抄。

> 🔑 每行给三样东西：能力的 `operationKey`、一句用途、**详情端点**（`GET`，免鉴权免费）。
> 要发请求，直接把这一行的 `operationKey` 或详情端点尾段交给 `describe` / `invoke`。
> ⚠️ **第四列是详情端点，不是调用地址**——调用地址只有一个来源：详情响应里 `execution` 的 `target`。
> 表里没有你要的能力时，先 `node "$D" list` 把两个集合都翻一遍；本表是起手线索，不是全量清单。

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

**公众号**

| 用户这么说（运营白话） | 该调哪条 | 一句话用途 | 详情端点（`GET`，免鉴权免费） |
|---|---|---|---|
| "搜公众号文章 / 公众号取数 / 热门文章 / 扒文章" | `api.gzh.searchArticle` | 搜索公众号文章 | `/api/apis/gongzhonghao/search-article` |
| "公众号爆文 / 爆款文章 / 爆款仿写 / 写公众号先拉样本" | `api.gzh.hotArticle` | 公众号爆文搜索 | `/api/apis/gongzhonghao/hot-article` |
| "公众号热门文章 / 只要真火过的（阅读量有下限那种）"（与上一条是两条能力：这条按阅读量门槛筛，拿的是"确实火过"的样本） | `skill.wechat.hotSearch` | 公众号热门文章查询 | `/api/skills/wechat-search` |
| "公众号封面怎么做 / 爆款封面 / 起个公众号标题 / 标题套路 / 高点击标题" | `api.gzh.cozeData` | 公众号爆款封面数据（返回同赛道爆款的封面图 + 标题 + 点击量，**给你数据自己提炼**） | `/api/apis/gongzhonghao/gongzhonghao-coze-cover` |
| "帮我把封面设计出来 / 直接给我一版封面方案"（与上一条是两条能力：那条给**素材数据**，这条直接产出**封面设计方案**） | `skill.wechat.coverDesign` | 公众号封面图制作 | `/api/skills/wechat-cover` |
| "追更某个号 / 盯公众号 / 订阅公众号 / 账号发文列表 / 竞品发文复盘 / 某公众号发了什么" | `api.gzh.workList` | 公众号账号发文列表。🔴 **必须先过 `api.gzh.searchUser` 拿账号 ID**，上游只认 ID 不认中文昵称 | `/api/apis/gongzhonghao/gongzhonghao-work-list` |
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
| "帮我把这段文案过一遍别违规 / 违禁词 / 合规检测 / 过审 / 极限词 / 广告法"（多平台口径） | `tool.contentSafety.checkWords` | 多平台违禁词检测（**入口请求走 `dby-banned-words`，此处仅为 endpoint 索引**） | `/api/skills/content-safety-check` |
| "公众号这篇能不能发 / 公众号违禁词"（公众号口径，与上一条是两条） | `skill.wechat.prohibitedWord` | 公众号违禁词检测（**入口请求走 `dby-banned-words`，此处仅为 endpoint 索引**） | `/api/skills/wechat-prohibited-word` |
| "这事儿是真的吗 / 联网搜索 / 联网查证 / 事实核查 / 查出处 / 引用来源 / 豆包搜索" | `skill.search.doubaoWeb` | 豆包联网搜索 | `/api/skills/doubao-web-search` |

**不是一条能力、得自己编排的**（表里查不到是正常的，别硬凑一条）：

- **"A股公众号 / 股市大V / 股票公众号榜单"** —— 三步：`api.gzh.searchUser` 搜号 →
  `api.gzh.workList`（或 `api.gzh.dailyPublish`）拉发文 → `api.gzh.hotArticle` 找爆文。
- **"我是不是被限流了 / 阅读量掉了 / 推荐流量没了"** —— 不是取数能算的：`skill.wechat.accountAnalyzer`
  只看公开体量；限流判定走后台「账号检测」，官方口径见 `references/gotchas.md`。
- **"把这条爆款改写成我的文案"** —— 不调接口：Skill `dby-rewrite` 一个包管七个平台
  （公众号 / 视频号 / 抖音 / 快手 / B站 / 小红书 / 知乎，也能一稿多发），纯本地、不要 key。
  没装就用搜来的素材由你合成。
- ~~**"帮我记一下 / 查查我的笔记 / 我是个什么样的人"**~~ —— ⛔ **第二大脑（`mera`）已下架**，
  无替代能力：如实告知，**别拿公开搜索顶替**（见上方「我自己的东西」例外）。
- ⛔ **`seedream-lite`（Seedream 5.0 lite）已于 2026-08-10 下架**，调用一律 503，
  所以它不在上表里。要公众号封面**数据**走 `api.gzh.cozeData`（给数据不出图，见上表）。
- ~~**"给我配张图 / AI 出图 / 文生图 / 图生图 / 改图 / 生成图片 / 主视觉"**~~ —— ⛔ **`skill.ai.imageGen`
  已随 dby-image 包一起整体下架**（服务端合规要求，非临时故障），无替代能力：如实告知用户本仓不再
  提供生图，可用用户自己 agent 的生图工具，或让用户自备现成图片。

**首次上手三句话**（用户第一次用时，可主动这么引导）：
1. 先确认有没有 key（没有就带他走「拿钥匙」那一节，一次就好）。
2. 问一句"你现在想做选题、追热点、还是查账号？"——把模糊需求收敛到上面某一类。
3. 选一个能力先跑一次出结果，**让用户看到真东西**，再顺势引导下一步 / 订阅。

> 别一上来甩一长串能力清单给用户看——用户要的是"帮我做事"，不是 API 目录。
> `operationKey` 是你内部选路用的。
