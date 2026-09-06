# 只想存草稿、不要排版（直接打 CLI）

> 只在**正文已经是公众号风格 HTML、没有本地图片也没有本地封面**、且不需要排版/主题/封面配图时读它。

正文**没有本地图片、也没有本地封面**、也不需要走本流水线的排版/主题/引导式设计——只是把已经是
**公众号风格 HTML**（不是 markdown）的正文存进草稿箱，直接打本包的 `scripts/dby.mjs` 引导壳
（转发到 `dby-api`，须与 dby-api 一起安装），不必走 `pipeline.mjs` 那一整串渲染/传图/封面步骤。
`$SKILL_DIR` = 本包目录（宿主加载本 SKILL.md 时给出的目录）：

```bash
node "$SKILL_DIR/scripts/dby.mjs" wechat publish --appid <authorizerAppid> --title "标题" --html article.html
# 默认停在确认态（退出码 6）并列出目标公众号与标题；用户点头后原样重放并加 --confirm
```

不知道 appid 先 `node "$SKILL_DIR/scripts/dby.mjs" wechat status` 看已绑定的公众号（0 个提示先去绑定）。参数：`--appid`、
`--title`、`--html <文件>` 三个必填，`--digest`、`--author`、`--source-url`、`--thumb-media-id` 可选，
其余看 `node "$SKILL_DIR/scripts/dby.mjs" wechat publish --help`。成功返回 `mediaId`。
微信侧上限（命令先拦再花钱）：标题 ≤ 32 字（后台放宽到 64，32–64 只警告）、摘要 ≤ 120 字（不传默认抓正文前 54 字）、
正文少于 2 万字符且小于 1MB。stderr 里的 `[notice] …` 是「你安装的 skill 有更新」，请原样转达给用户。

计费：**只在成功时扣点**。哪些错误码退点、失败/中断后怎么恢复重跑，见[恢复与重跑](./recovery.md)——口径只写在那一处。

> 正文里若含**本地图片**或**本地封面**，`wechat publish` 不会替你上传本机文件，图会被静默丢弃——
> 这种情况改用 `scripts/preprocess-and-publish.mjs`（见[组合结构](./modules.md)）或走完整的
> `pipeline.mjs`。
