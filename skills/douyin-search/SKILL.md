---
name: douyin-search
description: 抖音爆款搜索 · 一个关键词批量搜抖音爆款作品，终端铺出「标题/达人/点赞/作品链接」表格，再给一句选题洞察。当用户需要按关键词搜抖音爆款、做短视频选题取数、扒一批对标作品、行业热点扫描、竞品内容盘点时使用。触发词：抖音搜索、搜抖音爆款、抖音取数、扒抖音作品、短视频选题、对标作品。
---

# 抖音爆款搜索（都爆鸭）

本鸭专做**短视频取数**这一档：一个关键词下去，把这条赛道上的抖音爆款作品一批捞回来，终端直接铺成可点的表格——给你做**选题洞察**用，不是为了刷单条。追热点、扒对标、攒脚本素材，先用本鸭把"面"扫开，再去挑值得拆解的"点"。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。
>
> 想按热度+最新发布**实时综合搜**，用 `douyin-realtime-search`；想扒某条作品的**评论区舆情**，用 `douyin-comment`。本鸭是「关键词 → 一批爆款作品」的扫面工具，还支持按发布日期区间圈定。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **短视频选题取数** | 搜 `减脂餐` 一批捞这条赛道的爆款作品 | 一眼掌握当下都在拍什么角度 |
| **对标账号盘点** | 搜 `职场干货` 批量扒对标达人的爆款 | 摸清同赛道谁在出爆款、抢哪些切口 |
| **行业热点扫描** | 搜 `AI 工具` 看这条赛道的爆款风向 | 快速判断当下流量集中在哪 |
| **脚本素材搜集** | 搜 `开箱测评` 攒一批可参考的爆款角度 | 给下一条脚本攒一手素材 |
| **指定档期取数** | 搜 `618` 并圈定 `--start-date`/`--end-date` | 只看某个活动档期内的爆款 |

---

## 工作流（4 步）

### 1. 提炼关键词
从用户描述里抽出**核心关键词**——精简，2~6 个字最佳（如 `减脂餐`、`职场干货`、`开箱测评`）。词越短越宽、命中越多；词太长太细容易扫空。一次只搜一个关键词。若用户限定了时间窗，再叠加 `--start-date` / `--end-date`（`YYYY-MM-DD`）。

### 2. 调用搜索脚本
```bash
python3 "$SKILL_PATH/scripts/search_douyin.py" "减脂餐"
```
只看某段档期的爆款，叠加日期区间：
```bash
python3 "$SKILL_PATH/scripts/search_douyin.py" "618" --start-date 2026-06-01 --end-date 2026-06-18
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每个关键词只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一关键词重复调用。

### 3. 铺成作品表格
从 `data.items`（作品数组）里取字段，按下表铺成 Markdown。字段做**防御式读取**——`title`（标题）/ `authorName`（达人）/ `likeCount`（点赞）/ `workUrl`（作品链接）/ `publishTime`（发布时间）可能缺失，缺了留空别报错。标题渲染成**可点链接**（指向作品原文 URL）。

| 标题 | 达人 | 点赞 | 发布时间 |
|------|------|------|----------|
| [示例作品标题](https://www.douyin.com/video/xxx) | 某某达人 | 12.3w | 2026-06-20 |

> 想给这批作品排个序，可加一列「热度指数/综合指数」（关键词相关性 + 点赞热度 + 时效新鲜度）降序排、同分按点赞高的优先——这是展示层加工，不改接口调用。

### 4. 给一句选题洞察
表格之后，用本鸭口吻补一句**选题洞察**：这批作品在抢什么角度、哪个切口还没人拍透、值不值得跟。简短、有用，别堆套话，别反问用户"你的真实目的是什么"。

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

- `POST https://doubaoya.com/api/apis/douyin/search-work/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "减脂餐", "startDate": "2026-06-01", "endDate": "2026-06-18" }`
  - `keyword`：字符串，必填
  - `startDate`：字符串 `YYYY-MM-DD`，可选（不传则不限）
  - `endDate`：字符串 `YYYY-MM-DD`，可选（不传则不限）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "authorName": "...", "likeCount": 0, "workUrl": "...", "publishTime": "..." } ] },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 keyword 为空、日期格式错） | 修正后重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试安全，不会重复扣费。

---

## 目录结构

```
douyin-search/
├── SKILL.md                  # 本文件
└── scripts/
    └── search_douyin.py      # 零依赖搜索脚本（urllib），调用 doubaoya.com
```
