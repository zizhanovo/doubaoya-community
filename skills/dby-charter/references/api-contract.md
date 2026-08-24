# API 契约（章程 + 档案）

> 要手写请求、查某条路由的方法/路径/返回，或排 `CHARTER_INVALID` 一类错时读它。
> 正常走 `scripts/charter.mjs` 的话不必读。

🔑 **章程和档案是同一个资源**：章程只是 IP 档案上的一个字段。所以契约只有这一张表，
两半都在这儿——上半是章程，下半是档案本身（人设 / 产品 / 文风 DNA / 头像）。
这些路由**在 catalog 里没有条目**，「入参现拉」在这儿拉不到东西，所以本表是它们唯一的真相源，
逐字与后端一致，别删。

**章程**

| 方法 | 路径 | 说明 | 返回 `data` |
|------|------|------|------|
| GET | `/api/ip-profile/charter` | 读**默认档案**的章程（便捷路由） | `{ profileId, charter \| null, charterUpdatedAt }` |
| GET | `/api/ip-profile/:id/charter` | 读指定档案的章程 | `{ charter \| null, charterUpdatedAt }` |
| PUT | `/api/ip-profile/:id/charter` | **全量替换**章程（不是增量 patch） | `{ charter, charterUpdatedAt }` |

**档案本身**（人设 / 赛道 / 产品 / 文风 DNA / 头像，流程见
[`references/writing-dna.md`](references/writing-dna.md)）

| 方法 | 路径 | 说明 | 请求体关键字段 | 返回 |
|------|------|------|----------------|------|
| GET | `/api/ip-profile` | 查我的默认档案 | — | `{ profile \| null }` |
| GET | `/api/ip-profiles` | 查我的全部档案 | — | `{ profiles: [] }` |
| POST | `/api/ip-profile` | 建档 | `name, isDefault, avatarUrl, imageUrls, personaJson, productsJson, niche, nicheTags` | `{ profile }` |
| PUT | `/api/ip-profile/:id` | 改档 / 存蒸好的 DNA | 上面任意字段 + `writingDnaJson, dnaSampleCount, dnaDistilledAt, dnaModel, wechatThemeId, wechatAppid` | `{ profile }` |
| DELETE | `/api/ip-profile/:id` | 删档 | — | `{ deleted: true, id }` |
| POST | `/api/ip-profile/:id/samples` | 存一篇范文 | `title?, sourceUrl?, content` | `{ sample, dnaSampleCount }` |
| GET | `/api/ip-profile/:id/samples` | 读回已存范文（带正文，重蒸时不必重贴） | — | `{ samples: [{ id, title, sourceUrl, content, wordCount }], dnaSampleCount }` |
| DELETE | `/api/ip-profile/:id/samples/:sampleId` | 删一篇范文（不带 Content-Type） | — | — |
| POST | `/api/upload` | 上传图片到图床（存头像 / 生图参考图用） | `dataBase64（data URI，png/jpeg/webp，≤2MB）, filename?` | `{ url, key, contentType, size }` |

体积上限：`writingDnaJson` ≤ 32KB（超限 400 `DNA_TOO_LARGE`）；单篇范文 `content` ≤ 50KB（超限 400
`SAMPLE_TOO_LARGE`）；上传图片 ≤ 2MB（超限 400 `IMAGE_TOO_LARGE`）。档案存取 / 范文录入
**全部免费**，不调 LLM、不扣点。

三条注意，一条都别漏：

- **`products` 是只读投影**：GET 回来的 charter 附带一个合成的 `products`（来自档案 `productsJson`），
  原样 PUT 回去必 400。`scripts/charter.mjs` 已经替你剥了；**只有手写请求时才需要自己剥**。
  改产品走档案那半边（[`references/writing-dna.md`](references/writing-dna.md) 的「六、个人产品」），不走 charter 路由。
- **PUT 是全量替换**：只改一个字段，也要先拿全量、改完把**整份**传回去。少传的键判「缺失」而 400。
- **无默认档案时 `GET /api/ip-profile/charter` 返回 404**。先建档
  （`POST /api/ip-profile`，流程见 [`references/writing-dna.md`](references/writing-dna.md) 的
  「一、第一次建档」），拿到档案 id，再回来存章程。

### 错误处理

通用报错码（401 / 429 / 5xx）见 `dby-gateway/references/protocol.md` 第 6 条；下面只列章程与档案自己的：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 404 | `NOT_FOUND` | 档案不存在 / 不属于你 / 无默认档案 | 先 `GET /api/ip-profiles` 确认 id，或先建档 |
| 400 | `CHARTER_INVALID` | 章程没过校验（枚举 / 长度 / 结构 / 体积 / `products` 回写） | 按 `message` 逐条修正后重 PUT |
| 400 | `VALIDATION_ERROR` | 档案参数不合法（如范文 `content` 为空） | 修正参数重试 |
| 400 | `DNA_TOO_LARGE` | `writingDnaJson` 超 32KB | 精简后重试 |
| 400 | `SAMPLE_TOO_LARGE` | 单篇范文超 50KB | 截断或分篇存 |
| 400 | `IMAGE_TOO_LARGE` | 上传图片超 2MB | 压缩后重试 |
| 400 | `UNSUPPORTED_TYPE` | 上传图片不是 png/jpeg/webp | 转换格式后重试 |
| 502 | `UPLOAD_FAILED` | 图床上传失败（上游临时故障） | 可重试 |

`CHARTER_INVALID` 的 `message` 是**所有校验问题用「；」拼成的完整清单**，原样透传给自己看，
**逐条改完一次性重 PUT**，不要一条一条试。

> 排错提示：如果拿到的不是 `CHARTER_INVALID`，而是通用的 `BAD_REQUEST`（形如「Body is not valid JSON…」），
> **先自查 body 里有没有 `__proto__` 键**——这类 body 在网关层就被拦掉了，拿不到逐条 errors。
> 章程结构里本来也不该出现这个键。

### 手写请求（一般不用）

正常走 `scripts/charter.mjs`（见上面「怎么读写章程」）。
只有在没有 Node、或要把这条路嵌进别的程序时才手写——那时**自己记得剥 `products`**、
并且 PUT **整份**而不是增量。
