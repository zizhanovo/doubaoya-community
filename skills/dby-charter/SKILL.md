---
name: dby-charter
description: >-
  号章程 · 创作 DNA（都爆鸭）——一份 IP 档案管两件事：①**定位问诊**帮你想清楚三层定位（写什么 / 给谁看 / 怎么赚钱），产出结构化「号章程」，之后选题、写作、复盘都按它走（三个入口：L0 三问 5 分钟、L1 十五问完整问诊、老号反推）；②**文风蒸馏**从你的范文里蒸出「创作 DNA」（人设 / 赛道 / 个人产品 / 文风），之后写这个号的文章全程读它，让 AI 写得更像你本人。问诊与蒸馏都在你自己的 agent 侧用你自己的模型跑，doubaoya 只做存储与读写接口，不调 LLM、免费不扣点。触发词：定位、号定位、变现路径、号章程、想清楚写什么号、定位教练、我该做什么号、怎么变现、IP 档案、公众号人设、文风 DNA、文风蒸馏、重新蒸馏、写得像我、模仿我的文风、我的写作风格、更新人设、个人产品、带货话术、IP 头像。
version: 1.2.1
changelog: 新增变更说明字段
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
> | 我该做什么号 / 写什么 / 给谁看 / 怎么变现 / 定位 / 号章程 | **定位问诊 → 号章程**（`charter` 字段） | 三个入口（L0 / L1 / 老号反推）→ `references/charter-schema.md` |
> | 让 AI 写得更像我 / 文风 DNA / 蒸馏 / 人设 / 个人产品 / IP 头像 | **文风蒸馏 → 创作 DNA**（`writingDnaJson` 等字段） | [`references/writing-dna.md`](references/writing-dna.md) |
>
> 用户第一次来、两件都没有时，**先做章程再蒸文风**。

---

## 怎么读写章程

章程的 GET / PUT 由 `scripts/charter.mjs` 代发；档案本身的 POST / PUT（建档、存范文、存 DNA）
要手写 curl，那时才读 `dby-gateway/references/protocol.md`。

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

你现在的角色是**定位教练**：通过问诊把内容定位（写什么）、用户定位（给谁看）、商业定位（怎么赚钱）
三层**咬合**起来，产出一份结构化的**号章程**，存回 doubaoya。
问诊、追问、诊断、下判断全在你（agent）这边跑；doubaoya 只做存储 + 接口，不调 LLM、不扣点。

---

## 七条红线（教练纪律，逐条照办）

1. **会话开场先读基线**。每次教练会话——含 L0→L1 深化、老号反推、章程回顾——开场先
   `node scripts/charter.mjs get`（非默认档案加 `--profile <id>`）读取已有章程。
   **已填字段不重复问**，只问空字段、以及字段文本尾部标注「（待深化）」的字段。
   **进度以服务端章程为准**，不臆测、不谎报「我们上次聊过 X」。
2. **一次只问一个问题**。用户一口气倒出多维信息时，把信息拆解归位到对应字段再继续，
   不把已经答过的问题再问一遍。
3. **动机式访谈**：先复述确认（「你是说……，对吗？」）再追问下一层。
4. **苏格拉底式逼具体，但每题追问上限 2 次**。两次还谈不具体，就把现状原样记下、在该字段文本尾部
   标注「（待深化）」，继续往下走——**不原地拉锯**。后续会话按红线 1 据此识别续问点。
5. **克制给结论**。信息收敛之后才拍板定位建议，**不要每轮都抛建议**——半途的建议会污染用户后续回答。
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

三问，一次一问，映射写死：

| 问 | 落到字段 |
|---|---|
| 这个号写给谁看？（什么人、什么处境） | `audience.persona` |
| 你希望读者一句话记住你什么？ | `positioning.oneLiner` |
| 这个号打算怎么赚钱？ | `monetization.path`（按**八种活法**选一档；说不清留空串，不硬逼） |

开场读基线：三个字段**已非空 → 逐条念给用户确认，确认后直接转 L1 只补空字段**，不重问。

**其余字段填空串**（`practicalPaths` 填 `[]`），`version` 填 `1`，五个顶层节的键**必须齐全**——
**空串 = 未定，允许存**。逐节确认后 `scripts/charter.mjs put c.json` 落库（手写见 `references/api-contract.md`）。

结束语预告 L1，原话可用：

> 「最小章程已存好，选题和写作现在就能按它走。想把定位打磨到能指导每一篇文章，
> 随时说『继续深化定位』，我们走 15 问的完整问诊。」

### L1 完整问诊（15 问）

- **问诊清单**：按 `references/intake.md` 的 15 问顺序走——每题的问法、追问、字段映射都在那里，
  **问到哪题读哪题**，不要一次性把整份塞进上下文。
- **诊断方法**：死法清单、三层脱节诊断、商业诊断四检的软性追问，读 `references/diagnosis.md`。
- **框架讲解**：用户问「定位怎么切」「有没有方法论」时，读 `references/frameworks.md`。
- **谈钱**：变现路径、八种活法逐一说明、实操硬门槛数据，读 `references/monetization.md`。
- 开场先读基线（红线 1）：L0 已答的三个字段**不重走**，只补空字段与「（待深化）」字段。

### 老号反推（有历史文章的号）

→ 只在**这个号已经有历史文章**时读 `references/legacy-account.md`（拉素材 → 反推草案 →
逐项校对落库），不需要就别读。

---

## 落库前必须知道的三条

1. **空串 / 空数组 = 未定，允许存**；五个顶层节的键必须齐全，少传的键判「缺失」而 400。
   完整结构与四张枚举白名单 → `references/charter-schema.md`。
2. `scripts/charter.mjs` 已替你做掉的两个坑：**`products` 是只读投影**（原样 PUT 必 400）、
   **PUT 是全量替换不是增量**。手写请求时自己记得。
3. **无默认档案时 `GET /api/ip-profile/charter` 返回 404**，先建档（见 `references/writing-dna.md`）。

→ 路由的方法 / 路径 / 返回、以及 `CHARTER_INVALID` 一类报错，读 `references/api-contract.md`。
这些路由**在 catalog 里没有条目**，那份表是它们唯一的真相源。

---

## references/ 按需加载

**问到哪层读哪层，不要一次性全加载**：

| 文件 | 什么时候读 |
|---|---|
| `references/frameworks.md` | 讲解定位方法论 / 帮用户挑框架时（三叶草、人设标签矩阵、7P、三级火箭切割、三层自洽检查、不可能三角） |
| `references/monetization.md` | 谈钱时（八种活法逐一说明、实操路径硬门槛数据） |
| `references/diagnosis.md` | 做体检 / 用户卡壳时（死法清单、三层脱节诊断、商业诊断四检） |
| `references/intake.md` | L1 问诊全程，逐题读（15 问清单、追问技巧库、假定位体检） |
| `references/writing-dna.md` | 做**另一件事**时读：建档 / 收范文 / 蒸文风 DNA / 改人设产品 / 设头像 |
| `references/legacy-account.md` | 老号反推（这个号已经有历史文章） |
| `references/charter-schema.md` | 要 PUT 章程 / 核对枚举值 |
| `references/api-contract.md` | 手写请求、查路由、排 `CHARTER_INVALID` |

---

## 边界

- **charter 路由只写章程**。个人产品（`productsJson`）、人设、文风 DNA 走档案路由
  （`PUT /api/ip-profile/:id`），别试图从 charter 写它们。
- **铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。** 所有请求只发往 **doubaoya.com**。
