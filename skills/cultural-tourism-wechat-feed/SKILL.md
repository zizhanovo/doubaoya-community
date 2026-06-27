---
name: cultural-tourism-wechat-feed
description: 公众号文旅文章内容源 · 按关键词扫描公众号里的文旅/城市/景区爆款长文，终端表格展示（标题链接/点赞）并聚类成文旅选题方向。当用户做文旅局/景区/城市文旅的公众号选题与对标、找文旅长文爆款、写城市旅游推文找角度时使用。
---

# 公众号文旅文章内容源（都爆鸭）

本鸭帮你按关键词扫一遍公众号里的文旅爆款长文——把城市、景区、线路攻略里阅读跑得最高的文章捞出来，终端铺成可点的爆文表格，再帮你聚类成几个文旅选题方向，攒成一份能直接动笔的推文对标清单。

> 公众号是文旅深度内容的阵地：攻略、城市故事、文旅政策解读都在这里出长尾爆款。适合**文旅局公众号、景区订阅号、城市文旅运营**找深度选题、看同行推文、抠标题角度。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

> 说明：底层是公众号内容流 Feed，按你给的关键词取文章。「文旅」是用关键词把它当文旅选题镜头来用——结果取决于 Feed 对你这个词的命中，词越贴近文旅越准。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **推文选题** | 用 `文旅`、`城市旅游` 扫高阅读爆文 | 看清文旅长文当下写什么火 |
| **景区深度对标** | 用 `景区`、`古镇`、`非遗` 等 | 锁定景区类长文的角度与结构 |
| **城市故事挖掘** | 用 `城市`、`小众目的地` 找切口 | 找到城市文旅的故事化写法 |
| **爆款热度排序** | 按 `likeCount` 点赞从高到低看 | 一眼锁定文旅长文里最能打的爆款 |
| **标题角度拆解** | 看高点赞文章的标题写法 | 提炼文旅推文的爆款标题套路 |

---

## 工作流（4 步）

### 1. 定关键词
从用户描述里抽出一个 **文旅方向关键词**（必填），如 `文旅`、`城市旅游`、`景区`、`古镇`、`非遗`、`小众目的地`。词宽命中多、词细更聚焦，一次只扫一个关键词。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_culture_feed.py" "文旅"
```
翻页 / 调整每页条数（可选）：
```bash
python3 "$SKILL_PATH/scripts/fetch_culture_feed.py" "城市旅游" --page 2 --size 30
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一参数重复调用。

### 3. 渲染爆文表格
从 `data.items`（文章数组）里取字段，铺成 Markdown 表格。字段做防御式读取——`title`（标题）/ `likeCount`（点赞）可能缺失，缺了就留空，别报错。标题渲染成**可点链接**（指向文章原文 URL，URL 缺失则纯文本）。

| 标题 | 点赞 |
|------|------|
| [示例文旅爆文](https://mp.weixin.qq.com/s/xxx) | 1,200 |

### 4. 聚类成选题方向 + 一句洞察
把这批文章按文旅角度**聚类**（如 城市故事 / 景区攻略 / 美食地图 / 非遗文化 / 政策解读），每个方向挑出代表爆款，组成一份简短对标清单。结尾用本鸭口吻补一句**选题洞察**：当下文旅长文哪个角度最受欢迎、哪种叙事还有空位。别堆套话，别反问用户目的。

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
- 请求体：`{ "keyword": "文旅", "pageNum": 1, "pageSize": 20 }`
  - `keyword`：字符串，必填
  - `pageNum`：整数，可选（默认 1，由 `--page` 控制）
  - `pageSize`：整数，可选（默认 20，由 `--size` 控制）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "title": "...", "likeCount": 1200 } ] },
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
cultural-tourism-wechat-feed/
├── SKILL.md                    # 本文件
└── scripts/
    └── fetch_culture_feed.py   # 零依赖脚本（urllib），调用 doubaoya.com
```
