# 落地生效范围（两条渲染路的主题源）

> 主题调好、要存回去时读它——它回答「存了之后到底哪条路会变、哪条不会」。

> **服务端默认主题**(`POST`/`PUT` + `isDefault:true`,存在 `userWechatTheme` 表里)决定
> **doubaoya.com 网页排版工作室**和 **`POST /api/wechat/render`** 渲染出来的 HTML。
> **`dby-publish` 发文**时的主题按
> `--theme x.json` > `config.json` 里写成路径的 `mdTheme` > **服务端编译主题**
> (`GET /api/wechat/theme?format=compiled`,即上面存回的默认主题,拉不到就回退) >
> 项目默认(`themes/benya-clean.json`)取。
>
> 所以:**存回服务端设为默认是主路**——发文机器只要配了 `DOUBAOYA_API_KEY` 且**没有**用
> `--theme` / `config.mdTheme` 钉死本机主题,pipeline 发文会自动拉到这份默认排版,无需再落本机文件。
> **仍需落本机文件**的情形:发文时钉着本机主题(`--theme`/`config.mdTheme` 路径)、离线/拉取失败要兜底、
> 或用的是不带自动拉取的旧版 pipeline——这些情况下只存服务端,发出去的还是旧(本机)排版。

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
发文机器配了 `DOUBAOYA_API_KEY` 且未钉本机主题时,pipeline 发文也会自动拉到这份默认排版
(拉不到会回退本机主题,不中断)。**若发文时钉着本机主题(`--theme` 或 `config.mdTheme` 路径),
则以刚落下的 `themes/my-theme.json` 为准——别混着说,按用户的实际配置讲清楚哪条路生效。

---

