# CLI 用法（六个场景 + 全部参数）

> 要指定账号 / 公众号 / 本地封面 / 摘要，或要用 `--design`、`--dry-run` 的完整写法时读它。

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"   # 或放 ~/.doubaoya/key、Keychain（account-verify 会找）

# A. 从 Markdown 开始（渲染 → 传图 → 存草稿）
node scripts/pipeline.mjs --md article.md --title "标题" --config ./config.json

# B. 已有排好版的 HTML，直接发
node scripts/pipeline.mjs --html article.html --title "标题"

# C. 指定账号 + 公众号 + 本地封面 + 摘要
node scripts/pipeline.mjs --md a.md --title "标题" \
  --account you@example.com --appid wx0123... --cover cover.png --digest "本期摘要"

# D. 干跑：只渲染+校验+扫描本地图，什么都不发（要密钥 + 已绑号）
node scripts/pipeline.mjs --md a.md --title "标题" --dry-run

# D'. 只渲染拿在线预览链接：跳过草稿前置检查，要密钥、不要绑号
node scripts/pipeline.mjs --md a.md --title "标题" --render-only

# E. 起可视化设计工作台选主题/封面/配图 → 产出 design-config.json（见「用设计工作台」）
node scripts/design-studio.mjs --md a.md --title "标题"           # 网页里点完「保存配置」

# F. 用设计工作台产出的 design-config 跑流水线（套主题 + 设封面 + 按 h2 锚点注入配图）
node scripts/pipeline.mjs --md a.md --title "标题" --design a.design.json --dry-run
```

参数：`--md | --html`（二选一）、`--title`（必填）、`--account`、`--appid`、`--cover`（本地 jpeg/png，>1MB 自动压成 jpg）、`--digest`、
`--config`、`--profile`、`--theme <path> | neutral`、`--design`、`--output-processed-html`、`--base-url`、`--render-only`、`--dry-run`、`--help`。
本机多条 key 对应不同账号时，账号校验会停下要 `--account`，按报错列出的账号补上。

> **只存草稿**：本流水线**没有**任何群发参数。传 `--mass-send`/`--broadcast`/带「群发」字样的 flag 会被**直接拒绝**。

