# 组合结构（不重复造轮子）

> 只在要弄清流水线由哪几段组成、或想不走整条流水线自己组合时读它。

`dby wechat pipeline` 是编排者，它串起下面几段：

| 阶段 | 做什么 | 单独用时的命令 |
|------|------|------|
| 账号解析 | 两处来源（环境变量 `DOUBAOYA_API_KEY` → `dby login` 存的凭证）候选 → 逐个 whoami 校验账号 → 按目标账号挑对 key，key 只在内存。多 key 指向不同账号且未指定 `--account` 时，报出各 key 对应账号并停。 | `dby whoami` |
| md→公众号 HTML | **平台渲染**：免费不扣点，主题由服务端套，返回 HTML、`themeSource`、`warnings`、在线预览链接。**失败即中止，没有本地回退**。 | `dby render` / `dby preview` |
| 封面/配图 | **不在本包**。需要新图且用户明确要了时走 `dby-image`，或用户自备：落成本地文件后接回本包，封面喂 `--cover`，配图以 `<img src=本地路径>` 落进正文，**不碰发布契约**。 | `dby image gen …`（归 dby-image） |
| 传图 + 存草稿 | 本地图预上传 + >1MB 压缩 + 封面上传 + 存草稿（draft/add，无群发）。 | 已排好版且带本地图：`dby wechat pipeline --html … --confirm`；无本地图/无本地封面：`dby wechat publish`（见[只想存草稿、不要排版](./draft-only.md)） |

编排者把这几段串起来，并加上身份上下文加载、草稿前置检查、硬门与结构化回报。
1.x 包里的本机渲染器在已装用户那里仍可用，支持到 3.0.0；2.x 起不再随包提供。
