---
name: dby-api
description: >-
  都爆鸭 (doubaoya / 本鸭) — 新媒体取数与创作总入口：一条 DOUBAOYA_API_KEY 调平台全部在架能力，按意图路由。也做要带出处的联网查资料 / 事实核查。Trigger words: 小红书：搜索/爬取/作品/创作/选题/标题/封面/排行/榜单/热榜/日榜/周榜/周排行/TOP/热门笔记/爆款笔记/笔记查询、公众号：取数/写作/爬虫/标题/封面/排行/榜单/爆文/黑马/违禁词/对标/发了什么、抖音：搜索/取数/评论/实时搜索/综合搜索、视频号：AI/日报/爆款/选题、爆款：文章/标题/封面/结构/仿写/复盘/排行/选题/笔记发现、选题：拆解/灵感/素材/角度/信号、封面：灵感/参考/套路/设计/选题、标题：灵感/优化/套路/生成、账号画像/账号体检/账号健康度/账号发文列表、对标：分析/作品/推荐/矩阵/账号/后再写、竞品：账号/诊断/跟踪/发文复盘、出海：选题/爆款/日报/流量风口、笔记：对标/拆解/生成/选题、内容：创作/灵感/出海、跨平台：选题/分析/热搜、热点：扫描/榜、今日热点/综合热点/追热点/蹭热点/借势选题/找选题/中线选题/短视频选题/全网热搜/热搜关键词/跨平台热搜/全网热榜/聚合热榜/热榜TOP10/每日榜/今日爆款/一周爆款/近期爆款/全平台爆款/低粉爆款/素人爆款/搜抖音爆款、低粉高赞/黑马笔记/黑马账号/头部账号/热门账号/相似账号/标杆账号/小号打法/冷启动对标/起号参考/公众号诊断/批量诊断/被限流/阅读量掉了/账号检测/周度趋势/近30天作品/最新发布/最多点赞/持续走高/增长榜/阅读增长/增长率排行/流量风向/热度指数/追流量/追更/话题研究/看赛道热门内容、改图/配图/主视觉/文生图/图生图/生成图片/AI出图/首图灵感/高点击标题/起标题、过审/极限词/合规检测/敏感词/公众号违禁词、查出处/引用来源/联网搜索/联网查证/豆包搜索/社媒舆情/舆情监测/用户需求/评论分析/评论风向/看评论/扒评论区、解析链接/链接解析/作品详情/扒文章/扒抖音作品/写小红书/照着写小红书/找对标笔记/热门文章/批量爬公众号/盯公众号/订阅公众号/某公众号发了什么、AI视频号/小红书抖音公众号/文旅/短剧/赛道日报/每天在推什么/实时取数/公众号取数
version: 1.2.1
compatibility: >-
  需要环境变量 DOUBAOYA_API_KEY（形如 dyh_…，在 doubaoya.com 密钥中心生成）；需要能对 https://doubaoya.com 发 HTTPS 请求。
  发现类端点（能力清单 / 详情）免鉴权也免费，调用类端点必须带 Bearer 且计费。
  正文里的 curl 示例只要 curl；可选的零依赖封装脚本 scripts/doubaoya.mjs 需要
  Node ≥ 18（用全局 fetch），不装任何 npm 包。
---
# 都爆鸭 · doubaoya

新媒体取数总入口：一条 `DOUBAOYA_API_KEY` 通到平台全部在架能力。
你（agent）的活是**听懂用户想干嘛 → 选对能力 → 调 → 把结果讲成人话**。

调用走 **`scripts/doubaoya.mjs`**，别自己拼路径（硬拼必 404；脚本先拉详情拿 `execution.target` 再打）。

---

## 怎么调

请求由 `scripts/doubaoya.mjs` 代发；只有绕开脚本自己拼请求时才读 `dby-gateway/references/protocol.md`。

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"    # 绝不打印、不写文件、不回显给用户
D=~/.claude/skills/dby-api/scripts/doubaoya.mjs   # 按实际安装位置改

# 发现：两个集合一起拉／搜（免 key、免费）；每行末尾带计费（免费 / N点）
node "$D" list
node "$D" search 小红书 爆款

# 🔴 先 describe 再 invoke —— 入参规格现拉，一个字段名都别照记忆拼；<ref> 也可以直接给 operationKey
node "$D" describe trend/trending-hub-keyword
node "$D" describe api.trend.hotSpotKeyword

# 调用（计费）。<ref> = <slug> 或 <platform>/<slug>
node "$D" invoke trend/trending-hub-keyword '<照 describe 拉到的入参规格填>'
node "$D" invoke xiaohongshu-viral-notes '<照 describe 拉到的入参规格填>'

