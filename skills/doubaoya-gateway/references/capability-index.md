# 能力索引（**只供选路，不含入参**）

> 本文件属于 `doubaoya-gateway`。它回答且只回答两个问题：**有哪些能力、每条的详情端点在哪**。
> 「它长什么样、怎么填参数」不在这里，也永远不会在这里——那些去详情端点现拉（见 SKILL.md §1）。

**这张表回答且只回答两个问题**：有哪些能力、每条的详情端点在哪。
入参一律不在这儿——要拼参数请回 SKILL.md §1 现拉。

表里给的是**详情端点**（`GET`，免鉴权免费），不是调用地址：拿到详情响应后，
调用地址读它的 `execution` 的 `target`（SKILL.md §3.3）。这样专用路由那三条也不会被推错。

> 2026-08-18 从发现接口实拉生成，共 94 条。**准数与在架状态以你实拉的发现接口为准**——
> 下架的条目会从发现接口里消失，本表不会自己知道。表里没有你要的能力时，
> 先拉一遍 `GET /api/skills` 和 `GET /api/apis` 再下结论。
>
> 标记：⚠️专用 = `execution` 的 `mode` 是 `dedicated`，调用地址与详情端点无关，**必须读 `target`**；
> ⛔ = 实拉时 `mode` 为 `unavailable`，当前不可调。

<!-- 本表由发现接口生成，勿手改。重新生成：
     curl -s https://doubaoya.com/api/apis 与 /api/skills，
     按 operationKey / title / (platform,slug) 三列铺开即可。 -->

### 产品化 Skill 集合 —— 详情端点 `GET /api/skills/<slug>`

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `skill.playlet.wechatFeed` | 短剧-公众号信息源 | `/api/skills/playlet-wechat-feed` |
| `skill.search.doubaoWeb` | 豆包联网搜索 | `/api/skills/doubao-web-search` |
| `skill.social.last30Days` | Last 30 Days—CN版 | `/api/skills/cn-last30days` |
| `skill.ai.imageGen` | GPT-image2 | `/api/skills/gpt-image-gen` |
| `skill.wechatChannels.aiFeed` | AI视频号信息源 | `/api/skills/wechat-channels-ai-feed` |
| `skill.trend.radar` | 跨平台趋势雷达 | `/api/skills/trend-radar` |
| `skill.xhs.viralNotes` | 小红书爆款笔记发现 | `/api/skills/xiaohongshu-viral-notes` |
| `tool.contentSafety.checkWords` | 多平台违禁词检测 | `/api/skills/content-safety-check` |
| `skill.wechat.draftPublish` | 公众号草稿箱写入 ⚠️专用 | `/api/skills/wechat-draft-publish` |
| `skill.wechat.render` | 公众号排版渲染 ⚠️专用 | `/api/skills/wechat-render` |
| `skill.ipProfile.charter` | 定位教练 · 号章程 ⚠️专用 | `/api/skills/dby-charter` |
| `skill.wechat.similarAccount` | 公众号相似账号推荐 | `/api/skills/wechat-similar-account` |
| `skill.wechat.accountAnalyzer` | 公众号账号诊断 | `/api/skills/wechat-account-analyzer` |
| `skill.wechat.fastestGrowing` | 公众号黑马账号推荐 | `/api/skills/wechat-fastest-growing` |
| `skill.wechat.hotSearch` | 公众号热门文章查询 | `/api/skills/wechat-search` |
| `skill.wechat.prohibitedWord` | 公众号违禁词检测 | `/api/skills/wechat-prohibited-word` |
| `skill.wechat.coverDesign` | 公众号封面图制作 | `/api/skills/wechat-cover` |

### 平台数据能力集合 —— 详情端点 `GET /api/apis/<platform>/<slug>`

**全网热榜 / 热点**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `api.trend.hotTopics` | 全网热榜聚合查询 | `/api/apis/trend/hot-topics` |
| `api.trend.hotKeywords` | 全网热搜关键词 | `/api/apis/trend/hot-keywords` |
| `api.trend.hotSpotPlatform` | 抖音实时热榜 | `/api/apis/trend/douyin-hot-trend` |
| `api.trend.hotSpotKeyword` | 全网热点(关键词)聚合 | `/api/apis/trend/trending-hub-keyword` |

