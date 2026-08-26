# 本地渲染预览（可选）

> 只在**本机已装 `dby-publish`**、且用户想在本机快速看主题套上去的效果时读它。
> 改 themeJson 本身以 API 渲染那条路为准。

**(b) 本地渲染预览**（可选,需已装 `dby-publish`,用它的 `render-wechat-html.mjs`）:
把编辑中的主题存成本机 json,渲一版 HTML 打开看;改主题文件后重跑一条命令即"换肤":

```bash
node dby-publish/scripts/render-wechat-html.mjs --md sample.md --title "预览" \
  --theme my-theme.json --out preview.html
```

（纯本机、零依赖、不发请求、不发布、不提交。改 themeJson 本身仍以路 (a) 为准。
旧版这里推荐的 `design-studio.mjs` 可视化工作台已随 dby-publish 4.0 下线,别再找它。）
