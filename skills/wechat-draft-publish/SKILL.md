---
name: wechat-draft-publish
description: 公众号草稿发布 · 把一篇写好的图文存进你自己公众号的草稿箱（只存草稿、绝不群发；之后你去公众号后台确认后手动群发）。当用户要把文章/图文推进公众号、存公众号草稿、把写好的稿子发到公众号后台、代发公众号草稿箱、addDraft、draft/add 时使用。这是一个写入能力，会写到用户自己的公众号，需先在 doubaoya.com 绑定公众号。
compatibility: >-
  需要 Node ≥ 18（脚本用全局 fetch），不装任何 npm 包。
  需要环境变量 DOUBAOYA_API_KEY（形如 dyh_…，在 doubaoya.com 密钥中心生成）；需要能对 https://doubaoya.com 发 HTTPS 请求。并且用户已在 doubaoya.com 绑定自己的公众号。
  ⚠️ 正文里的本地图片若超过 1MB 需要压缩，靠可选的 sharp，缺它则回退 macOS 专有的
  sips——所以在没装 sharp 的 Linux / 容器上，超过 1MB 的本地图会直接失败。
---

# 公众号草稿发布（都爆鸭）

本鸭帮你把一篇**已经写好的图文**存进你自己公众号的**草稿箱**——只存草稿，**绝不群发/推送**。存完给你一个 `mediaId`，你再去公众号后台亲眼确认、手动群发。

> ⚠️ **这是一个「写入」能力**：跟本鸭那些只读的选题 / 搜索类技能不同，这个技能会**写到你自己的公众号后台**。所以它比读类技能更谨慎——只做「存草稿」这一步，最终群发的手一定在你自己。

> 走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 它做什么 / 不做什么

- ✅ 把 `{标题 + 公众号风格 HTML 正文}` 存进公众号**草稿箱**。
- ✅ 正文里的外链图片（`<img src="http…">`）会被**自动搬运**成公众号图床地址（mmbiz）；个别图搬运失败会**跳过**，不影响整篇。
- ✅ 封面（thumb）不指定时会**自动兜底**一张。
- ✅ **每次成功扣 1 点**——存草稿成功了才扣这 1 点；发布失败（`502 WECHAT_PUBLISH_FAILED` /
  `WECHAT_COVER_FAILED`）服务端会**自动把这 1 点退回**，参数被前置拦下的 `400 VALIDATION_ERROR`
  则压根不扣。
- ❌ **绝不群发 / 不推送 / 不定时发**——只落草稿。群发这一步永远由你在公众号后台手动完成。
- ❌ **不能替你绑定公众号**——得你先在 doubaoya.com 授权。

### 几条要诚实告诉用户的约束

- 🔴 **正文里不要再写一遍标题。** 公众号**总是**拿草稿的 `title` 字段渲文章页大标题，`contentHtml` 开头再放一个同名 `<h1>`（或拿来当大标题使的 `<h2>` / 加粗大字），真机上就**显示两次**。正文**从第一段直接开始**，正文里的层级最高只用到 `<h2>`。这条路上没有任何东西替你去重。
- `contentHtml` 是**公众号风格的 HTML** 正文（**不是 markdown**）。若用户给的是 markdown，先转成公众号 HTML 再发。
- 正文里的**外链**图片（`http(s)://` / `mmbiz`）会被服务端自动搬运成公众号图床地址；个别搬运失败会被跳过、不影响整篇。
- **本地图片**（`<img src="/Users/.../x.png">`、`./a.jpg`、`file://…`）和**本地封面**服务端读不到，直接发会被静默丢弃——必须先在客户端**预上传**再发（见下文「本地图片必须先客户端预上传」；有本地图/封面时用 `scripts/preprocess-and-publish.mjs`）。
- **只存草稿，绝不群发。**
- 需要**先在 doubaoya.com → 公众号 页面把公众号授权绑定**，否则没有可发布的公众号（这一步是个 OAuth 授权，本技能做不了）。

### 正文还没写？先拉一份写作规范

