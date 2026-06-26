# 都爆鸭 · doubaoya-community

> 新媒体爆款工作搭子的技能库 —— 一条口令，让你的 AI agent 替你挖选题、追热点、搜内容、查账号、保合规、改文案。

这是 **都爆鸭（doubaoya）** 的社区 Agent Skill 库。把里面的技能装进你的 AI 助手
（Claude Code / Codex 等），配上一条 `DOUBAOYA_API_KEY`，agent 就会用
[doubaoya.com](https://doubaoya.com) 的公开 API 替你完成日常新媒体活儿——你只管说人话，
技术细节本鸭全包了。

部分技能（改写 / 调查 / PDF 提取这类）**纯本地运行、不联网、不需要 key**，agent 自己干活。

## 这库给谁用

新媒体运营、内容创作者、MCN、代运营、做内容工具的开发者——任何天天跟
**抖音 / 小红书 / 公众号 / 视频号** 选题和脚本打交道的人。

## 先拿钥匙（口令）

需要调数据的技能要一条口令（API Key）：

1. 打开 https://doubaoya.com → **登录**
2. 进 **口令中心** → **生成口令**
3. 整条口令只在生成那一下完整露脸，复制收好（形如 `dyh_…`）
4. 设进环境变量：`export DOUBAOYA_API_KEY="dyh_你的口令"`

> agent 会把 key 存进环境变量，自己调接口、自己拼结果，**绝不把整条 key 回显出来**。

## 安装

```bash
npx skills add zizhanovo/doubaoya-community
```

也可以只装其中某一个技能：

```bash
npx skills add zizhanovo/doubaoya-community/skills/trending-hub
```

## 技能清单

### 总览

| 技能 | 一句话 |
|------|--------|
| **doubaoya** | 总纲技能：教 agent 用一条口令调 doubaoya.com 公开 API，挖选题 / 追热点 / 写脚本 |

### 数据型（需要 `DOUBAOYA_API_KEY`）

| 技能 | 能力 | 对应能力 |
|------|------|---------|
| **trending-hub** | 全网热榜聚合，产跨平台选题信号 | 热榜聚合 |
| **xiaohongshu-search** | 按关键词搜小红书爆款笔记 | 小红书搜索 |
| **xiaohongshu-hot-notes** | 按赛道发现高互动小红书爆款笔记（搜索+互动排序） | 小红书爆款 |
| **gongzhonghao-search** | 按关键词搜公众号文章，做行业 / 竞品 / 选题 | 公众号搜索 |
| **douyin-account-insight** | 查抖音账号资料、粉丝量、作品概况，做画像分析 | 抖音账号 |
| **douyin-account-works** | 抖音账号概况 + 作品体量概览 | 抖音账号 |
| **content-parse** | 粘公开链接，返回归一化作品 / 文章详情，拆解「为什么火」 | 内容解析 |
| **wechat-banned-words** | 公众号文案违禁词检测 + 合规改写 | 违禁词检测 |
| **multi-banned-words** | 同一文案跨多平台违禁词对照 + 统一安全改写 | 违禁词检测 |

### 本地型（不联网、不需要 key）

| 技能 | 能力 |
|------|------|
| **multi-rewrite** | 一稿多发：把文案按各平台规则改写成多平台版本 |
| **wechat-rewrite** | 把文案改写成公众号风格 |
| **xiaohongshu-rewrite** | 把文案改写成小红书种草笔记风格 |
| **zhihu-rewrite** | 把文案改写成知乎专业长文 / 答主体 |
| **ai-intelligence-investigator** | 情报 / 竞品 / 舆情调查方法论，交叉验证产结构化报告 |
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
