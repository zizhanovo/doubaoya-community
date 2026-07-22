---
name: wechat-theme-studio
description: >-
  公众号排版主题工作室 · 按你的口语描述改公众号文章的**默认排版样式**（配色 / 标题 / 引用 / 图注等），
  本地即时预览，最后**存回服务端**成为发文与网页排版工作室都读的那份默认主题。闭环:读当前主题 →
  改 themeJson → 本地校验 + 预览 → POST/PUT 存回服务端默认。走 doubaoya.com,鉴权用你自己的
  DOUBAOYA_API_KEY(Bearer)。当用户要改公众号排版、定制主题样式、换配色 / 换标题样式 / 调排版、
  「排版长得像 XX」、把默认排版改掉时使用。
  触发方式:/wechat-theme-studio、改公众号排版、定制主题样式、换公众号配色、调排版主题、改默认排版。
  Trigger: customize WeChat article theme, change layout/palette/heading style, restyle 公众号 typography,
  edit and save the default theme, /wechat-theme-studio.
version: 1.0.0
---

# 公众号排版主题工作室（都爆鸭）

帮用户把公众号文章的**排版样式**（配色 / 标题条 / 引用卡 / 图注 / 分割线…）按口语描述改成想要的样子，
本地即时预览，最后**存回服务端**成为「默认排版」——发文流水线和网页排版工作室都会自动套这份。

> 排版是一份声明式的 **`themeJson`**（配色 palette + 每个标签的 inline-style 模板）。渲染器按它把
> Markdown 确定性地渲成公众号内联样式 HTML。你（agent）的活是**按描述生成 / 修改合法的 themeJson**，
> 本地自检 + 预览，再把它**存回服务端**。

---

## ⚠️ 三条硬红线（先读，全程守住）

### 红线 1 · 微信兼容:标题装饰只能挂在有文字的元素自身

公众号编辑器会 **strip 掉「没有文字、纯靠 inline-block 宽高 + background 撑色块的空 `<section>`/`<span>`」**。
所以标题引导条 / 强调竖条 / 下划线这类装饰**必须作为 inline style 直接写在标题元素自身**，
**绝不**用独立的空装饰块（如在 h2 前塞一个空的 `<section style='width:32px;height:4px;background:…'>`——发到公众号会消失）。

- ✅ 对:`elements.h2.style` 里直接写 `border-left:4px solid {{accent}};border-bottom:1px solid {{border}};padding:0 0 8px 11px;`
  （竖条 + 发丝下划线长在 h2 身上,h2 有文字,编辑器保留）。
- ❌ 错:用 `wrapBefore` 注入一个空的 `<section>` 当色条（无文字 → 被 strip）。

### 红线 2 · 微信兼容:别给整篇套 `decorations.articleWrap` 外框

**不要**用 `decorations.articleWrap` 给整篇正文包一个浅底 + 圆角的卡片外框——公众号正文里它会变成一道**突兀的边框**。
`articleWrap.before` / `after` 留空字符串。想要「呼吸感」用段间距（`margin` / `line-height`）和局部卡片（如 blockquote 圆角卡）实现。

### 红线 3 · 安全:themeJson 会内联进公众号草稿,服务端会拒收不合法主题

`themeJson` 用户可控、会内联进最终 HTML,所以服务端 `POST/PUT/render` 都会 `validateTheme`,不过直接 **400**。
生成的主题**必须**满足（详见 [`scripts/validate-theme.mjs`](./scripts/validate-theme.mjs) 与下文 schema）:

- top-level 只允许 `meta` / `palette` / `page` / `elements` / `decorations` / `components`,其余键 = 硬错。
- `palette` 值必须像颜色（`#hex` / `rgb()` / `hsl()` / 具名色 / `{{token}}`）。8 个标准键:`text heading accent accent2 muted bgSoft border link`。
- `page` 键:`fontFamily fontSize lineHeight letterSpacing color`,值都是字符串。
- `elements.<tag>.style` 是 inline CSS,**不能含 `<` 或 `>`**（markup 放 `wrapBefore`/`wrapAfter`/`hr.html`）。
- **六条硬红线**:任何字符串都不得出现 `<script` / `<style` / `class=` / `src=` / `javascript:` / `onX=`（如 `onclick=`）。
- 整个 themeJson **≤ 64KB**。

