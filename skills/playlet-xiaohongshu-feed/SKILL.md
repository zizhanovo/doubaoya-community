---
name: playlet-xiaohongshu-feed
description: 小红书短剧笔记日报内容源 · 按关键词扫描小红书里的短剧爆款笔记，终端表格展示（标题/点赞）并聚类成每日短剧选题日报。当用户需要小红书短剧爆款笔记、短剧种草、短剧笔记选题、短剧安利文案、追踪小红书短剧赛道时使用。
---

# 小红书短剧笔记日报内容源（都爆鸭）

本鸭帮短剧创作者和 MCN 运营按关键词扫一遍小红书里的短剧爆款笔记——把短剧安利、剧情种草、追剧攻略类的爆款笔记捞出来，终端铺成可点的爆款表格，再按种草角度聚类成几个方向，攒成一份能直接拿去写笔记、做种草投放的短剧日报。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **每日爆笔盘点** | 用 `短剧` 扫今天小红书里的短剧爆款笔记 | 一眼看清小红书短剧圈今天在种什么草 |
| **种草选题日报** | 按角度扫一遍，聚类成几个种草切口 | 一份能直接写笔记的短剧选题日报 |
| **细分角度追踪** | 用 `短剧安利`、`甜宠短剧`、`追剧攻略` 等细词 | 锁定某种短剧种草写法的爆款 |
| **封面标题拆解** | 看高点赞笔记的标题与封面话术 | 提炼小红书短剧爆款笔记的种草套路 |
| **种草文案沉淀** | 翻页多拉几屏攒一手笔记素材 | 攒短剧种草/导流文案库 |

---

## 工作流（4 步）

### 1. 定关键词
从用户描述里抽出一个 **短剧方向关键词**（必填），如 `短剧`、`短剧安利`、`甜宠短剧`、`追剧攻略`、`短剧推荐`。词宽命中多、词细更聚焦，一次只扫一个关键词。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_playlet_feed.py" "短剧"
```
翻页 / 调整每页条数（可选）：
```bash
python3 "$SKILL_PATH/scripts/fetch_playlet_feed.py" "甜宠短剧" --page 2 --size 30
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一参数重复调用。

### 3. 渲染爆款表格
从 `data.items`（笔记数组）里取字段，铺成 Markdown 表格。本接口稳定返回的核心字段是 `title`（标题）与 `likeCount`（点赞）；做防御式读取——字段可能缺失，缺了就留空，别报错，也别脑补接口没返回的链接或作者。若某条返回里恰好带了链接，再把标题渲染成可点链接，否则纯文本即可。

| 标题 | 点赞 |
|------|------|
| 示例短剧爆款笔记 | 24,000 |

### 4. 聚类成日报 + 一句洞察
把这批笔记按种草角度**聚类**（如 剧情安利 / 演员吸粉 / 追剧攻略 / 同款穿搭），每个方向挑出代表爆款，组成一份简短日报。结尾用本鸭口吻补一句**选题洞察**：今天小红书短剧圈哪个角度最能种草、哪种封面话术还有空位。别堆套话，别反问用户目的。

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

- `POST https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-playlet-feed/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "短剧", "pageNum": 1, "pageSize": 20 }`
  - `keyword`：字符串，必填
  - `pageNum`：整数，可选（默认 1，由 `--page` 控制）
  - `pageSize`：整数，可选（默认 20，由 `--size` 控制）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "likeCount": 24000 } ] },
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
playlet-xiaohongshu-feed/
├── SKILL.md                      # 本文件
└── scripts/
    └── fetch_playlet_feed.py     # 零依赖脚本（urllib），调用 doubaoya.com
```
