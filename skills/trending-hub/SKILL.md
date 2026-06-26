---
name: trending-hub
description: 都爆鸭·全网热点聚合（按平台 + 关键词）。按平台编号 + 关键词把多平台的热点聚合到一起，帮你快速看清此刻全网围绕这些词在热什么、哪些值得追、能嗅出哪些选题信号。触发词：全网热榜、热点聚合、追热点、热搜、趋势、选题信号、全网热点、关键词热榜。
---

# 都爆鸭 · 全网热点聚合（按平台 + 关键词）

本鸭一句话定位：给定**平台编号 + 关键词**，把多个平台围绕这些词的热点聚合成一张榜，让你 1 分钟看清此刻全网在聊什么，并顺手帮你翻译成**可追的选题信号**。

适用对象：内容创作者、自媒体运营、市场/品牌策划、媒体编辑、追热点的同学。

---

## 1. 拿钥匙（DOUBAOYA_API_KEY）

调用接口需要一把口令（API Key）。拿钥匙四步走：

1. 打开 **doubaoya.com**
2. **登录**
3. 进入 **口令中心**
4. 点 **生成口令**

口令形如 `dyh_xxxxxxxx`。拿到后配进环境变量：

```bash
export DOUBAOYA_API_KEY="dyh_xxxxxxxx"
```

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `DOUBAOYA_API_KEY` | 都爆鸭口令，形如 `dyh_…` | 是 |

> 安全约定：**永远不要把口令打印出来、写进日志、贴进对话或提交进仓库**。脚本只在请求头里用它，不会回显。

---

## 2. 跑脚本

零依赖，标准库即可（Python 3）。

```bash
# 默认：平台 2,5,8 + 关键词 AI + 今天 00:00 至当前
python3 scripts/fetch_trends.py

# 指定平台编号 + 关键词 + 时间区间
python3 scripts/fetch_trends.py --platforms 2,5,8 --keywords AI,大模型 --start-date "2026-06-24 00:00:00" --end-date "2026-06-24 01:00:00"
```

CLI 参数：

| 参数 | 说明 | 默认 |
|------|------|------|
| `--platforms` | 逗号分隔的平台编号（整数），如 `2,5,8` | `2,5,8` |
| `--keywords` | 逗号分隔的关键词 | `AI` |
| `--start-date` | 区间起始 datetime `"YYYY-MM-DD HH:MM:SS"` | 今天 00:00:00 |
| `--end-date` | 区间结束 datetime `"YYYY-MM-DD HH:MM:SS"` | 当前时刻 |

---

## 3. 工作流（本鸭推荐的标准动作）

1. **选平台 + 定关键词 + 框时间窗**
   - 默认平台 `2,5,8`、关键词 `AI`、今天 00:00 至当前。
   - 用户给了具体词就换 `--keywords`，只关心某平台就收窄 `--platforms`。

2. **调脚本拿数据**
   ```bash
   python3 scripts/fetch_trends.py --platforms 2,5,8 --keywords AI
   ```
   脚本成功时把 `data` 以 JSON 打到 stdout，热点在 `data.items` 里。

3. **整理成一张 TOP 榜**
   按热度降序铺表，字段防御性读取：
   - `platform` 平台编号
   - `item.title` 标题
   - `item.hotCount` 热度
   - `item.index` 平台内名次

   | 名次 | 标题 | 热度 | 平台 |
   |------|------|------|------|
   | 1 | … | … | 2 |

4. **跨平台事件识别 + 选题信号**
   - **跨平台撞榜**：同一件事在多个平台都上榜 → 当下最硬的全网热点，优先级最高。
   - **平台差异**：同一事件在不同平台的切入角度本身就是选题。
   - **独占热点**：只在单平台冒头 → 该平台用户偏好信号，适合做垂类内容。

5. **给几条"可追的方向"**：基于榜单落到 3 条左右具体可执行的选题建议。

---

## 4. 接口契约

- 接口：`POST https://doubaoya.com/api/apis/trend/trending-hub-keyword/call`
- 鉴权：请求头 `Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体（精确参数）：
  ```json
  { "platforms": [2, 5, 8], "keywords": ["AI"], "startDate": "2026-06-24 00:00:00", "endDate": "2026-06-24 01:00:00" }
  ```
  - `platforms`：整数数组（平台编号）
  - `keywords`：字符串数组
  - `startDate` / `endDate`：datetime 字符串 `"YYYY-MM-DD HH:MM:SS"`
- 返回信封（envelope）：
  ```json
  {
    "success": true,
    "requestId": "…",
    "data": { "items": [ { "platform": 2, "item": { "title": "…", "hotCount": 123, "index": 1 } } ] },
    "error": null
  }
  ```
  - **先看 `success`**：`true` 才读 `data`；否则读 `error.code` / `error.message`。
  - 热点在 `data.items`；字段防御性读取，缺了就跳过。

---

## 5. 错误码

| HTTP | code | 含义 / 处理 |
|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 → 检查 `DOUBAOYA_API_KEY`，去口令中心重生成 |
| 400 | `VALIDATION_ERROR` | 参数不对 → 检查 `platforms`（整数）与 `keywords` 取值 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 → 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障，**已自动退费、可安全重试** → 稍后重跑即可 |

脚本会把失败统一打到 stderr：`[error] code: message`，并以退出码 1 退出。

---

## 6. 目录结构

```
trending-hub/
├── SKILL.md                 # 本说明
└── scripts/
    └── fetch_trends.py      # 零依赖热点拉取脚本（标准库 urllib）
```

---

## 7. 常见问答

**Q：提示 "缺少环境变量 DOUBAOYA_API_KEY"？**
A：先 `export DOUBAOYA_API_KEY="dyh_…"`（去 doubaoya.com → 登录 → 口令中心 → 生成口令）。

**Q：平台编号怎么填？**
A：填整数（如 `2,5,8`），具体编号对应哪个平台以 doubaoya.com 接口为准。

**Q：报 `502 PROVIDER_FAILED`？**
A：上游临时抖动，系统**已自动退费**，直接重跑即可。

**Q：某关键词没数据？**
A：正常现象——换个词或放宽时间窗即可。按 `data.items` 实际返回展示，缺字段就跳过。
