---
name: douyin-hot-trend
description: 抖音实时热榜 · 按日期区间拉抖音实时热榜，帮你看清近几天抖音在热什么、哪些话题正在起势、该追哪条热点。当用户需要抖音热榜、抖音热搜、抖音实时榜、抖音热点、抖音趋势、抖音在热什么时使用。触发词：抖音热榜、抖音热搜、抖音实时榜、抖音热点、抖音趋势、抖音风向。
---

# 抖音实时热榜 · 按日期区间（都爆鸭）

本鸭帮你按**日期区间**拉抖音实时热榜——一眼看到近几天抖音在热什么、哪些话题正在起势，顺手判断该追哪条热点。

> 🔗 这是**无关键词**的抖音热搜直取（`{ "platform": 2 }`，不带关键词）。做「综合热点选题」时，它是 `trending-hub` 流程的抖音补充源——**别把用户的账号名/IP名当关键词**，IP 只用于后续匹配筛选。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

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

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**。

---

## 跑脚本

零依赖，标准库即可（Python 3）。

```bash
# 默认：抖音（platform 2），近 5 天区间
python3 "$SKILL_PATH/scripts/fetch_hot_trend.py"

# 指定平台 + 日期区间
python3 "$SKILL_PATH/scripts/fetch_hot_trend.py" --platform 2 --start-date 2026-06-20 --end-date 2026-06-24
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--platform` | 平台编号（整数） | `2`（抖音） |
| `--start-date` | 区间起始日 `YYYY-MM-DD` | 今天往前 4 天 |
| `--end-date` | 区间结束日 `YYYY-MM-DD` | 今天 |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout，别用 `head`/`tail` 预览。

---

## 工作流（3 步）

1. **定平台 + 区间**：默认抖音、近 5 天。要看更长的趋势就把 `--start-date` 往前挪。
2. **调脚本拿数据**：热榜在 `data.items` 里，每条含 `index`（名次）、`title`（标题）、`hotCount`（热度，**字符串**，形如 `"920万"`）、`url`（链接）。
3. **铺榜 + 给风向**：返回已按热度排好，**按 `index`（名次）升序**铺成 Markdown 表即可（`hotCount` 是 `"920万"` 这类带单位的字符串，别拿它做数值排序）。表后用本鸭口吻补一句——这几天哪类话题在霸榜、哪条正在起势值得抢先做。

| 名次 | 标题 | 热度 | 链接 |
|------|------|------|------|
| 1 | … | … | … |

字段防御式读取（缺了留空）。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/trend/douyin-hot-trend/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "platform": 2, "startDate": "2026-06-20", "endDate": "2026-06-24" }`
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "index": 1, "title": "...", "hotCount": "920万", "url": "..." } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误码

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如日期格式错） | 修正 `--start-date` / `--end-date` 重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

---

## 目录结构

```
douyin-hot-trend/
├── SKILL.md                 # 本文件
└── scripts/
    └── fetch_hot_trend.py   # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：提示缺少 `DOUBAOYA_API_KEY`？**
A：先 `export DOUBAOYA_API_KEY="dyh_…"`（去 doubaoya.com → 登录 → 口令中心 → 生成口令）。

**Q：跑完 `items` 是空的 / 某天没数据？**
A：这就是说**该日期区间内没有热榜数据**，不是脚本出错——别编数据填表。把 `--start-date` 往前挪一两天、或确认所选窗口确有数据后重跑。

**Q：报 `502 PROVIDER_FAILED`？**
A：上游临时抖动，系统已自动退款，直接重跑即可。
