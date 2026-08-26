# 引导式设计的 4 步（选风格 / 封面 / 配图 / 排版）

> 第 6 步真要动手做视觉时读它。用户说「你全权定 / 我赶时间」就走逃生舱，不必读。

第 6 步——渲染前后完成视觉设计。**引导是默认**：在下面 4 处停下来问用户；**逃生舱**：用户若说
「封面配图你全权定 / 我赶时间」，就跳过所有停顿，用 `config.defaultStyleId` 自动出一版。
生图走能力 `skill.ai.imageGen`（详情端点 `GET /api/skills/gpt-image-gen`），**无需额外密钥**
（用发布本就在用的 `DOUBAOYA_API_KEY`）。想在对话里逐张生就用零依赖薄壳 `scripts/gen-image.mjs`，
缺密钥时它报清晰错误、不崩。**这一步花钱，动手前先问用户**（现价现拉，本文不写数字）。

1. **选风格** — 把 `assets/styles/index.json` 的 6 个风格（`name` + `id`）和各自样图 `assets/styles/<id>.jpg`
   列给用户挑（或用户说「你定」）。6 个起手风格：`杂志编辑风(magazine-editorial)`、`极简大字(minimal-bigtype)`、
   `真实摄影感(photo-real)`、`扁平插画(flat-illustration)`、`国潮中式(guochao-chinese)`、`商务信息图(biz-infographic)`。
2. **封面** — AI 读文章提炼一个封面概念（主体 + 氛围），用选定风格生 1 张宽幅横版，展示给用户 →
   选 / 重生 / 自己传 / 用兜底。定了就设进 `--cover <本地 jpeg/png>`。**封面必须加 `--cover-guard`**
   （它是唯一控制比例的东西：写入 16:9 宽幅并把主体压进**居中的正方形安全区**、四边留氛围背景——
   封面会被裁两次：消息列表按 2.35:1 裁掉上下，历史消息 / 转发卡片再从正中裁出 1:1，左右也没；
   900×383 里只有居中的 383×383 两处都能看见）。
   **`--size` 无效**，上游整个忽略它，比例只靠 `--cover-guard` / prompt：
   ```bash
   node scripts/gen-image.mjs --prompt "<封面概念>" --style <风格id> --cover-guard \
     --out <暂存目录>/cover.jpg
   ```
3. **配图** — 扫文章结构（一般每个 `##` 小标题下 1 张），提议张数与各自画面，逐张生成（不传比例默认出方图）
   并以 `<img src=本地路径>` 落进 **Markdown 源**（不是渲染后的 HTML——放进源里才会被主题套上图注/圆角/间距）。
   ```bash
   node scripts/gen-image.mjs --prompt "<该段画面>" --style <风格id> \
     --out <暂存目录>/fig1.jpg
   ```
   配图落进 Markdown 后**回到第 5 步重渲染**。这些本地图会被现有 `preprocess-and-publish.mjs` 走 `image` 上传，
   **无需改动任何发布链路**。
4. **排版** — 确认用哪套主题（见[主题从哪来](./rendering.md#主题从哪来)：默认就是用户在排版工作室保存的那套，
   服务端渲染时直接套；要换才用 `--theme <path>` / `config.mdTheme` 指一份本机主题 JSON；
   写主题见下方「复刻参考排版风格」）。

> `gen-image.mjs` 生成的本地 jpeg 路径，封面喂 `pipeline.mjs --cover`、配图以 `<img src>` 落进正文——
> 两者都不触碰微信侧发布契约。上游生图密钥只在 doubaoya 服务端，skill 端只用密钥。
