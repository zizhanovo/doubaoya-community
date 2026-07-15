# config.json 字段说明

把 `config.example.json` 复制成 `config.json`，填上**你自己**的值再用。所有值都是你的，仓库里不带任何个人信息。

```bash
cp config.example.json config.json
# 然后编辑 config.json
```

`null` 表示「自动探测」——留 `null` 时流水线会自己去问服务端（例如只绑定了一个公众号时自动选中它）。

| 键 | 含义 | 示例 |
|----|------|------|
| `targetAccount` | 目标 doubaoya.com 登录账号（邮箱或手机号）。用于在本机有多条 key 时挑出正确的那条。`null` = 若本机所有有效 key 都指向同一账号则自动选中；指向不同账号则报错要你指定。 | `"you@example.com"` |
| `publicAccountName` | 目标公众号昵称。填了会在前置检查里断言 `/api/wechat/status` 返回的昵称与它一致，不一致就告警——防止发错公众号。`null` = 不校验昵称。 | `"我的公众号"` |
| `appid` | 目标公众号的 `authorizerAppid`。绑定了多个公众号时用它精确指定其一。`null` = 只绑定一个时自动选中。 | `"wx0123456789abcdef"` |
| `author` | 文章作者署名（供你写作/回报时参考，流水线不强制使用）。 | `"张三"` |
| `digestTemplate` | 摘要模板/默认摘要（未通过 `--digest` 指定时的兜底文案）。 | `"本期精选……"` |
| `coverDir` | 本地封面目录。未通过 `--cover` 指定封面时，可在这里放约定好的封面图。`""` = 不用本地封面。 | `"./covers"` |
| `coverFallback` | 无本地封面时的兜底策略标记，回报里会注明「走都爆鸭兜底」。 | `"doubaoya"` |
| `ipProfile` | IP/身份 profile 的路径（相对本 skill 目录）。流水线会加载并回显它的 `displayName / aliases / isNot`，防止把账号名误读成通用名词。见 `profiles/README.md`。 | `"profiles/my-ip.json"` |
| `ipImage` | 你的卡通 IP 形象图路径（相对本 skill 目录）。设计工作台/生图脚本会把它作为**参考图条件化**生成封面与配图，让全篇形象统一（走 `operation:"edit"` + `referenceImage`）。把图放进 `assets/ip/` 再指向它。`null` = 不注册 IP，封面/配图退回文生图。见 `assets/ip/README.md`。 | `"assets/ip/benya.png"` |
| `mdTheme` | Markdown→HTML 默认主题。项目默认 `themes/magazine.json`；相对路径按配置文件所在目录解析。CLI 的 `--theme` 优先；填 `"neutral"` 可显式退回中性渲染器。 | `"themes/magazine.json"` |
| `draftsDir` | 本地草稿/产物目录（可选，供你归档渲染出的 HTML）。`""` = 用临时目录。 | `"./drafts"` |
| `defaultStyleId` | 逃生舱默认风格 id（用户说「你全权定/我赶时间」时用它自动出图）。取值见 `assets/styles/index.json` 的 6 个 `id`。 | `"magazine-editorial"` |
| `coverAutogen` | 是否在引导式设计里默认 AI 生成封面。`false` = 不生封面，走 `--cover` 或都爆鸭兜底。 | `true` |
| `figureAutogen` | 是否在引导式设计里默认 AI 生成正文配图。`false` = 不自动配图。 | `true` |
| `generatedDir` | 生成图的本地暂存目录（相对本 skill 目录）。封面/配图 jpeg 落在这里，再喂 `--cover` 或以 `<img src>` 放进正文。 | `"assets/generated"` |

> **可视化设计工作台（可选）**：不想用命令行逐步选风格/生图，可起 `node scripts/design-studio.mjs --md <文章.md> --title "<标题>"`（本地 `127.0.0.1` 网页、零依赖），在页面里点完排版主题/封面/配图，「保存配置」产出一个 `design-config.json`（结构见 `schemas/design-config.schema.json`），再 `node scripts/pipeline.mjs --md … --title … --design <json>` 消费（套主题 + 设封面 + 按 h2 锚点注入配图）。`--design` 的主题/封面是默认值，显式 `--theme`/`--cover` 冲突时命令行优先并告警。生成的图落 design-config 同目录的 `.design/assets/`，与上面的字段无关，无需在 `config.json` 里配置。

> **生封面/配图无需额外密钥**：`scripts/gen-image.mjs` 直接用你发布本就在用的密钥 `DOUBAOYA_API_KEY`（Bearer）调 doubaoya.com 的生图接口、扣点数，上游生图密钥只在 doubaoya 服务端、skill 端不接触。密钥只放环境变量（`export DOUBAOYA_API_KEY=…`），绝不落配置/文件。

> 提醒：`config.json` 属于你个人，**不要**提交到公共仓库。仓库里只保留 `config.example.json`（全空/占位）。
