---
name: douyin-comment
description: 抖音评论拉取 · 按作品 ID 翻页拉抖音一级评论，终端铺出「评论内容/点赞/作者/IP归属」表格，再给一句舆情/选题洞察。当用户需要扒抖音评论区、做舆情分析、挖用户真实需求、看评论风向、攒选题灵感时使用。触发词：抖音评论、扒评论区、评论分析、舆情、用户需求、评论风向。
---

# 抖音评论拉取（都爆鸭）

本鸭专做**评论区取数**这一档：给一个抖音作品 ID，把这条作品下的一级评论一页页捞回来，终端直接铺成表格——给你做**舆情判断/选题洞察**用。评论区是用户真实需求的金矿：他们在问什么、骂什么、求什么，下一条选题往往就藏在里头。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。
>
> 还没有作品 ID？先用 `douyin-search`（按关键词）或 `douyin-realtime-search`（实时综合）搜到目标作品，拿到 `videoId`（作品 ID）再回本鸭扒评论。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **舆情风向监测** | 扒某条爆款作品的评论区 | 快速判断观众是夸是骂、风向往哪偏 |
| **挖用户真实需求** | 翻几页评论看高频提问 | 抓住下一条选题该回答的问题 |
| **对标作品拆解** | 看对标爆款下评论在聊什么 | 摸清观众真正被什么戳中 |
| **争议/危机预警** | 盯品牌相关作品评论 | 第一时间发现负面苗头 |
| **选题灵感搜集** | 从高赞评论里捞金句/痛点 | 给下一条脚本攒一手真实素材 |

---

## 工作流（4 步）

### 1. 拿到作品 videoId
本鸭按**作品 ID**拉评论，不认 URL。若手头只有作品链接或关键词，先用 `douyin-search` / `douyin-realtime-search` 搜到目标作品，从结果里取 `videoId`（作品 ID）。一次只扒一条作品。

### 2. 调用评论脚本（可翻页）
```bash
python3 "$SKILL_PATH/scripts/fetch_comments.py" "7480000000000000000"
```
翻页继续往下拉：
```bash
python3 "$SKILL_PATH/scripts/fetch_comments.py" "7480000000000000000" --page 2
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**同一页只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别重复调用。

### 3. 铺成评论表格
从 `data.items`（评论数组）里取字段，按下表铺成 Markdown。字段做**防御式读取**——`text`（评论内容）/ `likeCount`（点赞）/ `authorName`（作者）/ `ipLocation`（IP 归属，如有）可能缺失，缺了留空别报错。

| 评论内容 | 点赞 | 作者 | IP 归属 |
|----------|------|------|---------|
| 示例评论一句话 | 1.2w | 某某用户 | 广东 |

> 想给评论排个序，按点赞（`likeCount`）降序排，高赞优先——高赞评论最能代表观众共识，是选题信号最强的那批。这是展示层加工，不改接口调用。

### 4. 给一句舆情/选题洞察
表格之后，用本鸭口吻补一句**舆情/选题洞察**：评论区整体是夸是骂、高频痛点是什么、有没有现成可接的选题钩子。简短、有用，别堆套话，别反问用户"你的真实目的是什么"。

> 看到返回里 `hasMore` 为 `true`，说明**还有下一页**——想看全就 `--page` 加一继续拉；为 `false` 则已到底。

---

## 拿钥匙（密钥）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **密钥中心**
4. **生成密钥**（形如 `dyh_…`）

配进环境变量（脚本只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
```

**铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出密钥。所有请求只发往 **doubaoya.com**，别把密钥带去任何其他域名。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/douyin/comments/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "videoId": "7480000000000000000", "page": 1 }`
  - `videoId`：字符串，必填（作品 ID）
  - `page`：整数，可选（默认 1，翻页取下一批评论）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "text": "...", "likeCount": 0, "authorName": "...", "ipLocation": "..." } ], "hasMore": true },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。
- `data.hasMore` 为 `true` 表示还有下一页评论，可 `--page` 加一继续拉。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 videoId 为空） | 修正作品 ID 后重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试安全，不会重复扣费。

---

## 目录结构

```
douyin-comment/
├── SKILL.md                  # 本文件
└── scripts/
    └── fetch_comments.py     # 零依赖评论拉取脚本（urllib），调用 doubaoya.com
```