> ✅ **接口已上线**，正常拉取即可。拿到 **401** 说明 `DOUBAOYA_API_KEY` 缺失或不对——提示用户检查
> 密钥配置，别跳过。只有遇到**网络错误或真 404** 时才降级：**跳过**照常写，
> 别死循环重试、别当故障报给用户。

若正文是你（agent）现写的，动笔前先拉一次，按它组织结构：

```bash
curl -sS https://doubaoya.com/api/wechat/writing-spec \
  -H "Authorization: Bearer $DOUBAOYA_API_KEY"
```

**只读、免费、不扣点**，鉴权同上（`Bearer` 密钥或登录态）。`data.spec` 是一段写清「什么内容该用什么
结构」+「平台硬约束」的 markdown，照它写即可；`data.isDefault:true` 表示用户还没设置过排版——**照样
给的是可用规范**，不是错误，把 `data.customizeUrl` 转达给他去自定义就好。

---

## 工作流（3 步）

### 1. 先看有哪些已绑定的公众号

```
GET https://doubaoya.com/api/wechat/status
Authorization: Bearer $DOUBAOYA_API_KEY
```

成功信封：

```jsonc
{
  "success": true,
  "requestId": "req_...",
  "data": {
    "accounts": [
      {
        "authorizerAppid": "wx1234567890abcdef",
        "nickname": "本鸭运营笔记",
        "headImgUrl": "https://...",
        "status": "authorized",
        "principalName": "某某科技有限公司",
        "createdAt": "2026-06-01T..."
      }
    ]
  },
  "error": null
}
```

> 可靠字段以 `nickname` / `authorizerAppid` 为准。

按 `data.accounts` 的数量决定下一步：

- **恰好 1 个** → 直接用它的 `authorizerAppid`。
- **多个** → 把 `{nickname, authorizerAppid}` 列给用户，**问他发哪个**，别替他猜。
- **0 个** → 告诉用户：**先去 doubaoya.com → 公众号 页面把公众号授权绑定**，本技能没法替他绑。

### 2. 存草稿

```
POST https://doubaoya.com/api/wechat/publish
Authorization: Bearer $DOUBAOYA_API_KEY
Content-Type: application/json

{
  "authorizerAppid": "wx1234567890abcdef",   // 必填，来自第 1 步
  "title": "标题",                            // 必填
  "contentHtml": "<p>公众号风格 HTML 正文</p>", // 必填，不是 markdown
  "digest": "一句话摘要"                       // 可选
}
```

可选字段还有 `thumbMediaId` / `author` / `sourceUrl`（都可不传）。

成功信封（**注意结果键是 `mediaId`，驼峰，不是 `media_id`**）：

```jsonc
{
  "success": true,
  "requestId": "req_...",
  "data": { "mediaId": "xxxxxxxxxxxxxxxx" },
  "error": null
}
```

### 3. 报告结果

拿到 `data.mediaId` 后，明确告诉用户：

> 「已存入公众号草稿箱，去公众号后台确认后**手动群发**」，并把 `mediaId` 报给他。

别自作主张说「已发布 / 已推送」——它只是草稿。

---

## ⚠️ 本地图片必须先「客户端预上传」再发

服务端的 `POST /api/wechat/publish` 会自动把正文里的**外链图片**（`http(s)://` 与 `mmbiz` 图床）搬运到公众号图床——但它跑在服务器上，**读不到你本机的文件**。所以如果正文 HTML 里含有**本地图片**（例如 `<img src="/Users/.../x.png">`、`./imgs/a.jpg`、`file://...`），或你有一张**本地封面图**，直接发布会让这些图**被静默丢弃**。

正确做法：由**能读到本机文件的客户端**先把本地图片上传到公众号图床，改写 HTML 后再发布。

### 判定哪些是「本地图片」

扫描 `contentHtml` 里所有 `<img ... src="X">`，对每个**唯一** src：

