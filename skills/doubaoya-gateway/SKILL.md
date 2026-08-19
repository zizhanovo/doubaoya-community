---
name: doubaoya-gateway
description: >-
  都爆鸭平台的**调用网关**（基础设施 Skill，不承接业务意图）：鉴权头怎么带、两条互不回落的调用路由怎么选、
  统一信封与错误码怎么解、以及最要紧的一条纪律——**入参规格调用前现拉，别照记忆或本地文档拼**。
  另附一份**只供选路**的能力索引（operationKey + 一行用途 + 详情端点，不含任何入参字段）。
  当你已经决定要调 doubaoya.com 的某条能力，却不确定该打哪条路径 / 入参从哪儿取 / 返回怎么解 /
  报错（404、DEDICATED_ROUTE、NO_RESULT）怎么办时读本 Skill；也供其他都爆鸭业务 Skill 引用与内联。
  ⚠️ 它**不**负责「帮我写文章 / 挖选题 / 做封面 / 查违禁词」这类活——那些请走对应业务 Skill（总入口 `dby`）。
  Trigger words: doubaoya 调用协议 / 调用网关 / DOUBAOYA_API_KEY / operationKey / execution.target /
  inputContract / 入参规格 / 统一信封 / SKILL_NOT_FOUND / ENDPOINT_NOT_FOUND / DEDICATED_ROUTE /
  NO_RESULT / CAPABILITY_UNAVAILABLE / 该打哪条路由。
compatibility: >-
  需要环境变量 DOUBAOYA_API_KEY（形如 dyh_…，在 doubaoya.com 密钥中心生成）；需要能对
  https://doubaoya.com 发 HTTPS 请求。发现与详情端点免鉴权且免费，调用端点必须带 Bearer 且计费。
  不依赖任何本地运行时、第三方 CLI 或额外安装。
---

# 都爆鸭 · 调用网关

**这是一个基础设施 Skill。** 它不干活，只回答一件事：*已经决定要调都爆鸭的某条能力了，
接下来该怎么正确地把这一次调用打出去。*

用户说「帮我写篇公众号文章」「找几个选题」「查下这段文案有没有违禁词」时，**别用本 Skill**——
走对应的业务 Skill（不知道走哪个就用总入口 `dby`）。业务 Skill 决定*用哪条能力*，
本 Skill 只管*那条能力怎么调*。

---

## 0. 一句话说清本 Skill 的边界

| 本 Skill **管** | 本 Skill **不管** |
|---|---|
| 鉴权头、基址、两条路由的分工 | 某条能力的入参有哪些字段（→ 运行时现拉，见 §1） |
| 统一信封、`noResult` / `notice` / `detailUrl`、错误码 | 业务流程该先做哪步（→ `dby`） |
| 有哪些能力、走哪条路由（选路索引，§4） | 结果怎么加工成文案 / 封面 / 报告（→ 业务 Skill） |
| 跨能力的选路坑（§5） | 计价与额度（→ doubaoya.com 控制台） |

---

## 1. 🔴 第一条协议：**契约现拉，本地文档只当索引**

> **调用前，先从详情端点取这条能力的入参规格。本地文档（包括本文件）只当索引，不当真相。**

这条规矩不是洁癖，是修一个已经反复发作的病：**契约一旦被烤进分发物，就必然漂。**
装在用户机器上的技能包是**一份快照**，而平台的入参在演进——快照里写死的字段清单，
下一次上游改版就变成一份**看起来很确定、其实在骗人**的假规格。agent 照它拼参数，
拿回 `VALIDATION_ERROR`，然后在错误的方向上反复重试。

所以：**能力清单可以缓存在本地（它变得慢，而且变了会被仓库的闸打红），入参绝不可以。**

### 入参规格从哪儿取（三级，就近取到就停）

对着目标能力的**详情端点**发一个 `GET`（**免鉴权、免费、不计点**）：

- 平台数据能力 → `GET https://doubaoya.com/api/apis/<platform>/<slug>`
- 产品化 Skill → `GET https://doubaoya.com/api/skills/<slug>`

从同一个响应里按顺序取：