> **生成后务必先本地自检**（见 §3），过了再往服务端提交,省一次 400 往返。

---

## 契约:服务端主题 CRUD + 渲染（以 doubaoya.com 主仓 render-routes.ts 为准）

所有请求都用你自己的密钥走 **Bearer** 鉴权（也支持登录 cookie 会话）。基址默认 `https://doubaoya.com`
（可用 `DOUBAOYA_BASE_URL` 覆盖）。响应统一信封:`{ success, requestId, data, error }`——成功读 `data`,失败读 `error.{code,message}`。

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"   # doubaoya.com → 登录 → 密钥中心 → 生成
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
| `DELETE /api/wechat/theme/:id` | — | `{ deleted:true, id }` | 删主题(仅本人的) |

要点（都来自真实代码）:
- **主题行字段**:`{ id, userId, name, themeJson, isDefault, createdAt, updatedAt }`（`themeJson` 就是那份 JSON）。
- **render 主题解析优先级**:`themeJson`(传了就用这份) > `themeId` > 我的默认主题 > 兜底 `benya-clean`。所以**预览编辑中的主题就传 `themeJson`**。
- **一人一默认**:`isDefault:true` 时服务端在事务里把我其他主题的 `isDefault` 置反,保证只有一份默认。
- **name 缺省** = `"我的主题"`；**PUT 只更传了的字段**（`themeJson`/`name`/`isDefault` 按需）。
- `themeId` 非法 → 400 `UNKNOWN_THEME`；`themeJson` 不合法 → 400 `UNSAFE_THEME`/`VALIDATION_ERROR`/`THEME_TOO_LARGE`。

---

## 闭环步骤

### 1. 读起点主题

从当前默认或某个内置主题起步:

```bash
# a) 读我当前的默认主题(有就在它上面改)
curl -s -H "$AUTH" "$BASE/api/wechat/theme"

# b) 或列出内置主题,挑一个复制起步(推荐 benya-clean——已是微信兼容范本)
curl -s -H "$AUTH" "$BASE/api/wechat/themes"
```

> **推荐从 `benya-clean` 起步**:它已按红线 1 / 红线 2 改造过（标题装饰 inline 在标题上、无 articleWrap 外框）,是最省心的微信兼容底板。
> 本 skill 也自带一个 WeChat-safe 起手模板 [`themes/theme.example.json`](./themes/theme.example.json)（暖橘编辑风,可直接复制改配色）。

### 2. 按用户口语描述改 themeJson

把「换成暖橘色 / 标题要竖条 / 引用做成卡片 / 字再大一点 / 排版长得像某某号」翻译成合法 themeJson。
schema 全貌见下方 §themeJson 结构;守住上面三条红线。改配色最省事:**只动 `palette` 八个键**,其余用 `{{token}}` 自动跟随。

### 3. 本地先自检（省一次 400 往返）

把生成的主题写成本地文件,过本 skill 自带的零依赖校验器:

```bash
node scripts/validate-theme.mjs /tmp/my-theme.json   # 有硬错误按提示改;exit 0 = 合法
```

> 这份 `validate-theme.mjs` 与服务端的安全边界**同源同规则**;本地过了,服务端基本就过。
> （若本机也装了 `wechat-article-pipeline`,它的 `scripts/validate-theme.mjs` 完全等价。）

### 4. 预览两条路(改一版看一版)

**(a) API 渲染 → 存本地 .html 打开**（无需其他 skill,只要 curl,最稳）:

```bash
# 用编辑中的 themeJson 渲染样例文章,拿回 HTML 存本地打开肉眼看
curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg md "$(cat sample.md)" --slurpfile t /tmp/my-theme.json \
        '{markdown:$md, title:"预览", themeJson:$t[0]}')" \
  "$BASE/api/wechat/render" | jq -r '.data.html' > /tmp/preview.html
open /tmp/preview.html    # macOS;别的平台用浏览器打开
```

> render 返回的 HTML 与最终存进草稿的正文**逐字一致**——这是最可靠的把关:预览什么样,发文就什么样。
> `data.warnings` 若有(如未知 `{{token}}`)一并看一眼。

**(b) 本地实时换肤工作台**（可选,需已装 `wechat-article-pipeline`,它带 `design-studio.mjs` 与 `themes/`）:
把编辑中的主题存成 `wechat-article-pipeline/themes/<名>.json`,再起工作台,左侧手机公众号外框会把它作为一张主题卡实时预览,改文件重选即换肤:

