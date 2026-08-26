# dby-publish · 公众号图文流水线（都爆鸭）

把一篇**已经写好的** Markdown / HTML，走一串**确定性的机械步骤**，最终存进你自己公众号的**草稿箱**——
**只存草稿，绝不群发**。存完给你 `mediaId`，你再去公众号后台亲眼确认、手动群发。

编排脚本把三件事串起来：
1. **whoami 校验账号**（本机多条 key → 挑出目标账号那条，key 只在内存）；
2. **md→公众号内联样式 HTML** 渲染（`--html` 时跳过）；
3. **本地图片预上传 + 存草稿**（复用 vendored 的 `preprocess-and-publish.mjs`）。
并在最前面**加载并回显身份上下文**（IP profile 的 `isNot` 消歧），防止账号名被误读成同名的通用名词。

> 完整的 10 步 SOP 与硬规则见 [`SKILL.md`](./SKILL.md) 与单一事实源 [`pipeline.json`](./pipeline.json)。

## 前置条件

- **Node ≥ 18**（内置 `fetch`），零外部依赖（仅用 Node 内置模块）。
- 一个 **doubaoya.com** 账号，并已**绑定你自己的公众号**。
- 一条 **`DOUBAOYA_API_KEY`**（doubaoya.com → 登录 → 密钥中心 → 生成）。

## 安装

把整个 `dby-publish/` 目录放进你的 skills 目录即可，无需 `npm install`。

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
dby-publish/
├── SKILL.md
├── README.md
├── LICENSE
├── pipeline.json                 # 10 步 SOP + 硬规则（人读的约定文档，脚本不读取）
├── config.example.json           # 配置模板（复制成 config.json 再填）
├── config.example.README.md      # 配置字段逐项说明
├── references/                   # 条件式细节文档（SKILL.md 按需指路，含 recovery.md）
├── themes/                       # 只留内置兜底主题 benya-clean.json；其余主题走服务端裸 id
├── profiles/
│   ├── example-ip.json           # 虚构示例身份卡（演示 schema）
│   └── README.md
└── scripts/
    ├── pipeline.mjs              # 编排者 CLI（心脏）
    ├── account-verify.mjs       # 多来源 key → whoami → 挑对账号
    ├── render-wechat-html.mjs   # md → 公众号内联样式 HTML（本机；已退出流水线主干，
    │                             #   只供「无密钥先看排版」，无在线预览链接）
    └── preprocess-and-publish.mjs  # vendored：传图 + 存草稿
