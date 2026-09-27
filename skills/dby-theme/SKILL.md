---
name: dby-theme
description: >-
  公众号排版主题工作室 · 按你的口语改公众号文章的**默认排版样式**（配色 / 标题 / 引用 / 图注），本地即时预览，
  最后同时落到两处：存回服务端 + 存成本机 theme 文件。走 doubaoya.com，鉴权用你自己的 DOUBAOYA_API_KEY。
  触发方式：/dby-theme、改公众号排版、定制主题样式、换公众号配色、调排版主题、改默认排版。
  Trigger words: customize WeChat article theme, change layout / palette / heading style.
version: 2.0.0-next.0
changelog: 随 @doubaoya/cli 2.0.0-next.0 统一发版，要点见 CHANGELOG.md
compatibility: >-
  只需要 Node ≥22（经 `dby` 命令运行：全局安装的 dby 或 npx 拉取确切版本 @doubaoya/cli，零依赖）；
  联网命令需要凭证（`dby login` 或环境变量 DOUBAOYA_API_KEY）。渲染与存主题免费。
---

# 公众号排版主题工作室（都爆鸭）

排版是一份声明式的 **`themeJson`**（配色 palette + 每个标签的 inline-style 模板），渲染器按它把
Markdown 确定性地渲成公众号内联样式 HTML。按描述生成 / 修改合法的 themeJson，
服务端渲染预览，再**存回服务端设为默认**；发文钉了 `--theme` / `config.mdTheme` 时再落一份本机文件。
渲染 / 存主题都**免费不扣点**。

## 调用 dby

1. 先跑 `node -v`：没有 Node 或主版本低于 22 就停下，请用户先装 Node 22+；此时不跑任何 npm / npx。
2. `dby --version` 输出正好是 `2.0.0-next.0` 时，直接 `dby <组> <命令>`。
3. 否则 `npx -y --fetch-timeout=15000 @doubaoya/cli@2.0.0-next.0 <组> <命令>`；registry 不可达就加 `--registry=https://registry.npmmirror.com` 重试同一版本，仍失败就停下报告，不换版本。
4. 退出码 4（没有凭证）→ 请用户跑 `dby login`；计费命令超时不重试。

---

## ⚠️ 四条硬红线（先读，全程守住）

### 红线 1 · 微信兼容:标题装饰只能挂在有文字的元素自身

公众号编辑器会 **strip 掉没有文字、纯靠 inline-block 宽高 + background 撑色块的空 `<section>`/`<span>`**。
标题引导条 / 强调竖条 / 下划线**必须作为 inline style 直接写在标题元素自身**，**绝不**用独立的空装饰块。

- ✅ 对:`elements.h2.style` 里直接写 `border-left:4px solid {{accent}};border-bottom:1px solid {{border}};padding:0 0 8px 11px;`
- ❌ 错:用 `wrapBefore` 注入一个空的 `<section style='width:32px;height:4px;background:…'>` 当色条（无文字 → 被 strip）。

### 红线 2 · 微信兼容:别给整篇套 `decorations.articleWrap` 外框

`articleWrap` 包整篇正文的浅底圆角卡片在公众号里会变成一道**突兀的边框**。
`articleWrap.before` / `after` 留空字符串；「呼吸感」用段间距和局部卡片（如 blockquote 圆角卡）实现。

### 红线 3 · 安全:themeJson 会内联进公众号草稿,服务端会拒收不合法主题

本地不再校验：服务端在 `dby preview --theme-file` 与 `dby wechat theme-add` / `theme-update` 时校验，
不合法返回 **400** 并列出问题——按它改到过为止，不在这里另存一份会漂移的规则清单。

微信编辑器官方规范另有八条「不拒但走样」的写法（`position`、`text-align:start`、固定像素宽、自定义字体栈…），
清单与可读性基线见 `references/theme-schema.md` 末尾。

### 红线 4 · 数据安全:动手改前必须落盘备份,没有备份不改

