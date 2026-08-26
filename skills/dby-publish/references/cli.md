# CLI 用法（五个场景 + 全部参数）

> 要指定账号 / 公众号 / 本地封面 / 摘要，或要用 `--dry-run`、`--render-only` 的完整写法时读它。

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

# E. 带本地封面与配图（图先用 dby-image 出好；配图以 <img src=本地路径> 落进 a.md 正文）
node scripts/pipeline.mjs --md a.md --title "标题" --cover ./cover.jpg
```

参数：`--md | --html`（二选一）、`--title`（必填）、`--account`、`--appid`、`--cover`（本地 jpeg/png，>1MB 自动压成 jpg）、`--digest`、
`--config`、`--profile`、`--theme <id> | <path> | neutral | default`、`--output-processed-html`、`--base-url`、`--render-only`、`--dry-run`、`--help`。

`--theme` 的两种写法**去处不同**：

- **裸 id**（`benya-clean`、`dark-tech`）→ 本机不读文件，送 `themeId` 交服务端解析，
  与**不写 `--theme`** 时是同一份真相。可用 id 见 `GET /api/wechat/themes`；未知 id
  服务端返 400 并列出来。服务端有 19 个公开主题，包内只有 15 个镜像，**那 4 个只能靠裸 id 拿到**。
- **路径**（含 `/` 或 `.json`）→ 读本机文件、本机先校验、整套作为 `themeJson` 送出。
  自定义主题走这条。
  ⚠️ 指到**包内** `themes/` 的路径是服务端同名主题的旧副本（engine-1，实测 `benya-clean`
  包内 4282 字节 vs 服务端 8471 字节、diff 152 行）⇒ 排版会与账号默认不一致。
  这种写法仍然可用但会告警，改用裸 id 即可。
本机多条 key 对应不同账号时，账号校验会停下要 `--account`，按报错列出的账号补上。

**微信 draft/add 字段上限**（脚本在渲染 / 传图之前就拦，`scripts/lib/draft-limits.mjs`）：
`--title` ≤ 32 字（官方接口文档口径；后台编辑器放宽到 64 字符，32–64 只警告，>64 拒绝）；
`--digest` ≤ 120 字，仅单图文有摘要，不传则微信默认抓正文前 54 字；正文 HTML 少于 2 万字符且小于 1MB；
正文图 jpg/png 且 <1MB（超了本包自动压）。封面在微信侧是永久素材 `thumb_media_id`，
后台会按 2.35:1（列表）与 1:1（转发卡片，取正中）两种比例裁。

> **只存草稿**：本流水线**没有**任何群发参数。传 `--mass-send`/`--broadcast`/带「群发」字样的 flag 会被**直接拒绝**。