```

## License

MIT — 见 [`LICENSE`](./LICENSE)。

---

## 最近变更

- **4.0.0**：出图与设计工作台整套下线。删除 `scripts/gen-image.mjs`（生图薄壳）、
  `scripts/design-studio.mjs` + 页面（本地可视化设计工作台）、`assets/`（6 张风格样图与 IP 图目录）、
  `references/guided-design.md` / `references/design-studio.md`、`schemas/design-config.schema.json`，
  以及 `pipeline.mjs` 的 `--design` 参数——这些老用法会坏（major）。封面与配图统一由 `dby-image` 出图：
  拿到本地文件路径后封面走 `--cover <路径>`、配图以 `<img src=本地路径>` 落进正文再渲染。
  配图位置规划脚本 `plan-figures.mjs` 迁往 `dby-image`。`config.json` 的 `ipImage` / `defaultStyleId`
  已无读者，从模板与字段说明中移除。
- **3.0.0**：包内主题只留内置兜底 `benya-clean`，其余 14 个服务端旧副本删除——把 `--theme` 或
  `config.mdTheme` 写成 `themes/xxx.json` 路径的用法会坏，改用裸 id（服务端解析，排版才与账号默认一致）。
- **2.5.0**：发布失败/中断有恢复文档了——新增 `references/recovery.md`（重跑不幂等、素材残留怎么处理、
  哪些错误码退点、从哪一步重来）；保存草稿抓不到 `mediaId` 时不再打「完成」横幅，改报「结果待确认」
  并以非零码退出（`mediaId` 是唯一凭据），失败信息也会说明已做过什么、现在什么状态；
  修掉 11 条文档断链；「服务端编译主题四级回退」等过期主题文档收敛到 `references/rendering.md`；
  主题顶层键清单收敛到 `scripts/validate-theme.mjs`；加 `.gitignore` 防止误提交 `config.json`；
  脚本步序日志去掉硬编码的 `/9` 分母。
- **2.4.2**：SKILL.md frontmatter 新增 `changelog:` 变更说明字段。
- **2.4.1**：把「报错码」从「绕开脚本才读」的条件里摘出来——429 按 IP 分桶、该退避不该重试，写进正文。
- **2.4.0**：按微信 draft/add 官方文档补字段上限前置校验（`scripts/lib/draft-limits.mjs`，三条入口共用：
  标题 >64 拒 / 32–64 警告、摘要 >120 拒、正文 ≥2 万字符或 ≥1MB 拒）；封面护栏 `COVER_GUARD` 改成
  「主体进居中正方形安全区」——公众号封面除 2.35:1 外还会从正中裁 1:1，原来只防上下。调研见 `docs/research/dby-publish/`。

- **2.3.0**：文档去掉「1536x1024 / 1024x1024」——`gen-image.mjs --size` 上游忽略，比例只靠 `--cover-guard` / prompt；
  SKILL.md 步骤改用步骤名（脚本日志的「步骤 N/9」与 SOP 编号不对应）；`cli.md` 补 `--render-only`；
  协议引用改成条件式（请求由脚本代发）；`pipeline.json` 版本与 SKILL 对齐。
- **合并原「公众号草稿发布」包（已下架）**：`unify-dby-naming` 改名车把本包的老目录名
  改成 `dby-publish` 的同时吸收了它——原包的 Python 入口 `publish_draft.py` 与「存公众号草稿 /
  公众号草稿箱 / 代发公众号草稿箱 / addDraft / draft/add」触发词并入本包，见
  `SKILL.md` 的「只想存草稿、不要排版」一节。
- **调用知识改成网关委托形态**：本 Skill 用到的三条能力现在 operationKey 与详情端点一起点名，
  调用协议逐字内联（照 `dby-gateway` §2 的模板；硬规则 6 要求内联而不是写一句「详见网关」），
  **入参规格一律调用前从详情端点现拉**——原来烤在正文里的返回字段表与计价数字已整段删掉
  （烤进分发物的契约必然漂，而价格会静默调整）。**十步 SOP 与终态判断一步没动。**
  （第 5 步当时被说成两条路；**现已收敛为只走平台渲染**，见下条。）
- **流水线的 md→HTML 已改为只走平台渲染**（`POST /api/wechat/render`）：主题由服务端套，
  产物自带在线预览链接（`detailUrl`），渲染失败一律中止、不回退本机渲染器。
  「拉服务端编译主题回本机套用」那套整个退场——主题从此只有一个事实源。
  同时那套自定义组件语法（关注卡 / 金句 / 花式标题 / 分割，冒号围栏写法）**已整体移除**，
  平台渲染器不解析它。改用普通 Markdown：金句用引用块、小节标题用二级标题、分割用 `---`；
  引导关注卡没有等价替代，需要的话在公众号编辑器里手工插。
  （这里刻意不写出那套记号的字面形式 —— 写出来就等于把它重新放进上下文，
  而它现在写了不会报错、只会原样漏成正文里的几个字符。）
  本机渲染器 `render-wechat-html.mjs` 保留，只服务设计工作台与「无密钥先看排版」。
  `validate-theme.mjs` 对 engine-2 主题（`meta.engine:2` / `tokens` / 带点号 token）
  仍是**硬错误**——这类主题只能用服务端编译版。
- 默认 Markdown 排版主题已切为 `benya-clean`（本鸭 · 知识清爽）。想沿用旧版
  `magazine`（杂志风）的，在 `config.json` 里把 `mdTheme` 指回 `themes/magazine.json`，或渲染时加 `--theme themes/magazine.json`。
