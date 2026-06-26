---
name: bilibili-keyword-accounts
description: B站关键词搜账号 · 按关键词搜 B 站账号（UP主），支持综合排序或按粉丝数排序，终端表格展示（UP主/UID/粉丝数/等级/简介）。当用户需要搜索 B站账号、查找 B站 UP主、找同赛道账号、做账号对标、筛选 KOL、拓展合作资源时使用。触发词：B站账号搜索、B站 UP主、找 B站账号、bilibili 账号、B站达人、B站同类账号。
---

# B站关键词搜账号（都爆鸭）

嘎！本鸭帮你按关键词搜 B 站账号——快速发现同赛道 UP 主、做账号对标、筛选潜在合作。一个关键词下去，终端铺出账号表格（粉丝数、等级、简介一目了然），可按综合或粉丝数排序，支持翻页。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **发现同赛道 UP主** | 搜 `数码` 看这个领域有哪些账号 | 快速锁定目标领域 UP主 |
| **账号对标** | 搜 `美食` 按粉丝数排序看头部大号 | 摸清头部账号基本面 |
| **筛选合作 KOL** | 搜 `美妆` 看粉丝量评估合作价值 | 拓展合作资源 |
| **了解领域生态** | 搜 `编程` 看赛道账号分布 | 掌握竞争格局 |

---

## 工作流（4 步）

### 1. 读懂意图，提炼关键词与排序
从用户描述里抽出**核心关键词**，2~6 个字最好（如 `数码`、`美食`、`编程`）。一次只搜一个关键词。

识别排序意图（用户没提就用默认）：
- **排序方式 `--order`**：默认 `"totalrank"`（综合排序）；`"fans"` = 粉丝数排序（用户提到「粉丝最多」「头部大号」时用）。
- **页码 `--page`**：默认 `1`。

### 2. 调用搜索脚本
```bash
python3 "$SKILL_PATH/scripts/search_bilibili_user.py" "数码"
```
按粉丝数排序 / 翻页（均可选）：
```bash
python3 "$SKILL_PATH/scripts/search_bilibili_user.py" "美食" --order fans --page 2
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次查询只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览，也别对同一关键词重复调用。

### 3. 渲染账号表格
从 `data.items`（账号数组）里取字段，按下面格式铺成 Markdown 表格。字段做**防御式读取**——`uname`（UP主）/ `uid` / `fansNum`（粉丝数）/ `level`（等级）/ `sign`（简介）可能缺失或命名略有差异，缺了就留空或写「—」，别让某条数据搞崩整张表。

| UP主 | UID | 粉丝数 | 等级 | 简介 |
|------|-----|--------|------|------|
| 某某 UP主 | 12345678 | 105.2w | Lv6 | 数码评测 / 好物分享 |

> 数字格式化：`< 10000` 用原始数字，`≥ 10000` 用 `x.xw`。简介过长（如超 40 字）可截断加 `...`；为空显示 `—`。

### 4. 给一句对标洞察
表格之后，用本鸭的口吻补一句**洞察**：这批账号里头部是谁、腰部有哪些值得对标、哪类账号还有空位。简短、有用，别堆套话。

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

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**，不要把口令带去任何其他域名。

---

## 接口与信封

- `POST https://doubaoya.com/api/apis/bilibili/search-user/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "keyword": "数码", "order": "totalrank", "page": 1 }`
  - `keyword`：字符串，必填
  - `order`：字符串，可选（默认 `"totalrank"` = 综合排序；`"fans"` = 粉丝数排序）
  - `page`：整数，可选（默认 1）
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "uid": 0, "uname": "...", "fansNum": 0, "level": 0, "sign": "..." } ] },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。
- ⚠️ **字段防御**：账号字段可能缺失或命名略有差异，读取时一律「取不到就给默认值」，缺字段留空，别报错。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 keyword 为空） | 修正关键词重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 404 | `ENDPOINT_NOT_FOUND` | 接口路径不对 | 恢复默认端点路径 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |
| — | `NETWORK_ERROR` | 连不上 doubaoya.com | 检查网络后重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
bilibili-keyword-accounts/
├── SKILL.md                       # 本文件
└── scripts/
    └── search_bilibili_user.py    # 零依赖搜索脚本（urllib），调用 doubaoya.com
```
