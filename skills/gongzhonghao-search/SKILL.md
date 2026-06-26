---
name: gongzhonghao-search
description: 公众号搜索 · 按关键词搜微信公众号文章，终端表格展示（标题链接/作者/发布时间）并给出选题洞察。当用户需要公众号搜索、查公众号文章、找公众号爆款、做行业热点追踪、竞品分析、选题灵感、素材搜集时使用。
---

# 公众号文章搜索（都爆鸭）

本鸭帮你按关键词搜微信公众号文章——追行业热点、扒竞品爆款、攒选题素材，一个关键词下去，终端直接铺出可点的文章表格，再附一句选题洞察。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **行业热点追踪** | 搜 `AI 工具` 看近期这个领域公众号都在写什么 | 一眼掌握当下热点角度 |
| **竞品内容分析** | 搜 `大模型` 看同赛道在怎么选题、怎么起标题 | 摸清对手内容策略 |
| **选题灵感搜集** | 搜 `职场沟通` 找爆款角度和写作切口 | 给下一篇文章找方向 |
| **素材搜集** | 搜 `小红书运营` 批量收集可参考的文章 | 攒一手写作素材 |
| **趋势研究** | 搜 `2026 经济` 看舆论风向 | 为研究/报告打底 |

---

## 工作流（4 步）

### 1. 读懂意图，提炼关键词
从用户描述里抽出**核心关键词**。关键词要**精简**——2~6 个字最好（如 `AI 工具`、`大模型`、`职场`）。词越短越宽，命中越多；词太长太细容易搜空。一次只搜一个关键词。

### 2. 调用搜索脚本
```bash
python3 "$SKILL_PATH/scripts/search_gzh.py" "AI 工具"
```
翻页（可选）：
```bash
python3 "$SKILL_PATH/scripts/search_gzh.py" "AI 工具" --page 2
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览或对同一关键词重复调用。

### 3. 渲染文章表格
从 `data.items`（文章数组）里取字段，按下面格式铺成 Markdown 表格。字段做防御式读取——`title` / `accountName`（作者/公众号）/ `publishTime`（发布时间）可能缺失，缺了就留空，别报错。标题渲染成**可点链接**（指向文章原文 URL）。

| 标题 | 作者 | 发布时间 |
|------|------|----------|
| [示例文章标题](https://mp.weixin.qq.com/s/xxx) | 某某公众号 | 2026-06-20 |

> 想做更细的「三维评分」排序（关键词相关性 + 阅读热度 + 时效新鲜度）时，可在表格基础上加一列总分按降序排，同分按阅读量高的优先——这是展示层的加工，不影响接口调用。

### 4. 给一句选题洞察
表格之后，用本鸭的口吻补一句**选题洞察**：这批文章在抢什么角度、哪个切口还没人写透、值不值得跟。简短、有用，别堆套话，别问用户"你的真实目的是什么"。

---

## 拿钥匙（口令）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **口令中心**
4. **生成口令**（形如 `dyh_…`）

配置到环境变量（脚本只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的口令"
```

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**，不要把口令带去任何其他域名。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/gongzhonghao/search-article/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "AI 工具", "page": 1 }`
  - `keyword`：字符串，必填
  - `page`：整数，可选（默认 1）
  - 无 date / source / count 等其他字段
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "accountName": "...", "publishTime": "..." } ] },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 keyword 为空） | 修正关键词重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
gongzhonghao-search/
├── SKILL.md                  # 本文件
└── scripts/
    └── search_gzh.py         # 零依赖搜索脚本（urllib），调用 doubaoya.com
```
