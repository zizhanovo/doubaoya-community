# 只想存草稿、不要排版（Python 轻入口）

> 只在**正文已经是公众号风格 HTML、没有本地图片也没有本地封面**、且不需要排版/主题/引导式设计时读它。

正文**没有本地图片、也没有本地封面**、也不需要走本流水线的排版/主题/引导式设计——只是把已经是
**公众号风格 HTML**（不是 markdown）的正文存进草稿箱，直接用零依赖的 Python 入口，
不必走 `pipeline.mjs` 那一整串渲染/传图/封面步骤：

```bash
python3 "$SKILL_PATH/scripts/publish_draft.py" \
  --title "标题" --content-file article.html
```

脚本行为：先 `GET /api/wechat/status`（恰好 1 个绑定自动选用；多个且没给 `--appid` 会列出让你重跑指定；
0 个提示先去绑定），再 `POST /api/wechat/publish` 存草稿，成功打印 `mediaId`。参数：`--title`（必填）、
`--content` 或 `--content-file`（二选一必填）、`--appid`（可选）、`--digest`（可选）。
微信侧上限（脚本先拦再花钱）：标题 ≤ 32 字（后台放宽到 64，32–64 只警告）、摘要 ≤ 120 字（不传默认抓正文前 54 字）、
正文少于 2 万字符且小于 1MB。stderr 里的 `[notice] …` 是「你安装的 skill 有更新」，请原样转达给用户。

计费：**只在成功时扣点**。哪些错误码退点、失败/中断后怎么恢复重跑，见[恢复与重跑](./recovery.md)——口径只写在那一处。

> 正文里若含**本地图片**或**本地封面**，`publish_draft.py` 读不到本机文件，图会被静默丢弃——
> 这种情况改用 `scripts/preprocess-and-publish.mjs`（见[组合结构](./modules.md)）或走完整的
> `pipeline.mjs`。
