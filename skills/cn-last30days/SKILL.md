---
name: cn-last30days
description: 全网近30天作品聚合 · 一个关键词同时捞「小红书 + 抖音 + 公众号」近30天真实作品，跨平台对比舆情、对照三平台选题角度。当用户需要跨平台话题研究、社媒舆情监测、品牌口碑对比、三平台选题对照、热点跨平台分析时使用。触发词：跨平台分析、社媒舆情、近30天作品、小红书抖音公众号、舆情监测、话题研究、跨平台选题。
dependency:
  python: []
  system:
---

# 全网近30天作品聚合（都爆鸭）

嘎！本鸭一个关键词下去，同时把**小红书、抖音、公众号**近30天的真实作品捞回来——三平台一次到位，跨平台看舆情、对照选题角度，不用一个平台一个平台地翻。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **跨平台舆情对比** | 搜 `大模型` 看三平台各自在聊什么 | 一眼看出哪个平台更热、口径差在哪 |
| **三平台选题对照** | 搜 `减脂` 对比小红书种草 / 抖音追评 / 公众号深度 | 同一题各平台的切口与角度 |
| **品牌口碑监测** | 搜 `某品牌` 看三平台口碑与讨论 | 多维度舆情视角，交叉验证 |
| **热点话题研究** | 搜 `2026 经济` 看全网风向 | 为研究 / 报告打底 |
| **历史回溯** | 加 `--start-date` / `--end-date` 框定时间窗 | 追一段时间内的趋势演变 |

> 平台信号速读：小红书 = 种草体验 / 教程攻略；抖音 = 热点追评 / 情绪传播；公众号 = 行业深度 / 观点输出。三平台交叉验证的结论最稳。

---

## 工作流（4 步）

### 1. 读懂意图，提炼关键词
从用户描述里抽出**核心关键词**，精简到 2~6 个字最好（如 `AI 视频`、`大模型`、`职场`）。词越短越宽，命中越多；太长太细容易搜空。一次只搜一个关键词。话题太模糊（如「工具」「方法」）时，先请用户具体化再搜。

### 2. 调用聚合脚本
```bash
python3 "$SKILL_PATH/scripts/search_cn30.py" "大模型"
```
框定时间窗（可选，回溯近30天内任意区间）：
```bash
python3 "$SKILL_PATH/scripts/search_cn30.py" "大模型" --start-date 2026-06-01 --end-date 2026-06-24
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head` / `tail` 预览或对同一关键词重复调用。

### 3. 渲染三平台表格
返回的 `data` 内含三组数组（防御式读取，缺字段留空别报错）：

| 数组键 | 平台 | 典型字段 |
|--------|------|----------|
| `xhsResult` | 小红书 | `title` / `authorName` / `likeCount` / `commentCount` / `publishTime` / 链接 |
| `dyResult` | 抖音 | `title` / `authorName` / 点赞 / 评论 / 分享 / `publishTime` / 链接 |
| `gzhResult` | 公众号 | `title` / `accountName` / 阅读 / 点赞 / `publishTime` / 链接 |

**展示方式（二选一）**：

- **分平台三张表**（推荐）：按 公众号 → 小红书 → 抖音 顺序，每平台一张表，各取互动靠前的若干条，标题渲染成可点链接。
  | 标题 | 作者 | 互动 | 发布时间 |
  | ---- | ---- | ---- | -------- |
- **合并一张表**：加一列「平台」，把三组作品并到 `平台 / 标题 / 互动 / 发布时间` 一张表里，便于横向比对。

### 4. 给一句跨平台洞察
表格之后，用本鸭口吻补一句**跨平台洞察**：同一话题在三平台的热度差、各平台的切口差异、哪个角度还没被写透、值不值得跟。简短有用，别堆套话，别追问用户「真实目的是什么」。

---

## 拿钥匙（密钥）

1. 打开 **doubaoya.com**
2. **登录**（没有账号先注册）
3. 进 **密钥中心**
4. **生成密钥**（形如 `dyh_…`）

配置到环境变量（脚本只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
```

**铁律：密钥绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出密钥。所有请求只发往 **doubaoya.com**，不要把密钥带去任何其他域名。

依赖：仅用 Python 3 标准库，无需安装任何第三方包。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/multi/cn30-multi-search/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "大模型" }`，可选带 `startDate` / `endDate`
  - `keyword`：字符串，必填
  - `startDate` / `endDate`：`YYYY-MM-DD`，**可选**——不传时由服务端取默认近30天；只在用户给了时间口径时才带上
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": {
      "xhsResult": [ { "title": "...", "authorName": "...", "likeCount": 0, "publishTime": "..." } ],
      "dyResult":  [ { "title": "...", "authorName": "...", "publishTime": "..." } ],
      "gzhResult": [ { "title": "...", "accountName": "...", "publishTime": "..." } ]
    },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。
- 字段防御：三组数组里每条作品字段命名可能略有差异、也可能缺失，一律「取不到给默认值」，缺了留空，别让一条数据搞崩整张表。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成（不要回显密钥） |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 keyword 为空、日期格式不对） | 修正参数重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值 / 续额 |
| 404 | `ENDPOINT_NOT_FOUND` | 接口路径不对 | 一般是脚本被改动，恢复默认端点路径 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |
| — | `NETWORK_ERROR` | 连不上 doubaoya.com | 检查网络后重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
cn-last30days/
├── SKILL.md                  # 本文件
└── scripts/
    └── search_cn30.py        # 零依赖聚合脚本（urllib），调用 doubaoya.com
```
