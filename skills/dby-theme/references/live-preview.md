# 本地实时换肤工作台（可选）

> 只在**本机已装 `dby-publish`**、且用户想要「改文件即换肤」的实时预览时读它。
> 改 themeJson 本身以 API 渲染那条路为准。

**(b) 本地实时换肤工作台**（可选,需已装 `dby-publish`,它带 `design-studio.mjs` 与 `themes/`）:
把编辑中的主题存成 `dby-publish/themes/<名>.json`,再起工作台,左侧手机公众号外框会把它作为一张主题卡实时预览,改文件重选即换肤:

```bash
node dby-publish/scripts/design-studio.mjs --md sample.md --title "预览"   # 默认 127.0.0.1:4599
```

（该工作台只绑本机、只写本地产物、不发布、不提交。它主打「选主题 + 封面 + 配图」,改 themeJson 本身仍以路 (a) 为准。）
