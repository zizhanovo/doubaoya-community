# 落地生效范围（两条渲染路的主题源）

> 主题调好、要存回去时读它——它回答「存了之后到底哪条路会变、哪条不会」。

> **服务端默认主题**(`POST`/`PUT` + `isDefault:true`,存在 `userWechatTheme` 表里)决定
> **doubaoya.com 网页排版工作室**和 **`POST /api/wechat/render`** 渲染出来的 HTML。
> **存回服务端设为默认 → 未钉本机主题的 `dby-publish` 发文也会用到它**——它内部具体怎么取、
> 按什么优先级取,是 `dby-publish` 自己的实现细节,不在本包描述;要细读读
> `dby-publish/references/rendering.md`（若已装）。
>
> **仍需落本机文件**的情形:发文时钉着本机主题(`--theme`/`config.mdTheme` 路径)、或要离线兜底——
> 这些情况下只存服务端,发出去的还是本机那份旧排版。

**第一步 · 存回服务端(网页工作室 + `/api/wechat/render` + 未钉本机主题的 pipeline 发文这条路生效):**

```bash
# 新建并设为默认(首次)
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg name "暖橘编辑" --slurpfile t /tmp/my-theme.json \
        '{name:$name, themeJson:$t[0], isDefault:true}')" \
  "$BASE/api/wechat/theme" | jq '.data.theme.id'

# 或更新已有主题(从 GET /api/wechat/theme 或 /themes 拿到 id 后)
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d "$(jq -n --slurpfile t /tmp/my-theme.json '{themeJson:$t[0], isDefault:true}')" \
  "$BASE/api/wechat/theme/<主题id>" | jq '.data.theme.updatedAt'
```

**第二步（按需）· 落成本机 theme 文件(发文时钉着本机主题、或要离线兜底的才需要):**

```bash
# 放进 pipeline 的 themes/ 目录(路径按本机 dby-publish 的实际安装位置)
cp /tmp/my-theme.json <dby-publish>/themes/my-theme.json

# 发文时显式指定这份主题
node scripts/pipeline.mjs --md a.md --title "标题" --theme themes/my-theme.json
# 或把 config.json 的 "mdTheme" 指向 themes/my-theme.json,以后不必每次带 --theme
```

> **主题是在 doubaoya.com 网页排版工作室里调的?** 先把它拉下来再落到本机,别手抄:
>
> ```bash
> curl -s -H "$AUTH" "$BASE/api/wechat/theme" | jq '.data.theme.themeJson' > /tmp/my-theme.json
> ```

落完再向用户汇报,并**如实说清各自的生效范围**:
**服务端默认排版已更新——网页排版工作室和 `POST /api/wechat/render` 立刻生效;
发文机器配了 `DOUBAOYA_API_KEY` 且未钉本机主题时,pipeline 发文也会读到这份默认排版。**
若发文时钉着本机主题(`--theme` 或 `config.mdTheme` 路径),则以刚落下的
`themes/my-theme.json` 为准——别混着说,按用户的实际配置讲清楚哪条路生效。

---

## 回滚（改坏了怎么办）

第 1 步的 GET 命令已经把改前的默认主题落盘到 `$BACKUP`（红线 4）。存回服务端之后发现效果不对，
把备份的 `themeJson` 原样 PUT 回去，服务端就恢复成改前的样子：

```bash
# 备份里有主题 id 才能回滚(id 来自 data.theme.id);没有 id 说明改之前用户还没有默认主题,
# 这种情况无需回滚——直接把这次新建的主题 DELETE 掉即可(先用 GET 确认它不是别的默认主题)
THEME_ID="$(jq -r '.data.theme.id // empty' "$BACKUP")"
if [ -n "$THEME_ID" ]; then
  curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
    -d "$(jq -n --slurpfile b "$BACKUP" '{themeJson:$b[0].data.theme.themeJson, isDefault:true}')" \
    "$BASE/api/wechat/theme/$THEME_ID" | jq '.data.theme.updatedAt'
else
  echo "备份里没有主题 id(改之前没有默认主题),无需回滚"
fi
```

若还落过本机文件（第二步），把它也换回备份内容：

```bash
jq '.data.theme.themeJson' "$BACKUP" > <dby-publish>/themes/my-theme.json
```

---

