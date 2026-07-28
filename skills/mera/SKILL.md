---
name: mera
description: >-
  Mera 第二大脑（LLM-Wiki）—— 随口说一句就记进自己的笔记，问一句就从自己的笔记里找答案。当用户说
  「帮我记一下」「记下来」「存进笔记」「我刚想到」「备忘一下」「把这个链接存了」「我之前是不是说过」
  「查查我的笔记」「我记过什么」「我对 X 怎么看」「关于 X 我有哪些素材」「我是个什么样的人」
  「按我的风格写」时使用本 Skill。它教 AI agent 用用户自己的 DOUBAOYA_API_KEY 连到用户自己的 Mera
  第二大脑：写入（异步，必须轮询到收条）、混合检索原文素材、带引用的问答、读人格内核给回答定调。
  Trigger words: 帮我记一下 / 记下来 / 存进笔记 / 备忘 / 第二大脑 / 我的笔记 / 我记过什么 /
  我之前说过 / 我对 X 怎么看 / 我有哪些素材 / 我是个什么样的人 / Mera / mera。
---

# Mera · 第二大脑

嘎！这是用户**自己的**第二大脑。别的技能是往外看（全网在爆什么），本鸭这一个是往里看：
**用户随口说的一句话进得去，过几天问一句还能带着出处捞出来。**

一条 `DOUBAOYA_API_KEY` 通到用户自己的 Mera 账号（https://mera.doubaoya.com）。
里面全是**用户的私人内容**——你只读它、只用它回答用户本人，绝不外传。

---

## 0. 你能替用户做什么（一句话版）

| 用户这么说 | 你该做 | 子命令 |
|-----------|--------|--------|
| 「帮我记一下…」「记下来」「备忘一下」「我刚想到…」 | 写进第二大脑，**并等到收条** | `remember` |
| 「把这个链接存了」「这篇文章收进来」 | 同上，传 `url` | `remember` |
| 「查查我的笔记」「我之前是不是说过 X」「关于 X 我有哪些素材」 | 检索**原文片段**，给素材 | `search` |
| 「我对 X 怎么看」「我以前是怎么决定的」 | 基于笔记**给结论 + 出处** | `ask` |
| 「你了解我吗」「我是个什么样的人」「按我的风格写」 | 取人格内核，给后续回答定调 | `self` |

---

## 1. 硬规则（红线，先看这一节）

1. **绝不无声吞掉。** 任何一次写入 / 检索失败，都必须明确告诉用户失败了、失败在哪一步。
   **禁止在没拿到 `status=done` 的情况下说「已保存」「记好了」。** 这是本 Skill 最容易犯的错，也是最不能犯的错。
2. **写入一律走 `remember`，走完收条再开口。** 写入是异步的（`write` 只返回 `ingestion_id`），
   拿到 202 就报「已记下」= 撒谎。`remember` 已经把轮询包好了，别自己拿 `write` 手搓轮询。
3. **不编造来源。** `ask` 的结论必须连 `citations` 里的 `raw_source.title` 一起给。
   **无支撑的唯一判据是 `evidence_level === "none"`**（等价于 `has_evidence === false`、等价于 `citations` 为空），
   命中就明说「你的笔记里没有能支撑这个问题的内容」，再决定要不要用你自己的常识补一句（补了必须标明那是你的判断）。
   ❌ **别拿 `evidence.grade === "待核实"` 当无支撑判据**——`reference` 级也是这个 grade，那是真检索到了用户原文的，冤枉不得。
4. **不许把那句英文占位符甩给用户。** `evidence_level === "none"` 时 Mera 返回的 `answer` 是一句硬编码英文
   （`I could not find any supported evidence…`），那是占位符不是回答。脚本已经在这种情况下把它换成中文并打上
   `no_evidence: true`，你**照 `answer_notice` 说人话**，别把英文原句转述给中文用户。
   上游原句一个字不动地留在 **`answer_upstream`** 里——那是**排查用的原件，不是给用户看的**，
   除非用户自己要求看原始返回，否则不转述、不翻译、不改写它。
