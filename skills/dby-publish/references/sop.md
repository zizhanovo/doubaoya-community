# 10 步 SOP（权威在 `pipeline.json` 的 `steps[]`）

> 想逐步核对流水线到底做了哪几件事、或要向用户解释某一步时读它。日常跑 `pipeline.mjs` 不必读。

### 10 步 SOP
1. **识别任务类型** — 确认是「把已写好的文章推进公众号草稿箱」。
2. **读取身份上下文** — 加载并**回显** IP/身份 profile（名称 / 别名 / `isNot` 消歧 / 语气）。
3. **whoami 校验账号** — `GET /api/agent/whoami`，把本地 key 解析成目标账号那一条（key 只在内存）。
4. **草稿前置检查** — `GET /api/skills`（断言 `slug=wechat-draft-publish` 存在）+ `GET /api/wechat/status`（确认公众号、解析 appid/昵称）。
5. **md→HTML** — `--md` 时渲染成公众号内联样式 HTML（原样保留 `<img src>`）；`--html` 时直接用。
6. **封面 / 配图（可选，图归 `dby-image`）** — 需要新图时由 agent 走 `dby-image` 出图，拿到本地路径：封面喂 `--cover`；配图以 `<img src=本地路径>` 落进 Markdown 源对应 h2 小节末尾（位置可先用 `dby-image` 的 `plan-figures.mjs` 规划），入源后回到第 5 步重渲染。用户没提封面 / 配图就不出图。
7. **图片预处理** — 扫描 `<img>`，**本地图片客户端预上传**到图床（>1MB 先压缩）并改写 HTML；外链原样保留。
8. **封面** — 本地封面作为 thumb 预上传；没有则走都爆鸭兜底封面。
9. **保存草稿** — `POST /api/wechat/publish`（draft/add）。
10. **验证回报** — 标题 / 公众号 / 正文图上传数 / 封面 / mediaId / **群发：否**。
