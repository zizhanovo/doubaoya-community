---
name: wechat-draft-publish
description: 公众号草稿发布 · 把一篇写好的图文存进你自己公众号的草稿箱（只存草稿、绝不群发；之后你去公众号后台确认后手动群发）。当用户要把文章/图文推进公众号、存公众号草稿、把写好的稿子发到公众号后台、代发公众号草稿箱、addDraft、draft/add 时使用。这是一个写入能力，会写到用户自己的公众号，需先在 doubaoya.com 绑定公众号。
---

# 公众号草稿发布（都爆鸭）

本鸭帮你把一篇**已经写好的图文**存进你自己公众号的**草稿箱**——只存草稿，**绝不群发/推送**。存完给你一个 `mediaId`，你再去公众号后台亲眼确认、手动群发。

> ⚠️ **这是一个「写入」能力**：跟本鸭那些只读的选题 / 搜索类技能不同，这个技能会**写到你自己的公众号后台**。所以它比读类技能更谨慎——只做「存草稿」这一步，最终群发的手一定在你自己。

> 走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 它做什么 / 不做什么

- ✅ 把 `{标题 + 公众号风格 HTML 正文}` 存进公众号**草稿箱**。
- ✅ 正文里的外链图片（`<img src="http…">`）会被**自动搬运**成公众号图床地址（mmbiz）；个别图搬运失败会**跳过**，不影响整篇。
- ✅ 封面（thumb）不指定时会**自动兜底**一张。
- ❌ **绝不群发 / 不推送 / 不定时发**——只落草稿。群发这一步永远由你在公众号后台手动完成。
- ❌ **不能替你绑定公众号**——得你先在 doubaoya.com 授权。

### 几条要诚实告诉用户的约束

- `contentHtml` 是**公众号风格的 HTML** 正文（**不是 markdown**）。若用户给的是 markdown，先转成公众号 HTML 再发。
- 正文里的**外链**图片（`http(s)://` / `mmbiz`）会被服务端自动搬运成公众号图床地址；个别搬运失败会被跳过、不影响整篇。
- **本地图片**（`<img src="/Users/.../x.png">`、`./a.jpg`、`file://…`）和**本地封面**服务端读不到，直接发会被静默丢弃——必须先在客户端**预上传**再发（见下文「本地图片必须先客户端预上传」；有本地图/封面时用 `scripts/preprocess-and-publish.mjs`）。
- **只存草稿，绝不群发。**
- 需要**先在 doubaoya.com → 公众号 页面把公众号授权绑定**，否则没有可发布的公众号（这一步是个 OAuth 授权，本技能做不了）。

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

# 只扫描本地图、不上传不发布（自检用，不需要口令）
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

## 拿钥匙（口令）

1. 打开 **doubaoya.com** → **登录**
2. 进 **口令中心** → **生成口令**（形如 `dyh_…`）

配置到环境变量（脚本只认这个）：

```bash
export DOUBAOYA_API_KEY="dyh_你的口令"
```

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**，不要把口令带去任何其他域名。

---

## 错误处理

先看信封 `success`：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。常见错误码：

| HTTP | error.code | 含义 | 你该怎么办 |
|------|------------|------|-----------|
| 401 | `UNAUTHORIZED` | 口令无效 / 会话失效 | 检查 `DOUBAOYA_API_KEY`，去口令中心撤销并重新生成 |
| 403 | `FORBIDDEN` | 这个公众号**不属于**当前口令背后的用户 | 说明用的是别人绑定的公众号，或口令与绑定账号对不上——换成本人绑定该号的口令 |
| 400 | `VALIDATION_ERROR` | 缺 `authorizerAppid` / `title` / `contentHtml` | 按 `message` 补齐必填项 |
| 502 | `WECHAT_PUBLISH_FAILED` / `WECHAT_COVER_FAILED` | 上游 / 封面处理失败（**额度已退**） | 可安全重试；封面失败可试着换封面或不传 `thumbMediaId` |
| 503 | `WECHAT_NOT_CONFIGURED` | 平台侧公众号能力**未配置** | 非用户能自解，提示这是平台配置问题，稍后再试 / 联系 doubaoya.com |

> `502` 类失败会**自动退还额度**，重试是安全的，不会重复扣费。
> 若 `GET /api/wechat/status` 的 `accounts` 为空 → 不是错误码问题，是**还没绑定公众号**：让用户先去 doubaoya.com → 公众号 页面绑定，本技能替不了他绑。

---

## 目录结构

```
wechat-draft-publish/
├── SKILL.md                      # 本文件
└── scripts/
    ├── publish_draft.py          # 零依赖脚本（urllib）：查绑定 → 存草稿（无本地图片时用）
    └── preprocess-and-publish.mjs # Node 脚本：预上传本地正文图/封面 → 改写 HTML → 存草稿
```
