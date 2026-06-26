---
name: douyin-works-crawler
description: 抖音账号作品采集 · 给一个账号（中文名或抖音号皆可），拉它的资料档案 + 近期作品列表，帮你做账号画像、拆解内容打法。当用户需要抖音账号画像、抖音作品采集、抖音达人资料、抖音内容拆解、抖音对标分析、抖音作品列表时使用。触发词：抖音账号画像、抖音作品采集、抖音达人资料、抖音内容拆解、对标账号、作品列表。
---

# 抖音账号作品采集 · 账号画像（都爆鸭）

本鸭帮你按账号拉**抖音资料档案 + 近期作品列表**——给一个账号（中文账号名或抖音号都行），就能看清它的基本盘、最近发了什么、哪条最爆，顺手拆解它的内容打法。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **账号画像** | 拉目标账号资料 + 作品 | 一份完整的账号档案 |
| **拆解爆款** | 看近期作品点赞分布 | 哪条内容最爆、为什么 |
| **对标研究** | 采集同赛道对标号 | 可迁移的内容打法 |
| **选题取经** | 扫一遍对方近期选题 | 一批可借鉴的选题方向 |

---

## 工作流

### 1. 给账号
传一个账号即可——**中文账号名**或**抖音号 ID** 都可以，系统会自动识别（中文名走账号名、否则走账号 ID）。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_user_works.py" "某某账号"
```
传抖音号也行：
```bash
python3 "$SKILL_PATH/scripts/fetch_user_works.py" "douyin12345"
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout，别用 `head`/`tail` 预览。

### 3. 呈现账号档案 + 作品表
先从 `data.profile` 里取账号基本盘（昵称、粉丝、简介等，防御式读取，缺了留空）写成一小段档案；再从 `data.items` 里取 **title（标题）**、**likeCount（点赞）**、**workUrl（作品链接）** 等字段，铺成 Markdown 表：

| 标题 | 点赞 | 作品链接 |
|------|------|----------|
| 某条作品 | xxxx | https://... |

> 涉及账号热度/影响力指标时，统一叫「热度指数 / 综合指数」，不要用其他叫法。

### 4. 给一句内容打法洞察
表后用本鸭口吻补一句：这个号靠什么内容形态起量、爆款集中在哪类选题、节奏和钩子有什么规律、哪些打法能迁移到自己的号或其他平台。简短、有用，别堆套话。

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

- `POST https://doubaoya.com/api/apis/douyin/douyin-user-works/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "account": "某某账号" }`
  - `account`：**必填**，账号名称或账号 ID 皆可；传中文账号名走账号名匹配，否则按抖音号 ID 匹配（后端自动识别）
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "profile": { ... }, "items": [ { "title": "...", "likeCount": 0, "workUrl": "..." } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如账号为空） | 补全账号名/抖音号后重试 |
| —  | `NO_DATA` | 没匹配到该账号 | 换个写法（中文名/抖音号）再试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
douyin-works-crawler/
├── SKILL.md                  # 本文件
└── scripts/
    └── fetch_user_works.py   # 零依赖脚本（urllib），调用 doubaoya.com
```
