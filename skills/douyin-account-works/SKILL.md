---
name: douyin-account-works
description: 抖音账号概况 + 作品体量概览。输入抖音账号的 secUid，调用都爆鸭接口返回账号档案（昵称、粉丝数、关注数、作品总数），并给出作品体量速览。当用户提到"抖音作品"、"抖音账号概况"、"抖音内容采集"、"抖音作品体量"、"达人作品"时使用。注意：本接口为账号档案级（profile-only），不返回逐条作品列表；如需拆解某条具体作品，引导用户改用内容解析技能（tool/parse-content-detail）并提供作品链接。
---

# 抖音账号概况 · 作品体量概览

> 本鸭一句话：丢给我一个抖音账号的 secUid，我先把这只账号的「家底」给你摸清楚——昵称、粉丝、关注、作品总数，一锅端。具体哪条作品好，咱们再单独拆。

---

## 这只鸭子能干啥

这是都爆鸭社区库里的「抖音账号概况」技能。它做的是**账号档案 + 作品体量**这一层：

- 拿到账号的 **secUid**，调用都爆鸭官方接口；
- 返回**账号概况**：昵称、粉丝数、关注数、作品总数；
- 给出**作品体量**判断（这只账号一共发了多少条），帮你快速判断它是高产号还是精品号。

适合品牌方、MCN、内容运营在签约 / 竞品监测的**第一步**——先看账号底子，再决定要不要深挖。

### 它**不**做什么（重要）

本接口是 **profile-only（账号档案级）**：它返回账号的统计数字，**不返回逐条作品列表**，也**不会**逐条吐出 50 条作品的点赞 / 评论 / 链接。

所以请**不要**承诺"爬一份 50 条作品清单"。如果用户想拆解**某一条具体作品**（完播、互动、文案结构等），让他把那条作品的链接给你，改用**内容解析技能 `tool/parse-content-detail`** 来逐条解析。两者分工：

| 想要的东西 | 用哪个技能 |
|------------|------------|
| 账号有多少粉、发了多少条（账号底子） | **本技能** douyin-account-works |
| 某一条作品的详细数据（给链接逐条拆） | 内容解析技能 `tool/parse-content-detail` |

---

## 三步上手

### 第一步：拿钥匙（口令）

调接口需要一把都爆鸭口令：

1. 打开 **doubaoya.com**
2. **登录**
3. 进入 **口令中心**
4. 点击 **生成口令**，得到一串形如 `dyh_xxxxxxxx` 的口令

把它设进环境变量（**本鸭只读不说，绝不把口令打印出来**）：

```bash
# macOS / Linux
export DOUBAOYA_API_KEY=你的口令      # 形如 dyh_xxxxxxxx

# Windows PowerShell
$env:DOUBAOYA_API_KEY="你的口令"
```

### 第二步：拿到 secUid

本接口**只认 secUid**（账号的稳定唯一标识，形如 `MS4wLjABAAAA...`）。

怎么取 secUid：打开目标账号的抖音主页（网页版 / 分享链接），URL 里 `/user/` 后面那一长串就是 secUid。例如
`https://www.douyin.com/user/MS4wLjABAAAA...` → 取 `MS4wLjABAAAA...`。

> 本技能不做"昵称模糊搜索"。请直接提供 secUid，结果最准。

### 第三步：跑脚本

```bash
python3 scripts/query_account.py "MS4wLjABAAAA..."
```

脚本零依赖（只用 Python 3 标准库 `urllib`），从环境变量读口令，成功时打印 `data` 的 JSON。

---

## 接口契约

- **Host**：`https://doubaoya.com`
- **Endpoint**：`POST https://doubaoya.com/api/apis/douyin/query-account/call`
- **认证**：请求头 `Authorization: Bearer $DOUBAOYA_API_KEY`
- **请求体**（精确参数，仅 secUid）：

  ```json
  { "secUid": "MS4wLjABAAAA..." }
  ```

- **返回信封**：

  ```json
  {
    "success": true,
    "requestId": "req_xxx",
    "data": {
      "profile": {
        "nickname": "本鸭厨房",
        "followerCount": 1234567,
        "followingCount": 42,
        "workCount": 318
      }
    },
    "error": null
  }
  ```

  **先看 `success`**：为 `true` 才取 `data`；否则读 `error.code` / `error.message`。
  解析 `data.profile` 请**防御式**取值——字段可能缺失，缺了就显示"—"，别让流程崩。

---

## 把结果讲给用户（账号概况模板）

成功拿到 `data.profile` 后，按下面这样组织回复：

```
📋 抖音账号概况 · {nickname}

• 粉丝数：{followerCount}
• 关注数：{followingCount}
• 作品总数：{workCount}

🦆 作品体量：这只账号累计发布 {workCount} 条作品。
（本技能给的是账号底子；想逐条拆解某条作品，把作品链接发我，
  我用内容解析技能 tool/parse-content-detail 单独给你拆。）
```

数字呈现建议：≥1 亿用"亿"，≥1 万用"w"（如 123.5w），<1 万用千分位（如 9,860）。

> ⚠️ **绝不编造**：`data.profile` 里没有的字段（例如逐条作品、互动明细、某种"指数"）一律不要凭空生成。接口没给，就如实说"本接口未提供"，并引导去用内容解析技能。

---

## 报错怎么读

脚本会把错误打到 stderr，形如 `[error] CODE: message`，并以非 0 退出。常见码：

| HTTP | code | 含义 / 处理 |
|------|------|-------------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没设口令或口令无效。去 doubaoya.com → 口令中心 重新生成，重设 `DOUBAOYA_API_KEY`。 |
| 400 | `VALIDATION_ERROR` | 入参有问题，多半是 secUid 缺失 / 格式不对。检查是不是传成了昵称或抖音号。 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足。前往 doubaoya.com 充值后重试。 |
| 502 | `PROVIDER_FAILED` | 上游临时抖动。**已自动退款，可安全重试**。 |

脚本本地未设口令时，会直接报"未设置环境变量 DOUBAOYA_API_KEY"并给出取口令指引，**不会**发起请求。

---

## 项目结构

```
douyin-account-works/
├── scripts/
│   └── query_account.py   # 零依赖脚本：POST {secUid}，按信封解析后打印 data
└── SKILL.md               # 本说明（工作流 / 契约 / 模板 / 报错）
```

---

## 安全与边界（本鸭守则）

- **绝不打印口令**：脚本只把口令放进请求头，任何输出 / 日志都不含它。
- **绝不编造数据**：只呈现接口真实返回的字段；缺字段就如实说缺。
- **不越界**：本技能只做账号档案 + 作品体量。逐条作品解析 → 内容解析技能 `tool/parse-content-detail`。
- **只连 doubaoya.com**：本技能只与 `doubaoya.com` 通信，不连任何其它数据源。