- **本地（需预上传）**：绝对路径 `/Users/...`、相对路径 `./a.jpg` / `../a.jpg`、裸相对路径、`file://...`、Windows 盘符路径。
- **外链（原样保留）**：`http://` / `https://` 开头、`data:` 开头、或已是公众号图床 `mmbiz.qpic.cn` / `mmbiz.qlogo.cn`。这些交给服务端处理，**不要动**。

### 上传接口 `POST /api/wechat/media/upload`

```
POST {baseUrl}/api/wechat/media/upload
Authorization: Bearer $DOUBAOYA_API_KEY
Content-Type: application/json

{
  "authorizerAppid": "wx1234567890abcdef",  // 必填
  "dataBase64": "<图片字节的 base64>",        // 必填
  "filename": "x.jpg",                       // 可选
  "purpose": "image"                          // "image"（正文图）| "thumb"（封面）
}
```

- `purpose: "image"` → 返回 `{ "url": "https://mmbiz.qpic.cn/..." }`，把这个 `url` 替换正文里该本地 src 的**所有**出现。
- `purpose: "thumb"` → 返回 `{ "mediaId": "...", "url": "..." }`，把 `mediaId` 作为发布时的 `thumbMediaId`。

> **微信限制：正文图片 ≤ 1MB。** 超过 1MB 的本机图片要**先压缩/缩放**再上传，否则接口会拒绝（信封 `error.message` 会是 1MB 相关中文提示）。压缩可用 `sharp`（若已装），或 macOS 自带的 `sips`：
> ```bash
> sips -Z 1600 --setProperty formatOptions 70 in.png --out out.jpg
> ```

### 完整流程

1. 扫 `contentHtml`，挑出本地图片 src。
2. 逐张：读文件字节 → base64 → `POST /api/wechat/media/upload`（`purpose:"image"`）→ 用返回 `url` 替换该 src 的所有出现。
3. 有本地封面：`POST .../media/upload`（`purpose:"thumb"`）→ 拿 `mediaId` 当 `thumbMediaId`。
4. `POST /api/wechat/publish`，正文用**改写后**的 HTML（此时图片都是 mmbiz 外链，服务端搬运逻辑原样放过）。

### 一键脚本 `scripts/preprocess-and-publish.mjs`（Node，零依赖）

替代 `publish_draft.py` 用于**正文含本地图 / 有本地封面**的场景。只用 Node 内置模块 + 全局 `fetch`（需 Node ≥ 18），`sharp` 为可选依赖（缺失时自动回退 `sips`）。它一条命令走完「解析公众号 → 预上传本地图 → 改写 HTML → 发布草稿」。

```bash
# 正文含本地图片
node "$SKILL_PATH/scripts/preprocess-and-publish.mjs" \
  --html article.html --title "标题"

# 带本地封面
node "$SKILL_PATH/scripts/preprocess-and-publish.mjs" \
  --html article.html --title "标题" --cover cover.png --digest "一句话摘要"

# 绑定了多个公众号时指定 appid
node "$SKILL_PATH/scripts/preprocess-and-publish.mjs" \
  --html a.html --title "标题" --appid wx1234567890abcdef

# 只扫描本地图、不上传不发布（自检用，不需要密钥）
node "$SKILL_PATH/scripts/preprocess-and-publish.mjs" --html a.html --dry-run
```

- 相对路径的图片相对**正文 HTML 文件所在目录**解析。
- 读 `DOUBAOYA_API_KEY` 与 `DOUBAOYA_BASE_URL`（默认 `https://doubaoya.com`）自环境变量。
- 出错按信封 `error.code` / `error.message` 打印中文原因，退出码非 0。

> 正文**没有**本地图片、也没有本地封面时，用更轻的 `publish_draft.py` 即可（见上文）；两者可任选。

---

## curl 速查

