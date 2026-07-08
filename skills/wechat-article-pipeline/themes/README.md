# themes/ — 公众号 排版主题

一个**主题**（`theme.json`）是一份声明式的 JSON，把一种公众号排版风格（配色 + 每种元素的
内联样式模板 + 整篇装饰）**外化成数据**，让渲染器 `scripts/render-wechat-html.mjs` **确定性地**套用——
不用改一行渲染代码。因为公众号草稿编辑器会剥掉 `<style>`/`<head>`/class 样式，所以每个元素都得自带
`style="…"`；主题就是这些内联样式串的**样式库**。**移动优先**（正文≈16px、行高与段间距都要舍得给）。

契约的**权威**是 [`THEME-SCHEMA.md`](./THEME-SCHEMA.md)——top-level 只允许
`meta` / `palette` / `page` / `elements` / `decorations`，其余从**默认主题**深合并兜底（可以只写一部分）。

## 主题清单（13 个，按来源分组）

拿来即用，或复制一个再改。三类来源；后两类由 `scripts/import-theme.mjs` 从开源社区主题
转换而来（署名/许可见 [`CREDITS.md`](./CREDITS.md)）。

### 手作（3，本仓库原创，品牌中性）

| 主题 | 一句话风格 |
|------|-----------|
| [`magazine.json`](./magazine.json) | **杂志风**——强主色 + 色条标题、讲究的图注，适合观点/深度长文。 |
| [`minimal.json`](./minimal.json) | **极简风**——低饱和、细 hairline、大留白，适合克制的品牌调性。 |
| [`knowledge.json`](./knowledge.json) | **知识卡片风**——清晰层级、引用块/列表突出，适合教程/干货/清单。 |

### doocs/md 移植（3，WTFPL — 见 CREDITS）

| 主题 | 一句话风格 |
|------|-----------|
| [`doocs-classic.json`](./doocs-classic.json) | **经典**——居中主色下划线 h1、整块实底主色 h2、主色左条 h3，mdnice/doocs 经典观感。 |
| [`doocs-grace.json`](./doocs-grace.json) | **优雅**——default 之上加柔和阴影、圆角 h2、虚线 h3、渐变分割线。 |
| [`doocs-simple.json`](./doocs-simple.json) | **简洁**——非对称圆角 h2（`8px 24px`）、淡色描边 h3、细线。 |

### wewrite 移植（7，MIT © OpenClaw — 见 CREDITS + LICENSE-wewrite）

| 主题 | 一句话风格 |
|------|-----------|
| [`wewrite-sspai.json`](./wewrite-sspai.json) | **少数派**——暖白底、红色点缀，文艺清爽，数码/效率类。 |
| [`wewrite-github.json`](./wewrite-github.json) | **GitHub**——白底蓝链、等宽代码，技术文档/开发者内容。 |
| [`wewrite-minimal-gold.json`](./wewrite-minimal-gold.json) | **极简金**——白底金色细线，奢华克制，高端品牌/精品。 |
| [`wewrite-newspaper.json`](./wewrite-newspaper.json) | **报刊**——米黄底深棕衬线，深度报道/评论。 |
| [`wewrite-ink.json`](./wewrite-ink.json) | **水墨**——宣纸底墨色衬线、留白疏朗，文化/人文。 |
| [`wewrite-warm-editorial.json`](./wewrite-warm-editorial.json) | **暖编辑**——白底琥珀色，生活方式/文化。 |
| [`wewrite-professional-clean.json`](./wewrite-professional-clean.json) | **专业净**——蓝色、中性，适合大多数商业内容的安全默认。 |

**怎么挑**：观点长文 → magazine / newspaper；性冷淡/品牌感 → minimal / minimal-gold；
教程干货 → knowledge；技术 → github；商业通用 → professional-clean；文化人文 → ink。
不完全合适就**复制一个再改**，比从零写省事。

## 带自己的主题进来（`import-theme.mjs`）

`scripts/import-theme.mjs` 是零依赖转换器，把两种常见开源主题格式转成本仓库的 `theme.json`：

```bash
# wewrite 的 toolkit/themes/*.yaml（MIT）
node ../scripts/import-theme.mjs --from my.yaml --out my-theme.json --name "我的主题"

# doocs/md 的 theme-css/*.css（WTFPL；grace/simple 是 default 的 diff，需带 --base 和 --accent）
node ../scripts/import-theme.mjs --from theme.css --base default.css --accent '#2d6da3' --out my-theme.json
```

输出恒定符合 [`THEME-SCHEMA.md`](./THEME-SCHEMA.md) 并通过 `validate-theme.mjs`（仅内联样式、
无 class/script/style/事件、从不注入图片 src）。`--format` 默认按扩展名自动识别
（`.yaml`→wewrite-yaml，`.css`→doocs-css）。

## 自己写一个（一次性，之后永久复用）

写主题是一次性的活；产出的 `theme.json` 之后每次只用 `--theme` 复用。两条路径详见 SKILL.md 的
「复刻参考排版风格 → 可复用主题」；速览：

- **从一篇公众号文章（URL）复刻**：
  ```bash
  node ../scripts/fetch-article.mjs --url "https://mp.weixin.qq.com/s/..." --out ref.html
  ```
  抓取正文、**保留内联 `style=`**、打印风格指纹（标签数 / 常用颜色 / 字号）。你（agent）读 `ref.html`，
  把**反复出现**的样式按 [`THEME-SCHEMA.md`](./THEME-SCHEMA.md) 抄成 `theme.json`（3–5 个最常用色 → `palette`）。
- **从一段文字风格描述**：直接照 schema 填 `theme.json`（如「性冷淡杂志风」→ 低饱和、细线、大留白）。

两条路径都**先校验再渲染**：

```bash
node ../scripts/validate-theme.mjs my-theme.json      # 有硬错误按提示改
```

> 诚实预期：公众号编辑器（秀米/135）导出的 HTML 很吵，只抄**规律**、别抄每一处 one-off；抄完手调。

## `--theme` 用法（渲染 / 流水线）

```bash
# 单独渲染成公众号 HTML
node ../scripts/render-wechat-html.mjs --md article.md --title "标题" --theme magazine.json

# 走完整流水线（渲染 → 传图 → 存草稿）；--theme 仅在 --md 时生效，--html 时被忽略
node ../scripts/pipeline.mjs --md article.md --title "标题" --theme magazine.json
```

不传 `--theme` 时，输出与历史中性渲染器**逐字节一致**（向后兼容）。
