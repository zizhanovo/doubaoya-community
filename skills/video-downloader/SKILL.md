---
name: video-downloader
description: 短视频下载器 · 解析抖音 / 小红书 / 快手 / B站等平台的公开视频，返回无水印直链与作品信息，每次一个分享链接。当用户需要下载短视频、保存无水印视频、解析视频直链、扒视频素材时使用。
---

# 短视频下载器（都爆鸭）

本鸭帮你把一条短视频分享链接解析成**无水印直链**——抖音、小红书、快手、B站等平台的公开视频，一行命令拿到可下载的原始地址和作品信息，省去自己折腾解析链路。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。无需自建解析链路，按次消费。

---

## 适用场景

| 场景 | 怎么用 | 拿到什么 |
|------|--------|----------|
| **保存无水印视频** | 丢一条分享链接进去 | 干净的无水印直链 |
| **扒素材做二创** | 解析爆款视频拿原片 | 可下载的原始视频地址 |
| **批量沉淀** | 一条一条解析攒库 | 逐条作品标题 + 直链 |
| **看作品信息** | 解析后读返回字段 | 作品标题等元信息 |

> 每次只解析**一个**分享链接。多个链接就多跑几次脚本。

---

## 工作流（3 步）

### 1. 拿到分享链接
从用户那里取一条作品分享链接（抖音 / 小红书 / 快手 / B站等平台的公开作品）。

### 2. 调用脚本
```bash
python3 "$SKILL_PATH/scripts/download.py" "<分享链接>"
```
脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每条链接只跑一次脚本**，直接读完整 stdout，别用 `head`/`tail` 预览。

### 3. 渲染结果
`data` 是**扁平结构**（不套 `item`），做**防御式读取**——`title`（作品标题）/ `videoUrl`（无水印视频直链）/ `cover`（封面）可能缺失，缺了就留空，别报错。把 `videoUrl` 给用户，`title` 做说明。若是图文作品，视频直链会为空，改读 `imageUrls`（图片直链数组）。

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

- `POST https://doubaoya.com/api/skills/video-downloader/invoke`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "url": "<分享链接>" }`
  - `url`：字符串，必填，作品分享链接
- 返回信封（`data` 为扁平结构）：
  ```json
  {
    "success": true,
    "requestId": "...",
    "data": {
      "platform": "douyin",
      "title": "...",
      "videoUrl": "https://...mp4",
      "cover": "https://...jpg",
      "imageUrls": []
    },
    "error": null
  }
  ```
  - `videoUrl`：无水印视频直链（图文作品时为空）
  - `imageUrls`：图片直链数组（图文作品时有值，视频作品时为空）
  - `cover` / `title` / `platform`：封面、标题、来源平台
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误处理

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。常见情况：

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如链接为空或无法识别） | 换一条有效的分享链接重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

> `502 PROVIDER_FAILED` 会自动退款，重试是安全的，不会重复扣费。

---

## 目录结构

```
video-downloader/
├── SKILL.md            # 本文件
└── scripts/
    └── download.py     # 零依赖脚本（urllib），调用 doubaoya.com
```