**公众号**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `api.gzh.searchArticle` | 搜索公众号文章 | `/api/apis/gongzhonghao/search-article` |
| `api.gzh.queryUser` | 查询公众号账号 | `/api/apis/gongzhonghao/query-user` |
| `api.gzh.queryWork` | 查询公众号作品 | `/api/apis/gongzhonghao/query-work` |
| `api.gzh.hotArticle` | 公众号爆文搜索 | `/api/apis/gongzhonghao/hot-article` |
| `api.gzh.categoryTime` | 公众号10万+/原创榜 | `/api/apis/gongzhonghao/category-time-hot` |
| `api.gzh.dailyPublish` | 公众号每日发文查询 | `/api/apis/gongzhonghao/gongzhonghao-daily-publish` |
| `api.gzh.workList` | 公众号账号发文列表 | `/api/apis/gongzhonghao/gongzhonghao-work-list` |
| `api.gzh.searchUser` | 公众号账号搜索 | `/api/apis/gongzhonghao/gongzhonghao-search-user` |
| `api.gzh.userQuery` | 公众号账号诊断 | `/api/apis/gongzhonghao/gongzhonghao-account-analyzer` |
| `api.gzh.similarAccounts` | 公众号相似账号推荐 | `/api/apis/gongzhonghao/gongzhonghao-similar-account` |
| `api.gzh.indexRank` | 公众号热门账号榜 | `/api/apis/gongzhonghao/gongzhonghao-index-rank` |
| `api.gzh.raiseRank` | 公众号阅读增长榜 | `/api/apis/gongzhonghao/gongzhonghao-raise-rank` |
| `api.gzh.cozeData` | 公众号爆款封面数据 | `/api/apis/gongzhonghao/gongzhonghao-coze-cover` |
| `api.gzh.aiFeed` | 公众号AI日报源 | `/api/apis/gongzhonghao/gongzhonghao-ai-feed` |
| `api.gzh.playletFeed` | 公众号文旅/短剧日报源 | `/api/apis/gongzhonghao/gongzhonghao-playlet-feed` |
| `api.gzh.syncUserNotes` | 公众号文章同步 | `/api/apis/gongzhonghao/gzh-sync-notes` |
| `api.gzh.syncAccount` | 公众号账号同步 ⛔ | `/api/apis/gongzhonghao/gzh-sync-account` |

**抖音**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `api.douyin.queryAccount` | 查询抖音账号 | `/api/apis/douyin/query-account` |
| `api.douyin.searchUser` | 搜索抖音账号 | `/api/apis/douyin/search-user` |
| `api.douyin.queryWorkList` | 查询抖音账号作品列表 | `/api/apis/douyin/query-work-list` |
| `api.douyin.searchWork` | 搜索抖音作品 | `/api/apis/douyin/search-work` |
| `api.douyin.realtimeSearch` | 抖音实时搜索 | `/api/apis/douyin/realtime-search` |
| `api.douyin.comments` | 抖音作品评论 | `/api/apis/douyin/comments` |
| `api.douyin.riseFansRank` | 抖音涨粉榜 | `/api/apis/douyin/douyin-rise-fans-rank` |
| `api.douyin.topAccount` | 抖音最具影响力账号榜 | `/api/apis/douyin/douyin-top-account` |
| `api.douyin.userWorks` | 抖音账号作品采集 | `/api/apis/douyin/douyin-user-works` |
| `api.douyin.accountDiagnosis` | 抖音账号诊断 | `/api/apis/douyin/douyin-account-diagnosis` |
| `api.douyin.similarAccounts` | 抖音相似账号推荐 | `/api/apis/douyin/douyin-similar-account` |
| `api.douyin.aiFeed` | 抖音AI日报源 | `/api/apis/douyin/douyin-ai-feed` |
| `api.douyin.playletFeed` | 抖音文旅/短剧日报源 | `/api/apis/douyin/douyin-playlet-feed` |
| `api.douyin.syncUserNotes` | 抖音账号作品同步 | `/api/apis/douyin/douyin-sync-notes` |
| `api.douyin.hotContentRank` | 抖音点赞飙升榜(日/周) | `/api/apis/douyin/douyin-content-surge` |
| `api.douyin.likesRank` | 抖音每日点赞榜 | `/api/apis/douyin/douyin-likes-rank` |
| `api.douyin.workList` | 抖音账号作品列表 | `/api/apis/douyin/douyin-work-list` |
| `api.douyin.queryWork` | 查询抖音作品详情 | `/api/apis/douyin/query-work` |