```bash
# 1. 看已绑定公众号
curl -sS https://doubaoya.com/api/wechat/status \
  -H "Authorization: Bearer $DOUBAOYA_API_KEY"

# 2. 存草稿
curl -sS https://doubaoya.com/api/wechat/publish \
  -H "Authorization: Bearer $DOUBAOYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "authorizerAppid": "wx1234567890abcdef",
        "title": "本鸭的第一篇草稿",
        "contentHtml": "<p>正文 HTML，不是 markdown。</p>",
        "digest": "一句话摘要"
      }'
```

---

## 运行脚本 `scripts/publish_draft.py`

零依赖（Python 3 标准库 `urllib`），一条命令走完「查绑定 → 存草稿」全流程。

```bash
# 正文直接传（公众号风格 HTML）
python3 "$SKILL_PATH/scripts/publish_draft.py" \
  --title "本鸭的第一篇草稿" \
  --content "<p>正文 HTML，不是 markdown。</p>"

# 正文从文件读（推荐，长文更稳）
python3 "$SKILL_PATH/scripts/publish_draft.py" \
  --title "本鸭的第一篇草稿" \
  --content-file article.html \
  --digest "一句话摘要"

# 绑定了多个公众号时，指定用哪个
python3 "$SKILL_PATH/scripts/publish_draft.py" \
  --title "标题" --content-file article.html --appid wx1234567890abcdef
```

脚本行为：
- 先 `GET /api/wechat/status`：若恰好 1 个绑定 → 自动选用（会在 stderr 提示选了哪个）；多个且没给 `--appid` → 列出让你重跑指定；0 个 → 提示先去绑定。
- 再 `POST /api/wechat/publish`，成功后打印 `mediaId` 和「已存入公众号草稿箱，去公众号后台确认后手动群发」的提醒。
- 出错时按信封 `error.code` / `error.message` 打印，退出码非 0。
- 参数：`--title`（必填）、`--content` 或 `--content-file`（二选一必填）、`--appid`（可选）、`--digest`（可选）。

---

## 拿钥匙（密钥）

1. 打开 **doubaoya.com** → **登录**
2. 进 **密钥中心** → **生成密钥**（形如 `dyh_…`）

