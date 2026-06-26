# 都爆鸭 · doubaoya Skill

> 新媒体爆款工作搭子 —— 一条口令，让你的 AI agent 替你挖选题、追热点、写脚本。

这是一个 **Agent Skill**：把它装进你的 AI 助手（Claude Code / Codex 等），
配上一条 `DOUBAOYA_API_KEY`，agent 就会用 [doubaoya.com](https://doubaoya.com) 的公开 API
替你完成日常新媒体活儿——你只管说人话，技术细节本鸭全包了。

## 这玩意儿给谁用

新媒体运营、内容创作者、MCN、代运营、做内容工具的开发者——任何天天跟
**抖音 / 小红书 / 公众号 / 视频号** 选题和脚本打交道的人。

## 本鸭能干啥

- **挖爆款选题** —— 给个赛道词，返回正在升温的选题方向
- **追全网热点** —— 一次聚合多平台热榜，直接产选题信号
- **搜三大平台内容** —— 抖音、小红书、公众号的真实作品与文章
- **查达人账号** —— 粉丝量、作品概况，做竞品监控
- **解析作品** —— 粘个公开链接，返回归一化的标题 / 作者 / 互动数据
- **检测违禁词** —— 发布前保命，给风险等级和替换建议
- **写开场脚本** —— 以上数据当素材，由 agent 合成 3 秒钩子 + 开场脚本

## 先拿钥匙（口令）

1. 打开 https://doubaoya.com → **登录**
2. 进 **口令中心** → **生成口令**
3. 整条口令只在生成那一下完整露脸，复制收好（形如 `dyh_…`）

## 装好就用

把这个 Skill 装进你的 agent，然后直接喂它一句话（把 key 换成你自己的）：

> 下载并安装这个 doubaoya Skill，我的 DOUBAOYA_API_KEY 是 `dyh_你的口令`。
> 帮我挖今天美食赛道最可能爆的 3 个选题，并各写一段开场脚本。

agent 会把 key 存进环境变量 `DOUBAOYA_API_KEY`，之后自己调接口、自己拼结果。
**它不会把整条 key 回显出来。**

## 自己动手试一下（可选）

仓库附了一个零依赖封装（Node 18+）：

```bash
export DOUBAOYA_API_KEY=dyh_你的口令

node scripts/doubaoya.mjs list
node scripts/doubaoya.mjs invoke trend-radar '{"keyword":"美食","platforms":["douyin","xiaohongshu"]}'
node scripts/doubaoya.mjs describe xiaohongshu-viral-notes
```

## 怎么调（给好奇的人）

所有能力挂在 `https://doubaoya.com/api/...`，统一信封返回：

```
POST https://doubaoya.com/api/skills/<slug>/invoke
Authorization: Bearer $DOUBAOYA_API_KEY
```

完整说明、能力清单、错误处理、端到端工作流见 [`SKILL.md`](./SKILL.md)。

## License

MIT —— 见 [LICENSE](./LICENSE)。
