# 用设计工作台（可视化替代）

> 只在用户说「不想在命令行里逐步选风格 / 生图，起个网页一次点完」时读它。
> 命令行引导式设计（SKILL.md「引导式设计」那节）与本页等价，二选一即可。

不想在命令行里逐步选风格 / 生图，可起本地网页工作台一次点完，产出一个 `design-config.json`，再交给
`pipeline.mjs --design` 消费。工作台零依赖（Node 内置 http + 全局 fetch），只绑 `127.0.0.1`，只写本地产物，不发布、不提交。

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
node scripts/design-studio.mjs --md <文章.md> --title "<标题>" \
     [--out <默认同目录 文章.design.json>] [--port 4599]
```

**注册卡通 IP（可选，保持全篇形象统一）**：把你的卡通 IP 形象图放进 `assets/ip/`（或页面顶部「上传 IP」），
并在 `config.json` 里把 `ipImage` 指向它。注册后，封面与配图默认走**参考图条件化生成**
（`operation:"edit"` + `referenceImage`），**保留同一形象**让全篇视觉统一；未注册则退回文生图。
见 [`assets/ip/README.md`](../assets/ip/README.md)。

页面三区：**①排版** = 主题卡片实时换肤预览（左侧 375px 手机公众号外框）；**②封面** = 选生图风格 →
生成候选（默认套用当前 IP 参考图，可再生 / 上传自己的）→ 挑一张；**③配图（自动布局）** = 点「自动配图」→
后端 `plan-figures.mjs`（确定性规则，不接 LLM）自动挑好位置（信息量大的 h2 小节末尾、张数按字数分档）→
逐张用 IP 参考图生成并**自动摆好**，用户只做「换一张 / 删除 / 整体重生」，**不手选锚点**。顶部「保存配置」
写出 `design-config.json`（含 `ip` 与自动填充的 `images[]`，过 [`schemas/design-config.schema.json`](../schemas/design-config.schema.json) 校验）。
生成的封面/配图 jpeg 落 `design-config` 同目录的 `.design/assets/`。

拿到 `design-config.json` 后进流水线（套主题 + 设封面 + 按 h2 锚点注入配图）：

```bash
node scripts/pipeline.mjs --md <文章.md> --title "<标题>" --design <文章.design.json> --dry-run
```

> `--design` 的主题 / 封面是默认值；显式 `--theme` / `--cover` 与之冲突时**命令行优先并告警**。配图按
> `afterHeading` 锚点插在对应 h2 小节末尾，找不到锚点则追加文末并告警。工作台 + `--design` 与上面的命令行
> 引导等价，二选一即可，都不触碰微信侧发布契约。

