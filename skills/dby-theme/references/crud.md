# 契约：服务端主题 CRUD + 渲染

> 要自己拼 curl、查某条主题路由的请求体 / 返回 / 报错码时读它。

⚠️ 先读 `dby-gateway/references/protocol.md` 再发请求（鉴权、密钥怎么拿、
信封与报错码全在那一份，本文件不再复述）。本节只列本 skill 自己的那几条主题路由。

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
BASE="${DOUBAOYA_BASE_URL:-https://doubaoya.com}"
AUTH="Authorization: Bearer $DOUBAOYA_API_KEY"
```

| 方法 & 路径 | 请求体 | 成功 `data` | 用途 |
|---|---|---|---|
| `GET /api/wechat/theme` | — | `{ theme: <我的默认主题行> \| null }` | 读我当前的默认主题 |
| `GET /api/wechat/themes` | — | `{ themes: [<我的全部主题行>], builtin: [<内置主题>] }` | 列我的主题 + 内置主题目录 |
| `POST /api/wechat/render` | `{ markdown, title?, themeId?, themeJson? }` | `{ html, themeSource, warnings? }` | Markdown→公众号 HTML(**免费,不扣点**) |
| `POST /api/wechat/theme` | `{ name?, themeJson, isDefault? }` | `{ theme: <新建行> }`（HTTP 201） | 新建主题;`isDefault:true` 置为默认 |
| `PUT /api/wechat/theme/:id` | `{ name?, themeJson?, isDefault? }` | `{ theme: <更新行> }` | 改已有主题(仅本人的) |
| `DELETE /api/wechat/theme/:id` | — | `{ deleted:true, id }` | 删主题(仅本人的,⚠️ 见下) |

要点（都来自真实代码）:
- **主题行字段**:`{ id, userId, name, themeJson, isDefault, createdAt, updatedAt }`（`themeJson` 就是那份 JSON）。
- **render 主题解析优先级**:`themeJson`(传了就用这份) > `themeId` > 我的默认主题 > 兜底 `benya-clean`。所以**预览编辑中的主题就传 `themeJson`**。
- **一人一默认**:`isDefault:true` 时服务端在事务里把我其他主题的 `isDefault` 置反,保证只有一份默认。
- **name 缺省** = `"我的主题"`；**PUT 只更传了的字段**（`themeJson`/`name`/`isDefault` 按需）。
- `themeId` 非法 → 400 `UNKNOWN_THEME`；`themeJson` 不合法 → 400 `UNSAFE_THEME`/`VALIDATION_ERROR`/`THEME_TOO_LARGE`。

⚠️ **DELETE 无历史版本可找回。** 删之前先 `GET /api/wechat/theme` 确认要删的 id 不是当前默认主题
（`isDefault:true`）——删掉默认主题后，未钉主题的渲染/发文会静默回退到内置 `benya-clean`，
且服务端不保留被删主题的任何副本。不确定就先按红线 4 落盘备份再删。

---

