# Mera · 第二大脑 Skill

> 随口说一句就记进自己的笔记，问一句就从自己的笔记里带着出处捞出来。

这是一个 **Agent Skill**：把它装进你的 AI 助手（Claude Code / Codex 等），配上一条
`DOUBAOYA_API_KEY`，agent 就能连到**你自己的** [Mera 第二大脑](https://mera.doubaoya.com)——
你说人话，它负责写进去、查出来。

其它技能是往外看（全网在爆什么），这一个是往里看：**你说过的、想过的、存过的，都还找得回来。**

## 能干啥

- **记** —— 「帮我记一下」「把这个链接存了」，一句话进第二大脑；写完给你收条（识别到哪些实体、抽出几条事实 / 待办）
- **搜** —— 「我之前是不是说过 X」「关于 X 我有哪些素材」，混合检索，返回**原文片段**
- **问** —— 「我对 X 怎么看」「我当时为什么这么决定」，基于你自己的笔记给结论，**并附出处**
- **懂你** —— 「我是个什么样的人」「按我的风格写」，读人格内核给回答定调

## 先拿钥匙（密钥）

1. 打开 https://doubaoya.com → **登录**
2. 进 **密钥中心** → **生成密钥**
3. 整条密钥只在生成那一下完整露脸，复制收好（形如 `dyh_…`）
4. 设进环境变量：`export DOUBAOYA_API_KEY="dyh_你的密钥"`

> 这条密钥同时决定连到**谁的**第二大脑——是你自己的。agent **绝不会把整条 key 回显出来**。

## 装好就用

装进 agent 后直接说人话：

> 帮我记一下：跟老王聊完，决定先做单机版再联网，下周三前把方案发他。

> 我之前跟老王到底是怎么定的？

## 自己动手试一下（可选）

零依赖（Node 18+），不用装任何包：

```bash
export DOUBAOYA_API_KEY=dyh_你的密钥

node scripts/mera.mjs remember '{"content":"今天想到一个点子：把选题库和第二大脑打通"}'
node scripts/mera.mjs search   "选题库"
node scripts/mera.mjs ask      '{"query_text":"我对远程办公是什么态度"}'
node scripts/mera.mjs self
```

自检（不需要密钥、不联网，起本地假网关跑一遍契约）：

```bash
node scripts/selfcheck.mjs
```

## 三条要紧的

1. **写入是异步的**，所以一律用 `remember`（它替你轮询到终态）。没拿到 `done` 之前，agent 不许说「已保存」。
2. **不编造来源**：`ask` 的结论必须带 `citations` 里的出处；没证据就明说「你的笔记里没有支撑」。
3. **隐私**：第二大脑里是你的私人内容，agent 不会把它外传到别的服务。

完整行为规则、错误码、端到端剧本见 [`SKILL.md`](./SKILL.md)。

## License

MIT —— 见 [LICENSE](./LICENSE)。
