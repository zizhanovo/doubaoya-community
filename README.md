# 都爆鸭 · doubaoya-community

> 新媒体爆款工作搭子的技能库 —— 一条口令，让你的 AI agent 替你挖选题、追热点、搜内容、查账号、保合规、改文案。

这是 **都爆鸭（doubaoya）** 的社区 Agent Skill 库。把里面的技能装进你的 AI 助手
（Claude Code / Codex 等），配上一条 `DOUBAOYA_API_KEY`，agent 就会用
[doubaoya.com](https://doubaoya.com) 的公开 API 替你完成日常新媒体活儿——你只管说人话，
技术细节本鸭全包了。

部分技能（改写 / 调查 / PDF 提取这类）**纯本地运行、不联网、不需要 key**，agent 自己干活。

## 这库给谁用

新媒体运营、内容创作者、MCN、代运营、做内容工具的开发者——任何天天跟
**抖音 / 小红书 / 公众号 / 视频号** 选题和脚本打交道的人。

## 先拿钥匙（口令）

需要调数据的技能要一条口令（API Key）：

1. 打开 https://doubaoya.com → **登录**
2. 进 **口令中心** → **生成口令**
3. 整条口令只在生成那一下完整露脸，复制收好（形如 `dyh_…`）
4. 设进环境变量：`export DOUBAOYA_API_KEY="dyh_你的口令"`

> agent 会把 key 存进环境变量，自己调接口、自己拼结果，**绝不把整条 key 回显出来**。

## 安装

```bash
npx skills add zizhanovo/doubaoya-community
```

也可以只装其中某一个技能：

```bash
npx skills add zizhanovo/doubaoya-community/skills/trending-hub
```

## 技能清单（共 80 个）

> 大部分技能要一条 `DOUBAOYA_API_KEY`（调 doubaoya.com 公开 API）；
> 标 **🖥 本地** 的纯本地运行、不联网、不需要 key，agent 自己干活。

### 🦆 总纲

| 技能 | 一句话 |
|------|--------|
| **doubaoya** | 总纲技能：教 agent 用一条口令调 doubaoya.com 公开 API，挖选题 / 追热点 / 写脚本 |

### 📣 公众号 / 视频号

| 技能 | 能力 |
|------|------|
| **gongzhonghao-search** | 按关键词搜公众号文章，做行业 / 竞品 / 选题 |
| **gzh-search** | 关键词批量爬公众号文章，铺表 + 选题洞察 |
| **gzh-subscribe** | 盯单个公众号，拉指定时段历史发文做追更复盘 |
| **gzh-ai-feed** | AI 方向公众号爆款日报内容源，聚类成每日选题 |
| **gzh-astock-top** | A股公众号大V榜：账号发现 → 数据 → 当日发文 |
| **wechat-hot-article** | 按关键词 + 时间区间拉同主题公众号爆文 |
| **wechat-hot-write** | 拉同主题爆文当样本，辅助写出能跑量的公众号文章 |
| **wechat-10w-hot** | 按行业 + 时间拉公众号 10万+ 阅读爆文榜 |
| **wechat-original-hot** | 公众号原创热门榜（区别于转载 / 洗稿） |
| **wechat-top-account** | 公众号热度指数榜（日 / 周 / 月榜） |
| **wechat-fastest-growing** | 公众号阅读增长榜，挖近期黑马账号 |
| **wechat-account-analyzer** | 公众号账号诊断 / 体检，支持多号竞品对照 |
| **wechat-similar-account** | 公众号对标账号推荐，搭竞品矩阵 |
| **wechat-title** | 公众号爆款标题创作 + 套路化评判 |
| **wechat-cover** | 同赛道爆款封面参考，提炼可复用视觉套路 |
| **wechat-channels-ai-feed** | AI 视频号爆款信息源，聚类成每日选题日报 |
| **wechat-banned-words** | 公众号违禁词检测 + 合规改写 |
| **wechat-rewrite** 🖥 | 把文案改写成公众号爆款风格 |

### 🎵 抖音

| 技能 | 能力 |
|------|------|
| **douyin-search** | 关键词批量搜抖音爆款作品，铺表 + 选题洞察 |
| **douyin-realtime-search** | 实时综合搜抖音，可切综合 / 最新 / 最多点赞 |
| **douyin-works-crawler** | 给账号拉资料档案 + 近期作品列表 |
| **douyin-account-insight** | 输入 secUid 拉账号档案，做体量判断 |
| **douyin-account-works** | 抖音账号概况 + 作品体量概览 |
| **douyin-account-diagnosis** | 批量拉账号画像 / 健康度 / 运营建议 |
| **douyin-similar-account** | 抖音相似账号 / 对标账号推荐 |
| **douyin-top-account** | 抖音影响力账号榜，看流量风向 |
| **douyin-rise-ranking** | 抖音涨粉账号榜，挖近期起势黑马 |
| **douyin-comment** | 按作品 ID 翻页拉一级评论，做舆情洞察 |
| **douyin-ai-feed** | 抖音 AI 日报内容流，支持翻页与时间区间 |
| **douyin-hot-trend** | 按日期区间拉抖音实时热榜，看正在起势的话题 |
| **douyin-content-surge** | 抖音点赞飙升榜，日榜 + 周榜一次拿，抓正在起飞的内容 |
| **douyin-weekly-surge** | 抖音点赞飙升周榜，看一周持续走高的中线趋势 |
| **douyin-daily-hot** | 抖音每日点赞 TOP 榜，看当天谁最吸赞 |
| **douyin-subscribe** | 按抖音号 + 时间窗追更，每天盯对标账号新作品 |

### 📕 小红书

| 技能 | 能力 |
|------|------|
| **xiaohongshu-search** | 搜小红书爆款笔记，挖赛道选题 |
| **xiaohongshu-hot-notes** | 按赛道发现高互动爆款笔记（搜索 + 互动排序） |
| **xiaohongshu-crawler** | 按关键词爬热门作品，支持日期 / 排序筛选 |
| **xiaohongshu-write** | 检索热门笔记 → 复盘爆款结构 → 产出新笔记 |
| **xiaohongshu-account-analyzer** | 输入 redId 做七维度商业价值诊断 |
| **xiaohongshu-similar-account** | 同阶对标 + 高阶标杆账号推荐 |
| **xiaohongshu-top-account** | 小红书最夯账号榜（日 / 周 / 月） |
| **xiaohongshu-comment** | 拉笔记一级评论，cursor 游标分页 |
| **xiaohongshu-dailytop** | 小红书日榜，看当天哪条笔记在霸榜 |
| **xiaohongshu-lowtop** | 小红书低粉爆款榜，挖纯内容力出圈的素人打法 |
| **xiaohongshu-weeklytop** | 小红书周榜，看一周持续走高的中线趋势 |
| **xiaohongshu-cover** | 按关键词拉爆款数据，提炼可复用封面套路 |
| **xiaohongshu-title** | 按关键词拆爆款标题钩子，产能跑量的标题 |
| **xiaohongshu-note-analyzer** | 按关键词做对标拆解，产可落地选题清单 |
| **xiaohongshu-rewrite** 🖥 | 把文案改写成小红书种草笔记风格 |

### 📺 B站 · TikTok

| 技能 | 能力 |
|------|------|
| **bilibili-keyword-search** | 按关键词搜 B 站视频作品，铺表 + 选题洞察 |
| **bilibili-keyword-accounts** | 按关键词搜 B 站 UP主账号 |
| **bilibili-portfolio-search** | 按 UP主 UID 拉作品集，游标翻页做对标复盘 |
| **tiktok-account-search** | 按关键词搜 TikTok 博主，按粉丝量排序 |

### 🌐 多平台 · 热点

| 技能 | 能力 |
|------|------|
| **trending-hub** | 全网热榜聚合，产跨平台选题信号 |
| **trending-hub-top10** | 全网平台热搜归并，输出综合 TOP10 |
| **multi-content-feed** | 全平台内容出海 Top 榜爆款一次扫遍 |
| **cn-last30days** | 一个词捞小红书 + 抖音 + 公众号近30天作品 |
| **astock-social-feed** | A股社媒每日信息源，跨平台扫 A股舆情 |
| **ks-ai-feed** | 快手 AI 爆款视频日报内容源 |
| **content-parse** | 粘公开链接，返回归一化作品 / 文章详情，拆解「为什么火」 |
| **multi-banned-words** | 跨平台违禁词对照 + 统一安全改写 |
| **multi-rewrite** 🖥 | 一稿多发：按各平台规则改写成多平台版本 |

### 🎬 短剧 · 文旅

| 技能 | 能力 |
|------|------|
| **playlet-douyin-feed** | 抖音短剧爆款日报内容源 |
| **playlet-wechat-feed** | 公众号短剧爆款文章日报内容源 |
| **playlet-xiaohongshu-feed** | 小红书短剧爆款笔记日报内容源 |
| **playlet-bili-feed** | B站短剧爆款视频日报内容源 |
| **cultural-tourism-douyin-feed** | 抖音文旅 / 城市 / 景区爆款内容源 |
| **cultural-tourism-wechat-feed** | 公众号文旅爆款长文内容源 |
| **cultural-tourism-xiaohongshu-feed** | 小红书文旅爆款笔记内容源 |
| **cultural-tourism-bilibili-feed** | B站文旅爆款视频内容源 |

### 🎨 AI 生成 · 下载 · 搜索

| 技能 | 能力 |
|------|------|
| **image-gen** | GPT-image2 文生图 / 图生图 / 编辑 |
| **seedream-5-lite** | Seedream 5.0 lite 文生图 / 图生图 / 组图 |
| **seedance-video-gen** | Seedance 2.0 一句提示词生成 MP4 视频 |
| **video-downloader** | 解析抖音 / 小红书 / 快手 / B站公开视频无水印直链 |
| **doubao-websearch** | 豆包异步联网检索，返回答案 + 引用来源 |

### 🖥 本地工具（不联网、不需要 key）

| 技能 | 能力 |
|------|------|
| **zhihu-rewrite** | 把文案改写成知乎专业长文 / 答主体 |
| **ai-intelligence-investigator** | 情报 / 竞品 / 舆情调查方法论，交叉验证产报告 |
| **optimize-skill-md** | 把一份 SKILL.md 规范化、优化到标准格式 |
| **pdf-image-text-extractor** | 本地从 PDF / 图片提取文字 |

## 怎么调（给好奇的人）

数据型技能统一走 doubaoya.com 的公开 API，统一信封返回：

```
POST https://doubaoya.com/api/apis/<platform>/<slug>/call
Authorization: Bearer $DOUBAOYA_API_KEY
Content-Type: application/json
```

成功 / 失败都是同一层信封：

```jsonc
{ "success": true,  "requestId": "req_...", "data": { /* 结果 */ }, "error": null }
{ "success": false, "requestId": "req_...", "data": null, "error": { "code": "...", "message": "..." } }
```

永远先看 `success`：`true` 取 `data`，`false` 读 `error.code` / `error.message`。
更完整的约定、错误码、端到端工作流见根技能 [`skills/doubaoya/SKILL.md`](./skills/doubaoya/SKILL.md)。

## License

MIT —— 见 [LICENSE](./LICENSE)。© 都爆鸭 / doubaoya。