1. **`inputContract`** —— 最权威。`kind` 为 `json-schema` 时，`jsonSchema` 是**从服务端 zod 现算**的
   完整 JSON Schema（draft 2020-12），跨字段约束带在各节点的 `x-constraints` 里，中文枚举是闭集；
   `kind` 为 `no-schema` 时它会**明说没有规格**并给出 `route`，**这时别自己编一份**。
2. **`inputUiSchema`** 的 `fields` 数组 —— `inputContract` 尚未在你打的这个部署上线时的退路。
   每个字段带路径、中文标签、必填与否和一段中文说明（很多计费规则就写在那段说明里）。
   实拉核过：**94 条能力 100% 有这一块**，所以这条退路今天对每条能力都成立。
3. **`requestSchema`** / `inputSchema` —— **示例值，不是规格**。只有前两级都没有时才拿它起手，
   并且要准备好读 `VALIDATION_ERROR` 的 `message` 逐轮修正。

> ⚠️ **`inputContract` 是新字段，不是所有部署都已经在发它。** 2026-08-18 实拉
> `https://doubaoya.com` 的详情端点，响应里还没有这个字段——服务端实现已就绪但尚未上生产。
> 所以上面的顺序必须**按字段是否存在**判断，不能假定它一定在。

---

## 2. 给业务 Skill **内联**的最小协议

**业务 Skill 请把下面这段整体抄进自己的 SKILL.md**，不要只写一句「详见 `doubaoya-gateway`」——
agent 很可能不会跳过去读（把路由知识放在别处、指望 agent 自己去取，已经真的把一整条链断掉过）。

这段**故意只有协议、没有能力清单、没有任何入参字段**——那正是它可以被安全复制的原因：
协议是稳定的，抄一次能管很久；能力与入参是易变的，抄进去当天就开始腐烂。

<!-- 下面这段是给业务 Skill 复制的正文，请整体保留，包括开头两行占位说明。 -->

```markdown
## 调用都爆鸭（协议，抄自 doubaoya-gateway）

**本 Skill 用到的能力**：`<operationKey>` —— 详情端点 `<GET 路径>`
（只点名能力和详情端点；入参**不在这里写**，每次调用前现拉。）

1. **鉴权**：所有*调用*端点都要 `Authorization: Bearer $DOUBAOYA_API_KEY`。
   优先从环境变量 `DOUBAOYA_API_KEY` 读；环境里没有就**问用户一次**，之后不再追问；
   **绝不回显、打印或写进日志**，需要确认时只说前缀。基址 `https://doubaoya.com`。
2. **先拉规格，再拼参数**：`GET <详情端点>`（免鉴权、免费）。按 `inputContract` →
   `inputUiSchema` 的 `fields` → `requestSchema`（示例值，非规格）的顺序取，**就近取到就停**。
   🔴 **绝不照记忆或本文档里的字段名拼入参**——这里从来不写字段名，就是为了让你没得抄。
3. **照 `execution.target` 打，别自己拼地址**：同一个详情响应里有
   `execution.target.method` 和 `execution.target.path`，前面拼上基址就是要打的地址。
   `execution.mode` 为 `dedicated` 时方法未必是 `POST`（有 `PUT`）；为 `unavailable` 时
   **没有 `target`，别调**，如实告诉用户这条能力暂时不可用。
4. **两条路由互不回落**：`/api/skills/<slug>/invoke` 与 `/api/apis/<platform>/<slug>/call`
   是**两个不相交集合**各自的入口，拿错集合的 slug 去打另一条一律 404，**换着花样重试没有用**。
   所以第 3 条不是建议：地址只能来自详情响应。
5. **读信封**：成功失败都是同一层 `{ success, requestId, data, error }`。
   **先看 `success`**——`true` 取 `data`，`false` 读 `error.code` / `error.message`。
   成功信封上还可能多出三个可选字段（**缺席是常态，不是异常**）：
   - `noResult`：查询合法、就是没数据，**已不计费**。别当失败重试，如实告诉用户没结果并建议换条件。
   - `notice`：本 Skill 有更新的提示，**原样转达**，不影响本次结果。
   - `detailUrl`：这次结果在 doubaoya.com 上的详情页，可以给用户点。
