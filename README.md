# 都爆鸭 · doubaoya-community

> 新媒体爆款工作搭子的技能库 —— 一条密钥，让你的 AI agent 替你挖选题、追热点、搜内容、查账号、保合规、改文案。

这是 **都爆鸭（doubaoya）** 的社区 Agent Skill 库。把里面的技能装进你的 AI 助手
（Claude Code / Codex 等），配上一条 `DOUBAOYA_API_KEY`，agent 就会用
[doubaoya.com](https://doubaoya.com) 的公开 API 替你完成日常新媒体活儿——你只管说人话，
技术细节本鸭全包了。

部分技能（改写 / 调查 / PDF 提取这类）**纯本地运行、不联网、不需要 key**，agent 自己干活。

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

## 安装

```bash
npx skills add zizhanovo/doubaoya-community
```

也可以只装其中某一个技能：

```bash
npx skills add zizhanovo/doubaoya-community/skills/trending-hub
```

> **推荐从主入口开始**：装好后输入 `/dby`（都爆鸭公众号工具箱主入口），它按「选题 → 写草稿 → 排版 → 代发 → 复盘 → 反哺选题」的飞轮，逐步把你路由到该用的技能。第一次用输入 `/dby 新手入门`；干完一步不知道下一步，随时回 `/dby`。

## 更新

技能会持续迭代，用 `skills` 原生更新命令拿最新版：

```bash
npx skills update                          # 更新已安装的全部技能到最新
npx skills update wechat-article-pipeline  # 只更新某一个技能
```

> **当初带 `-g` 全局安装的，更新也要带 `-g`**（如 `npx skills update wechat-article-pipeline -g`），否则更新不到全局那一份。

例：公众号排版默认已升级为「本鸭 · 知识清爽（benya-clean）」，已装旧版的用户需 `update` 后新默认才生效。

> **只想更新本鸭、不碰别人的技能**：输入 `/dby-update`，它只按仓库精确同步 `zizhanovo/doubaoya-community`
> （`npx skills add zizhanovo/doubaoya-community -g -s '*' -a claude-code universal -y`），不会像无参数的 `npx skills update` 那样连你装的其他技能一起更，也不动你本地的 `config.json` / 创作 DNA / 产出文件。

## 技能清单（共 26 个）

> 大部分技能要一条 `DOUBAOYA_API_KEY`（调 doubaoya.com 公开 API）；
> 标 **🖥 本地** 的纯本地运行、不联网、不需要 key，agent 自己干活。

### 🦆 总纲

| 技能 | 一句话 |
|------|--------|
| **dby** ⭐ | 公众号工具箱**主入口**：新手引导 + 任务前路由 + 任务后导航，按飞轮逐跳把你路由到该用的技能（`/dby`） |
| **dby-update** | 本鸭更新入口：按仓库精确同步官方 doubaoya-community，不碰你装的其他技能、不动本地配置（`/dby-update`） |
| **doubaoya** | 总纲技能：教 agent 用一条密钥调 doubaoya.com 公开 API，挖选题 / 追热点 / 写脚本 |
| **doubaoya-gateway** | 调用网关（基础设施）：鉴权、两条互不回落的路由、统一信封与错误码，以及「入参规格调用前现拉」的纪律；附一份只供选路的能力索引。给其他技能引用，不承接业务意图 |

### 🧠 第二大脑（你自己的内容）

| 技能 | 能力 |
|------|------|

### 📣 公众号 / 视频号

| 技能 | 能力 |
|------|------|
| **wechat-hot-article** | 按关键词 + 时间区间拉同主题公众号爆文 |
| **wechat-account-analyzer** | 公众号账号诊断 / 体检，支持多号竞品对照 |
| **wechat-similar-account** | 公众号对标账号推荐，搭竞品矩阵 |
| **wechat-cover** | 同赛道爆款封面参考，提炼可复用视觉套路 |
| **wechat-banned-words** | 公众号违禁词检测 + 合规改写 |
| **wechat-rewrite** 🖥 | 把文案改写成公众号爆款风格 |
| **ip-profile** | 建 / 更新公众号「创作 DNA」（人设 / 赛道 / 文风蒸馏），生成文章时全程读它 |
| **dby-charter** | 定位教练：L0 三问 / L1 十五问 / 老号反推出结构化「号章程」，逐节确认后存回服务端，选题 / 写作 / 复盘都按它走 |
| **wechat-article-pipeline** | 公众号图文流水线：md→公众号 HTML→封面→存草稿箱（只存草稿、不群发） |
| **wechat-draft-publish** | 把写好的图文存进你自己公众号草稿箱（只存草稿、不群发，需先绑定公众号） |
| **wechat-theme-studio** | 按口语描述改公众号**默认排版主题**（配色 / 标题 / 引用 / 图注），本地预览后存回服务端 |

### 📕 小红书

| 技能 | 能力 |
|------|------|
| **xiaohongshu-rewrite** 🖥 | 把文案改写成小红书种草笔记风格 |

### 🌐 多平台 · 热点

| 技能 | 能力 |
|------|------|
| **trending-hub** | 全网热榜聚合，产跨平台选题信号 |
| **content-parse** | 粘公开链接，返回归一化作品 / 文章详情，拆解「为什么火」 |
| **multi-banned-words** | 跨平台违禁词对照 + 统一安全改写 |
| **multi-rewrite** 🖥 | 一稿多发：按各平台规则改写成多平台版本 |

### ✂️ 直播切片

| 技能 | 能力 |
|------|------|

### 🎬 短剧 · 文旅

| 技能 | 能力 |
|------|------|
| **playlet-wechat-feed** | 公众号短剧爆款文章日报内容源 |

### 🎨 AI 生成 · 搜索

| 技能 | 能力 |
|------|------|
| **image-gen** | GPT-image2 文生图 / 图生图 / 编辑 |
| **seedream-5-lite** | ⛔ **已下架**（2026-08-10，调用恒 503）——出图请改用 `image-gen` |

### 🖥 本地工具（不联网、不需要 key）

| 技能 | 能力 |
|------|------|
| **ai-intelligence-investigator** | 情报 / 竞品 / 舆情调查方法论，交叉验证产报告 |
| **optimize-skill-md** | 把一份 SKILL.md 规范化、优化到标准格式 |
| **pdf-image-text-extractor** | 本地从 PDF / 图片提取文字 |

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
更完整的约定、错误码、端到端工作流见根技能 [`skills/doubaoya/SKILL.md`](./skills/doubaoya/SKILL.md)。

## License

MIT —— 见 [LICENSE](./LICENSE)。© 都爆鸭 / doubaoya。