5. **绝不回显 / 打印 / 记录整条 `DOUBAOYA_API_KEY`**——需要确认时只露前缀（如 `dyh_xxxx…`）。
6. **隐私不外传。** 第二大脑里的内容是用户的私人材料：不要把检索到的内容发到别的服务 / 别的 API / 公开渠道，
   不要拿它去搜索引擎里搜，不要写进任何会外发的产物里，除非用户在这一轮明确要求。
7. **只走 `https://doubaoya.com` 的公开 `/api/...` 接口**，不要猜测或暴露上游内部服务。

---

## 2. 先拿钥匙（密钥）

调接口前需要一把密钥（API Key），形如 `dyh_…`。拿钥匙四步：

1. 打开 [doubaoya.com](https://doubaoya.com)
2. **登录**（没有账号先注册）
3. 进入 **密钥中心**
4. 点 **生成密钥**，复制形如 `dyh_…` 的字符串

拿到后写进环境变量（终端里执行一次即可）：

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
```

> 🔒 整条密钥只在生成那一下完整露脸。环境里没有就**问用户一次**，拿到后存进环境变量，之后不再追问。
> **绝不把整条 key 打印出来、写进日志或聊天。**

**不需要额外「绑定 Mera 账号」这一步**：第一次用会自动开通，之后记的东西都落在同一个账号下，
用户可以去 https://mera.doubaoya.com 用同一身份看到它们。别跟用户说「你可能还没绑定」——没有这个状态。

| 环境变量 | 说明 | 必填 |
| -------- | ---- | ---- |
| `DOUBAOYA_API_KEY` | 都爆鸭密钥（`dyh_…`），同时决定连到**哪个人的**第二大脑 | 是 |
| `DOUBAOYA_BASE_URL` | 覆盖默认 `https://doubaoya.com`（自托管 / 联调用） | 否 |
| `MERA_POLL_BACKOFF_MS` | 覆盖 `remember` 的轮询退避（毫秒，逗号分隔；默认 `1000,2000,3000,4000`）。抓长网页 / 传长文常超 10 秒，可加长 | 否 |

依赖：Node 18+，零第三方依赖。

---

## 3. 脚本用法

脚本位置：`scripts/mera.mjs`。它统一 POST 到 `https://doubaoya.com/api/apis/mera/<slug>/call`，
拆掉统一信封，把 `data` 的 JSON 打到 stdout。

```bash
node scripts/mera.mjs remember '<json>'        # ⭐ 写入 + 轮询到终态（写入首选）
node scripts/mera.mjs write    '<json>'        # 只写入（异步，返回 ingestion_id，你得自己轮询）
node scripts/mera.mjs status   <ingestion_id>  # 查一次处理状态
node scripts/mera.mjs search   "<关键词>"       # 混合检索，拿原文素材
node scripts/mera.mjs ask      '<json>'        # 基于笔记问答（带引用）
node scripts/mera.mjs self                     # 人格内核 + 关键记忆
```

**输出契约**：成功 → `data` 的 JSON 打 stdout，退出码 0；失败 → `[error] <code>: <message>` 打 stderr，退出码 1。
所以每次调用后**先看退出码 / stderr**，别只闷头解析 stdout。

| 子命令 | 入参 | 例 |
|--------|------|----|
| `remember` / `write` | `{content?, url?, title?}`，**content / url 二选一**；`title` **只在 content 模式生效** | `node scripts/mera.mjs remember '{"content":"和老王聊完，决定先做单机版再联网"}'` |
| | 存链接（**别传 title**，url 模式下服务端硬用抓到的页面标题，传了会被忽略） | `node scripts/mera.mjs remember '{"url":"https://example.com/post"}'` |
| `status` | `<ingestion_id>` | `node scripts/mera.mjs status ing_abc123` |
| `search` | 关键词字符串 | `node scripts/mera.mjs search "远程办公"` |
| `ask` | `{query_text, top_k?, conversation_id?}` | `node scripts/mera.mjs ask '{"query_text":"我对远程办公是什么态度"}'` |
| `self` | 无 | `node scripts/mera.mjs self` |

---

## 4. 写入剧本：必须走完收条

> ⚠️ 这一节是本 Skill 的核心。写入是**异步**的：`write` 返回 202 `{ingestion_id, status:"queued"}`，
> 那时候东西**还没进大脑**。`remember` 会替你退避轮询（1s → 2s → 3s → 4s，约 10 秒）直到终态。

### 4.1 三种终态，三种说法

`remember` 的输出里有 `remember_result`，照它分支：

| `remember_result` | 退出码 | 你该跟用户怎么说 |
|-------------------|--------|------------------|
| `done` | 0 | 「记下了」+ 把 `disposition` 翻成人话（见 4.2） |
| `failed` | 1 | **必须明说失败**：「这条没记进去，原因是 `<error>`」，并问要不要重试 |
| `pending` | 0 | 「已经排队进去了，但 10 秒内还没确认完成」——**不许说「已保存」**。给出 `ingestion_id`，说明稍后可以复查 |

`pending` 时的复查动作（隔一会儿再来一次就行）：

```bash
node scripts/mera.mjs status <ingestion_id>
```

### 4.2 把 `disposition` 翻成人话

`status=done` 时结果里带 `disposition`，别把 JSON 甩给用户，翻译它：

| 字段 | 含义 | 怎么说 |
|------|------|--------|
| `outcome` | `graph` / `record` / `archived` / `failed` | `graph`＝进了知识图谱；`record`＝按记录整篇留存；`archived`＝归档留底 |
| `entities[]` | 识别出的实体 | 「识别到 3 个人物 / 概念：X、Y、Z」 |
| `fact_count` | 抽出的事实条数 | 「抽出 5 条事实」 |
| `todo_count` | 抽出的待办条数 | 「顺手抓到 1 条待办」——**有待办一定要报**，用户常靠这个记事 |
| `edge_count` | 新建的关系边 | 「和你之前记的 X 连上了」（>0 时才说） |
| `tier` / `page` / `reason` | 分级 / 落到哪一页 / 处置理由 | 用户追问细节时再展开 |

**示范**：

```
记下了 ✅
识别到 3 个实体（远程办公、老王、单机版方案），抽出 5 条事实、1 条待办（「先做单机版」），
还和你之前记的「产品排期」连上了 2 条关系。
```

### 4.3 去重

**只有 `deduplicated === true` 才能说「这条你之前记过了」**：

```
这条你之前记过了，本鸭没重复存，给你指回原来那条。
```

⚠️ **字段缺失 ≠ 首次记录。** 老版本的 Mera 不回这个字段，缺失时就只说「记下了」，
**不许反过来断言「这是新的一条」**。（脚本也不会替你合成一个 `deduplicated: false`。）

判断不了时还有两个**弱信号**可以参考（只做参考，别当结论说死）：
`stages` 只有 `[{stage:"ingest", status:"succeeded"}]` 一行（链在 ingest 处就断了），
且 `raw_source_id` 指向的是老那条。

### 4.4 重复提交会不会存两份（用户很在意，别说错）

| 模式 | 幂等吗 | 怎么跟用户说 |
|------|--------|-------------|
| `content`（贴正文） | **是**。去重键是正文内容的哈希（首尾空白已归一），同一段文字再提交一次不会存两份，第二次直接解析到同一个 `raw_source_id`、`status` 立刻 `done` | 「一样的内容再记一次不会存两条」 |
| `url`（存链接） | **不保证**。去重按**抓回来的正文**算，不按 URL 算——页面上任何动态内容（阅读量、「3 分钟前」、A/B 文案）变一个字，哈希就变，会多存一条 | 「同一个链接存两次有可能存成两条，因为网页内容会变」。要幂等就自己把正文贴过来走 content 模式 |

两个边界也别说反：

- 上次提交还**没跑完**就重试 → 不会短路，会在同一条 raw_source 上把链**重跑**一遍（不多存行，但多花一次处理）。
- 同样内容此前被**归档**过 → 会**故意**插入新行让它重新可见，这是设计意图，不是重复存。

### 4.5 标题的两个坑

- `title` 只在 **content 模式**生效（写进 `raw_source.title`）；**url 模式下客户端传的 `title` 被完全忽略**
  （`source_type`、`origin_uri` 同样被忽略），标题以抓到的页面标题为准。脚本会在 stderr 报 `[warn] IGNORED_FIELDS`——
  看到就别跟用户说「按你给的标题存好了」。
- **`title` 不参与去重哈希**。所以「内容一样、只改个标题」重新提交会被去重挡下，**新标题静默丢失**
  （raw_source 不可变，冲突直接 DO NOTHING，永不 UPDATE）。用户想改标题**不能靠重新提交**，
  如实告诉他去 https://mera.doubaoya.com 改。

### 4.6 写入的内容边界

- 用户说什么就记什么，**别替他润色 / 结构化 / 缩写**。第二大脑要的是原话，抽取由 Mera 后端做。
- 用户给的是链接 → 传 `url`，别自己先抓网页再传正文（除非用户就是要幂等，见 4.4）。
- 一次说了好几件事 → 可以当一条整体记（Mera 会拆事实）；只有明确是**互不相干的几件事**才分多次 `remember`。

---

## 5. 读取剧本：`search` 和 `ask` 分工

**一句话判据：要素材、要看原文 → `search`；要结论 → `ask`。**

| 用户意图 | 走哪个 | 理由 |
|---------|--------|------|
| 「关于 X 我有哪些素材」「我之前是不是记过这个」「把原话找出来」 | `search` | 要的是原文片段，自己读、自己挑 |
| 「我对 X 怎么看」「我当时为什么这么决定」「总结一下我在 X 上的想法」 | `ask` | 要的是被综合过的结论 + 出处 |
| 要拿笔记当写作素材 | 先 `search` 拿原文，再自己组织 | 素材要保真 |

### 5.1 `search`

返回 `results[]`，每条含 `title`、`source_type`、`media_type`、`created_at`、`snippet`、`score`、
`chunk_id`、`char_start`、`char_end`。

- 按 `score` 排，展示时带上 `title` + `created_at`（用户认「我什么时候记的」）。
- `snippet` 是原文片段，**照原样引**，别改写成自己的话再当成用户说过的。
- 0 条 → 如实说「你的笔记里没搜到这个」，可建议换个词再搜。**绝不编内容填空。**
- **没有分页。** 接口只收 `q`，条数是服务端定死的（**一次最多 20 个来源**），返回里没有 cursor / total / next。
  别去试 `page` / `limit` / `top_k` 这类参数——不存在。要更多就**换个关键词再搜一次**，
  用户要「全部」时也如实说明「一次最多给 20 个来源」。

### 5.2 `ask`

返回 `answer` + `has_evidence` + `evidence_level` + `evidence{grade, grounded_count, reference_count, note}` + `citations[]`
+ `conversation_id` + `message_id`。

**`evidence_level` 只有三个值，判据照这张表，别自己发挥**：

| `grounded_count` / `reference_count` | `evidence_level` | `evidence.grade` | 怎么说 |
|---|---|---|---|
| 0 / 0 | `none` | 待核实 | **没有支撑**：明说「你的笔记里没有能支撑这个问题的内容」 |
| 0 / >0 | `reference` | 待核实 | **有原文参考、无事实级锚定**：可以答，但要说「这是从你几条笔记里读出来的印象，没有硬结论」 |
| >0 / 0 | `grounded` | 确证 | 有事实锚定，正常答 + 出处 |
| >0 / >0 | `grounded` | 部分未核验 | 正常答 + 出处，可提一句「有一部分只是参考、没核验」 |

- `evidence_level === "none"` ⟺ `has_evidence === false` ⟺ `citations` 为空 —— 这三个恒等价，
  是**唯一**正确的「完全没碰到你的笔记」判据。
- ❌ **别拿 `evidence.grade === "待核实"` 当无支撑判据**：`reference` 级也是这个 grade，那是真检索到用户原文的。
- 想表达「没有事实级锚定」，用 `evidence.grounded_count === 0`。

**呈现规则（硬）**：

1. 先看脚本有没有给 `no_evidence: true`（`evidence_level === "none"` 时脚本会加它，把那句英文占位符换成中文，
   并把上游原句逐字留在 `answer_upstream`——**那是排查用的原件，不转述给用户**）。
   有 → 照 `answer_notice` 说人话，**绝不把英文原句转述给用户**，然后再决定要不要用你自己的常识补一句
   （补了必须标明「这是我的判断，不是你笔记里的内容」），也可以建议他换个问法、或者先记一条再来问。
2. 没有 → 给 `answer`，并且**一定要连出处一起给**：从 `citations[]` 里取 `raw_source.title`
   （没有标题就用 `origin_uri`），列成「依据：《…》《…》」。`kind` 为 `grounded` 的是硬证据，
   `reference` 的是弱参考——两者都出现时要区分开。
3. **禁止编造 citation**：没有的 `title` 不许补，`citations` 为空就说没有出处。
4. 多轮追问同一个话题时，把上一轮返回的 `conversation_id` 带进下一次 `ask`，保住上下文。
5. 想更全的召回可以调大 `top_k`（**上限 50**，不传就用服务端默认），别盲目往大了调。
6. 计费：`ask` 每次 **1 点**，`note-write` / `note-status` / `note-search` / `self` **不计点**。
   所以能用 `search` 解决的别硬上 `ask`，也别为了「保险」把同一个问题问两遍。

---

## 6. `self`：给回答定调，别每轮都调

`self` 返回的真实形状（别按脑补的结构去取）：

```jsonc
{
  "core": {
    "persona_core": {                 // ⚠️ 可能是 null
      "compiled_self": "……"           // ⚠️ 一整段中文 markdown 字符串，不是结构化对象
    },
    "current_version_no": 3,          // number | null
    "versions": [ { "id": "…", "version_no": 3, "change_reason": "…", "recorded_at": "…" } ]
  },
  "memories": [
    { "id": "…", "statement": "…", "kind": "…", "memory_type": "…", "recorded_at": "…", "source": { } }
  ]
}
```

**`persona_core` 为 `null` 是正常状态**（用户从没跑过整理，这时是 200 不是 404）。脚本会在 stderr 报
`[warn] NO_PERSONA_CORE`。这时**绝不许脑补用户是什么样的人**——如实说「你在 Mera 里还没有内核，
去 https://mera.doubaoya.com 跑一次整理再来」，这一轮就先只用 `memories` 里的关键记忆。

**`compiled_self` 整段当上下文读，禁止按固定小节 split。** 它约定含 6 个 H2
（身份锚点 / 决策与思考方式 / 原则与偏好 / 关系与角色 / 当前关注与在推进 / 表达风格），
但那只是给模型的 prompt 约束、**代码零校验**，生成失败会走确定性兜底，不保证这 6 节都在。
按小节切会在兜底那天整段取空。

`memories[]` 的取值域是归一化过的，**永不为 null、永不越界**：

- `kind` ∈ `factual` / `style` / `relational`
- `memory_type` ∈ `fact` / `preference` / `relation` / `project` / `material`

**什么时候调**：

- 用户问「你了解我吗」「我是个什么样的人」「我的风格是什么」。
- 用户要求「按我的风格写」「用我的口吻」「像我会做的决定那样判断」。
- 一段需要贴合本人的长任务**开头**取一次，用来定调。

**什么时候不调**：

- ❌ 每轮都调。取一次就够，**在同一段对话里复用**，别反复打接口。
- ❌ 用户只是要记一条东西 / 只是要搜个素材——那用不着人格内核。

**怎么用**：`core.persona_core.compiled_self` 整段读进来定语气和判断偏好，`memories[].statement` 是用户本人的关键事实——
引用时可以带上 `recorded_at`（「你在 X 月说过…」），但**别把内核原文整段倒给用户看**，那是给你定调用的。

---

## 7. 典型回合（端到端）

**用户**：「帮我记一下：跟老王聊完，决定先做单机版再联网，下周三前把方案发他。」

1. 判断意图 = 写入 → 直接 `remember`（原话进，不润色）：
   ```bash
   node scripts/mera.mjs remember '{"content":"跟老王聊完，决定先做单机版再联网，下周三前把方案发他。"}'
   ```
2. 看退出码 + `remember_result`。拿到 `done` 和 `disposition`。
3. 交付：
   ```
   记下了 ✅ 识别到「老王 / 单机版方案」两个实体，抽出 2 条事实、1 条待办（下周三前把方案发老王）。
   ```

**用户**（几天后）：「我之前跟老王到底怎么定的？」

1. 要结论 → `ask`：
   ```bash
   node scripts/mera.mjs ask '{"query_text":"我和老王关于产品方案是怎么定的"}'
   ```
2. `has_evidence=true` → 给 `answer`，附「依据：《2026-07-27 的一条笔记》」。
3. 用户接着说「把原话给我看看」→ 转 `search`，把 `snippet` 原样贴出来。

---

## 8. 错误码对照表

脚本把错误以 `[error] code: message` 打到 stderr 并以退出码 1 结束。常见 `code`：

| code | 含义 | 应对 |
| ---- | ---- | ---- |
| `MISSING_API_KEY`（脚本本地） | 环境变量没设 | 带用户走 §2 拿钥匙四步。**不要回显密钥**。 |
| `UNAUTHORIZED`（401） | 密钥无效 / 已撤销 | 提醒用户去 doubaoya.com → 密钥中心 重新生成并 `export`。**不要回显密钥**。 |
| `VALIDATION_ERROR`（400） | 入参不合法 | 看 `message` 修：`content`/`url` 是不是都空了、`query_text` 是不是漏了、`top_k` 是不是超了 50、`ingestion_id` 对不对。 |
| `INSUFFICIENT_CREDITS` / `NO_CREDIT_ACCOUNT`（402） | 额度不足 / 没有额度账户 | 提醒用户到 doubaoya.com 查看 / 补充额度。 |
| `FORBIDDEN`（403） | 没有这个能力的权限 | 如实转告，别重试。 |
| `ENDPOINT_NOT_FOUND` / `NOT_FOUND`（404） | 接口路径不对 / 对象不存在 | 一般是脚本被改动或 `ingestion_id` 写错，核对后重试。 |
| `RATE_LIMITED`（429） | 调太快了 | 等一会儿再来，**别原地狂重试**。 |
| `PROVIDER_FAILED`（502） | 上游临时失败 | **额度自动退回，可安全重试**。重试会不会存两份见 §4.4（content 模式不会，url 模式不保证）。重试一两次仍失败再告知用户。 |
| `CAPABILITY_UNAVAILABLE`（503） | 这个部署没配 Mera | 如实告诉用户「当前服务没开通第二大脑」，**别重试**。 |
| `NETWORK_ERROR`（脚本本地） | 连不上 doubaoya.com | 检查网络后重试。 |
| `BAD_RESPONSE`（脚本本地） | 返回不是合法 JSON | 稍后重试；持续出现就告诉用户服务端异常。 |
| `INGESTION_FAILED`（脚本本地） | 写入进了队列但处理失败（`status=failed`） | **必须明说**：`status` 里的 `error` 是一句以 stage 名开头的字符串（如 `chunk: produced no chunks for raw_source 0a9b… (empty content?)`），可以直接转告用户，再问要不要重试 / 改用粘正文。 |
| 其它没见过的 code | 未在本表中 | 把 `message` 如实转告用户，**不要自己编解释、不要重试到死**。 |

---

## 9. 边界与容错

- **写入没确认就是没确认。** `pending` 不是成功，也不是失败——就照实说「已入队、还没确认」。
- **检索 0 条**：如实说没搜到，可建议换词或换 `search`/`ask`。**绝不编内容。**
- **字段缺失**：Mera 的返回字段可能缺（如没有 `disposition`、没有 `citations`），
  一律「取不到就跳过这句」，别让缺字段搞崩整段汇报，也别把 `undefined` 打给用户。
- **别越权改用户的大脑**：本 Skill 只有写入和读取，**没有删除 / 修改**能力（第一版有意如此）。
  用户说「把那条删了」「把标题改一下」→ 如实告诉他要去 https://mera.doubaoya.com 自己操作，
  **别想着用「重新提交一次」来改标题**（见 §4.5，那样只会被去重挡下、新标题静默丢失）。
- **超长内容**：一次 `remember` 传很长的正文 / 抓一个大网页，10 秒常常不够，
  会落到 `pending`。这时可以把 `MERA_POLL_BACKOFF_MS` 调长（如 `2000,4000,8000,15000`）再来一次 `status` 复查，
  别当成失败。

---

## 10. 目录结构

```
mera/
├── SKILL.md              # 本文件：触发词 / 写入收条剧本 / search vs ask / 红线
├── README.md             # 给人看的介绍与安装
├── LICENSE
└── scripts/
    ├── mera.mjs          # 零依赖客户端（Node 18+）
    └── selfcheck.mjs     # 自检：起本地假网关 + spawn 真脚本，断言 stdout/stderr/退出码
```

自检随时可跑（不需要密钥、不联网）：

```bash
node scripts/selfcheck.mjs
```

---

## 11. 常见问答

**Q：密钥怎么拿？**
A：[doubaoya.com](https://doubaoya.com) 登录 → 密钥中心 → 生成密钥，复制 `dyh_…`，
`export DOUBAOYA_API_KEY="dyh_…"`。这条密钥同时决定连到**谁的**第二大脑——是用户自己的。

**Q：`write` 和 `remember` 到底用哪个？**
A：**用 `remember`**。`write` 只在你已经明确要自己控制轮询节奏时才用（比如批量写一堆、想先全部投递再统一查状态）。

**Q：写完为什么没马上能搜到？**
A：写入是异步的，要过解析 / 抽取几道工序。拿到 `status=done` 才算真进去了。`pending` 时隔十几秒 `status` 复查一次。

**Q：`ask` 说没证据，我该怎么回？**
A：先明说「你的笔记里没有能支撑这个问题的内容」，再决定要不要用你自己的常识补一句——但**必须标明那是你的判断**。
绝不能把自己的推理伪装成用户笔记里的内容。判据只认 `evidence_level === "none"`，别用 `grade`。

**Q：`ask` 怎么回了一句英文？**
A：那是 `evidence_level === "none"` 时 Mera 的硬编码占位符，不是回答。脚本已经替换成中文并打了
`no_evidence: true`——**照中文说，别把英文原句转出去**。

**Q：同一条记两遍会存两份吗？**
A：贴正文（content）不会；存链接（url）**不保证**——去重按抓回来的正文算，网页有动态内容就会多存一条。详见 §4.4。

**Q：`self` 返回的 `persona_core` 是 null？**
A：说明用户从没在 Mera 里跑过整理。**别脑补他是什么样的人**，如实请他去 https://mera.doubaoya.com 跑一次，
这一轮先只用 `memories`。

**Q：能删笔记吗？**
A：不能。本 Skill 只写入和读取，删改请用户去 https://mera.doubaoya.com 操作。

**Q：报 502 `PROVIDER_FAILED`？**
A：上游临时抖动，额度已自动退回，直接重试即可。