6. **报错怎么办**（`HTTP` / `error.code`）：
   401 `MISSING_API_KEY` / `UNAUTHORIZED` → 让用户去密钥中心生成或重建，更新环境变量；
   400 `VALIDATION_ERROR` → 照 `message` 改入参，改前**重拉一次规格**；
   400 `DEDICATED_ROUTE` → 走错到通用代理了，`message` 里写着该打哪条，照 `execution.target` 重发；
   402 `INSUFFICIENT_CREDITS` → 提示用户充值；
   404 `SKILL_NOT_FOUND` / `ENDPOINT_NOT_FOUND` → 见第 4 条，**去另一个集合的发现接口找**，别猜 slug；
   503 `CAPABILITY_UNAVAILABLE` → **别重试**，换能力或如实告知；
   502 `PROVIDER_FAILED` → 上游临时失败，**额度已自动退回**，可以直接重试。
```

<!-- 以上是给业务 Skill 复制的正文。 -->

### 🔴 **绝不能**抄进业务 Skill 的东西

| 不许抄 | 为什么 |
|---|---|
| 任何能力的**入参字段清单**（名称、类型、必填、枚举值） | 这就是「把契约烤进分发物」，是本轮要根治的病本身 |
| §4 那份**能力索引**（整表或成片摘录） | 业务 Skill 只该点名它自己用的那一两条，抄全表 = 又造一个会漂的副本 |
| 上游返回的**字段名清单** | 输出结构同样会变；照实际响应读，别照文档读 |
| 计价、点数、额度的**具体数字** | 会静默重定价，抄进去就是对用户报错价 |

**可以**抄的只有两样：上面那段协议正文，以及**你自己那一两条能力的 `operationKey` + 详情端点**。

---

## 3. 协议展开（内联那段的完整版）

### 3.1 鉴权与基址

所有能力挂在 `https://doubaoya.com` 下，JSON 进 JSON 出。

```
Authorization: Bearer $DOUBAOYA_API_KEY
Content-Type: application/json
```

密钥形如 `dyh_…`，在 doubaoya.com → 登录 → 密钥中心生成，**整条只在生成那一下完整露脸**。

**发现与详情端点是例外：它们不需要鉴权，也不计费**，所以「调用前先拉规格」这一步是白送的，
没有任何理由跳过。

> `POST /api/skills/recommend` 是个特例：它**必须带 `Authorization` 头**——不带头的 POST 会先被
> CSRF 闸拦掉，返 403 `CSRF_FORBIDDEN`（实拉验证过），看起来像鉴权错误，其实是没进到鉴权那一步。

### 3.2 两个集合，两条路由，**不回落**

| 集合 | 发现接口 | 详情端点 | 调用路由 |
|---|---|---|---|
| 产品化 Skill | `GET /api/skills` | `GET /api/skills/<slug>` | `POST /api/skills/<slug>/invoke` |
| 平台数据能力 | `GET /api/apis` | `GET /api/apis/<platform>/<slug>` | `POST /api/apis/<platform>/<slug>/call` |

2026-08-18 实拉：产品化 Skill 17 条、平台数据能力 77 条，**数量上的大头在后者**。
但**别把这两个数字抄进判断**——能力会上新也会下架，准数以你这一次实拉的 `total` 为准。

🔴 这两条路由**不是同一批能力的两个别名**。拿错集合的 slug 打过去一律 404，
而且**没有任何回落**——在错的那一半上重试一百次还是 404。

### 3.3 `execution`：地址的唯一来源

发现与详情响应里，每条能力都带这么一块（下面是 2026-08-18 实拉 `/api/apis/trend/hot-topics`
的响应投影，**只留了协议相关的键**）：

```jsonc
{
  "platform": "trend",
  "slug": "hot-topics",
  "operationKey": "api.trend.hotTopics",
  "execution": {
    "mode": "generic",        // generic=通用代理 / dedicated=专用路由 / unavailable=当前不可调
    "sideEffect": "read",     // read / generate / write_internal / write_external
    "target": { "method": "POST", "path": "/api/apis/trend/hot-topics/call" }
  }
}
```

