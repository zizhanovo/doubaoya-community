# API 契约（本包用到的免费路由）

> 要绕开 `scripts/write.mjs` 自己发请求、或想确认某条路由计不计费时读它。

| 方法 | 路径 | 干什么 | 计费 |
|---|---|---|---|
| GET | `/api/ip-profile` | 我的默认档案（`{profile:null}` = 还没建） | 免费 |
| GET | `/api/ip-profile/:id/charter` | 号章程（定位/受众/变现/北极星 + 只读投影 `products`） | 免费 |
| GET | `/api/ip-profile/:id/samples` | 范文样本（带正文） | 免费 |
| DELETE | `/api/ip-profile/:id/samples/:sampleId` | 删一篇范文（不带 Content-Type！） | 免费 |
| GET | `/api/ip-profile/wechat-history?authorizerAppid=&count=` | 从自己授权的号拉历史图文（最多 20 篇，带 `text` 纯文本）；第 4 步 `articles` 子命令走它 | 免费 |
| GET | `/api/wechat/topics?niche=` | 选题卡（已并入自己的表现信号），回 `{ topics: [{ title, angle, why, refs }], notice? }` | 免费 |
| GET | `/api/wechat/review` | 复盘：已发文章 + 指标 + 赛道动态 | 免费 |

档案的**写入**（建档 / 改人设 / 存范文 / 蒸 DNA / 立章程）不在本包，走 `dby-charter`。

🔴 `GET /api/articles`（微信同步的已发文章）**只认登录态**，拿 `dyh_` 密钥调必回 `UNAUTHORIZED`——往期文章走上面的 `wechat-history`。


## 交棒给 dby-publish 的两条命令行（SKILL.md 交棒节）

用户只要成稿就到此为止，不交棒；终态未明先问一句。
② ③ 都先把成稿落盘 `.md`（正文，不含标题）再交棒。

**② 只要排版好的 HTML**（`--render-only`：渲染免费，**不需要绑公众号**）：
```bash
node <dby-publish>/scripts/pipeline.mjs --md 稿子.md --title "标题" --render-only
```

**③ 存进公众号草稿箱**（完整流水线，**这一步才需要已绑号**）：
```bash
node <dby-publish>/scripts/pipeline.mjs --md 稿子.md --title "标题" --digest "<摘要>"
```

⚠️ 第 8 步的留言流水线没有地方放，随成稿交给用户手动贴。

交棒后的回执四行：**查阅 / 执行 / 质检 / 跳过**——没走的步写进「跳过」并说明原因。


## 违禁词自检的命令行（第 9 步自检第 1 项）

```bash
python3 <dby-banned-words>/scripts/check_multi.py "<标题+摘要+成稿>" --platforms gongzhonghao
```

🔴 平台写死一个（只查公众号），标题、摘要、正文一起查。**任何终态都要跑。**
