# 命令契约（章程 + 档案）

> 要查某条命令做什么、返回什么，或排 `CHARTER_INVALID` 一类错时读它。
> 调用方式见 SKILL.md「调用 dby」。

🔑 **章程和档案是同一个资源**：章程只是 IP 档案上的一个字段。所以契约只有这一张表，
两半都在这儿——上半是章程，下半是档案本身（人设 / 产品 / 文风 DNA / 头像）。
这些命令背后的路由**在 catalog 里没有条目**，「入参现拉」在这儿拉不到东西，所以本表是它们唯一的真相源，别删。

**章程**

| dby 命令 | 做什么 | 返回里要看的字段 |
|------|------|------|
| `dby charter get` | 读**默认档案**的章程（原样，含只读 `products`） | `charter`、`charterUpdatedAt`；没有章程退出码 3（`NO_CHARTER`） |
| `dby charter get --profile <id>` | 读指定档案的章程 | 同上 |
| `dby charter get --for-edit` | 读成可直接改再 put 的形态（已剥 `products`） | `> c.json` 后改其中的 `data.charter`；`put` 认得这层 `{ok, data}` 信封，只发章程本身 |
| `dby charter put c.json [--profile <id>]` | **全量替换**章程（不是增量 patch；无论如何都会再剥一次 `products`） | `charter`、`charterUpdatedAt` |

**档案本身**（人设 / 赛道 / 产品 / 文风 DNA / 头像，流程见
[`references/writing-dna.md`](references/writing-dna.md)）

| dby 命令 | 做什么 | 请求体关键字段 | 返回 |
|------|------|----------------|------|
| `dby profile get` | 查我的默认档案 | — | `profile`（`null` = 还没建） |
| `dby profile list`（同 `dby charter profiles`） | 查我的全部档案 | — | `profiles[]`（id / 是否默认 / 名字） |
| `dby profile create --file body.json` | 建档 | `name, isDefault, avatarUrl, imageUrls, personaJson, productsJson, niche, nicheTags` | `profile` |
| `dby profile update <id> --file body.json` | 改档 / 存蒸好的 DNA（只传要改的键） | 上面任意字段 + `writingDnaJson, dnaSampleCount, dnaDistilledAt, dnaModel, wechatThemeId, wechatAppid` | `profile` |
| `dby profile delete <id> --confirm` | 删档（不可逆，级联删该档案下的范文与文档） | — | `deleted: true, id` |
| `dby profile sample-add <id> --file 范文.md [--title T] [--source-url U]` | 存一篇范文（正文是纯文本，不是 JSON） | 正文 ≤ 50KB | `sample`、`dnaSampleCount` |
| `dby profile sample-list <id>` | 读回已存范文（带正文，重蒸时不必重贴） | — | `samples[]{id, title, sourceUrl, content, wordCount}`、`dnaSampleCount` |
| `dby profile sample-rm <id> <sampleId> --confirm` | 删一篇范文（不可逆） | — | — |
| `dby upload <本地图片>` | 上传图片到图床（存头像 / 生图参考图用；CLI 自己转 base64） | png/jpeg/webp，≤2MB（超限本地就拦） | `url, key, contentType, size` |

`--body '<json>'` 与 `--file` 二选一；`--confirm` 缺了不会执行，只回确认清单、退出码 6。

体积上限：`writingDnaJson` ≤ 32KB（超限 400 `DNA_TOO_LARGE`）；单篇范文 ≤ 50KB（超限 400
`SAMPLE_TOO_LARGE`）；上传图片 ≤ 2MB（超限 400 `IMAGE_TOO_LARGE`）。档案存取 / 范文录入
**全部免费**，不调 LLM、不扣点。

三条注意，一条都别漏：

- **`products` 是只读投影**：`charter get` 回来的 charter 附带一个合成的 `products`（来自档案 `productsJson`），
  原样 put 回去必 400。`charter get --for-edit`/`charter put` 已经替你剥了。
  改产品走档案那半边（`dby profile update`，见 [`references/writing-dna.md`](references/writing-dna.md) 的「六、个人产品」），不走章程命令。
- **put 是全量替换**：只改一个字段，也要先拿全量、改完把**整份**传回去。少传的键判「缺失」而 400。
- **无默认档案时 `dby charter get` 回 404 `NOT_FOUND`**。先建档
  （`dby profile create`，流程见 [`references/writing-dna.md`](references/writing-dna.md) 的
  「一、第一次建档」），拿到档案 id，再回来存章程。

### 错误处理

通用退出码：4 = 没有凭证（`dby login`）、5 = 网络不通、6 = 缺 `--confirm`；下面只列章程与档案自己的：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 404 | `NOT_FOUND` | 档案不存在 / 不属于你 / 无默认档案 | 先 `dby profile list` 确认 id，或先建档 |
| 400 | `CHARTER_INVALID` | 章程没过校验（枚举 / 长度 / 结构 / 体积 / `products` 回写） | 按 `message` 逐条修正后重 put |
| 400 | `VALIDATION_ERROR` | 档案参数不合法（如范文 `content` 为空） | 修正参数重试 |
| 400 | `DNA_TOO_LARGE` | `writingDnaJson` 超 32KB | 精简后重试 |
| 400 | `SAMPLE_TOO_LARGE` | 单篇范文超 50KB | 截断或分篇存 |
| 400 | `IMAGE_TOO_LARGE` | 上传图片超 2MB | 压缩后重试 |
| 400 | `UNSUPPORTED_TYPE` | 上传图片不是 png/jpeg/webp | 转换格式后重试 |
| 502 | `UPLOAD_FAILED` | 图床上传失败（上游临时故障） | 可重试 |

`CHARTER_INVALID` 的 `message` 是**所有校验问题用「；」拼成的完整清单**，原样透传给自己看，
**逐条改完一次性重 put**，不要一条一条试。

> 排错提示：如果拿到的不是 `CHARTER_INVALID`，而是通用的 `BAD_REQUEST`（形如「Body is not valid JSON…」），
> **先自查 body 里有没有 `__proto__` 键**——这类 body 在网关层就被拦掉了，拿不到逐条 errors。
> 章程结构里本来也不该出现这个键。
