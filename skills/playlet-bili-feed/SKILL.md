---
name: playlet-bili-feed
description: B站短剧视频日报内容源 · 按关键词扫描 B 站里的短剧爆款视频，终端表格展示（标题链接/UP主/点赞）并聚类成每日短剧选题日报。当用户需要 B 站短剧爆款视频、短剧解说选题、短剧吐槽/二创素材、追踪 B 站短剧赛道时使用。
---

# B站短剧视频日报内容源（都爆鸭）

本鸭帮短剧创作者和 MCN 运营按关键词扫一遍 B 站上的短剧爆款视频——把短剧解说、吐槽、二创、盘点类的爆款视频捞出来，终端铺成可点的爆款表格，再按内容形态聚类成几个方向，攒成一份能直接拿去做解说脚本、二创选题的短剧日报。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **每日爆款盘点** | 用 `短剧` 扫今天 B 站里的短剧爆款视频 | 一眼看清 B 站短剧区今天在火什么 |
| **解说选题日报** | 按形态扫一遍，聚类成几个内容方向 | 一份能直接写解说脚本的短剧选题日报 |
| **细分形态追踪** | 用 `短剧解说`、`短剧吐槽`、`短剧二创` 等细词 | 锁定某种短剧视频形态的爆款 |
| **标题封面拆解** | 看高点赞视频的标题与封面切口 | 提炼 B 站短剧爆款视频的起标题套路 |
| **对标 UP 沉淀** | 翻页多拉几屏看谁在持续出爆款 | 攒一手 B 站短剧对标 UP 主库 |

---

## 工作流（4 步）

### 1. 定关键词
从用户描述里抽出一个 **短剧方向关键词**（必填），如 `短剧`、`短剧解说`、`短剧吐槽`、`短剧二创`、`短剧盘点`。词宽命中多、词细更聚焦，一次只扫一个关键词。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_playlet_feed.py" "短剧"
```
翻页 / 调整每页条数（可选）：
```bash
python3 "$SKILL_PATH/scripts/fetch_playlet_feed.py" "短剧解说" --page 2 --size 30
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一参数重复调用。

### 3. 渲染爆款表格
从 `data.items`（视频数组）里取字段，铺成 Markdown 表格。字段做防御式读取——`title`（标题）/ `authorName`（UP 主）/ `likeCount`（点赞）可能缺失，缺了就留空，别报错。标题渲染成**可点链接**（指向视频原文 URL）。

| 标题 | UP主 | 点赞 |
|------|------|------|
| [示例短剧爆款视频](https://www.bilibili.com/video/xxx) | 某某短剧UP | 56,000 |

### 4. 聚类成日报 + 一句洞察
把这批视频按内容形态**聚类**（如 短剧解说 / 高能吐槽 / 剪辑二创 / 盘点合集），每个方向挑出代表爆款，组成一份简短日报。结尾用本鸭口吻补一句**选题洞察**：今天 B 站短剧区哪种形态最能涨播放、哪个切口还有空位。别堆套话，别反问用户目的。

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

- `POST https://doubaoya.com/api/apis/bilibili/bilibili-playlet-feed/call`
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
    "data": { "items": [ { "title": "...", "authorName": "...", "likeCount": 56000 } ] },
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
playlet-bili-feed/
├── SKILL.md                      # 本文件
└── scripts/
    └── fetch_playlet_feed.py     # 零依赖脚本（urllib），调用 doubaoya.com
```
