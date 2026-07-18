---
name: seedream-5-lite
description: Seedream 5.0 lite AI 图片生成 · 一句提示词出图，支持文生图 / 图生图 / 组图 / 提示词优化，可指定尺寸。当用户需要 AI 出图、生成配图、做组图、出封面素材时使用。
---

# Seedream 5.0 lite AI 图片生成（都爆鸭）

本鸭帮你用 Seedream 5.0 lite 一行命令出图——给一句提示词就出图，玩法覆盖**文生图 / 图生图 / 组图 / 提示词优化**，还能指定尺寸。无需自建出图链路，按次消费，拿回图片直链。

> 调用走 **doubaoya.com** 一条线，鉴权用你自己的密钥（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

> ⏳ **这是异步慢操作**：图片在服务端生成，约 **6 分钟**，单次请求内一气呵成返回——**无需客户端轮询**，发一次 POST 静等结果即可。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **文生图** | 只给一句提示词 | 按描述生成的图片直链 |
| **组图 / 多图** | 提示词描述系列画面 | 一批风格统一的图 |
| **指定尺寸** | 加 `--size` 设定宽高 | 目标比例的图片 |
| **做封面 / 配图** | 描述风格与主体 | 可直接用的素材图 |

---

## 工作流（3 步）

### 1. 写提示词（可选定尺寸）
把用户需求转成清晰的图片提示词，必要时确定尺寸（默认 `2048x2048`）。

### 2. 调用脚本（耐心等几分钟）
```bash
python3 "$SKILL_PATH/scripts/generate_image.py" "一只戴礼帽的鸭子站在复古海报里，极简平面风"
```
指定尺寸：
```bash
python3 "$SKILL_PATH/scripts/generate_image.py" "夏日柠檬汽水广告主视觉" --size 2048x2048
```
脚本会先在 stderr 提示「已提交，服务端生成中」，然后**等待约 6 分钟**直到结果返回，把成功信封里的 `data` 以 JSON 打到 stdout。**每次出图只跑一次脚本**，别中途打断、别重复调用。

### 3. 渲染图片
从 `data.images`（URL 数组）里取地址，做**防御式读取**——数组可能为空或缺失，缺了就提示未拿到图。把图片直链给用户即可。

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

- `POST https://doubaoya.com/api/skills/seedream-lite/invoke`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "prompt": "<提示词>", "size": "2048x2048" }`
  - `prompt`：字符串，必填
  - `size`：字符串 WxH，可选（默认 `2048x2048`，由 `--size` 控制）
- **异步慢操作**：服务端约 6 分钟内完成生成并在本次请求里返回，无需轮询。
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "images": [ "https://...png" ] },
    "error": null
  }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 | 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 prompt 为空、size 格式错） | 修正参数重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
seedream-5-lite/
├── SKILL.md                # 本文件
└── scripts/
    └── generate_image.py   # 零依赖脚本（urllib），调用 doubaoya.com
```
