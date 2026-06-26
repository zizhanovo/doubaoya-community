---
name: seedance-video-gen
description: Seedance2.0 AI 视频生成 · 一行命令把一句提示词生成一段 MP4 视频，可指定时长。当用户需要 AI 生成视频、文生视频、做短视频片段、出动态素材时使用。
---

# Seedance2.0 AI 视频生成（都爆鸭）

本鸭帮你用 Seedance2.0 一行命令出视频——给一句提示词，服务端生成一段 **MP4** 还你。无需自建生成链路，按次消费，拿回视频直链。

> 调用走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

> ⏳ **这是异步慢操作，且最慢**：视频在服务端生成，**最长可达约 20 分钟**，单次请求内一气呵成返回——**无需客户端轮询**，发一次 POST 后请务必**耐心等待**，别中途打断。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **文生视频** | 给一句画面提示词 | 一段 MP4 视频直链 |
| **出动态素材** | 描述运镜与主体 | 可下载的视频片段 |
| **调时长** | 加 `--duration` 指定秒数 | 指定时长的视频 |
| **多版尝试** | 不同提示词多跑几次 | 多段候选视频 |

---

## 工作流（3 步）

### 1. 写提示词（可选定时长）
把用户需求转成清晰的视频画面提示词，必要时确定时长（默认 6 秒）。

### 2. 调用脚本（务必耐心等，最长约 20 分钟）
```bash
python3 "$SKILL_PATH/scripts/generate_video.py" "一只鸭子在霓虹城市夜景中滑板穿行，电影级运镜"
```
指定时长：
```bash
python3 "$SKILL_PATH/scripts/generate_video.py" "海浪缓缓拍打沙滩，日落金光" --duration 6
```
脚本会先在 stderr 提示「已提交，服务端生成中」，然后**长时间等待**（最长约 20 分钟）直到结果返回，把成功信封里的 `data` 以 JSON 打到 stdout。**每次出视频只跑一次脚本**，别中途打断、别重复调用——它真的会跑很久。

### 3. 渲染视频
从 `data` 里取字段，做**防御式读取**——`videoUrl`（视频直链）/ `duration`（时长）可能缺失，缺了就提示未拿到结果。把视频直链给用户即可。

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

- `POST https://doubaoya.com/api/skills/seedance-video-gen/invoke`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "prompt": "<提示词>", "duration": 6 }`
  - `prompt`：字符串，必填
  - `duration`：整数，可选（默认 6，由 `--duration` 控制）
- **异步慢操作（最长约 20 分钟）**：服务端生成完成后在本次请求里返回，无需轮询。
- 返回信封：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": { "videoUrl": "https://...mp4", "duration": 6 },
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
| 400 | `VALIDATION_ERROR` | 参数不合法（如 prompt 为空、duration 非法） | 修正参数重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
seedance-video-gen/
├── SKILL.md                # 本文件
└── scripts/
    └── generate_video.py   # 零依赖脚本（urllib），调用 doubaoya.com
```
