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
| `mdTheme` | Markdown→HTML 默认主题。`null` = 不送任何主题字段，由**服务端**套你在 doubaoya.com 排版工作室保存的默认排版。写成路径（如 `"themes/magazine.json"`）= 钉本机主题 JSON（先本机校验再整套送出；相对路径按配置文件所在目录解析）；写成裸 id（如 `"benya-clean"`）或 `"neutral"` = 送 `themeId` 交服务端解析（`neutral` 是平台的中性排版）。CLI 的 `--theme` 永远优先。细节与唯一事实源见 `references/rendering.md`「主题从哪来」。 | `null` |
| `draftsDir` | 本地草稿/产物目录（可选，供你归档渲染出的 HTML）。`""` = 用临时目录。 | `"./drafts"` |

> **生封面/配图不在本包，出图能力当前暂时下架**；未来是否恢复需重新评估，当前不承诺恢复时间。
> 不调用已下架能力或旧包，图片只能来自用户自备或 agent 自己的生图工具。出好图落成本地文件后，
> 封面走 `--cover <路径>`、配图以 `<img src=本地路径>` 落进正文，与 `config.json` 的字段无关。

> 提醒：`config.json` 属于你个人，**不要**提交到公共仓库。仓库里只保留 `config.example.json`（全空/占位）。

---

## 为什么这里比脚本少几个键

2026-08-22 对账：`coverAutogen` / `figureAutogen` / `generatedDir` 曾在这张表里，
**而脚本与 SKILL.md 都零读取** —— 用户写了它们只会得到沉默：不报错、不生效、没有任何现象。
已摘掉。2026-08-26 出图栈下线后，`ipImage` / `defaultStyleId` 的读者（design-studio / gen-image /
SKILL.md 的引导式设计）全部退场，同理摘掉。

🔴 **加配置项之前先想清楚谁读它。** 本包有**两类读者**：
- **脚本**（`scripts/*.mjs`、`publish_draft.py`）——grep 得到；
- **agent**（SKILL.md 教它去读的，例如 `defaultStyleId` 那条逃生舱）——grep 脚本**搜不到**。

⇒ 判一个键死没死，**两边都要查**。只查脚本会把 agent 读的键误判成死键
（当年就差点因此误删过 `defaultStyleId`——如今它是连 agent 侧读者也没了才摘的）。
