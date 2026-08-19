---
name: doubaoya-gateway
description: >-
  都爆鸭平台的**调用网关**（基础设施 Skill，**不承接业务意图**）：鉴权怎么带、两条互不回落的路由怎么选、
  统一信封与错误码怎么解，以及一条纪律——**入参规格调用前现拉**。不负责写文章 / 挖选题 / 做封面 / 查违禁词，那些走 `dby`。
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
| 有哪些能力、走哪条路由（→ `references/capability-index.md`） | 结果怎么加工成文案 / 封面 / 报告（→ 业务 Skill） |
| 跨能力的选路坑（→ `references/routing-pitfalls.md`） | 计价与额度（→ doubaoya.com 控制台） |

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

> **抄成什么样算对？照 `wechat-article-pipeline` 抄。** 它是这套形态的第一个业务 Skill：
> 正文全是判断与编排（每一步用哪条能力、何时该停下来问人），下面这段协议逐字内联，
> 逐能力的入参一个字都没有。它还示范了另外两件事——**点名能力时 operationKey 与详情端点一起给**
> （撞名那条否则定位不到），以及**平台能力办不到的活**（要读写用户本机文件的那些）
> 单独收进自己包里的 `references/`，不跟协议混在一处。

<!-- 下面这段是给业务 Skill 复制的正文，请整体保留，包括开头两行占位说明。 -->

```markdown
## 调用都爆鸭（协议，抄自 doubaoya-gateway）

**本 Skill 用到的能力**：`<operationKey>` —— 详情端点 `<GET 路径>`
（只点名能力和详情端点；入参**不在这里写**，每次调用前现拉。）

1. **鉴权**：所有*调用*端点都要 `Authorization: Bearer $DOUBAOYA_API_KEY`。
   优先从环境变量 `DOUBAOYA_API_KEY` 读；环境里没有就**问用户一次**，之后不再追问。
   🔴 **一个字符都不许回显、打印或写进日志——前缀也是密钥内容。** 要报状态只许说
   「已设置 / 没设置」，别打印任何截断形式（`${KEY:0:6}` 这种写法就是在打印密钥）。
   基址 `https://doubaoya.com`。
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
     发现接口里也没有这条能力时，**多半是本机 skill 已经过期**（它点名的能力早就下架了）：
     跟用户说一句「你的本鸭 skill 可能过期了」，让他跑一次 `/dby-update`（或说「更新都爆鸭」），
     然后**只重试这一次**。🔴 重试仍是 404 就如实告知能力已下架，**不许再更新、不许成环**。
   503 `CAPABILITY_UNAVAILABLE` → **别重试**，换能力或如实告知；
   502 `PROVIDER_FAILED` → 上游临时失败，**额度已自动退回**，可以直接重试。
   🔴 只有上面这条 404 走「先更新再重试」，**别的错一律不许触发更新**——
   401 是钥匙问题、400 是入参问题、402 是余额问题，更新 skill 一个都治不了，
   把它们也当成「该更新了」只会让每次失败都多跑一遍安装。
```

<!-- 以上是给业务 Skill 复制的正文。 -->

### 🔴 **绝不能**抄进业务 Skill 的东西

| 不许抄 | 为什么 |
|---|---|
| 任何能力的**入参字段清单**（名称、类型、必填、枚举值） | 这就是「把契约烤进分发物」，是本轮要根治的病本身 |
| `references/capability-index.md` 那份**能力索引**（整表或成片摘录） | 业务 Skill 只该点名它自己用的那一两条，抄全表 = 又造一个会漂的副本 |
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

## 4. `references/` 里有什么（按需加载，别一次全读）

**接口多不是拆技能的理由，是拆 `references/` 的理由。** 网关只有一个，细节按主题分在下面两份里，
用到哪份读哪份：

| 文件 | 什么时候读 | 里面是什么 |
|---|---|---|
| `references/capability-index.md` | 你还不知道该点名哪条能力，或不确定它走哪条路由 | 94 条能力的 operationKey + 一行用途 + 详情端点。**仅供选路** |
| `references/routing-pitfalls.md` | 选定能力之后、真正打请求之前 | 哪些能力不该混用、什么时候该用哪条、已知的坑（含唯一一处 operationKey 撞名） |

### 🔴 这两份里放什么、不放什么——一条判据

> **本地文档回答「该用哪个、要注意什么」；详情端点回答「它长什么样、怎么填参数」。**
> 前者随经验积累而更新，后者随目录变化而变化——**混在一起的那部分，一定是先烂的那部分。**

所以 `references/` 里**只放选路知识**（能力不该怎么混用、什么场景走哪条、踩过的坑），
**绝不放参数表 / 字段清单 / 出入参样例**。别的技能库能把参数烤进 references，是因为它们的接口
变得慢、还有版本号；**本平台的目录一周就变**（光 2026-08-17 那一天就净增 9 个能力），
烤进去的当天就开始腐烂——本机装的 80 个包里已经有 32 个停在早被砍掉的旧契约上。

⚠️ 这不只是纪律，是有闸的：仓库的校验器会扫**整个技能包目录**（`SKILL.md` 与 `references/` 一视同仁），
逐能力的入参字段一旦出现在任何一份里，当场打红。

---


## 5. 本文档里的响应片段都是实拉的

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

## 6. 硬规则

1. **入参规格调用前现拉**，本地文档只当索引。本文件从头到尾不写任何能力的字段名，就是为了让你没得抄。
2. **地址只能来自 `execution` 的 `target`**，永远不自己拼。
3. **API Key 一个字符都不许回显**——前缀也是密钥内容，只许报「已设置 / 没设置」。
4. **`noResult` 不是失败**，别重试；**`CAPABILITY_UNAVAILABLE` 不要重试**；
   **`PROVIDER_FAILED` 可以重试**（额度已退）。
5. **别把本文里的条数、价格当事实**——以实拉为准。
6. 业务 Skill 引用本 Skill 时，**内联 §2 那段协议**，只点名自己那一两条能力，其余一概不抄。
