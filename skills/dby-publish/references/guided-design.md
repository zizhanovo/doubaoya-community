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
2. **封面** — AI 读文章提炼一个封面概念（主体 + 氛围），用选定风格生 1 张 `1536x1024`，展示给用户 →
   选 / 重生 / 自己传 / 用兜底。定了就设进 `--cover <本地jpeg>`。**封面必须加 `--cover-guard`**
   （把主体压在水平中带、上下留氛围背景，防公众号 2.35:1 居中裁切切掉关键内容）：
   ```bash
   node scripts/gen-image.mjs --prompt "<封面概念>" --style <风格id> --cover-guard \
     --size 1536x1024 --out <暂存目录>/cover.jpg
   ```
3. **配图** — 扫文章结构（一般每个 `##` 小标题下 1 张），提议张数与各自画面，逐张生成 `1024x1024`
   并以 `<img src=本地路径>` 落进 **Markdown 源**（不是渲染后的 HTML——放进源里才会被主题套上图注/圆角/间距）。
   ```bash
   node scripts/gen-image.mjs --prompt "<该段画面>" --style <风格id> \
     --size 1024x1024 --out <暂存目录>/fig1.jpg
   ```
   配图落进 Markdown 后**回到第 5 步重渲染**。这些本地图会被现有 `preprocess-and-publish.mjs` 走 `image` 上传，
   **无需改动任何发布链路**。
4. **排版** — 确认用哪套主题（见[主题从哪来](#主题从哪来)：默认就是用户在排版工作室保存的那套，
   服务端渲染时直接套；要换才用 `--theme <path>` / `config.mdTheme` 指一份本机主题 JSON；
   写主题见下方「复刻参考排版风格」）。

> `gen-image.mjs` 生成的本地 jpeg 路径，封面喂 `pipeline.mjs --cover`、配图以 `<img src>` 落进正文——
> 两者都不触碰微信侧发布契约。上游生图密钥只在 doubaoya 服务端，skill 端只用密钥。
