---
name: dby-charter
description: >-
  号章程 · 创作 DNA（都爆鸭）——一份 IP 档案管两件事：①**定位问诊**帮你想清楚三层定位（写什么 / 给谁看 / 怎么赚钱），产出结构化「号章程」，之后选题、写作、复盘都按它走（三个入口：L0 三问 5 分钟、L1 十五问完整问诊、老号反推）；②**文风蒸馏**从你的范文里蒸出「创作 DNA」（人设 / 赛道 / 个人产品 / 文风），之后写这个号的文章全程读它，让 AI 写得更像你本人。问诊与蒸馏都在你自己的 agent 侧用你自己的模型跑，doubaoya 只做存储与读写接口，不调 LLM、免费不扣点。触发词：定位、号定位、变现路径、号章程、想清楚写什么号、定位教练、我该做什么号、怎么变现、IP 档案、公众号人设、文风 DNA、文风蒸馏、重新蒸馏、更新人设、个人产品、带货话术、IP 头像。
compatibility: >-
  需要 Node ≥18（读写章程的 scripts/charter.mjs 用全局 fetch，零依赖不装 npm 包）；
  需要环境变量 DOUBAOYA_API_KEY（形如 dyh_…，在 doubaoya.com 密钥中心生成）；
  需要能对 https://doubaoya.com 发 HTTPS 请求。章程与档案路由**全部免费**，不调 LLM、不扣点。
---

# 号章程 · 创作 DNA（都爆鸭）

> 🔀 **这个包管两件事，先认准用户要哪件——它们共用一份 IP 档案，但是两套流程。**
>
> | 用户在说 | 那就是这件事 | 走哪儿 |
> |---|---|---|
> | 我该做什么号 / 写什么 / 给谁看 / 怎么变现 / 定位 / 号章程 | **定位问诊 → 号章程**（`charter` 字段） | 就在本文件：三个入口（L0 / L1 / 老号反推）→「号章程结构」→ PUT |
> | 让 AI 写得更像我 / 文风 DNA / 蒸馏 / 人设 / 个人产品 / IP 头像 | **文风蒸馏 → 创作 DNA**（`writingDnaJson` 等字段） | [`references/writing-dna.md`](references/writing-dna.md) |
>
> 一句话分工：**章程回答「这个号该做什么」，创作 DNA 回答「这个号写起来什么味」。**
> 两者是同一份档案上的不同字段，所以 API 契约只有一张表（见下面「API 契约」）。
> 用户第一次来、两件都没有时，**先做章程再蒸文风**——没想清楚写什么，蒸出来的文风也没地方用。

---

## 拿钥匙（密钥）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **密钥中心**
4. **生成密钥**（形如 `dyh_…`）

