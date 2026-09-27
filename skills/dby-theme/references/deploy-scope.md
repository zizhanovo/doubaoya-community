# 落地生效范围（两条渲染路的主题源）

> 主题调好、要存回去时读它——它回答「存了之后到底哪条路会变、哪条不会」。

> **服务端默认主题**(`dby wechat theme-add --default` / `theme-update`)决定
> **doubaoya.com 网页排版工作室**和 **`dby render` / `dby preview`** 渲染出来的 HTML。
> **存回服务端设为默认 → 未钉本机主题的 `dby-publish` 发文也会用到它**——它内部具体怎么取,
> 是 `dby-publish` 自己的实现细节,不在本包描述;要细读读 `dby-publish/references/rendering.md`（若已装）。
>
> **仍需落本机文件**的情形:发文时钉着本机主题(`--theme` / `config.mdTheme` 路径)——
> 这种情况下只存服务端,发出去的还是本机那份旧排版。

**第一步 · 存回服务端(网页工作室 + `dby render|preview` + 未钉本机主题的发文这条路生效):**

```bash
# 新建并设为默认(首次)；返回里 data.theme.id 记下来
dby wechat theme-add --file t.json --name "暖橘编辑" --default

# 或更新已有主题(id 来自 dby wechat theme-get / theme-list)
# body.json 形如 { "themeJson": <t.json 的内容>, "isDefault": true }
dby wechat theme-update <主题id> --file body.json
```

两条命令都会先经服务端校验，不合法返回 400 并列出问题。

**第二步（按需）· 落成本机 theme 文件(发文时钉着本机主题的才需要):**

```bash
# 放进发文工作目录的 themes/ 下
cp t.json themes/my-theme.json

# 发文时显式指定这份主题(整套 JSON 交服务端校验并渲染)
dby wechat pipeline --md a.md --title "标题" --theme themes/my-theme.json --confirm
# 或把 config.json 的 "mdTheme" 指向 themes/my-theme.json,以后不必每次带 --theme
```

> **主题是在 doubaoya.com 网页排版工作室里调的?** 先拉下来再落到本机,别手抄:
> `dby wechat theme-get --json > cur.json`，把其中 `data.theme.themeJson` 这一段另存为 `t.json`。

落完再向用户汇报,并**如实说清各自的生效范围**:
**服务端默认排版已更新——网页排版工作室和 `dby render|preview` 立刻生效;
未钉本机主题的发文也会读到这份默认排版。**
若发文时钉着本机主题(`--theme` 或 `config.mdTheme` 路径),则以刚落下的
`themes/my-theme.json` 为准——别混着说,按用户的实际配置讲清楚哪条路生效。

---

## 回滚（改坏了怎么办）

第 1 步已经把改前的默认主题落盘到 `backup.json`（红线 4，`dby wechat theme-get --json` 的输出）。
存回服务端之后发现效果不对，把备份的 `themeJson` 原样写回去，服务端就恢复成改前的样子：

1. 看 `backup.json` 里的 `data.theme`：
   - **是 `null`**（改之前用户还没有默认主题）→ 无需回滚；直接 `dby wechat theme-rm <这次新建的id> --confirm`
     删掉这次新建的主题（先 `dby wechat theme-get` 确认它就是这次建的那份）。
   - **有 `id`** → 继续第 2 步。
2. 把 `data.theme.themeJson` 取出来写成 `restore.json`：`{ "themeJson": <备份里那段>, "isDefault": true }`。
3. `dby wechat theme-update <data.theme.id> --file restore.json`。

若还落过本机文件（第二步），把 `themes/my-theme.json` 也换回备份里 `data.theme.themeJson` 那一段。
