---
name: bilibili-keyword-search
description: B站关键词搜作品 · 按关键词搜 B 站视频作品，支持排序方式与发布时间筛选，终端表格展示（标题链接/UP主/点赞/发布时间）并给出选题洞察。返回的是平台刚更新的新鲜数据（非缓存/历史）。当用户需要 B站搜索、查 B站最新视频、找 B站热门作品、做赛道选题、竞品分析、内容灵感搜集时使用。触发词：B站搜索、B站最新视频、B站热门、B站搜作品、bilibili 搜索、B站选题。
---

# B站关键词搜作品（都爆鸭）

嘎！本鸭帮你按关键词搜 B 站视频作品——追赛道热点、扒同行爆款、攒选题素材。一个关键词下去，终端直接铺出可点的视频表格，再附一句选题洞察。还能挑排序方式、限定发布时间，**给到你的都是平台刚更新的新鲜数据，不是旧缓存。**

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **赛道热点追踪** | 搜 `AI 工具` 看近期这个领域 UP 主都在发什么 | 一眼掌握当下热点角度 |
| **竞品内容分析** | 搜 `数码评测` 看同赛道怎么选题、怎么起标题 | 摸清对手内容策略 |
| **爆款选题灵感** | 搜 `职场` 找高赞角度和切口 | 给下一条视频找方向 |
| **素材搜集** | 搜 `Python 教程` 批量收集可参考的作品 | 攒一手创作素材 |
| **趋势研究** | 搜 `2026 显卡` 看舆论风向 | 为研究/报告打底 |

---

## 工作流（4 步）

### 1. 读懂意图，提炼关键词与筛选条件
从用户描述里抽出**核心关键词**，2~6 个字最好（如 `AI 工具`、`数码评测`、`职场`）。词越短越宽，命中越多；词太长太细容易搜空。一次只搜一个关键词。

同时识别筛选意图（用户没提就用默认）：
- **排序方式 `--sort-type`**：默认 `"1"`（综合 / 最热）。常见值 `"1"` = 综合/最热。
- **发布时间 `--publish-time`**：默认 `"0"`（不限）。如 `"30"` = 近 30 天。
- **页码 `--page`**：默认 `1`。

### 2. 调用搜索脚本
```bash
python3 "$SKILL_PATH/scripts/search_bilibili.py" "AI 工具"
```
带筛选 / 翻页（均可选）：
```bash
python3 "$SKILL_PATH/scripts/search_bilibili.py" "数码评测" --sort-type 1 --publish-time 30 --page 2
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一关键词重复调用。

### 3. 渲染作品表格
从 `data.items`（视频数组）里取字段，按下面格式铺成 Markdown 表格。字段做**防御式读取**——`title`（标题）/ `author`（UP主）/ `likeCount`（点赞）/ `publishTime`（发布时间）可能缺失或命名略有差异，缺了就留空或写「—」，别让某条数据搞崩整张表。标题渲染成**可点链接**（指向视频原文 URL，如 `work_url`）。总页数可读 `data.pages`。

| 标题 | UP主 | 点赞 | 发布时间 |
|------|------|------|----------|
| [示例视频标题](https://www.bilibili.com/video/xxx) | 某某 UP主 | 10.2w | 2026-06-20 |

> 数字格式化：`< 10000` 用原始数字，`≥ 10000` 用 `x.xw`。想做更细的「三维评分」排序（关键词相关性 + 点赞热度 + 时效新鲜度）时，可加一列总分按降序排——这是展示层加工，不影响接口调用。

### 4. 给一句选题洞察
表格之后，用本鸭的口吻补一句**选题洞察**：这批作品在抢什么角度、哪个切口还没人写透、值不值得跟。简短、有用，别堆套话，别追问用户"你的真实目的是什么"。

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

- `POST https://doubaoya.com/api/apis/bilibili/search-work/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "AI 工具", "sortType": "1", "publishTime": "0", "page": 1 }`
  - `keyword`：字符串，必填
  - `sortType`：字符串，可选（默认 `"1"` = 综合/最热）
  - `publishTime`：字符串，可选（默认 `"0"` = 不限；如 `"30"` = 近30天）
  - `page`：整数，可选（默认 1）
  - 以上字段都有默认值，脚本每次都会带上
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "author": "...", "likeCount": 0, "publishTime": "..." } ], "pages": 1 },
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
| 404 | `ENDPOINT_NOT_FOUND` | 接口路径不对 | 恢复默认端点路径 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |
| — | `NETWORK_ERROR` | 连不上 doubaoya.com | 检查网络后重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
bilibili-keyword-search/
├── SKILL.md                  # 本文件
└── scripts/
    └── search_bilibili.py    # 零依赖搜索脚本（urllib），调用 doubaoya.com
```
