---
name: ks-ai-feed
description: 快手 AI 爆款视频日报内容源 · 按一批关键词批量扫描快手平台 AI 方向的爆款视频，终端表格展示（标题/作者/播放量）并聚类成每日选题日报。当用户需要快手 AI 日报、快手每日 AI 热点、快手 AI 爆款视频、快手内容选题、做快手 AI 赛道内容发现时使用。
---

# 快手 AI 爆款视频日报内容源（都爆鸭）

本鸭帮你按一批关键词扫一遍快手上 AI 方向的爆款视频——把当下快手跑得最火的 AI 短视频捞出来，终端铺成爆款表格，再帮你聚类成几个话题方向，攒成一份能直接用的快手 AI 选题日报。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **每日快手 AI 热点** | 用 `AI教程`、`ChatGPT` 等扫今天的爆款 | 一眼看清快手 AI 圈今天在火什么 |
| **快手 AI 选题日报** | 一次传多个关键词批量扫，聚类成几个话题 | 一份能直接选题的短视频日报 |
| **细分方向追踪** | 传 `AI绘画`、`数字人`、`AI变现` 等细词 | 锁定某个快手 AI 细分赛道的爆款 |
| **爆款角度拆解** | 看高播放量视频的标题与切口 | 提炼快手 AI 短视频的爆款写法 |
| **素材沉淀** | 翻页多拉几屏攒库 | 攒一手快手 AI 方向选题素材 |

---

## 工作流（4 步）

### 1. 定关键词（可多个）
从用户描述里抽出一批 **AI 方向关键词**（必填，至少一个），如 `AI教程`、`ChatGPT`、`大模型`、`AI绘画`、`数字人`。一次可传多个批量扫，词宽命中多、词细更聚焦。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_ks_ai_feed.py" "AI教程" "ChatGPT"
```
翻页 / 调整每页条数（可选）：
```bash
python3 "$SKILL_PATH/scripts/fetch_ks_ai_feed.py" "大模型" "AI绘画" --page 2 --size 30
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一参数重复调用。

### 3. 渲染爆款表格
从 `data.items`（视频数组）里取字段，铺成 Markdown 表格。字段做防御式读取——`title`（标题）/ `authorName`（作者）/ `playCount`（播放量）可能缺失，缺了就留空，别报错。**按播放量从高到低排**。

| 标题 | 作者 | 播放量 |
|------|------|--------|
| 三分钟学会用 AI 做口播 | 某某 AI 号 | 128,000 |

### 4. 聚类成日报 + 一句洞察
把这批视频按话题方向**聚类**（如 工具教程 / AI绘画 / 数字人 / 变现玩法），每个方向挑出代表爆款，组成一份简短日报。结尾用本鸭口吻补一句**选题洞察**：今天快手 AI 圈哪个方向最热、哪个角度还有空位。别堆套话，别反问用户目的。

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

## 接口与信封

- `POST https://doubaoya.com/api/apis/kuaishou/kuaishou-ai-feed/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keywords": ["AI教程", "ChatGPT"], "pageNum": 1, "pageSize": 20 }`
  - `keywords`：字符串数组，必填（可批量传多个关键词）
  - `pageNum`：整数，可选（默认 1，由 `--page` 控制）
  - `pageSize`：整数，可选（默认 20，由 `--size` 控制）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "authorName": "...", "playCount": 128000 } ] },
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
| 400 | `VALIDATION_ERROR` | 参数不合法（如 keywords 为空） | 修正关键词重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
ks-ai-feed/
├── SKILL.md                     # 本文件
└── scripts/
    └── fetch_ks_ai_feed.py      # 零依赖脚本（urllib），调用 doubaoya.com
```