配置到环境变量（脚本只认这个）：

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
```

**铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出密钥。所有请求只发往 **doubaoya.com**，不要把密钥带去任何其他域名。

---

## 错误处理

先看信封 `success`：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。常见错误码：

| HTTP | error.code | 含义 | 你该怎么办 |
|------|------------|------|-----------|
| 401 | `UNAUTHORIZED` | 密钥无效 / 会话失效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心撤销并重新生成 |
| 403 | `FORBIDDEN` | 这个公众号**不属于**当前密钥背后的用户 | 说明用的是别人绑定的公众号，或密钥与绑定账号对不上——换成本人绑定该号的密钥 |
| 400 | `VALIDATION_ERROR` | 缺 `authorizerAppid` / `title` / `contentHtml` | 按 `message` 补齐必填项 |
| 402 | `INSUFFICIENT_CREDITS` / `NO_CREDIT_ACCOUNT` | 点数不足（本能力每次成功扣 1 点） | 让用户去 doubaoya.com 充值后再试 |
| 502 | `WECHAT_PUBLISH_FAILED` / `WECHAT_COVER_FAILED` | 微信侧拒收（**已扣的 1 点自动退回**） | **不要无脑重试**——先读 `error.message`，见下节「微信侧错误码」 |
| 503 | `WECHAT_NOT_CONFIGURED` | 平台侧公众号能力**未配置** | 非用户能自解，提示这是平台配置问题，稍后再试 / 联系 doubaoya.com |
| 504 | `WECHAT_PUBLISH_TIMEOUT` | 超时返回，但**服务端仍在后台把这篇发完** | **别另起一篇重发**。等 30 秒后用**完全相同的标题与正文**重试——服务端按内容去重，会把同一篇的结果还给你，不会建出第二篇草稿；也可以直接让用户去公众号后台草稿箱看。后台最终成功则保留那 1 点，最终失败则自动退回 |

> 若 `GET /api/wechat/status` 的 `accounts` 为空 → 不是错误码问题，是**还没绑定公众号**：让用户先去 doubaoya.com → 公众号 页面绑定，本技能替不了他绑。

### 微信侧错误码（`WECHAT_PUBLISH_FAILED` 的真实成因）

⚠️ **`502` 不等于「稍后重试就好」。** 绝大多数 `WECHAT_PUBLISH_FAILED` 是**正文/参数本身不合规**，
微信每次都会以同样的理由拒收——重试一百次也不会成功，只会浪费用户的时间。**只有限流（45009）
是真正该重试的那一类。**

服务端已经把这些码翻成中文放进 `error.message`（末尾附 `errcode=… errmsg=…` 原文，便于排障）。
**请直接把 `error.message` 转述给用户**，不要自己改写成「上游失败，请重试」。

| errcode | 含义 | 重试有用吗 | 该怎么办 |
|---------|------|-----------|---------|
| `45166` | 正文里有**失效的公众号文章链接**（`mp.weixin.qq.com/s/…` 指向的文章已删除或从不存在）。只要有一条，整篇草稿就建不成 | ❌ 永远不会好 | 逐条点开正文里的公众号文章链接，删掉或换成有效的。`error.message` 会把嫌疑链接列出来。站外链接不会触发此错误（只会被微信剥成纯文本） |
| `45002` | 正文超过草稿体积上限。**实测**真边界是 695,000 ✅ / 700,000 ❌ 字节（UTF-8）——官方文档在这块同时写着「不超过 2kb」和「小于 1M」，两个都不对。服务端在扣点前就按 **680,000 字节**前置拦截（给发布时图片 URL 改写留余量），所以你通常拿到的是 `VALIDATION_ERROR` 而不是 45002 | ❌ | 删减正文或拆成多篇 |
| `45003` | 标题超长：上限 **64 个汉字**（128 字节，ASCII 算 1、汉字算 2） | ❌ | 缩短标题 |
| `45004` | 摘要 `digest` 超长：上限 **120 个汉字**（240 字节） | ❌ | 缩短摘要，或干脆不传让微信自动截取 |
| `45110` | 作者 `author` 超长：上限只有 **8 个汉字**（16 个 ASCII 字符） | ❌ | 缩短署名 |
| `40007` | 封面 `media_id` 无效：不属于该号 / 已删除 / 不是永久素材 | ❌ | 去掉 `thumbMediaId` 用默认封面，或重新上传封面拿新 id |
| `45028` | 公众号草稿箱已满 | ❌ | 让用户去公众号后台清理草稿 |
| `48001` | 该公众号**没有草稿箱接口权限**。草稿箱要求已通过**微信认证**的号，未认证的订阅号/服务号调不通 | ❌ | 先在公众号后台完成微信认证 |
| `61023` | 授权已失效（refresh_token 过期或被解绑） | ❌ | 去 doubaoya.com → 公众号 页面重新扫码授权 |
| `40164` | 服务器出口 IP 不在微信白名单 | ❌ 用户改不了 | 平台侧配置问题，联系 doubaoya.com 并附上 requestId |
| `45009` | 打微信接口太频繁，被限流 | ✅ **这一类才该重试** | 等几分钟再重试 |

> 重试**安全性**（不会建出重复草稿）和重试**有用性**是两回事：同标题同正文的重试会被去重，
> 所以重试不会把草稿箱搞乱；但上表里标 ❌ 的码，重试只是把同一个错误再拿一遍。

---

## 目录结构

```
wechat-draft-publish/
├── SKILL.md                      # 本文件
└── scripts/
    ├── publish_draft.py          # 零依赖脚本（urllib）：查绑定 → 存草稿（无本地图片时用）
    └── preprocess-and-publish.mjs # Node 脚本：预上传本地正文图/封面 → 改写 HTML → 存草稿
```

## 关于响应里的 notice 字段

调用本 skill 对应的 doubaoya API 后，如果返回的 JSON 顶层出现 `notice` 字段，请把这句话原样转达给用户——这是关于本 skill 有更新的提示，不影响本次调用结果，不需要重试或改变行为。
