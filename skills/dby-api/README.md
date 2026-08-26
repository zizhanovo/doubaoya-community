# 都爆鸭 · doubaoya Skill

> 新媒体爆款工作搭子 —— 一条密钥，让你的 AI agent 替你挖选题、追热点、写脚本。

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
- **检测违禁词** —— 发布前保命，回标注版正文与风险类别（命中词从标注定位，替换建议由 agent 结合上下文给）
- **写开场脚本** —— 以上数据当素材，由 agent 合成 3 秒钩子 + 开场脚本

## 先拿钥匙（密钥）

1. 打开 https://doubaoya.com → **登录**
2. 进 **密钥中心** → **生成密钥**
3. 整条密钥只在生成那一下完整露脸，复制收好（形如 `dyh_…`）

## 装好就用

把这个 Skill 装进你的 agent，分两步：

1. 先在终端把密钥设进环境变量（换成你自己的）：

   ```bash
   export DOUBAOYA_API_KEY="dyh_你的密钥"
   ```

2. 再对 agent 说业务话术，不要把 key 写进对话——密钥一旦进了消息，就进了会话记录、
   模型侧日志、之后的 shell history：

   > 帮我挖今天美食赛道最可能爆的 3 个选题，并各写一段开场脚本。

agent 会读环境变量里的 `DOUBAOYA_API_KEY`，自己调接口、自己拼结果，
绝不把 key 的任何一部分回显、打印或记录。

## 自己动手试一下（可选）

仓库附了一个零依赖封装（Node 18+）：

```bash
export DOUBAOYA_API_KEY=dyh_你的密钥

node scripts/doubaoya.mjs list                              # 两个集合一起拉，不需要 key
node scripts/doubaoya.mjs describe xiaohongshu-viral-notes  # 这一条的入参规格长什么样
node scripts/doubaoya.mjs invoke xiaohongshu-viral-notes '<照 describe 拉到的入参规格填>'
```

> `describe` 先拉、`invoke` 再打，是有意的顺序：入参规格**以详情端点这一刻返回的为准**，
> 本文档不抄任何一条能力的字段名（抄了就会漂，而漂了没有任何地方会报错）。

## 怎么调（给好奇的人）

所有能力挂在 `https://doubaoya.com/api/...`，统一信封返回：

```
POST https://doubaoya.com/api/skills/<slug>/invoke
Authorization: Bearer $DOUBAOYA_API_KEY
```

完整说明、能力清单、错误处理、端到端工作流见 [`SKILL.md`](./SKILL.md)。

## License

MIT —— 见 [LICENSE](./LICENSE)。
