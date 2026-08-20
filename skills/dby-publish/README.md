# wechat-article-pipeline · 公众号图文流水线（都爆鸭）

把一篇**已经写好的** Markdown / HTML，走一串**确定性的机械步骤**，最终存进你自己公众号的**草稿箱**——
**只存草稿，绝不群发**。存完给你 `mediaId`，你再去公众号后台亲眼确认、手动群发。

编排脚本把三件事串起来：
1. **whoami 校验账号**（本机多条 key → 挑出目标账号那条，key 只在内存）；
2. **md→公众号内联样式 HTML** 渲染（`--html` 时跳过）；
3. **本地图片预上传 + 存草稿**（复用 vendored 的 `preprocess-and-publish.mjs`）。
并在最前面**加载并回显身份上下文**（IP profile 的 `isNot` 消歧），防止账号名被误读成同名的通用名词。

> 完整的 9 步 SOP 与硬规则见 [`SKILL.md`](./SKILL.md) 与单一事实源 [`pipeline.json`](./pipeline.json)。

## 前置条件

- **Node ≥ 18**（内置 `fetch`），零外部依赖（仅用 Node 内置模块）。
- 一个 **doubaoya.com** 账号，并已**绑定你自己的公众号**。
- 一条 **`DOUBAOYA_API_KEY`**（doubaoya.com → 登录 → 密钥中心 → 生成）。

## 安装

把整个 `wechat-article-pipeline/` 目录放进你的 skills 目录即可，无需 `npm install`。

## 快速开始

```bash
# 1. 配置（填你自己的值；字段说明见 config.example.README.md）
cp config.example.json config.json

# 2. 身份卡（改成你自己账号的身份）
cp profiles/example-ip.json profiles/my-ip.json
#    再把 config.json 的 ipProfile 指向 profiles/my-ip.json

# 3. 密钥
export DOUBAOYA_API_KEY="dyh_你的密钥"

# 4. 先干跑确认，再正式存草稿
node scripts/pipeline.mjs --md article.md --title "标题" --dry-run
node scripts/pipeline.mjs --md article.md --title "标题"
```

从已排好版的 HTML 直接发：

```bash
node scripts/pipeline.mjs --html article.html --title "标题"
```

`node scripts/pipeline.mjs --help` 查看全部参数。

## 安全说明

- **只存草稿，绝不群发。** 流水线里**没有任何群发路径**；传 `--mass-send`/`--broadcast`/带「群发」字样的参数会被**直接拒绝**。
- **发布前必 whoami**：账号校验不通过就停，绝不发到错误的账号。
- **绝不打印 API key**：key 仅在内存中传给子进程。
- `config.json` 与你自己的 `profiles/*.json` 属于你个人，**不要提交到公共仓库**（仓库只保留 `*.example.*`）。

## 目录

```
wechat-article-pipeline/
├── SKILL.md
├── README.md
├── LICENSE
├── pipeline.json                 # 单一事实源：9 步 SOP + 硬规则
├── config.example.json           # 配置模板（复制成 config.json 再填）
├── config.example.README.md      # 配置字段逐项说明
├── profiles/
│   ├── example-ip.json           # 虚构示例身份卡（演示 schema）
│   └── README.md
└── scripts/
    ├── pipeline.mjs              # 编排者 CLI（心脏）
    ├── account-verify.mjs       # 多来源 key → whoami → 挑对账号
    ├── render-wechat-html.mjs   # md → 公众号内联样式 HTML
    └── preprocess-and-publish.mjs  # vendored：传图 + 存草稿
```

## License

MIT — 见 [`LICENSE`](./LICENSE)。