# 离线自检（不联网、不需要 key）
node "$D" selfcheck
```

结果打 stdout（默认剥掉与 `items` / `content` 重复的 `raw`，加 `--raw` 保留），`notice` / `noResult` 打 stderr，失败以 `code: message` 非零退出。
起止时间类入参必须带时分秒（`YYYY-MM-DD HH:mm:ss`），只给日期过不了校验。

🔴 **入参一律现拉。** `describe` 返回里的 `requestSchema` / `inputSchema` 是**示例值不是 JSON Schema**，
照它的键名和值的形状填。上游对错入参**一律静默返空或给误导性报错**——
拿不到数据时先回 `describe` 核一遍入参，别急着判「接口挂了」。

---

## 0.5 用户该用哪个能力？（按"我想做什么"选）

用户未指明平台时默认公众号。

**公众号写作交付链例外**：只有在写作交付链上做路由判断时读
[`references/wechat-routing.json`](references/wechat-routing.json)，纯取数不读。极简原则：
**要交付一篇完整文章（写 + 排版 + 存草稿）走写作交付链**；公开数据、互动指标和选题分析走都爆鸭云端能力。
按号查发文：先 `api.gzh.searchUser` 拿账号 ID，再 `api.gzh.workList`（上游只认 ID 不认中文昵称）。

**「帮我写一篇公众号文章」例外**：这是**一条链**——
**写作主干交棒 `dby-write`**（它是 owner；本 Skill 只供数据——`api.gzh.hotArticle` 爆文样本、
`api.gzh.cozeData` 标题与封面套路，成品封面方案用 `skill.wechat.coverDesign`）；违禁词过审归 `dby-banned-words` →
`dby-publish`（排版 + 封面 + **存进用户自己的公众号草稿箱**）。
🔴 **先问清用户要的终态，再决定走到链上哪一站**；终态门以 `references/wechat-routing.json` 为准：
只要成稿写完正文就结束、不跑 `dby-publish`（它有真实副作用）；要排版 HTML 或进草稿箱就走到 `dby-publish`。拿不准就问一句。
逐跳导航由 `dby` 负责；用户没装 `dby` 时按上面这条链自己接续。

**「我自己的东西」例外 —— ⛔ 该能力已下架**：请求指向用户**自己**的内容（帮我记一下 / 我的笔记 /
我是个什么样的人）时过去走 `mera` 第二大脑，**现在调不通且无替代**——**如实告诉用户**，
**别拿公开搜索顶替**（公开搜索看不见他自己的笔记）。详见 `references/retired.md`。

---

→ **查路由（该调哪一条 / 它走哪条路由）时读**
[`references/capability-table.md`](references/capability-table.md)，已经知道调哪条就别读。
入参一律走 `describe` 现拉，那份表一个字段名都不抄。
全量索引与选路的坑在 `dby-gateway/references/capability-index.md` 与 `routing-pitfalls.md`（可选）。

🔴 **合规 / 违禁词：入口请求一律走 `dby-banned-words`**（专职包，三平台一次比对并出全平台安全改写）。
`tool.contentSafety.checkWords`（多平台口径，详情端点 `/api/skills/content-safety-check`）与
`skill.wechat.prohibitedWord`（公众号口径，`/api/skills/wechat-prohibited-word`）在这里只是
**endpoint 索引**，供 gateway 层直调，不作为本入口的路由目标。

🖼 **出图归 `dby-image`**，不在本包。

> ❌ **选题铁律：不要拿用户的账号名 / IP 名当关键词去搜。**
> 用户的公众号/账号名（如「菜籽油」）是**他是谁**（领域/人设/受众），不是搜索词——搜它只会搜到字面同名内容。
> **综合热点用无关键词的 `api.trend.hotSpotKeyword` 直取，IP 名字只用于匹配筛选。**
> 「不带关键词」说的是**关键词**——**时间窗口照样要收窄**（见 Gotchas 第一条）。
> 跨平台趋势雷达（`skill.trend.radar`）与全网热榜聚合（`api.trend.hotTopics`）按关键词搜：
> **手里已经有话题**时用它们看这个词在各平台分别热成什么样（雷达还能直接产出运营日报）；
> **没有话题、要它给你想选题**时别用——那时它们退化成搬运号 feed，热度常为空、多「未命名内容」。

---

## 失败了怎么办

报错码逐条怎么处置（`noResult` 不是失败、哪些可重试哪些绝不能重试、404 该去另一个集合找）
见 `dby-gateway/references/protocol.md` 第 6 条。

---

## Gotchas

→ 选定能力之后、真正打请求之前读 [`references/gotchas.md`](references/gotchas.md)；
拿不到数据、或结果明显不对时回来读。最贵的两条先记住：
**热点直取（`api.trend.hotSpotKeyword`）必须收窄时间窗口**，不收窄拿到的是上上周的热榜；
而 **`api.trend.hotKeywords` 恰恰相反，带时间区间必返 0 条**——两条能力的时间语义是反的。

---

## 交付回执（每次交付都随手带一份）

回执随交付写，不事后补。

动手前先说清这一次交到哪一档，**目标停在哪一档就在哪一档收手**；终态门以 `references/wechat-routing.json` 为准。
用户只要成稿时不跑 `dby-publish`（它会写进用户自己的公众号后台）；要进草稿箱却交一段 Markdown 就收尾才是断头。拿不准就问一句。

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
3. **入参现拉、路径现拉**（用 `describe` / 让脚本去拿），别照记忆或本文档拼。
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
