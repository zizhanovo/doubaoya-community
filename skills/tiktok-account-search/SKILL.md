---
name: tiktok-account-search
description: TikTok账号搜索 · 按关键词搜 TikTok（海外抖音）博主账号，按粉丝数从高到低展示，终端表格展示（账号/昵称/粉丝数/简介）。搜不到时推荐相近关键词。当用户需要搜索 TikTok 账号、查找 TikTok 达人、了解 TikTok 创作者、做海外账号对标、跨境达人筛选时使用。触发词：TikTok 账号搜索、TikTok 达人、TikTok 创作者、搜 TikTok 账号、TikTok 博主、海外抖音账号。
---

# TikTok账号搜索（都爆鸭）

嘎！本鸭帮你按关键词搜 TikTok（海外抖音）上的博主账号——找同赛道对标、筛选跨境达人、研究头部创作者。一个关键词下去，终端铺出账号表格（**按粉丝数从高到低**排好），昵称、粉丝量、简介一目了然。搜不到时本鸭再给你推荐几个相近关键词，不让你空手而归。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **找同赛道对标** | 搜 `fitness` 找海外健身博主 | 研究对标账号的内容方向 |
| **掌握竞争格局** | 搜 `美妆` 看头部账号有哪些 | 摸清某品类的头部分布 |
| **筛选合作达人** | 搜 `穿搭` 按粉丝量评估账号 | 辅助合作/签约决策 |
| **跨境达人搜集** | 搜 `美食` 找细分市场达人 | 攒一手带货/推广人选 |

---

## 工作流（4 步）

### 1. 读懂意图，提炼关键词
从用户描述里抽出**核心关键词**（中英文均可，如 `fitness`、`美妆`、`穿搭`）。一次只搜一个关键词。词太长太细容易搜空。

识别页码意图（用户没提就用默认）：
- **页码 `--page`**：默认 `1`。用户说「下一页」「第 2 页」时递增。

### 2. 调用搜索脚本
```bash
python3 "$SKILL_PATH/scripts/search_tiktok_user.py" "fitness"
```
翻页（可选）：
```bash
python3 "$SKILL_PATH/scripts/search_tiktok_user.py" "美妆" --page 2
```
脚本只发 `keyword` 和 `page`，**服务端内部把 page 映射成游标**，你不用手动管游标 token。脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一关键词重复调用。

### 3. 渲染账号表格
从 `data.items`（账号数组）里取字段，**按粉丝数从高到低**排，铺成 Markdown 表格。字段做**防御式读取**——`uniqueId`（账号）/ `nickname`（昵称）/ `fans`（粉丝数）/ `signature`（简介）可能缺失或命名略有差异，缺了就留空或写「—」，别让某条数据搞崩整张表。

| 账号 | 昵称 | 粉丝数 | 简介 |
|------|------|--------|------|
| @example_id | 某某博主 | 305.2w | Fitness Content Creator |

> 数字格式化：`< 10000` 用原始数字，`≥ 10000` 用 `x.xw`。昵称过长（超 20 字）截断加 `...`；简介过长（超 40 字）截断加 `...`，为空显示 `—`。

翻页信息：`data.hasMore`（是否还有更多）告诉你能不能翻下一页；`data.rid`（游标 token）由服务端维护，展示时不必给用户看。`hasMore` 为 `true` 时提示「回复『下一页』继续看」。

### 4. 搜不到时推荐相近关键词
若 `data.items` 为空：致歉并说明该词较小众或当前页无数据，再**主动给 10 个相近关键词**（2~6 字，覆盖不同维度）让用户换方向重试。不要编造数据、不要追问用户真实目的。

> 备注：本接口**没有日期/发布时间参数**，账号搜索不涉及时间筛选，无需做时间口径处理。

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

- `POST https://doubaoya.com/api/apis/tiktok/search-user/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "fitness", "page": 1 }`
  - `keyword`：字符串，必填
  - `page`：整数，可选（默认 1；服务端内部映射成游标，无需手动传游标）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": {
      "items": [ { "uniqueId": "...", "nickname": "...", "fans": 0, "signature": "..." } ],
      "hasMore": true,
      "rid": "..."
    },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。
- `data.hasMore`：是否还有更多；`data.rid`：游标 token（服务端维护）。
- ⚠️ **字段防御**：账号字段可能缺失或命名略有差异，读取时一律「取不到就给默认值」，缺字段留空，别报错。

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
tiktok-account-search/
├── SKILL.md                       # 本文件
└── scripts/
    └── search_tiktok_user.py      # 零依赖搜索脚本（urllib），调用 doubaoya.com
```
