# wechat-article-pipeline · 公众号图文全链路（都爆鸭）

一句「帮我写篇公众号爆文发出去」，agent 就从头走到尾：**查热点定选题 → 写正文 → 过合规 →
做封面 → 排版 → 存进你自己公众号的草稿箱**。

**只存草稿，绝不群发。** 存完你去公众号后台亲眼确认，再由你自己手动群发。

## 这个包长什么样

| 文件 | 装什么 |
|---|---|
| [`SKILL.md`](./SKILL.md) | **判断与编排**：每一步用哪条都爆鸭能力、结果怎么用、什么时候该停下来问人；外加逐字内联的调用协议 |
| [`references/local-tools.md`](./references/local-tools.md) | **只在平台能力办不到时才读**：本机图片预上传、无密钥的本地排版预览、复刻一篇文章的排版 |
| [`pipeline.json`](./pipeline.json) | 本地发布执行器（`scripts/pipeline.mjs`）的 10 步 SOP 与硬规则，脚本以它为准 |
| `scripts/` `themes/` `assets/` `profiles/` | 上面那些本地活儿的实现与素材 |

> **入参规格不写在这个包里**，一律调用前从平台的详情端点现拉——把契约烤进分发物，
> 下一次上游改版它就变成一份看起来很确定、其实在骗人的假规格。协议见 `SKILL.md`，
> 完整版见 `doubaoya-gateway`。

## 前置条件

- 一条 **`DOUBAOYA_API_KEY`**（doubaoya.com → 登录 → 密钥中心 → 生成），设进环境变量。
- 要存草稿，还需在 doubaoya.com **绑定你自己的公众号**。
- 只做本地排版预览 / 写主题：**不需要密钥、不需要绑号**，但需要 **Node ≥ 18**（零外部依赖）。

## 安装

把整个 `wechat-article-pipeline/` 目录放进你的 skills 目录即可，无需 `npm install`。
建议连 `doubaoya-gateway` 一起装——选路不确定时 agent 会去读它的能力索引。

## 安全说明

- **只存草稿，绝不群发。** 没有任何群发路径；传 `--mass-send` / `--broadcast` / 带「群发」字样的参数会被直接拒绝。
- **发布前必先校验账号**：账号校验不通过就停，绝不发到错误的账号。
- **绝不打印 API key**：key 仅在内存中传给子进程，需要确认时只说前缀。
- `config.json` 与你自己的 `profiles/*.json` 属于你个人，**不要提交到公共仓库**（仓库只保留 `*.example.*`）。

## License

MIT — 见 [`LICENSE`](./LICENSE)。
