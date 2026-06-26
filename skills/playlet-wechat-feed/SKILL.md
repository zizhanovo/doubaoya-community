---
name: playlet-wechat-feed
description: 公众号短剧文章日报内容源 · 按关键词扫描公众号里的短剧爆款文章，终端表格展示（标题链接/账号/点赞）并聚类成每日短剧选题日报。当用户需要公众号短剧爆文、短剧文章日报、短剧图文选题、短剧投放/解说素材、追踪公众号短剧赛道时使用。
---

# 公众号短剧文章日报内容源（都爆鸭）

本鸭帮短剧创作者和 MCN 运营按关键词扫一遍公众号里的短剧爆文——把短剧推荐、解说、盘点类的爆款图文捞出来，终端铺成可点的爆文表格，再按角度聚类成几个方向，攒成一份能直接拿去写图文、做投放文案的短剧日报。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **每日爆文盘点** | 用 `短剧` 扫今天公众号里的短剧爆文 | 一眼看清公众号短剧圈今天在写什么 |
| **图文选题日报** | 按角度扫一遍，聚类成几个切口 | 一份能直接写图文的短剧选题日报 |
| **细分角度追踪** | 用 `短剧推荐`、`短剧解说`、`短剧盘点` 等细词 | 锁定某种短剧图文写法的爆款 |
| **标题钩子拆解** | 看高点赞文章的标题与导语 | 提炼公众号短剧爆文的起标题套路 |
| **投放文案沉淀** | 翻页多拉几屏攒一手图文素材 | 攒短剧投放/导流文案库 |

---

## 工作流（4 步）

### 1. 定关键词
从用户描述里抽出一个 **短剧方向关键词**（必填），如 `短剧`、`短剧推荐`、`短剧解说`、`短剧盘点`、`短剧剧情`。词宽命中多、词细更聚焦，一次只扫一个关键词。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_playlet_feed.py" "短剧"
```
翻页 / 调整每页条数（可选）：
```bash
python3 "$SKILL_PATH/scripts/fetch_playlet_feed.py" "短剧解说" --page 2 --size 30
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一参数重复调用。

### 3. 渲染爆文表格
从 `data.items`（文章数组）里取字段，铺成 Markdown 表格。字段做防御式读取——`title`（标题）/ `accountName`（账号）/ `likeCount`（点赞）可能缺失，缺了就留空，别报错。标题渲染成**可点链接**（指向文章原文 URL）。

| 标题 | 账号 | 点赞 |
|------|------|------|
| [示例短剧爆文](https://mp.weixin.qq.com/s/xxx) | 某某短剧号 | 8,600 |

### 4. 聚类成日报 + 一句洞察
把这批文章按角度方向**聚类**（如 剧情盘点 / 演员八卦 / 短剧解说 / 投放种草），每个方向挑出代表爆文，组成一份简短日报。结尾用本鸭口吻补一句**选题洞察**：今天公众号短剧圈哪个角度最吃量、哪种标题写法还有空位。别堆套话，别反问用户目的。

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

- `POST https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-playlet-feed/call`
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
    "data": { "items": [ { "title": "...", "accountName": "...", "likeCount": 8600 } ] },
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
playlet-wechat-feed/
├── SKILL.md                      # 本文件
└── scripts/
    └── fetch_playlet_feed.py     # 零依赖脚本（urllib），调用 doubaoya.com
```
