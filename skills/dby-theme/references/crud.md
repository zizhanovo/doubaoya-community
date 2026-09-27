# 命令表：服务端主题 CRUD + 渲染

> 要查某条主题命令的参数 / 返回 / 报错码时读它。

鉴权、凭证与报错码的通用说明在 `dby-gateway/references/protocol.md`；本节只列本 skill 用到的主题命令。
所有命令加 `--json` 得到 `{ ok, data }` 信封，下表「返回」列指 `data` 里的内容。

| dby 命令 | 做什么 | 返回里要看的字段 |
|---|---|---|
| `dby wechat theme-get` | 读我当前的默认主题 | `theme`：默认主题行，没有时为 `null` |
| `dby wechat theme-list` | 列我的主题 + 内置主题目录 | `themes`（我的全部主题行）、`builtin`（内置主题） |
| `dby preview --file a.md --theme-file t.json [--title T]` | Markdown→公众号 HTML + 375px 预览页（**免费,不扣点**） | 落盘的两个文件路径、`warnings` |
| `dby render --file a.md [--theme <id>\|--theme-file t.json]` | 只出 HTML 文件，不出预览页 | 同上 |
| `dby wechat theme-add --file t.json [--name N] [--default]` | 新建主题；`--default` 置为默认 | `theme`：新建行 |
| `dby wechat theme-update <id> --file body.json` | 改已有主题（仅本人的），body 形如 `{ "themeJson": {…}, "isDefault": true, "name": "…" }` | `theme`：更新行 |
| `dby wechat theme-rm <id> --confirm` | 删主题（仅本人的,⚠️ 见下）；不带 `--confirm` 只停在确认态 | `deleted:true`、`id` |

要点:
- **主题行字段**:`{ id, userId, name, themeJson, isDefault, createdAt, updatedAt }`（`themeJson` 就是那份 JSON）。
- **渲染的主题优先级**:`--theme-file`(传了就用这份) > `--theme` > 我的默认主题 > 兜底 `benya-clean`。所以**预览编辑中的主题就用 `--theme-file`**。
- **一人一默认**:设默认时服务端在事务里把我其他主题的默认标记取消,保证只有一份默认。
- **name 缺省** = `"我的主题"`；**theme-update 只更传了的字段**（`themeJson`/`name`/`isDefault` 按需）。
- **校验在服务端**：`preview` / `render` / `theme-add` / `theme-update` 遇到不合法主题都返回 400（`UNSAFE_THEME` / `VALIDATION_ERROR` / `THEME_TOO_LARGE`）并列出问题；主题 id 不存在返回 400 `UNKNOWN_THEME`。

⚠️ **theme-rm 无历史版本可找回。** 删之前先 `dby wechat theme-get` 确认要删的 id 不是当前默认主题
（`isDefault:true`）——删掉默认主题后，未钉主题的渲染/发文会静默回退到内置 `benya-clean`，
且服务端不保留被删主题的任何副本。不确定就先按红线 4 落盘备份再删。
