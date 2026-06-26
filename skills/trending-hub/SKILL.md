---
name: trending-hub
description: 都爆鸭·全网热点聚合。一次把抖音、小红书、公众号的热榜拉到一起，帮你快速看清此刻全网在聊什么、哪些热点值得追、能从中嗅出哪些选题信号。触发词：全网热榜、热点聚合、追热点、热搜、趋势、选题信号、全网热点。返回的是聚合热榜，不做特定关键词的详情查询。
---

# 都爆鸭 · 全网热点聚合

本鸭一句话定位：把**抖音 / 小红书 / 公众号**三大平台的热榜聚合成一张榜，让你 1 分钟看清全网热点，并顺手帮你把它翻译成**可追的选题信号**。

适用对象：内容创作者、自媒体运营、市场/品牌策划、媒体编辑、追热点的同学。

> 重要边界：本技能返回的是**聚合热点榜**（多平台热榜的合并视图），**不**支持对某个特定热词做详情下钻。想要"今天全网在聊啥"——找本鸭就对了；想查"某个具体关键词的细节"——这个技能给不了。

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
# 默认：抖音 + 小红书 + 公众号，limit 由服务端决定
python3 scripts/fetch_trends.py

# 指定平台 + 条数
python3 scripts/fetch_trends.py --platforms douyin,xiaohongshu --limit 10
```

CLI 参数：

| 参数 | 说明 | 默认 |
|------|------|------|
| `--platforms` | 逗号分隔，可选 `douyin,xiaohongshu,gongzhonghao` | 三者全选 |
| `--limit` | 返回热点条数上限（整数，可选） | 不传则用服务端默认 |

---

## 3. 工作流（本鸭推荐的标准动作）

1. **选平台 + 定条数**
   - 默认就上全平台 `douyin,xiaohongshu,gongzhonghao`，`limit 10`。
   - 用户只关心某一两个平台时，按需收窄 `--platforms`。

2. **调脚本拿数据**
   ```bash
   python3 scripts/fetch_trends.py --platforms douyin,xiaohongshu,gongzhonghao --limit 10
   ```
   脚本成功时把 `data` 以 JSON 打到 stdout，热榜在 `data.items` 里。

3. **整理成一张 TOP 榜**
   按热度降序，输出排名 / 标题 / 热度 / 平台四列：

   | 排名 | 标题 | 热度 | 平台 |
   |------|------|------|------|
   | 1 | … | … | 抖音 |
   | 2 | … | … | 小红书 |
   | … | … | … | … |

   字段防御性读取（接口可能缺字段就跳过/留空）：
   - `title` 标题
   - `heat` 热度
   - `platform` 平台（douyin→抖音、xiaohongshu→小红书、gongzhonghao→公众号）
   - `rank` 平台内排名

4. **跨平台事件识别 + 选题信号**
   - **跨平台撞榜**：同一件事在多个平台都上榜 → 这是当下最硬的全网热点，优先级最高。
   - **平台差异**：同一事件在抖音是短视频玩法、在小红书是图文种草、在公众号是深度解读 → 不同平台的切入角度本身就是选题。
   - **独占热点**：只在单平台冒头 → 该平台用户的偏好信号，适合做垂类内容。

5. **给几条"可追的方向"**
   基于上面的榜单，落到 3 条左右**具体可执行**的选题建议，例如：
   - "话题 X 正跨平台发酵，建议出一条 30 秒抖音 + 一篇小红书图文双开。"
   - "公众号侧 Y 偏深度解读，可做'一文看懂'长图文承接搜索流量。"
   - "Z 目前仅小红书在热，适合做种草测评卡位。"

---

## 4. 接口契约

- 接口：`POST https://doubaoya.com/api/apis/trend/hot-topics/call`
- 鉴权：请求头 `Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体（精确参数）：
  ```json
  { "platforms": ["douyin", "xiaohongshu"], "limit": 10 }
  ```
  - `platforms`：字符串数组，合法值 `douyin` / `xiaohongshu` / `gongzhonghao`
  - `limit`：整数，可选
- 返回信封（envelope）：
  ```json
  {
    "success": true,
    "requestId": "…",
    "data": { "items": [ { "title": "…", "heat": 123, "platform": "douyin", "rank": 1 } ] },
    "error": { "code": "…", "message": "…" }
  }
  ```
  - **先看 `success`**：`true` 才读 `data`；否则读 `error.code` / `error.message`。
  - 热榜在 `data.items`；字段（`title` / `heat` / `platform` / `rank`）防御性读取，缺了就跳过。

---

## 5. 错误码

| HTTP | code | 含义 / 处理 |
|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 → 检查 `DOUBAOYA_API_KEY` 是否配置正确，去口令中心确认/重生成 |
| 400 | `VALIDATION_ERROR` | 参数不对 → 检查 `platforms` 取值与 `limit` 类型 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 → 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障，**已自动退费、可安全重试** → 稍后重跑即可 |

脚本会把失败统一打到 stderr：`[error] code: message`，并以退出码 1 退出。

---

## 6. 目录结构

```
trending-hub/
├── SKILL.md                 # 本说明
└── scripts/
    └── fetch_trends.py       # 零依赖热榜拉取脚本（标准库 urllib）
```

---

## 7. 常见问答

**Q：提示 "未找到环境变量 DOUBAOYA_API_KEY"？**
A：先 `export DOUBAOYA_API_KEY="dyh_…"`（去 doubaoya.com → 登录 → 口令中心 → 生成口令）。

**Q：能查某个具体热词的详情吗？**
A：不能。本技能只做**聚合热榜**，不做特定关键词的详情下钻。

**Q：报 `502 PROVIDER_FAILED`？**
A：上游临时抖动，系统**已自动退费**，直接重跑即可。

**Q：某平台没数据？**
A：正常现象——不同平台用户群不同，热点分布本来就有差。按 `data.items` 实际返回展示即可，缺字段就跳过。
