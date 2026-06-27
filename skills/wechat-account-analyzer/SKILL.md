---
name: wechat-account-analyzer
description: 公众号账号诊断 · 按名称批量给公众号做体检，输出账号画像 / 发文表现 / 健康度，支持多号并诊做竞品对照；可选先触发异步同步再诊断。当用户要给公众号做诊断、账号体检、看账号健康度、竞品账号对照、批量诊断多个号时使用。触发词：公众号诊断、账号体检、账号健康度、账号画像、竞品诊断、批量诊断。
---

# 公众号账号诊断（都爆鸭）

本鸭给公众号**做体检**：报上一个或多个账号名，本鸭把它们的画像、发文表现、健康度一并捞回来——自查也行，竞品并排对照也行。诊断读的是**库里现有的数据**；想要更新更全，先触发一次异步同步、等落库后再诊。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。
>
> 诊断画像按 API 真实返回字段如实呈现——主要看 `avgReadCount`（平均阅读）、`healthScore`（健康度）；缺什么就标"暂无"，不脑补、不打主观分。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **自号体检** | 诊断自己的公众号 | 画像 + 发文表现 + 健康度 |
| **竞品诊断** | 一次报多个竞品账号名 | 横向对照找差距 |
| **选号初筛** | 批量诊断候选合作号 | 快速判断量级是否匹配 |
| **定期复盘** | 周期性诊断同一批号 | 看健康度走势 |
| **同步后再诊** | `--sync` 先刷数据再体检 | 拿更新更全的诊断底数 |

---

## 工作流（4 步）

### 1. 收齐账号名称
取出要诊断的一个或多个**公众号名称**。名称越准、命中越稳。多个账号一次报齐即可并诊对照。

### 2.（可选）先同步、再诊断
默认直接诊断，读**库里现有数据**。若需要更新更全的底数，加 `--sync`：脚本会**先**对每个账号触发一次**异步同步**（用账号名作为 `accountId`），打印各自的**受理回执**（含 `status` / `retryAfterMinutes`），**再**调诊断接口。
> 同步是**异步**的，落库需要时间（参考回执里的 `retryAfterMinutes`）。带 `--sync` 这一次诊断**仍读库里现有数据**；想吃到刚同步的新数据，等回执建议的分钟数后**不带 `--sync`** 再跑一次。

### 3. 调用诊断脚本
```bash
# 直接诊断（读库里现有数据）
python3 "$SKILL_PATH/scripts/analyze_accounts.py" "账号A" "账号B"

# 先触发异步同步（打印受理回执），再诊断
python3 "$SKILL_PATH/scripts/analyze_accounts.py" "账号A" "账号B" --sync
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout（带 `--sync` 时会先额外打印 `syncReceipts`）。**每次只跑一次**，直接读完整 stdout。

### 4. 出诊断报告
基于返回的 `data.items` 给每个账号出一份简报：账号名（`accountName`）、平均阅读（`avgReadCount`）、健康度（`healthScore`）。多号时并排对照、点出差距与可落地的优化方向。字段做**防御式读取**——API 没返回的字段标"暂无"，**不估算、不补值、不打主观分**。

---

## 拿钥匙（口令）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **口令中心**
4. **生成口令**（形如 `dyh_…`）

配进环境变量（脚本只认这个）：
```bash
export DOUBAOYA_API_KEY="dyh_你的口令"
```

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**。

---

## 接口与信封

诊断（主接口）：
- `POST https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-account-analyzer/call`
- 请求体：`{ "accountNames": ["账号A", "账号B"] }`（字符串数组，必填）
- `data.items` 每条含 `accountName`、`avgReadCount`（平均阅读）、`healthScore`（健康度）。

同步（可选，`--sync` 时每个账号各调一次）：
- `POST https://doubaoya.com/api/apis/gongzhonghao/gzh-sync-notes/call`
- 请求体：`{ "accountId": "账号A" }`（用账号名作为 accountId）
- 返回**受理回执** `{ status, accepted, retryAfterMinutes }`，异步落库，不阻塞诊断；`retryAfterMinutes` 是建议的重试等待分钟数。

共用：
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "items": [ { "accountName": "...", "avgReadCount": 0, "healthScore": 0 } ] },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如账号名为空） | 核对账号名后重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试安全，不会重复扣费。

---

## 目录结构

```
wechat-account-analyzer/
├── SKILL.md                  # 本文件
└── scripts/
    └── analyze_accounts.py   # 零依赖诊断脚本（urllib，含可选 --sync），调用 doubaoya.com
```
