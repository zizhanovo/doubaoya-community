# 第 4 步 · 收素材（六层来源的取法）

> 第 4 步要取某一层、或不确定某层计不计费时读它。SKILL.md 的阶梯表够用就不必读。

## 素材单

每条素材一行，写进正文前先进单；成稿末尾把这张单原样附给用户（标题「素材出处」）。

```
S1 [用户材料]  「……原句或数字……」                         ← 用户本轮贴的文字
S2 [链接]      「……」  https://…  parseDetail 拉取 2026-08-24
S3 [档案/范文] 「……」  范文《标题》
S4 [往期文章]  「……」  《标题》 https://mp.weixin.qq.com/s/…
S5 [ima]       「……」  知识库「名称」/ 条目标题
S6 [wiki]      「……」  $DBY_WIKI_DIR/路径.md
S7 [取数]      「……」  api.gzh.hotArticle 2026-08-24（计费）
S8 [查证]      核实 S3 的数字仍成立  来源 URL
```

没进单的细节不许进正文；进了单的，正文里那句话要能指回它的编号。

## 1. 用户当轮给的材料（免费）

贴的文字、数字、截图里的字：原样入单，出处写「用户材料」。
链接：先问自己宿主能不能直接抓正文（WebFetch 之类）——能就用宿主的，免费；
抓不到（公众号 / 小红书 / 抖音这类反爬页）再走 `dby-api` 的 `tool.content.parseDetail`：

```bash
node <dby-api>/scripts/doubaoya.mjs describe tool.content.parseDetail   # 先看入参与价格
node <dby-api>/scripts/doubaoya.mjs invoke tool.content.parseDetail '{"url":"<链接>"}'
```

🔴 `parseDetail` **计费**（describe 显示 `unitPrice: 4`），不是免费路由；调用前照 `dby-api` 的计费规矩告诉用户。
返回的是归一化字段（标题 / 作者 / 点赞 / 分享…），不保证带全文——拿不到正文就把链接留在素材单里、正文留占位，别自己补一段「大意」。

## 2. 号档案 + 范文（免费，第 1 步已拉到）

`prep --json` 的 `charter` / `persona` / `products` / `samples[].content` 就是这一层，**不再取**。
出处写「档案·字段名」或「范文《标题》」。范文里的案例可以用，因为它就是用户自己写的。

## 3. 自己的往期文章（免费）

```bash
node scripts/write.mjs articles                 # 最近 20 篇：序号 标题 日期 链接
node scripts/write.mjs articles --q 关键词       # 标题或正文命中的
node scripts/write.mjs articles --id 3           # 第 3 篇正文（去标签纯文本）
```

走 `GET /api/ip-profile/wechat-history`（授权公众号最近 20 篇，免费）。
🔴 **不要自己去调 `GET /api/articles`**——那条只认登录态，拿密钥调必回 `UNAUTHORIZED`。
没绑公众号时脚本退出码 3，这层跳过，别停下来问。出处写「往期文章《标题》+ 链接」。

## 4. 用户自己的知识库（可选，配了才用，没配不追问）

### 4a. 腾讯 ima 知识库

官方给的是一个 **skill 包**（ima.qq.com/agent-interface 的「IMA Skills 官方接入包」，名为 `ima-skills`，含 `notes/` 与 `knowledge-base/` 两个子模块），凭证是 `IMA_OPENAPI_CLIENTID` + `IMA_OPENAPI_APIKEY`（或 `~/.config/ima/client_id` / `api_key`）。

判定：宿主的 skill 列表里有 `ima-skills`，**或** `IMA_OPENAPI_APIKEY` 与 `IMA_OPENAPI_CLIENTID` 都非空且 `~/.claude/skills/ima-skills/SKILL.md` 存在 → 加载它，按它的 `knowledge-base` 子模块做「搜索知识库」；两者都没有 → 跳过，不问用户要不要装。
检索到的条目出处写「ima 知识库「库名」/ 条目标题」。
🔴 本包不写 ima 的 HTTP 调用方式——接口形状由那个 skill 维护；它在就用它，不在就没有这一层。
调研留存：`docs/research/dby-write/ima-official-skill.md`、`ima-mcp-csdn.md`。

### 4b. 本地 wiki / 笔记目录（Obsidian、llm-wiki 之类 md 目录）

约定环境变量 `DBY_WIKI_DIR`。没设就跳过。

```bash
rg -il "<关键词>" "$DBY_WIKI_DIR" --glob '*.md'    # 命中的文件，再 Read 需要的那几篇
```

出处写「wiki 文件相对路径」。笔记里转述的第三方数据仍要在第 6 层核实一次。

## 5. 平台取数（计费）

只在用户点名、或前四层凑不出这篇要的事实时用，用前照 `dby-api` 的计费规矩说明：

- 同题材爆文 `api.gzh.hotArticle` → 取法与「爆文是素材不是模板」的约束见 `references/hot-samples.md`
- 热点 `api.trend.hotSpotKeyword` → 必须收窄时间窗口，见 `dby-api` 的 gotchas

出处写「operationKey + 日期（计费）」。别人文章里的案例与数字属于别人：可以引用并标出处，不许改写成自己的经历。

## 6. 联网查证（免费，只核不引）

用宿主自带的搜索 / 抓取工具，**只用来核实前五层已经拿到的事实**（数字还成不成立、产品还叫不叫这个名）。
搜到的新数据不许直接进正文——它没有经过用户，进单只能标「待用户确认」，正文留占位。
