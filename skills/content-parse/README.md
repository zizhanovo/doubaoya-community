# 内容解析 / content-parse

> 都爆鸭 · 本鸭出品

粘贴一条**公开作品/文章链接**，本鸭帮你解析成结构化详情——标题、作者、点赞/评论/转发——再陪你拆解爆款、分析「为什么火」。

这是一个**内容解析器**，不是下载器：归一化作品详情字段，不返回 mp4、不去水印。

---

## 简介

**核心价值**

- **一粘即解析**：丢一条公开链接，拿到归一化的标题 / 作者 / 互动数据。
- **拆解爆款**：基于解析事实，分析选题角度、开头钩子、发布时机，回答「这条为什么火」。
- **零依赖**：脚本仅用 Python 3 标准库，开箱即用。

**适用对象**

- 内容创作者 — 拆解对标账号的爆款，沉淀可复用方法论。
- 运营 / 投放 — 快速读出一条作品的互动量级与传播属性。
- 选题研究 — 把零散的「火过的内容」结构化成可分析的字段。

---

## 密钥获取与安全说明

- 本技能需要环境变量 `DOUBAOYA_API_KEY`，密钥形如 `dyh_...`。
- 密钥由 [doubaoya.com](https://doubaoya.com) 提供：**登录 → 密钥中心 → 生成密钥**。
- 配置后即可使用：`export DOUBAOYA_API_KEY=dyh_你的密钥`
- 禁止在代码、提示词、日志或输出文件中硬编码 / 明文暴露密钥；本技能脚本只从环境变量读取，永不回显。

---

## 使用指南

```bash
export DOUBAOYA_API_KEY=dyh_你的密钥
python3 scripts/parse_content.py "https://example.com/content/123"
```

### 常用说法速查

| 意图 | 示例话术 | 效果 |
|------|---------|------|
| 解析作品 | 「帮我解析这条作品 [链接]」 | 解析链接，返回标题/作者/互动数据 |
| 解析文章 | 「解析下这篇文章详情 [链接]」 | 返回归一化的文章详情字段 |
| 拆解爆款 | 「这条为什么火？帮我拆一下 [链接]」 | 先解析，再分析选题/钩子/时机 |

---

## 接口契约

- `POST https://doubaoya.com/api/apis/tool/parse-content-detail/call`
- 鉴权：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "url": "https://example.com/content/123" }`（仅 `url` 一个参数）
- 返回信封：`{ success, requestId, data, error }`；成功时读 `data.item`（`title` / `authorName` / `likeCount` / `shareCount` / `commentCount`，按需防御性读取）。

### 错误码

| HTTP | code | 含义 |
|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥 / 密钥无效 |
| 400 | `VALIDATION_ERROR` | 链接为空或格式不对 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 |
| 502 | `PROVIDER_FAILED` | 上游失败（已自动退款，可重试） |

详见 [SKILL.md](./SKILL.md)。
