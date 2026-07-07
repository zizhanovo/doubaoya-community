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
| `mdTheme` | Markdown→HTML 渲染主题标记（当前内置渲染器为中性主题，仅作占位；想要更花的排版可自行预渲染后用 `--html` 喂进来）。 | `"default"` |
| `draftsDir` | 本地草稿/产物目录（可选，供你归档渲染出的 HTML）。`""` = 用临时目录。 | `"./drafts"` |

> 提醒：`config.json` 属于你个人，**不要**提交到公共仓库。仓库里只保留 `config.example.json`（全空/占位）。
