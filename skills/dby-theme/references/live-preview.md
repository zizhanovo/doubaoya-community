# 改一版看一版（服务端渲染预览）

> 想「改主题文件、重跑一条命令即换肤」地反复看效果时读它。

把编辑中的主题存成本机 `t.json`，每次改动后重跑同一条命令：

```bash
dby preview --file sample.md --theme-file t.json --title "预览"
# → sample.wechat.html（最终 HTML）+ sample.preview.html（375px 手机宽预览页，打开看）
```

- 渲染在服务端完成（免费、不发布、不提交），主题同时被服务端校验；不合法返回 400 并列出问题。
- 没有凭证退出码 4 → `dby login`；离线退出码 5，**没有本地回退**。
- 1.x 包里的本机渲染器在已装用户那里仍可用，支持到 3.0.0；2.x 起不再随包提供。
- 旧版推荐过的 `design-studio` 可视化工作台已随 dby-publish 4.0 下线,别再找它。
