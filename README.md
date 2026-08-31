# 都爆鸭 · doubaoya-community

> **公众号 AI 执行外脑**——不只是给你判断，是真的帮你**取数、查违禁词、写进草稿箱**。

这是 **都爆鸭（doubaoya）** 的社区 Agent Skill 库。把里面的技能装进你的 AI 助手
（Claude Code / Codex 等），配上一条 `DOUBAOYA_API_KEY`，agent 就会用
[doubaoya.com](https://doubaoya.com) 的公开 API 替你完成日常新媒体活儿，还能直接把成稿
**存进你自己的公众号草稿箱**——你只管说人话，技术细节本鸭全包了。

部分技能（多平台改写这类）**纯本地运行、不联网、不需要 key**，agent 自己干活。

## 真实处境 → 你会得到

| 你现在的处境 | 你会得到 |
|---|---|
| 打开后台脑子一片空白，刷遍全网也想不出下一篇写什么，想要能直接抄的选题方向和热点信号 | `/dby-api` 挖选题、追全网热点、按关键词聚合爆文 |
| 选题定了，但一写标题、想封面就卡住，写出来的东西自己都觉得平 | `/dby-api` 拆爆款结构、起标题、配封面套路 |
| 正文写完了，懒得手动排版、传图、传封面，还想直接进自己公众号草稿箱（绝不群发） | `/dby-publish` 一条流水线走完 md → 公众号 HTML → 封面 → 存草稿箱 |
| 发布前心里没底，怕踩极限词/违禁词，还想顺手在小红书、抖音也过一遍 | `/dby-banned-words` 跨平台违禁词对照 + 一版全平台安全改写 |
| 一稿写完想同时发公众号、视频号、抖音、小红书，又不想逐条手改语气 | `/dby-rewrite` 多平台文案改写，一稿多发，纯本地不需要 key |
| 公众号默认排版不是自己的调性，想按口语改配色、标题样式、引用、图注 | `/dby-theme` 本地预览后存回服务端 |
| 写了一堆但号越来越没记忆点，说不清自己人设、文风、该写什么不该写什么 | `/dby-charter` 定位问诊 + 文风蒸馏，出一份号章程和创作 DNA |
| 不确定这一步该用哪个技能，或者第一次用完全没概念 | `/dby` 主入口，按飞轮逐跳把你路由到该用的技能 |

## 这库给谁用

新媒体运营、内容创作者、MCN、代运营、做内容工具的开发者——任何天天跟
**公众号 / 小红书 / 抖音** 选题和脚本打交道的人。

## 先拿钥匙（密钥）

需要调数据的技能要一条密钥（API Key）：

1. 打开 https://doubaoya.com → **登录**
2. 进 **密钥中心** → **生成密钥**
3. 整条密钥只在生成那一下完整露脸，复制收好（形如 `dyh_…`）
4. 设进环境变量：`export DOUBAOYA_API_KEY="dyh_你的密钥"`

> agent 会把 key 存进环境变量，自己调接口、自己拼结果，**绝不把整条 key 回显出来**。
> 不需要 key 的例外：`dby-rewrite` 纯本地运行，不联网、不调用任何 doubaoya.com 接口。

## 安装

```bash
npx skills add zizhanovo/doubaoya-community
```

也可以只装其中某一个技能：

```bash
npx skills add zizhanovo/doubaoya-community/skills/dby-api
```

> **推荐从主入口开始**：装好后输入 `/dby`（都爆鸭公众号工具箱主入口），它按「选题 → 写草稿 → 排版 → 代发 → 复盘 → 反哺选题」的飞轮，逐步把你路由到该用的技能。第一次用输入 `/dby 新手入门`；干完一步不知道下一步，随时回 `/dby`。
>
> **只想更新本鸭、不碰别人的技能**：输入 `/dby-update`，它只按仓库精确同步 `zizhanovo/doubaoya-community`，不会像无参数的 `npx skills update` 那样连你装的其他技能一起更，也不动你本地的 `config.json` / 创作 DNA / 产出文件。

## 更新

技能会持续迭代，用 `skills` 原生更新命令拿最新版：

```bash
npx skills update                # 更新已安装的全部技能到最新
npx skills update dby-publish    # 只更新某一个技能
```

> **当初带 `-g` 全局安装的，更新也要带 `-g`**（如 `npx skills update dby-publish -g`），否则更新不到全局那一份。

例：公众号排版默认已升级为「本鸭 · 知识清爽（benya-clean）」，已装旧版的用户需 `update` 后新默认才生效。

### 2026-08 改名说明

本次把三套前缀统一收成 `dby-`，并合并了两个公众号发布相关的包。新旧对照：

| 旧 slug | 新 slug |
|---|---|
| `doubaoya` | `dby-api` |
| `doubaoya-gateway` | `dby-gateway` |
| `wechat-article-pipeline` + `wechat-draft-publish` | `dby-publish`（合并为一个包） |
| `wechat-theme-studio` | `dby-theme` |
| `wechat-rewrite` | `dby-rewrite` |
| `multi-banned-words` | `dby-banned-words` |

**迁移方式**：跑 `/dby-update`。先跑一次让对账器升级到会读改名表的版本，再跑一次完成改名迁移——
`config.json` / `profiles/` / 自定义主题这类本地数据会自动搬到新目录，不用手动挪。

**如果第一跑就已经把老目录归档了**（说明对账器还是旧版，没赶上机制升级）：不丢数据，只是要多一步
手动。本地配置在归档目录里，按对账器输出末尾给出的复原命令（照着归档 `manifest.json` 逐条
`mv` 回去），把 `config.json` 拷到 `dby-publish/` 目录下即可。

**`ai-intelligence-investigator` 已下架**（情报 / 竞品 / 舆情调查，与公众号主线无关）。本地副本在
同一个归档目录里，用同一条复原命令就能把它移回来继续用。

**`dby-image`（AI 生图与改图）当前暂时下架**：本地旧副本仍会被归档，也能用复原命令搬回来，
但当前没有可执行的服务端出图能力，复原旧包也无法完成出图。未来是否恢复需重新评估，当前不承诺恢复
时间。现在需要图片时，请用你自己 agent 的生图工具，或自备现成图片交给 `dby-publish` 走
`--cover` / 正文 `<img src>`。

## 技能清单（共 12 个）

> 大部分技能要一条 `DOUBAOYA_API_KEY`（调 doubaoya.com 公开 API）；
> 标 **🖥 本地** 的纯本地运行、不联网、不需要 key，agent 自己干活。

### 🦆 入口与基础设施

| 技能 | 一句话 |
|------|--------|
| **dby** | 主入口：新手引导 + 任务前路由 + 任务后导航，按「选题 → 写草稿 → 排版 → 代发 → 复盘 → 反哺选题」飞轮逐跳路由（`/dby`、`/dby 新手入门`） |
| **dby-update** | 对账更新器：按仓库精确同步本鸭全集，不碰别人的包和本地配置；改名后会把本地数据搬到新目录（`/dby-update`） |
| **dby-charter** | 号章程 · 创作 DNA：定位问诊 + 文风蒸馏，选题 / 写作 / 复盘都按它走 |
| **dby-api** | 取数与创作总入口：一条 `DOUBAOYA_API_KEY` 调平台全部在架数据能力（热榜 / 爆文 / 账号 / 违禁词 / 联网查证），按意图路由 |
| **dby-gateway** | 调用网关（基础设施）：鉴权、路由、统一信封与错误码；给其他技能引用，不承接业务意图 |
| **dby-feedback** | 给本鸭提反馈：报 bug / 提建议 / 吐槽，agent 当场把本次会话真实经过写成完整反馈，用户过目全文后提交给维护者；端点不通落本地文件（不需要 key） |

### 📣 公众号工作流

| 技能 | 一句话 |
|------|--------|
| **dby-write** | 写作主干：读你的号章程与创作 DNA，选题 → 定目标与标题 → 提纲 → 正文 → 重写 → 摘要留言 → 自检，一口气写完一篇像你写的文章；也管**复盘**（按你自己的历史中位数分四象限，只告诉你该修哪一处） |
| **dby-publish** | 公众号图文流水线 + 存草稿：md → 公众号 HTML → 封面 → 存进你自己公众号草稿箱（只存草稿、绝不群发；需先绑号） |
| **dby-theme** | 按口语改公众号默认排版主题（配色 / 标题 / 引用 / 图注），本地预览后存回服务端 |

### 🌐 多平台

| 技能 | 一句话 |
|------|--------|
| **dby-rewrite** 🖥 | 多平台文案改写：公众号 / 视频号 / 抖音 / 快手 / B站 / 小红书 / 知乎，一稿多发；纯本地不需要 key |
| **dby-banned-words** | 跨平台违禁词对照（小红书 / 抖音 / 公众号）+ 一版全平台安全改写 |
| **dby-deai** 🖥 | 去 AI 味：把一段中文里「一眼就是 AI 写的」地方逐句指出来（套话、「不是A而是B」、三段排比、总分总、结尾升华），**默认只出体检报告不改稿**；不给 AI 率分数、不做学术降重、不帮规避 AI 标识；纯本地不需要 key |

## 怎么调（给好奇的人）

数据型技能统一走 doubaoya.com 的公开 API，统一信封返回：

```
POST https://doubaoya.com/api/apis/<platform>/<slug>/call
Authorization: Bearer $DOUBAOYA_API_KEY
Content-Type: application/json
```

成功 / 失败都是同一层信封：

```jsonc
{ "success": true,  "requestId": "req_...", "data": { /* 结果 */ }, "error": null }
{ "success": false, "requestId": "req_...", "data": null, "error": { "code": "...", "message": "..." } }
```

永远先看 `success`：`true` 取 `data`，`false` 读 `error.code` / `error.message`。
更完整的约定、错误码、端到端工作流见根技能 [`skills/dby-api/SKILL.md`](./skills/dby-api/SKILL.md)。

## License

PolyForm Noncommercial 1.0.0 —— 见 [LICENSE](./LICENSE)。© 2026 深圳观原生息科技有限公司（都爆鸭 / doubaoya）。

一句话：**你作为 doubaoya 用户装来给自己的号用，随便用、随便改，赚不赚钱都算非商业**；
拿去当自己产品 / 服务 / 数据接口的一部分分发或售卖，需要另谈商用授权（support@doubaoya.com）。
2026-08-26 之前的版本按 MIT 发布，已拿到的 MIT 副本不受影响。