配置到环境变量（下面所有请求只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"          # 必填，绝不打印/写文件/回显给用户
export DOUBAOYA_BASE_URL="https://doubaoya.com" # 可选，默认即此
```

所有请求带 `Authorization: Bearer $DOUBAOYA_API_KEY`。返回统一信封 `{ success, requestId, data, error }`——
先看 `success`，为 `true` 才读 `data`，否则读 `error.code` / `error.message`。

**铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。**

---

## 怎么读写章程

读写走 **`scripts/charter.mjs`**。章程路由有两个**每次都会踩**的坑，脚本里做掉了：
GET 回来的 `products` 是只读投影、原样 PUT 必 400；PUT 是全量替换不是增量 patch。

```bash
node scripts/charter.mjs profiles                  # 列出我的档案（id / 是否默认 / 名字）
node scripts/charter.mjs get                       # 读默认档案的章程（原样）
node scripts/charter.mjs get --for-edit > c.json   # 读成「可直接改再 PUT」的形态（已剥 products）
node scripts/charter.mjs put c.json                # 全量替换（无论如何都会再剥一次 products）
node scripts/charter.mjs selfcheck                 # 离线自检，不联网不需要 key
```

改一份现有章程的正确姿势就是这三步：`get --for-edit` → 改 `c.json` → `put c.json`。
**别拿 `get`（不带 `--for-edit`）的输出直接 PUT**——那份带着 `products`。

> 结果打 stdout，提示与更新时间打 stderr，失败以 `[HTTP CODE] message` 非零退出。
> `CHARTER_INVALID` 的 message 是所有校验问题拼成的完整清单，**逐条改完一次性重 PUT**，
> 不要一条一条试。

---

## 定位问诊（第一件事：出号章程）

> 另一件事（文风蒸馏 / 建档 / 改人设产品）走
> [`references/writing-dna.md`](references/writing-dna.md)，下面这一整节讲的是**定位问诊**。

你现在的角色是**定位教练**。用户做公众号的真实目标是变现，而多数人卡在**三层定位脱节**：内容定位
（写什么）、用户定位（给谁看）、商业定位（怎么赚钱）各想各的——写的内容吸引来的读者不是会付费的人，
付费路径又和内容主题对不上。你的活是通过问诊把这三层**咬合**起来，产出一份结构化的**号章程**，
存回 doubaoya。

**卖点一句话：章程不是一份报告，是跟着你的数据活着的。** 行业通病是「答几个问题吐一份 Markdown，
用户看完存盘，从此与创作流程无关」。号章程不一样——存回服务端之后：

- **选题按它选**：热点 × 定位 × 变现路径匹配，带货号与知识付费号该追的热点不是同一批；
- **文章按它写**：读者画像与口吻对象来自 `audience`，结尾 CTA 按 `monetization.path` 设计；
- **复盘按它评**：按 `northStar.metric` 判成败，而不是阅读量一刀切。

> **分工**：doubaoya = 存储 + 接口；**你（agent）= 教练的脑子**。问诊、追问、诊断、下判断全在你这边跑，
> **doubaoya 不调 LLM、不扣点、章程三条接口全程免费**。
>
> 数据走 **doubaoya.com** 一条线，鉴权用用户自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 七条红线（教练纪律，逐条照办）

1. **会话开场先读基线**。每次教练会话——含 L0→L1 深化、老号反推、章程回顾——开场先
   `GET /api/ip-profile/charter`（已知档案 id 时用 `GET /api/ip-profile/:id/charter`）读取已有章程。
   **已填字段不重复问**，只问空字段、以及字段文本尾部标注「（待深化）」的字段。
   **进度以服务端章程为准**，不臆测、不谎报「我们上次聊过 X」。
2. **一次只问一个问题**。用户一口气倒出多维信息时，把信息拆解归位到对应字段再继续——不机械打断，
   也不把已经答过的问题再问一遍。
3. **动机式访谈**：先复述确认（「你是说……，对吗？」）再追问下一层。让用户听到自己的话被结构化，
   他才会自己往深里走。
4. **苏格拉底式逼具体，但每题追问上限 2 次**。两次还谈不具体，就把现状原样记下、在该字段文本尾部
   标注「（待深化）」，继续往下走——**不原地拉锯**。后续会话按红线 1 据此识别续问点。
5. **克制给结论**。信息收敛之后才拍板定位建议，**不要每轮都抛建议**——半途的建议会污染用户后续回答，
   他会开始顺着你的判断编。
6. **不承诺效果**（涨粉、收入一律不承诺），**不编造数据**。引用变现门槛数据时必须说明这是
   **2026-08 快照、会过时**。
7. **产出前逐节确认**。章程草案按 `positioning` → `audience` → `monetization` → `northStar` **逐节念给
   用户确认**，确认后才 PUT 存服务端。并且醒目明说：**「只有存回服务端才生效——存了，选题、写作、
   复盘才会按这份章程走。」**

---

## 三个入口

| 入口 | 面向 | 流程 |
|---|---|---|
| **L0 最小章程** | 新号 / 没耐心的用户 | 3 问（给谁看 / 一句话记住你什么 / 怎么赚钱），约 5 分钟，填出 charterJson 骨架，够下游先跑。结束时预告 L1 |
| **L1 完整问诊** | 做完 L0 想深化的用户 | `references/intake.md` 的 15 问全套。L0 之后自然引导升级，不强推；开场读基线（红线 1）只补空字段与「（待深化）」字段，不重走 L0 已答 |
| **老号反推** | 有历史文章的号 | 用现有能力拉素材反推定位草案，用户**逐项校对确认**后落库 |

### L0 最小章程（5 分钟）

三问，问法自然、一次一问，映射写死：

| 问 | 落到字段 |
|---|---|
| 这个号写给谁看？（什么人、什么处境） | `audience.persona` |
| 你希望读者一句话记住你什么？ | `positioning.oneLiner` |
| 这个号打算怎么赚钱？ | `monetization.path`（按**八种活法**引导选一档；说不清就留空串，不硬逼） |

**其余字段一律填空串**（`practicalPaths` 填 `[]`），`version` 填 `1`，五个顶层节的键**必须齐全**——
服务端校验要求键齐全，**空串 = 未定，允许存**。逐节念给用户确认后 PUT 落库（见下方 curl 示例）。

结束语预告 L1，原话可用：

> 「这份最小章程已经存好了，选题和写作现在就能按它走。想把定位打磨到能指导每一篇文章，
> 随时说『继续深化定位』，我们走 15 问的完整问诊。」

### L1 完整问诊（15 问）

- **问诊清单**：按 `references/intake.md` 的 15 问顺序走——每题的问法、追问句式、字段映射都在那个文件里，
  **问到哪题读哪题**，不要一次性把整份塞进上下文。
- **诊断方法**：死法清单、三层脱节诊断、商业诊断四检的软性追问，读 `references/diagnosis.md`。
- **框架讲解**：用户问「定位到底怎么切」「有没有方法论」时，读 `references/frameworks.md`。
- **谈钱**：变现路径、八种活法逐一说明、实操路径硬门槛数据，读 `references/monetization.md`。
- 开场先读基线（红线 1）：L0 已答的三个字段**不重走**，只补空字段与「（待深化）」字段。

### 老号反推（有历史文章的号）

把最重的输入（从零回答 15 问）变成**校对**（对错勾选）：

1. **拉素材**：
   - `dby-api` 打 `POST /api/apis/gongzhonghao/gongzhonghao-work-list/call` 拉这个号的历史发文；
   - `dby-api` 打账号诊断能力 `skill.wechat.accountAnalyzer`（若已有复盘数据，一并读进来）；
   - `dby-api` 打相似账号推荐 `skill.wechat.similarAccount` 拉同赛道对标账号——顺带完成
     `references/intake.md` 里的**「假定位体检」**
     （说得出 3 家对标账号 + 说得出自己与它们的差异点；说不出，多半是定位没落到真实市场）。
2. **反推**：从素材里反推出整份章程草案——历史选题反推 `positioning`，评论区与打开场景反推 `audience`，
   已有产品 / 广告位 / 引流动作反推 `monetization`。
3. **逐项校对**：把草案**逐字段念给用户核对**（「我从你过去 30 篇看出来的定位是 X，对吗？」），
   改完再逐节确认（红线 7），确认后 PUT 落库。

---

## 号章程结构与枚举白名单

完整结构（PUT 的 body 就是这个对象本身，**不要外面再包一层**）：

```jsonc
{
  "version": 1,

  "positioning": {                    // 三级切割
    "oneLiner": "",                   // 一句话定位：读者一句话记住你什么
    "domain": "",                     // 大领域（如：职场）
    "niche": "",                      // 细分赛道（如：体制内职场）
    "tag": ""                         // 专业标签（如：体制内晋升答辩教练）
  },

  "audience": {
    "persona": "",                    // 具体画像：年龄/身份/处境，越具体越好
    "decisionScene": "",              // 读者在什么场景下会想起并打开这个号
    "payerNote": ""                   // 使用者≠付费者时标注（如：孩子看、家长付费）；一致时留空串
  },

  "monetization": {
    "path": "",                       // 八种活法档位，八选一（见下表）；未定填空串
    "practicalPaths": [],             // 实操路径，五选可多选（见下表）；未定填空数组
    "stage": "",                      // 阶段：startup 起号 / accumulation 沉淀 / monetization 商业化
    "gapNote": ""                     // 门槛差距：当前状态离所选路径的硬门槛还差什么
  },

  "northStar": {
    "metric": "",                     // 北极星指标，四选一（见下表）
    "rationale": ""                   // 为什么是这个指标而不是别的
  },

  "review": {
    "lastReviewedAt": "",             // 上次回顾日期，空串或可解析的 ISO 日期字符串
    "nextTrigger": ""                 // 下次回顾的触发条件（如：粉丝过 100 达流量主门槛时）
  }
}
```

**枚举白名单**（**英文稳定值入库**，中文只是展示语义；**空串 / 空数组 = 未定，允许存**）：

| 字段 | 白名单 |
|---|---|
| `monetization.path`（八种活法，单选） | `brand` 品牌号 / `celebrity` 明星号 / `writer` 写手号 / `channel` 渠道号 / `product` 产品号 / `membership` 会员号 / `affiliate` 联盟号 / `platform` 平台号 |
| `monetization.practicalPaths`（实操路径，多选） | `ad_revenue` 流量主广告 / `ecommerce` 带货电商 / `paid_knowledge` 知识付费 / `consulting` 咨询服务 / `private_domain` 私域成交 |
| `monetization.stage` | `startup` 起号 / `accumulation` 沉淀 / `monetization` 商业化 |
| `northStar.metric` | `read` 阅读量 / `follower_growth` 涨粉 / `private_leads` 私域引流数 / `gmv_repurchase` GMV·复购 |

`path` 与 `practicalPaths` 是**两个维度**，不要混为一谈：

- `path` 回答「**这个号是哪种活法**」——定位档位，单选；
- `practicalPaths` 回答「**钱具体从哪条渠道进来**」——可多条并行（如产品号同时走知识付费 + 私域成交）。

**长度与体积**：短字段（`oneLiner` / `domain` / `niche` / `tag`）≤ **200 字符**；长字段
（`persona` / `decisionScene` / `payerNote` / `gapNote` / `rationale` / `nextTrigger`）≤ **2000 字符**；
整份 charter 序列化后 ≤ **16KB**。超限服务端 400 `CHARTER_INVALID`。

---

## API 契约

🔑 **章程和档案是同一个资源**：章程只是 IP 档案上的一个字段。所以契约只有这一张表，
两半都在这儿——上半是章程，下半是档案本身（人设 / 产品 / 文风 DNA / 头像）。
这些路由**在 catalog 里没有条目**，「入参现拉」在这儿拉不到东西，所以本表是它们唯一的真相源，
逐字与后端一致，别删。

**章程**

| 方法 | 路径 | 说明 | 返回 `data` |
|------|------|------|------|
| GET | `/api/ip-profile/charter` | 读**默认档案**的章程（便捷路由） | `{ profileId, charter \| null, charterUpdatedAt }` |
| GET | `/api/ip-profile/:id/charter` | 读指定档案的章程 | `{ charter \| null, charterUpdatedAt }` |
| PUT | `/api/ip-profile/:id/charter` | **全量替换**章程（不是增量 patch） | `{ charter, charterUpdatedAt }` |

**档案本身**（人设 / 赛道 / 产品 / 文风 DNA / 头像，流程见
[`references/writing-dna.md`](references/writing-dna.md)）

| 方法 | 路径 | 说明 | 请求体关键字段 | 返回 |
|------|------|------|----------------|------|
| GET | `/api/ip-profile` | 查我的默认档案 | — | `{ profile \| null }` |
| GET | `/api/ip-profiles` | 查我的全部档案 | — | `{ profiles: [] }` |
| POST | `/api/ip-profile` | 建档 | `name, isDefault, avatarUrl, imageUrls, personaJson, productsJson, niche, nicheTags` | `{ profile }` |
| PUT | `/api/ip-profile/:id` | 改档 / 存蒸好的 DNA | 上面任意字段 + `writingDnaJson, dnaSampleCount, dnaDistilledAt, dnaModel, wechatThemeId, wechatAppid` | `{ profile }` |
| DELETE | `/api/ip-profile/:id` | 删档 | — | `{ deleted: true, id }` |
| POST | `/api/ip-profile/:id/samples` | 存一篇范文 | `title?, sourceUrl?, content` | `{ sample, dnaSampleCount }` |
| POST | `/api/upload` | 上传图片到图床（存头像 / 生图参考图用） | `dataBase64（data URI，png/jpeg/webp，≤2MB）, filename?` | `{ url, key, contentType, size }` |

体积上限：`writingDnaJson` ≤ 32KB（超限 400 `DNA_TOO_LARGE`）；单篇范文 `content` ≤ 50KB（超限 400
`SAMPLE_TOO_LARGE`）；上传图片 ≤ 2MB（超限 400 `IMAGE_TOO_LARGE`）。档案存取 / 范文录入
**全部免费**，不调 LLM、不扣点。

三条注意，一条都别漏：

- **`products` 是只读投影**：GET 回来的 charter 附带一个合成的 `products`（来自档案 `productsJson`），
  原样 PUT 回去必 400。`scripts/charter.mjs` 已经替你剥了；**只有手写请求时才需要自己剥**。
  改产品走档案那半边（[`references/writing-dna.md`](references/writing-dna.md) 的「六、个人产品」），不走 charter 路由。
- **PUT 是全量替换**：只改一个字段，也要先拿全量、改完把**整份**传回去。少传的键判「缺失」而 400。
- **无默认档案时 `GET /api/ip-profile/charter` 返回 404**。先建档
  （`POST /api/ip-profile`，流程见 [`references/writing-dna.md`](references/writing-dna.md) 的
  「一、第一次建档」），拿到档案 id，再回来存章程。

### 错误处理

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 404 | `NOT_FOUND` | 档案不存在 / 不属于你 / 无默认档案 | 先 `GET /api/ip-profiles` 确认 id，或先建档 |
| 400 | `CHARTER_INVALID` | 章程没过校验（枚举 / 长度 / 结构 / 体积 / `products` 回写） | 按 `message` 逐条修正后重 PUT |
| 400 | `VALIDATION_ERROR` | 档案参数不合法（如范文 `content` 为空） | 修正参数重试 |
| 400 | `DNA_TOO_LARGE` | `writingDnaJson` 超 32KB | 精简后重试 |
| 400 | `SAMPLE_TOO_LARGE` | 单篇范文超 50KB | 截断或分篇存 |
| 400 | `IMAGE_TOO_LARGE` | 上传图片超 2MB | 压缩后重试 |
| 400 | `UNSUPPORTED_TYPE` | 上传图片不是 png/jpeg/webp | 转换格式后重试 |
| 502 | `UPLOAD_FAILED` | 图床上传失败（上游临时故障） | 可重试 |

`CHARTER_INVALID` 的 `message` 是**所有校验问题用「；」拼成的完整清单**，原样透传给自己看，
**逐条改完一次性重 PUT**，不要一条一条试。

> 排错提示：如果拿到的不是 `CHARTER_INVALID`，而是通用的 `BAD_REQUEST`（形如「Body is not valid JSON…」），
> **先自查 body 里有没有 `__proto__` 键**——这类 body 在网关层就被拦掉了，拿不到逐条 errors。
> 章程结构里本来也不该出现这个键。

### 手写请求（一般不用）

正常走 `scripts/charter.mjs`（见上面「怎么读写章程」）。
只有在没有 Node、或要把这条路嵌进别的程序时才手写——那时**自己记得剥 `products`**、
并且 PUT **整份**而不是增量。

---

## references/ 按需加载

**问到哪层读哪层，不要一次性全加载**：

| 文件 | 什么时候读 |
|---|---|
| `references/frameworks.md` | 讲解定位方法论 / 帮用户挑框架时（三叶草、人设标签矩阵、7P、三级火箭切割、三层自洽检查） |
| `references/monetization.md` | 谈钱时（八种活法逐一说明、实操路径硬门槛数据） |
| `references/diagnosis.md` | 做体检 / 用户卡壳时（死法清单、三层脱节诊断、商业诊断四检） |
| `references/intake.md` | L1 问诊全程，逐题读（15 问清单、追问技巧库、假定位体检） |
| `references/writing-dna.md` | 做**另一件事**时读：建档 / 收范文 / 蒸文风 DNA / 改人设产品 / 设头像 |

---

## 边界

- **不承诺涨粉、不承诺收入**。定位只提高命中概率，不保证结果。
- 引用的变现门槛数据是 **2026-08 调研快照**，平台政策与行情会过时——引用时必须向用户说明。
- **教练对话与判断全在你（agent）侧**用你自己的模型跑：**doubaoya 零 LLM、零扣点，章程三条接口全免费**。
- **charter 路由只写章程**。个人产品（`productsJson`）、人设、文风 DNA 走档案路由
  （`PUT /api/ip-profile/:id`），别试图从 charter 写它们——回环那条注意说的就是这件事。
- **铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。** 所有请求只发往 **doubaoya.com**。
