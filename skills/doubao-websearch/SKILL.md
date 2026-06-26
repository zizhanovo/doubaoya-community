---
name: doubao-websearch
description: 豆包联网搜索 · 提交一个查询做异步联网检索（约 5 分钟），返回综合答案 + 引用来源 + 延伸建议。当用户需要联网查资料、找最新信息、要带来源的搜索答案、做事实核查时使用。
---

# 豆包联网搜索（都爆鸭）

本鸭帮你把一个问题丢给豆包联网检索——服务端实时联网把资料搜全、读完、整合，回给你一段**综合答案**，附上**引用来源**和几条**延伸建议**。无需自建检索链路，按次消费。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

> ⏳ **这是异步慢操作**：检索在服务端执行，整个过程**约 5 分钟**，单次请求内一气呵成返回——**无需客户端轮询**，发一次 POST 静等结果即可。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **联网查最新信息** | 把问题作为查询提交 | 综合答案 + 实时来源 |
| **带来源的事实核查** | 提一个需要佐证的问题 | 答案 + 可追溯的引用链接 |
| **快速调研** | 抛一个开放问题 | 整合好的结论 + 延伸方向 |
| **找资料源** | 围绕主题提问 | 一批相关来源链接 |

---

## 工作流（3 步）

### 1. 写好查询
从用户需求里提炼一个清晰的检索查询（一句话即可，越具体越准）。

### 2. 调用脚本（耐心等几分钟）
```bash
python3 "$SKILL_PATH/scripts/doubao_search.py" "2025 年 AI Agent 落地有哪些代表案例"
```
脚本会先在 stderr 提示「已提交，服务端生成中」，然后**等待约 5 分钟**直到结果返回，把成功信封里的 `data` 以 JSON 打到 stdout。**每个查询只跑一次脚本**，别中途打断、别重复调用，直接读完整 stdout。

### 3. 渲染综合答案 + 来源
从 `data` 里取字段，做**防御式读取**：
- `result.content`：综合答案正文 → 直接呈现给用户
- `result.references[]`：引用来源 → 铺成**来源列表**（可点链接）
- `result.suggestions[]`：延伸建议 → 列在末尾供用户继续追问

任一字段缺失就跳过该块，别报错。建议排版：先答案，再「来源」列表，最后「你还可以问」延伸建议。

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

- `POST https://doubaoya.com/api/skills/doubao-web-search/invoke`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "query": "<查询>" }`
  - `query`：字符串，必填
- **异步慢操作**：服务端约 5 分钟内完成检索并在本次请求里返回，无需轮询。
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": {
      "result": {
        "content": "综合答案…",
        "references": [ { "title": "...", "url": "https://..." } ],
        "suggestions": [ "延伸问题…" ]
      }
    },
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
| 400 | `VALIDATION_ERROR` | 参数不合法（如 query 为空） | 修正查询重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
doubao-websearch/
├── SKILL.md                # 本文件
└── scripts/
    └── doubao_search.py    # 零依赖脚本（urllib），调用 doubaoya.com
```