改主题是**就地覆写**（`theme-update` / `theme-add --default`），服务端不保留历史版本，改坏了没有第二处能找回。
第 1 步的备份命令**照抄不删**；备份文件路径记下来，改坏了照 `references/deploy-scope.md`「回滚」一节恢复。

---

## 命令

各命令的参数与返回字段 → 读 `references/crud.md`，不需要就别读。
**渲染的主题优先级** `--theme-file`（编辑中的这份）> `--theme` > 我的默认主题 > 兜底 `benya-clean`，
所以**预览编辑中的主题就用 `--theme-file`**；**一人一默认**，设默认时服务端把我其他主题的默认标记取消。

## 闭环步骤

### 1. 读起点主题并落盘备份（红线 4，照抄不删）

```bash
# a) 读我当前的默认主题并落盘备份——主题体在 data.theme.themeJson，id 在 data.theme.id
dby wechat theme-get --json > backup.json

# b) 或列出内置主题,挑一个复制起步(推荐 benya-clean——已按红线 1 / 2 改造过)
dby wechat theme-list
```

> 本 skill 也自带一个 WeChat-safe 起手模板 [`themes/theme.example.json`](./themes/theme.example.json)（暖橘编辑风,复制改配色即可）。

### 2. 按用户口语描述改 themeJson

把「换成暖橘色 / 标题要竖条 / 引用做成卡片 / 字再大一点」翻译成合法 themeJson，存成 `t.json`。
字段全貌见 `references/theme-schema.md`;守住上面四条红线。改配色最省事:**只动 `palette` 八个键**。

### 3. 预览（改一版看一版，服务端校验 + 渲染）

```bash
dby preview --file sample.md --theme-file t.json --title "预览"
# → sample.wechat.html（与存进草稿的正文逐字一致）+ sample.preview.html（375px 手机宽预览页，打开看）
```

> `sample.md` 别带 `#` 一级标题：`title` 会被插成 h1，正文再有就显示两个大标题。
> 返回里有 warnings（如未知 `{{token}}`）一并看一眼。每次改完 `t.json` 重跑这一条即换肤——见 `references/live-preview.md`。

### 4. ⚠️ 落地生效范围

→ 主题调好、要存回去时读 `references/deploy-scope.md`——它回答「存了之后哪条路会变、
哪条不会」，并给出存回服务端 / 落本机文件 / 改坏了回滚的完整命令。

**存回服务端设为默认是主路**（`dby wechat theme-add --file t.json --default` 或 `theme-update`）：
网页排版工作室、`dby render|preview`、以及**未钉本机主题的 `dby-publish` 发文**都读它。
**仍需落一份本机 theme 文件**的只有发文时钉着 `--theme` / `config.mdTheme` 的情形。
落完向用户汇报时**如实说清各自的生效范围，别混着说**。

## themeJson 结构（速查）

→ 真要动手写 / 改 themeJson 的字段时读 `references/theme-schema.md`，不需要就别读。
**只换配色的话改 `palette` 八个键就够**，其余用 `{{token}}` 自动跟随。

---

## 下一步（先看用户要的终态是什么）

**别默认往下推**——用户要的终态停在哪一档，就在哪一档收手：

| 用户要的终态 | 到这一步够不够 | 下一步 |
|---|---|---|
| 只要把默认排版改成自己想要的样子 | ✅ 够了，**到这里就结束** | — |
| 还要**用这套主题排版某篇正文、存进草稿箱** | 不够 | `dby-publish`（默认排版它会自动用；本机主题文件用 `--theme` 指过去） |
| 已有排好版的图文，只想让它进草稿箱 | 不够 | `dby-publish` |
| 正文还没写 | 不够 | `dby-api`（拉同主题爆文样本再写正文，走 api.gzh.hotArticle） |
| 正文没过违禁词 | 不够 | `dby-banned-words` |
| 说不清要到哪一步 | — | `dby`（公众号飞轮的逐跳导航） |
