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
