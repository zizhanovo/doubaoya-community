---
name: gzh-subscribe
description: 公众号发文订阅 · 盯住单个公众号，拉它在指定时间段内的历史发文列表，终端铺成「发布时间/标题/阅读/点赞」追更表做复盘。当用户要追更某个公众号、看某账号最近发了什么、复盘竞品发文、订阅盯梢某个号时使用。触发词：盯公众号、追更、某公众号发了什么、订阅公众号、竞品发文复盘、账号发文列表。
---

# 公众号发文订阅（都爆鸭）

本鸭专盯**一个账号**：给我一个公众号名称，本鸭把它在某个时间段里发的文章一条条拉出来，终端铺成追更表——它最近在写什么、更得勤不勤、哪篇跑出了量，一眼复盘。这是**按账号**拉发文，不是关键词搜索：盯竞对、追大神、复盘自己的号，都走这条线。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。
>
> 想按关键词扫一批不同账号的文章，用 `gzh-search`；想按热度挖爆文，用 `wechat-hot-article`。本鸭只对**单个指定账号**拉发文列表。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **竞品追更** | 拉竞对账号最近 30 天发文 | 对手在写什么、更新节奏 |
| **大神盯梢** | 订阅关注的号看其新发 | 不漏掉值得学的内容 |
| **自号复盘** | 拉自己账号某段时间发文 | 回看选题分布与表现 |
| **指定时段盘点** | `--start`/`--end` 圈一段时间 | 某活动期/某月的发文全貌 |
| **更新频率核查** | 看发布时间密度 | 判断账号活跃度 |

---

## 工作流（4 步）

### 1. 确认账号名称
本接口以**公众号名称**定位（不是关键词）。从用户描述里取出准确的账号名。名称越准、命中越稳；模糊名可能拉不到或拉串号。

### 2. 调用发文列表脚本
```bash
# 默认：最近 30 天（end=今天，start=今天往前 29 天），第 1 页
python3 "$SKILL_PATH/scripts/account_works.py" "示例公众号"

# 翻页 + 指定时间区间
python3 "$SKILL_PATH/scripts/account_works.py" "示例公众号" --page 2 --start 2026-06-01 --end 2026-06-20
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次**，直接读完整 stdout，别预览、别重复调用。

### 3. 铺成追更表
从 `data.items` 取字段铺 Markdown 表，按**发布时间降序**排（最新在上）。每条含 `title`（标题）、`publishTime`（发布时间）、`clicksCount`（阅读量）。字段做**防御式读取**——缺失留空别报错。标题渲染成**可点链接**。

| 发布时间（publishTime） | 标题（title） | 阅读量（clicksCount） |
|----------|------|------|
| 2026-06-20 | [示例文章标题](https://mp.weixin.qq.com/s/xxx) | 8.5w |

### 4. 给一句复盘洞察
表格之后补一句：这账号近期在主攻什么主题、更新勤不勤、哪篇明显跑赢、选题有没有转向。简短、有据，别堆套话。

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

**铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出密钥。所有请求只发往 **doubaoya.com**。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-work-list/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "accountName": "示例公众号", "page": 1, "publishTimeStart": "2026-05-29", "publishTimeEnd": "2026-06-27" }`
  - `accountName`：字符串，必填（公众号名称）
  - `page`：整数，可选（默认 1）
  - `publishTimeStart` / `publishTimeEnd`：`YYYY-MM-DD`。脚本默认 `publishTimeEnd=今天`、`publishTimeStart=今天往前 29 天`，可用 `--start` / `--end` 覆盖。
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "publishTime": "...", "clicksCount": 0 } ] },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如账号名为空、日期格式错） | 核对账号名/日期后重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试安全，不会重复扣费。

---

## 目录结构

```
gzh-subscribe/
├── SKILL.md                  # 本文件
└── scripts/
    └── account_works.py      # 零依赖发文列表脚本（urllib），调用 doubaoya.com
```
