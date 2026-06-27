---
name: wechat-similar-account
description: 公众号对标账号推荐 · 输入一个公众号名称，拉同赛道对标账号 + 高阶标杆账号，帮你搭竞品矩阵、找起号参考。当用户需要公众号对标、相似账号推荐、竞品发现、对标矩阵、起号参考、账号投放选择时使用。触发词：公众号对标、相似账号、对标推荐、竞品账号、起号参考、对标矩阵。
---

# 公众号对标账号推荐（都爆鸭）

本鸭帮你从一个公众号名字出发，扒出**同赛道可直接抄玩法的对标账号**，再推几个**模式更成熟、值得追赶的高阶标杆**——一句话，把竞品矩阵给你铺出来。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **竞品发现** | 给一个已知账号，让本鸭找出同赛道的相似号 | 一批可对标的竞品账号 |
| **对标矩阵** | 围绕自己的号搭一张对标表 | 同阶 + 高阶分层的对标矩阵 |
| **起号参考** | 新号没方向，先找成熟标杆抄结构 | 可复制的玩法与定位 |
| **投放选品** | 选合作/投放账号前看赛道生态 | 同赛道头部与腰部分布 |

---

## 工作流（4 步）

### 1. 确认对标种子账号
从用户描述里取一个**公众号名称**作为种子。名称越准命中越好；若用户提供了账号分类（如「职场」「母婴」），用 `--type` 传进去收窄赛道。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/fetch_similar.py" "某某公众号"
```
带分类收窄：
```bash
python3 "$SKILL_PATH/scripts/fetch_similar.py" "某某公众号" --type "职场"
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每个种子只跑一次脚本**，读完整 stdout，别用 `head`/`tail` 预览。

### 3. 账号未收录时：可选预同步
如果该账号尚未入库，可先提交同步受理（异步，约 30 分钟生效）。需要同时给微信号：
```bash
python3 "$SKILL_PATH/scripts/fetch_similar.py" "某某公众号" --sync --wechat-id "gh_xxxx"
```
`--sync` 会先发受理请求，回执后立刻继续拉当前可用的相似账号。若刚提交、数据还没回来，过约 30 分钟再跑一次即可。

### 4. 铺对标矩阵 + 给一句洞察
从 `data.items` 里取对标账号字段——`accountName`（账号名）、`avgReadCount`（平均阅读量）、`similarity`（相似度），防御式读取，缺了留空。按 `avgReadCount` 量级铺成两层 Markdown 表：**同阶对标**（量级相近、可直接抄玩法）和 **高阶标杆**（量级更大、模式可追赶）；`similarity` 越高越贴种子赛道。表后用本鸭口吻补一句：这个赛道头部在抢什么、自己的号该贴哪一档去打。

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

- 相似账号：`POST https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-similar-account/call`
  - 请求体：`{ "accountName": "某某公众号", "accountType": "职场" }`
    - `accountName`：字符串，必填
    - `accountType`：字符串，可选（收窄赛道）
- 可选预同步：`POST https://doubaoya.com/api/apis/gongzhonghao/gzh-sync-account/call`
  - 请求体：`{ "wechatId": "gh_xxxx", "accountName": "某某公众号" }`
  - 返回受理回执，异步生效（约 30 分钟）
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "accountName": "...", "avgReadCount": 50000, "similarity": 0.92 } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 accountName 为空、--sync 缺 --wechat-id） | 修正参数重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 404 | `NOT_FOUND` | 账号未收录 | 用 `--sync --wechat-id` 提交同步，约 30 分钟后重试 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
wechat-similar-account/
├── SKILL.md                  # 本文件
└── scripts/
    └── fetch_similar.py      # 零依赖脚本（urllib），调用 doubaoya.com
```