- `mode` 为 `generic` → 照 `target` 打，body 就是这条能力的入参。
- `mode` 为 `dedicated` → 同样照 `target` 打，但**方法未必是 `POST`**，而且
  **它的调用地址跟详情端点毫无关系**（例如详情在 `/api/skills/dby-charter`，
  真正要打的是 `PUT /api/ip-profile/:id/charter`）。**所以专用路由的地址推不出来，只能读 `target`。**
  误走通用 `/invoke` 会 400 `DEDICATED_ROUTE`，错误信息里直接写着该走哪条。
- `mode` 为 `unavailable` → **这时没有 `target` 字段**，`availability` 的 `note` 是可以转述给用户的原因
  （实拉见到的两条都是「上游接口维护中，恢复后自动可用」）。硬调返 503 `CAPABILITY_UNAVAILABLE`。

`target` 的 `path` 是**完整路径**，前面拼上基址就能发。**不要自己再去拼 `/api/skills/…`**——
本仓历史上就是这么把整整一侧的数据能力全写成了必然 404 的路径。

### 3.4 `inputContract` 长什么样

服务端已实现、**尚未上生产**（见 §1 的告警）。形状是一个带 `kind` 的可辨识联合：

```jsonc
// kind 为 json-schema：有真规格
{
  "kind": "json-schema",
  "jsonSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": { "…": "🔴 这一坨才是入参规格。本文档故意不展开——展开就等于把契约烤进分发物" },
    "required": [ "…" ],
    "additionalProperties": false
  },
  "route": { "method": "POST", "path": "/api/wechat/publish" }
}

// kind 为 no-schema：**没有**机器可读的规格，别自己编
{ "kind": "no-schema", "note": "…（说明为什么没有）", "route": { "method": "POST", "path": "…" } }
```

- `route` 只在**专用路由**能力上出现（通用能力的入口已经写在 `execution` 的 `target` 上了，不重复）。
- `kind` 为 `no-schema` 且 `route` 为 `null` ⇒ 这条能力当前无处可打（`mode` 是 `unavailable`）。
- **字段缺席不承载含义，`kind` 才承载**——别用「有没有某个字段」去推断规格状态。

---

## 4. 能力索引（**只供选路，不含入参**）

**这张表回答且只回答两个问题**：有哪些能力、每条的详情端点在哪。
入参一律不在这儿——要拼参数请回 §1 现拉。

表里给的是**详情端点**（`GET`，免鉴权免费），不是调用地址：拿到详情响应后，
调用地址读它的 `execution` 的 `target`（§3.3）。这样专用路由那三条也不会被推错。

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
| `api.xhs.cozeData` | 小红书爆款封面/标题数据 | `/api/apis/xiaohongshu/xiaohongshu-coze` |
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

## 5. 跨能力选路知识（真正的知识，不是样板）

这一节是**只有踩过才知道**的东西，也是本 Skill 除协议外唯一值得读的部分。

### 5.1 🔴 `operationKey` 有**唯一一处撞名**，点名时必须带上详情端点

`tool.contentSafety.checkWords` **同时存在于两个集合**，是 94 条里唯一的一处：

| 集合 | 详情端点 | 说明 |
|---|---|---|
| 平台数据能力 | `/api/apis/tool/check-banned-words` | 通用违禁词检测 |
| 产品化 Skill | `/api/skills/content-safety-check` | 多平台违禁词检测 |

两条**同价、都在架、路由完全不同**。所以「用 `operationKey` 点名能力」这个约定，
在这一条上**不足以定位**——业务 Skill 点名时必须**同时给出详情端点**（§2 的模板已经这么要求了）。
其余 92 条 `operationKey` 全局唯一，点名无歧义。

### 5.2 违禁词检测：空结果**照样收费**，而且**没有「风险等级」这种东西**

- **接口不返回风险分级，也不返回命中词数组**——别去读不存在的字段，更别自创一套等级糊弄用户。
  照一个不存在的字段判「它是空的 ⇒ 文案合规」，那是个**恒真判据**，会把**每一段**文案都放行；
  这是安全缺陷，不是体验问题。返回里到底有哪些字段，**照这一次的实际响应读**，别照任何文档读
  （本文档也不写，理由同 §1）。
- **「零违禁词」是一个有效答案，照常计费**，不会带 `noResult`。别把它当失败重试。

### 5.3 广域搜索类**永远"有结果"**，所以没有免费兜底

