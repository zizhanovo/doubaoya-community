# 把命令串成自己的流程

面向要把 `dby` 的命令串成自己的取材 / 写作 / 发布链路、或造自己专属 skill 的人。
只写事实：每步对应哪几条命令、每种失败怎么处置、该在哪一档停手、哪里真花钱。
命令名逐字对过 `node skills/dby-api/scripts/dby.mjs routes --json`，参数细节一律看
`node "$D" <组> <命令> --help`，这里不重复。

---

## 七步落表：定位 → 选题 → 取材 → 写 → 审 → 排版 → 存草稿

| 步骤 | 干什么 | 用哪些命令 |
|---|---|---|
| ① 定位 | 立/读号章程与创作 DNA，后面每一步都按它走 | `charter profiles`、`charter get`、`charter put` |
| ② 选题 | 拿选题候选；用户已经说了写什么就跳过这步 | `write topics`（或 `wechat topics`，两条读的是同一批候选） |
| ③ 取材 | 五样档案打底，再按需加素材库 / 灵感库 / 往期文章 | `write prep`、`write articles`、`material list`、`material get`、`material add`、`insp list`、`insp add` |
| ④ 写 | agent 自己写正文，不调接口；写完先建稿留痕 | `draft create` |
| ⑤ 审 | 走审稿包：读意见 → 回应 → 裁决 → 合并 → 提交新版 | `draft review-packet`、`draft comment`、`draft decide`、`draft merge`、`draft submit` |
| ⑥ 排版 | 正文转成公众号可发的 HTML，核写作规范硬约束 | `wechat render`、`wechat writing-spec` |
| ⑦ 存草稿 | 图先传，再把排版好的正文推进用户自己的公众号草稿箱 | `wechat media-upload`、`wechat publish` |

🔴 **本表止于「存进草稿箱」。** 真正的群发在微信公众平台后台完成，`wechat publish` 不群发、
都爆鸭不提供也不该提供这个能力。

---

## 每步失败怎么办：退出码对照表

| 退出码 | 含义 | 处置 |
|---|---|---|
| 0 | 成功 | 继续下一步 |
| 1 | 一般错误（服务端 5xx、未预期异常） | 记下错误信息，可重试一次；再失败就上报用户，别悄悄吞掉 |
| 2 | 用法 / 参数错 | 改参数、看 `--help`，别猜着重试 |
| 3 | 业务态（`no_account`、查无此能力、`doctor` 有项不过…） | 按 `error.code` 分支处理。常见：`NOT_FOUND`（换 ref 或先 `api list`/`api search`）、`AMBIGUOUS_REF`（按提示点名 `platform/slug`）、`BANNED_CHECK_PARTIAL`（部分平台失败，看 `data` 里逐平台结果） |
| 4 | 鉴权失败 | 先核 `DOUBAOYA_API_KEY` 是否已设；已设仍 4 时可能是**服务端还没升级到这条路由**，别急着换 key |
| 5 | 网络超时 | 🔴 **计费类命令绝不自动重试**——先核实是否已经扣点（`usage logs` / `usage log <id>`），再决定要不要手动重放；免费只读命令可以直接重试 |
| 6 | 需确认 | 停下，把回执里的 `changes` 转述给用户；得到同意后把回执给的确认命令原样重放（或手动加 `--confirm`） |

---

## 终态阶梯：只渲染 / 存草稿 / 发布各停在哪

- **只渲染**：`wechat render` 产出 HTML 就结束，不产生任何服务端副作用，不需要确认。
- **存草稿**：`wechat media-upload`（先传图）→ `wechat publish`——两条都走确认协议，不带
  `--confirm` 时只停在确认态、零请求；用户点头后再原样加 `--confirm`。存进的是**用户自己
  公众号后台的草稿箱**，不是发布。
- **真正发布（群发）不在本 CLI 范围内**：那一步永远由用户自己在微信公众平台点。
- 🔴 **没让你发就别发**：用户没明确说「存草稿」或「发布」之前，写完正文只问终态，
  不擅自往下走一步。

---

## 计费红线

- **真花都爆鸭的钱的只有两类**：`api invoke`（按能力计费，价格 `api describe` 现拉）与
  `banned check`（逐平台各计费一次，价格同样现拉）。
- **写入用户自己账号、但不花都爆鸭的钱**：`wechat publish`、`wechat media-upload`，以及各种
  `delete` / `rm` 类命令（`profile delete`、`material rm`、`wechat theme-rm`、`usage log-rm`…）——
  它们套的是同一套确认协议（退出码 6），停下来是因为**不可逆或有副作用**，不是因为要扣点；
  协议层不区分这两种「停下」，处置方式一样：转述 `changes`，用户点头再 `--confirm`。
- 🔴 **入参一律现拉**：`api describe` 返回里的 `requestSchema`/`inputSchema` 是示例值不是
  JSON Schema，别照记忆或本文档拼字段。
- 🔴 **计费请求绝不自动重试**（退出码 5）：上游可能已经处理并扣了点，重试等于付两次钱。

---

## 怎么写自己的 SKILL.md

把上面的表按你自己的业务顺序重新组合，就是一份用户专属 skill。骨架抄
[`references/user-skill-template.md`](user-skill-template.md)，里面每一条命令名都已经过
对账闸核实存在——照抄改业务措辞，别改命令名本身。
