---
name: content-parse
description: 解析作品/解析链接 — 粘贴一条公开作品或文章链接，本鸭帮你解析作品详情/文章详情，拿到标题、作者、点赞/评论/转发等互动数据，并可顺手拆解爆款、分析「为什么火」（选题角度/钩子/时机）。适用于：解析作品、解析链接、作品详情、文章详情、拆解爆款、为什么火、内容解析。
---

# 内容解析 · content-parse

本鸭的「内容解析」技能：丢给我一条**公开的作品/文章分享链接**，我调用 [doubaoya.com](https://doubaoya.com) 的 `parse-content-detail` 接口，把它解析成结构化详情——**标题、作者、点赞/评论/转发数**——再陪你一起拆解它「为什么火」。

> 这是一个**内容解析器**，不是下载器：它归一化作品详情字段，不返回 mp4、不去水印。

---

## 它能做什么

- **解析作品详情 / 文章详情**：粘贴一条公开链接，拿到归一化的标题、作者、互动数据。
- **拆解爆款**：基于解析出的字段，陪你分析选题角度、开头钩子、发布时机，回答「这条为什么火」。
- **零依赖**：脚本只用 Python 3 标准库，开箱即用。

每次解析**一条链接**即可。

---

## 第一步：拿钥匙（口令）

本技能需要环境变量 `DOUBAOYA_API_KEY`，口令形如 `dyh_...`。

1. 打开 [doubaoya.com](https://doubaoya.com) 并**登录**。
2. 进入 **口令中心**。
3. 点击 **生成口令**，复制形如 `dyh_xxxxxxxx` 的口令。
4. 配置到环境变量：

```bash
export DOUBAOYA_API_KEY=dyh_你的口令
```

> **安全提示**：绝不要把口令硬编码进代码、提示词、日志或输出文件；展示给用户时也不要回显完整口令。本技能脚本从环境变量读取，永不打印口令。

---

## 第二步：解析链接

把用户给的公开分享链接传给脚本即可：

```bash
python3 "$SKILL_PATH/scripts/parse_content.py" "https://example.com/content/123"
```

脚本会向 `POST https://doubaoya.com/api/apis/tool/parse-content-detail/call` 发送请求，
请求体只有一个参数：

```json
{ "url": "https://example.com/content/123" }
```

成功时，脚本把信封里的 `data` 以格式化 JSON 打印到标准输出。

---

## 返回信封

接口统一返回如下信封：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "data": {
    "item": {
      "title": "标题文本",
      "authorName": "作者名",
      "likeCount": 12345,
      "shareCount": 678,
      "commentCount": 901
    }
  },
  "error": null
}
```

**务必先看 `success`**：

- `success === true` → 读取 `data.item`，呈现标题/作者/互动数据。
- `success !== true` → 读取 `error.code` 与 `error.message` 给用户解释。

`data.item` 字段按需防御性读取——某些平台或某些作品可能缺字段（如 `shareCount`），缺失时如实说明「该字段未返回」，不要编造数字。

### 给用户呈现的格式（建议）

| 字段 | 来源 |
|------|------|
| 标题 | `data.item.title` |
| 作者 | `data.item.authorName` |
| 点赞 | `data.item.likeCount` |
| 评论 | `data.item.commentCount` |
| 转发 | `data.item.shareCount` |

---

## 第三步（可选）：拆解「为什么火」

拿到归一化字段后，本鸭可以陪用户做爆款拆解。从已解析的事实出发，别凭空臆测：

- **选题角度**：标题指向什么人群 / 什么痛点 / 什么情绪？
- **钩子**：标题前几个字如何制造好奇、对立或利益点？
- **时机 & 量级**：点赞/评论/转发的相对比例说明了什么——是「收藏型」（高赞低评）还是「争议型」（高评论）？转发高说明有社交货币属性。

把这些观察整理成「可复用的方法论」，而不是只夸「这条很火」。

---

## 错误处理

脚本遇到非成功信封时，打印 `[error] CODE: message` 到 stderr 并以退出码 1 结束。常见错误：

| HTTP | code | 含义 | 处理建议 |
|------|------|------|----------|
| 401 | `MISSING_API_KEY` | 没带口令 | 检查 `DOUBAOYA_API_KEY` 是否已 export |
| 401 | `UNAUTHORIZED` | 口令无效/已撤销 | 回口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 链接为空或格式不对 | 确认是完整的公开链接 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 前往 doubaoya.com 充值/续费 |
| 502 | `PROVIDER_FAILED` | 上游解析失败（**已自动退款**） | 可安全重试；多次失败请确认链接有效、未过期 |

> `PROVIDER_FAILED` 会自动退款，重试是安全的。

---

## 常见问题

**Q：我没有口令怎么办？**
A：前往 [doubaoya.com](https://doubaoya.com) 登录 → 口令中心 → 生成口令（形如 `dyh_...`），再 `export DOUBAOYA_API_KEY`。

**Q：能下载视频 / 去水印吗？**
A：不能。本技能是**内容解析器**，只返回结构化详情（标题/作者/互动数据），不提供 mp4 下载或去水印。

**Q：能一次解析多个链接吗？**
A：每次解析一条链接最稳。多条请分别调用脚本。

**Q：解析失败（PROVIDER_FAILED）怎么办？**
A：上游失败会自动退款，可直接重试；若反复失败，确认链接完整、公开且未过期。

**Q：口令会被打印出来吗？**
A：不会。脚本只从环境变量读取，绝不回显或写入日志。