**小红书**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `api.xhs.searchNote` | 搜索小红书笔记 | `/api/apis/xiaohongshu/search-note` |
| `api.xhs.searchUser` | 搜索小红书账号 | `/api/apis/xiaohongshu/search-user` |
| `api.xhs.queryAccount` | 查询小红书账号 | `/api/apis/xiaohongshu/query-account` |
| `api.xhs.searchWork` | 搜索小红书作品 | `/api/apis/xiaohongshu/search-work` |
| `api.xhs.crawlWork` | 小红书作品采集 | `/api/apis/xiaohongshu/crawl-work` |
| `api.xhs.comments` | 小红书笔记评论 ⛔ | `/api/apis/xiaohongshu/comments` |
| `api.xhs.topAccount` | 小红书最夯账号榜 | `/api/apis/xiaohongshu/xiaohongshu-top-account` |
| `api.xhs.accountAnalyzer` | 小红书账号诊断 | `/api/apis/xiaohongshu/xiaohongshu-account-analyzer` |
| `api.xhs.aiFeed` | 小红书AI日报源 | `/api/apis/xiaohongshu/xiaohongshu-ai-feed` |
| `api.xhs.playletFeed` | 小红书文旅/短剧日报源 | `/api/apis/xiaohongshu/xiaohongshu-playlet-feed` |
| `api.xhs.syncUserNotes` | 小红书账号作品同步 | `/api/apis/xiaohongshu/xhs-sync-notes` |
| `api.xhs.cozeData` | 小红书爆款封面/标题/笔记分析数据 | `/api/apis/xiaohongshu/xiaohongshu-coze` |
| `api.xhs.cozeDailyTop` | 小红书日榜 | `/api/apis/xiaohongshu/xiaohongshu-daily-top` |
| `api.xhs.cozeLowFansTop` | 小红书低粉爆款榜 | `/api/apis/xiaohongshu/xiaohongshu-low-fans-top` |
| `api.xhs.cozeWeeklyTop` | 小红书周榜 | `/api/apis/xiaohongshu/xiaohongshu-weekly-top` |

**视频号**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `api.sph.aiFeed` | 视频号AI日报源 | `/api/apis/sph/shipinhao-ai-feed` |
| `api.sph.searchWork` | 搜索视频号作品 | `/api/apis/sph/search-work` |
| `api.sph.searchUser` | 搜索视频号账号 | `/api/apis/sph/search-user` |
| `api.sph.queryWork` | 查询视频号作品详情 | `/api/apis/sph/query-work` |
| `api.sph.userWorks` | 视频号账号作品列表 | `/api/apis/sph/user-works` |

**B 站**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `api.bilibili.searchWork` | 搜索B站作品 | `/api/apis/bilibili/search-work` |
| `api.bilibili.searchUser` | 搜索B站账号 | `/api/apis/bilibili/search-user` |
| `api.bilibili.queryAccount` | 查询B站账号 | `/api/apis/bilibili/query-account` |
| `api.bilibili.queryWork` | 查询B站作品 | `/api/apis/bilibili/query-work` |
| `api.bilibili.playletFeed` | B站文旅/短剧日报源 | `/api/apis/bilibili/bilibili-playlet-feed` |
| `api.bilibili.aiFeed` | B站AI日报源(批量) | `/api/apis/bilibili/bilibili-ai-feed` |
| `api.bilibili.userWorks` | B站账号下作品集 | `/api/apis/bilibili/bilibili-user-works` |

**快手**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `api.kuaishou.aiFeed` | 快手AI日报源(批量) | `/api/apis/kuaishou/kuaishou-ai-feed` |
| `api.kuaishou.searchWork` | 搜索快手作品 | `/api/apis/kuaishou/search-work` |
| `api.kuaishou.searchUser` | 搜索快手账号 | `/api/apis/kuaishou/search-user` |
| `api.kuaishou.queryWork` | 查询快手作品详情 | `/api/apis/kuaishou/query-work` |
| `api.kuaishou.userWorks` | 快手账号作品列表 | `/api/apis/kuaishou/user-works` |

**TikTok**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `api.tiktok.searchUser` | 搜索TikTok账号 | `/api/apis/tiktok/search-user` |

**跨平台聚合**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `api.multi.contentExportTop` | 全平台内容出海Top榜 | `/api/apis/multi/multi-content-export-top` |
| `api.multi.workSearch` | 全平台近30天作品聚合 | `/api/apis/multi/cn30-multi-search` |
| `api.playlet.feed` | 短剧内容订阅Feed | `/api/apis/multi/playlet-feed` |

**通用工具**

| operationKey | 用途 | 详情端点 |
|---|---|---|
| `tool.contentSafety.checkWords` | 检测违禁词 | `/api/apis/tool/check-banned-words` |
| `tool.content.parseDetail` | 解析作品/文章详情 | `/api/apis/tool/parse-content-detail` |

---
