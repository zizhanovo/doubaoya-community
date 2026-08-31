# 组合结构（不重复造轮子）

> 只在要弄清哪个脚本干哪件事、或想不走 `pipeline.mjs` 自己组合时读它。

`scripts/pipeline.mjs` 是编排者，它组合三个零依赖模块：

| 阶段 | 模块 | 说明 |
|------|------|------|
| 账号解析 | `scripts/account-verify.mjs` | `resolveAccountKey({account, baseUrl})`：多来源（env / `~/.doubaoya` / Keychain）候选 → 逐个 whoami → 按目标账号挑对 key，key 只在内存。多 key 指向不同账号且未指定 `--account` 时，报出各 key 对应账号并停。 |
| md→公众号 HTML | **平台** `POST /api/wechat/render` | `renderViaPlatform({baseUrl,apiKey,markdown,themeJson,themeId})`（在 `pipeline.mjs` 内）：免费不扣点，主题由服务端套，返回 `{html, themeSource, warnings, detailUrl}`。**失败抛错，调用方中止，绝不回退本机渲染器**。 |
| md→公众号 HTML（本机，已退出主干） | `scripts/render-wechat-html.mjs` | `renderWechatHtml(md,{title,theme})`：零依赖内联样式渲染，**原样保留图片 src**。只服务「无密钥先看排版」，**不产生在线预览链接**。 |
| 封面/配图生图（**不在本包，也没有替代包**） | ⛔ 无 | 服务端 `skill.ai.imageGen` 因合规要求整体下架，dby-image 包同期退役。图片只能来自用户自备或 agent 自己的生图工具：落成本地文件后接回本包，封面喂 `--cover`，配图以 `<img src=本地路径>` 落进正文，**不碰发布契约**。 |
| 传图 + 存草稿 | `scripts/preprocess-and-publish.mjs` | 本地图预上传 + >1MB 压缩 + 存草稿（draft/add，无群发）。无本地图/无本地封面场景可换更轻的 `scripts/publish_draft.py`（Python，见[只想存草稿、不要排版](./draft-only.md)）。 |

编排者把这三步串起来，并加上身份上下文加载、前置检查、硬门与结构化回报。
