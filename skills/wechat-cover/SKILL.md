---
name: wechat-cover
description: 公众号爆款封面参考 · 按主题关键词拉同赛道爆款封面（封面图/标题/点击量），帮你提炼可复用的封面视觉套路——配色、构图、信息层级。当用户需要公众号封面参考、爆款封面、封面设计灵感、封面配色构图、封面套路总结时使用。触发词：公众号封面、爆款封面、封面参考、封面设计、封面套路、封面灵感。
---

# 公众号爆款封面参考（都爆鸭）

本鸭帮你按主题拉一批**同赛道爆款封面**——封面图、标题、点击量一起给你，让你看清这个题材里高点击封面长什么样，再由你（主 Agent）总结出可复用的视觉套路：配色、构图、信息层级、标题钩子。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **封面创意参考** | 搜 `职场` 看这个题材高点击封面长啥样 | 一批爆款封面图 + 标题 |
| **配色/构图套路** | 拉同主题封面横向比对 | 高转化封面的视觉共性 |
| **选题对齐封面** | 定了选题，先看封面怎么配 | 贴合内容的封面方向 |
| **改版前调研** | 自己封面没流量，先看同赛道标杆 | 可对标的封面打法 |

---

## 工作流（4 步）

### 1. 提炼主题关键词
从用户需求里抽出**核心主题词**，精简为 2~6 个字（如 `职场`、`育儿`、`AI 工具`）。词越短越宽、命中越多；太细容易拉空。一次只搜一个关键词。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_cover.py" "职场"
```
指定起始日期（默认今天-29 天，覆盖近 30 天爆款窗口）：
```bash
python3 "$SKILL_PATH/scripts/fetch_cover.py" "职场" --start 2026-06-01
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每个主题只跑一次脚本**，读完整 stdout，别用 `head`/`tail` 预览。

### 3. 看封面、总结视觉套路
`data.items` 是**扁平化后的多榜合并列表**，每条形如 `{ rank, item }`：`rank` 标出这条来自哪个榜（`oneWReadingRank` 万级阅读榜 / `tenWReadingRank` 十万级阅读榜 / `originalRank` 原创榜），真正的字段在**嵌套的 `item` 对象里**——`item.coverUrl`（**封面图 URL**）、`item.title`（**标题**）、`item.clicksCount`（**点击量**）。字段防御式读取，`item` 或其子字段缺失就留空，别报错。把高点击的几张封面对齐看，归纳：
- **配色**：主色调、对比强度、是否大色块
- **构图**：人物/实物/纯文字、文字占比、视觉中心
- **信息层级**：主标题字号、是否加角标/数字/箭头钩子
- **标题钩子**：和封面文案如何呼应

### 4. 给一套封面方向建议
基于上面的套路，用本鸭口吻给用户一套**可落地的封面方向**（配色 + 构图 + 标题钩子的组合建议），别堆套话。封面图务必只用接口返回的真实数据，不脑补、不联网另找。

---

## 拿钥匙（密钥）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **密钥中心**
4. **生成密钥**（形如 `dyh_…`）

配置到环境变量（脚本只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
```

**铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出密钥。所有请求只发往 **doubaoya.com**。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-coze-cover/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "职场", "startDate": "2026-05-28" }`
  - `keyword`：字符串，必填
  - `startDate`：字符串 `YYYY-MM-DD`，可选（默认今天-29 天）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": {
      "items": [
        { "rank": "oneWReadingRank", "item": { "coverUrl": "...", "title": "...", "clicksCount": 0 } }
      ],
      "groups": { "oneWReadingRank": [], "tenWReadingRank": [], "originalRank": [] }
    },
    "error": null
  }
  ```
  - `items` 是三个榜（`oneWReadingRank` 万级阅读 / `tenWReadingRank` 十万级阅读 / `originalRank` 原创）拉平合并后的数组，每条 `{ rank, item }`；封面图在 `item.coverUrl`（**不是** `cover`），标题在 `item.title`，点击量在 `item.clicksCount`。
  - `groups` 按榜单原样分组，一般用不到，取数以 `items` 为准。
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 keyword 为空、日期格式错） | 修正参数重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
wechat-cover/
├── SKILL.md                  # 本文件
└── scripts/
    └── fetch_cover.py        # 零依赖脚本（urllib），调用 doubaoya.com
```