```bash
node wechat-article-pipeline/scripts/design-studio.mjs --md sample.md --title "预览"   # 默认 127.0.0.1:4599
```

（该工作台只绑本机、只写本地产物、不发布、不提交。它主打「选主题 + 封面 + 配图」,改 themeJson 本身仍以路 (a) 为准。）

### 5. ⚠️ 存回服务端默认（关键断层,必须做,否则等于没改）

> **本地 `theme.json` 只用于本地渲染/预览。发文流水线和 doubaoya.com 网页排版工作室读的是服务端
> `userWechatTheme` 里的那份默认主题。只有把主题 `POST`/`PUT` 存回服务端并置 `isDefault:true`,才真正改掉了「默认排版」。**
> 别让用户以为「本地存了个 theme.json」就改好了——那份服务端根本读不到。

```bash
# 新建并设为默认(首次)
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg name "暖橘编辑" --slurpfile t /tmp/my-theme.json \
        '{name:$name, themeJson:$t[0], isDefault:true}')" \
  "$BASE/api/wechat/theme" | jq '.data.theme.id'

# 或更新已有主题(从 GET /api/wechat/theme 或 /themes 拿到 id 后)
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d "$(jq -n --slurpfile t /tmp/my-theme.json '{themeJson:$t[0], isDefault:true}')" \
  "$BASE/api/wechat/theme/<主题id>" | jq '.data.theme.updatedAt'
```

存回成功后告诉用户:**默认排版已更新,下次发文 / 网页排版工作室会自动套这套**。

---

## themeJson 结构（速查）

top-level 五段（+ 进阶 `components`）:

```jsonc
{
  "meta":     { "name": "暖橘编辑", "source": "description", "notes": "" },
  "palette":  { "text":"#33302b","heading":"#1f1c18","accent":"#d2691e","accent2":"#a8501a",
                "muted":"#a09a90","bgSoft":"#fbf1e7","border":"#ece3d8","link":"#a8501a" },
  "page":     { "fontFamily":"…,'PingFang SC',sans-serif","fontSize":"16px","lineHeight":"1.8",
                "letterSpacing":"0.01em","color":"{{text}}" },
  "elements": { /* 每个标签一套 inline-style 模板,见下 */ },
  "decorations": { "articleWrap": { "before":"", "after":"" }, "sectionDivider":"…" }
}
```

- **`{{token}}` 插值**:任何 style/HTML 字符串里的 `{{key}}` 先从 palette、再从 page 取值。改配色只动 palette。
- **`elements` 支持的标签**:`h1 h2 h3 h4 p blockquote ul ol li img hr strong em del a code pre`,按标签深合并（覆盖 h2 不影响 p）。
- **每个 element 字段**:`style`(inline CSS,不含 `<`/`>`)、`wrapBefore`/`wrapAfter`(块级元素前后注入的 HTML——**但装饰别做成空块,见红线 1**)、`li.marker`(自定义项目符号)、`img.figureStyle`/`captionStyle`(图注)、**`hr` 只有 `html`**(整条替换成装饰分割线,如居中短色线)。
- **标题装饰的正确姿势**（守红线 1）:色条 / 竖条 / 下划线用 `border-left` / `border-bottom` / `padding` **写进标题自己的 `style`**,别用空 `wrapBefore` 块。参照 `benya-clean` 与本 skill 的 `themes/theme.example.json`。
- **`decorations.articleWrap` 留空**（守红线 2）。

> 主题契约的权威文档在 `wechat-article-pipeline/themes/THEME-SCHEMA.md`（若已装）。本 skill 的 §themeJson 结构 + `theme.example.json` 足够独立完成一次改主题。

---

## 前置条件

- Node **≥ 18**（内置 `fetch`）、`curl`、`jq`（拼 JSON 用;不想用 jq 也可手写 JSON body）。
- 一个 **doubaoya.com** 账号 + 一条 **`DOUBAOYA_API_KEY`**（doubaoya.com → 密钥中心 → 生成）。
- 渲染 / 存主题都**免费不扣点**。真正发文（把套好主题的文章推进草稿箱）走 `wechat-article-pipeline`。

## 语言

- 用户用中文就用中文回复,用英文就用英文回复。中文回复遵循《中文文案排版指北》。