热榜 / 热搜 / 全网聚合这类广域能力，上游几乎不可能返回真正的空集——**扣费照常发生**。
所以：**别把「换个关键词再试一次」当成免费动作**，每一次重试都是一次真实扣费。
先把入参拿准（§1 现拉规格，尤其读 `inputUiSchema` 里那段中文说明，很多计费规则写在那儿），
再打第一枪。

### 5.4 上游对错入参**一律静默返空或给误导性报错**

拿到空结果时，**别急着判定「上游挂了」**——已经因此误判过两次，真因都在入参上
（一次是时间参数没给对，一次是分类名必须写全称）。正确的顺序是：
重拉一次规格 → 逐字核对入参（尤其枚举闭集与时间格式）→ 再考虑上游问题。

### 5.5 `notice` 是靠 `User-Agent` 触发的

服务端按请求的 `User-Agent` 判断你装的技能包版本是否过期，过期就在成功信封上挂一句 `notice`。
本仓每个技能包的 `.version` 文件就是给它用的（形如 `doubaoya-skill/<name>@<hash>`）。
**不带 `User-Agent` 不会报错，只是永远收不到更新提示。**

### 5.6 搜索 / 推荐接口只看得见一半

`GET /api/skills/search` 和 `POST /api/skills/recommend` **只在产品化 Skill 那 17 条里排序**，
**看不见另外 77 条平台数据能力**。所以：

- 用它们「找能力」，找不到**不等于**能力不存在。
- 找数据类能力请直接拉 `GET /api/apis` 自己筛。
- `recommend` 是 POST，**必须带 `Authorization` 头**，否则 403 `CSRF_FORBIDDEN`（§3.1）。

### 5.7 404 的正确破法

1. **两个集合都拉一遍**：`GET /api/skills` 和 `GET /api/apis`。八成是能力在另一半。
2. 找到后**照它的 `execution` 的 `target` 打**，不要自己拼路径。
3. 两个集合都没有 ⇒ 这个能力**不存在或已下架**。如实告诉用户，**别再猜别的 slug**。
4. 🔴 尤其别把**技能包目录名**（`npx skills add` 装进来的那个文件夹名）当成调用 slug——
   它们不是同一个东西，打过去必 404。

---

## 6. 本文档里的响应片段都是实拉的

2026-08-18 对 `https://doubaoya.com` 的免费只读端点实拉，原样摘录：

```jsonc
// GET /api/health
{ "success": true, "requestId": "1b4a97bf-…", "data": { "status": "ok" }, "error": null }

// GET /api/skills/<slug> —— 拿「平台数据能力」那一半的 slug 去打 Skill 详情端点（走错集合）
// HTTP 404
{ "success": false, "requestId": "ee693f75-…", "data": null,
  "error": { "code": "SKILL_NOT_FOUND", "message": "Skill not found" } }

// GET /api/apis/<platform>/<slug> —— 一个根本不存在的 slug
// HTTP 404
{ "success": false, "requestId": "4c60e7ae-…", "data": null,
  "error": { "code": "ENDPOINT_NOT_FOUND", "message": "Endpoint not found" } }

// POST /api/skills/recommend 不带 Authorization 头 —— HTTP 403，被 CSRF 闸拦在鉴权之前
{ "success": false, "requestId": "5cf9584d-…", "data": null,
  "error": { "code": "CSRF_FORBIDDEN", "message": "Origin not allowed" } }
```

`requestId` 每次都不同，上面只留了前缀。**报障时把 `requestId` 一起给用户**，
它是服务端定位这一次调用的唯一线索。

---

## 7. 硬规则

1. **入参规格调用前现拉**，本地文档只当索引。本文件从头到尾不写任何能力的字段名，就是为了让你没得抄。
2. **地址只能来自 `execution` 的 `target`**，永远不自己拼。
3. **绝不回显整条 API Key**，只说前缀。
4. **`noResult` 不是失败**，别重试；**`CAPABILITY_UNAVAILABLE` 不要重试**；
   **`PROVIDER_FAILED` 可以重试**（额度已退）。
5. **别把本文里的条数、价格当事实**——以实拉为准。
6. 业务 Skill 引用本 Skill 时，**内联 §2 那段协议**，只点名自己那一两条能力，其余一概不抄。
