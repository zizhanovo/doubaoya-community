# 组合结构（不重复造轮子）

> 只在要弄清哪个脚本干哪件事、或想不走 `pipeline.mjs` 自己组合时读它。

`scripts/pipeline.mjs` 是编排者，它组合三个零依赖模块：

| 阶段 | 模块 | 说明 |
|------|------|------|
| 账号解析 | `scripts/account-verify.mjs` | `resolveAccountKey({account, baseUrl})`：多来源（env / `~/.doubaoya` / Keychain）候选 → 逐个 whoami → 按目标账号挑对 key，key 只在内存。多 key 指向不同账号且未指定 `--account` 时，报出各 key 对应账号并停。 |
| md→公众号 HTML | **平台** `POST /api/wechat/render` | `renderViaPlatform({baseUrl,apiKey,markdown,themeJson,themeId})`（在 `pipeline.mjs` 内）：免费不扣点，主题由服务端套，返回 `{html, themeSource, warnings, detailUrl}`。**失败抛错，调用方中止，绝不回退本机渲染器**。 |
| md→公众号 HTML（本机，已退出主干） | `scripts/render-wechat-html.mjs` | `renderWechatHtml(md,{title,theme})`：零依赖内联样式渲染，**原样保留图片 src**。只服务设计工作台与「无密钥先看排版」，**不产生在线预览链接**。 |
| 封面/配图生图 | `scripts/gen-image.mjs` | `generateImage({prompt,size,out,styleId,coverGuard,referenceImage})`：零依赖，是能力 `skill.ai.imageGen`（详情端点 `GET /api/skills/gpt-image-gen`）的薄壳，同步返回、计费。传 `referenceImage`（本地路径/URL/`data:`/裸 base64，CLI `--reference-image`）时走 `operation:"edit"` 条件化，**保留参考图里的 IP 形象**；不传则文生图。另导出 `resolveReferenceImage(ref)`（本地图 → `data:` URL 小工具）。风格库 `assets/styles/index.json`，用 env `DOUBAOYA_API_KEY`（无需额外密钥）。产出本地 jpeg → 喂 `--cover` 或以 `<img src>` 落进正文，**不碰发布契约**。由 agent 在引导式设计里调用（不由 pipeline.mjs 机械触发）。 |
| 配图自动布局 | `scripts/plan-figures.mjs` | `planFigures(markdown,{maxFigures,minChars})` → `{figures[],meta}`：**确定性规则**（不接 LLM）决定在哪些 h2 小节末尾配图 + 画面建议。按小节有效字数过阈值（默认 160）挑，张数按总字数分档（<1800→3、1800–3000→4、>3000→5）封顶。CLI `node plan-figures.mjs --md <文章> [--max-figures N] [--min-chars N] [--json]`。工作台「自动配图」调它，产出直接填 `design-config.images[]`（`afterHeading` 锚点），由现有 pipeline 注入逻辑消费，**不改发布链路**。 |
| 传图 + 存草稿 | `scripts/preprocess-and-publish.mjs` | 本地图预上传 + >1MB 压缩 + 存草稿（draft/add，无群发）。无本地图/无本地封面场景可换更轻的 `scripts/publish_draft.py`（Python，见[只想存草稿、不要排版](./draft-only.md)）。 |

编排者把这三步串起来，并加上身份上下文加载、前置检查、硬门与结构化回报。
