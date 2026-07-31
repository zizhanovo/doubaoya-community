# doubaoya ASR 代理接口契约（**路由待后端上线**）

> ⚠️ **路由待后端上线。** 本文件是 `celebrity-slice` skill 与 doubaoya 后端 ASR 代理路由的
> **共读单一事实源**：skill 端 `scripts/asr_transcribe.py` **已按本契约实现并提交**，后端路由
> 由**另起的独立任务**照本文件实现。
>
> 当前状态：后端路由尚未上线，调用会返回 **HTTP 404**，脚本捕获后打印降级提示
> （见本文「客户端行为」与 `SKILL.md` 第 6 节的降级路径），不会静默失败。
>
> 上游 ASR 供应商由后端任务自行选型，**不进本契约**——只要满足下面的信封形状与词级
> 时间戳要求即可。

---

## 1. 路由

| 项 | 值 |
|------|------|
| 方法 | `POST` |
| 默认地址 | `https://doubaoya.com/api/apis/media/asr/call` |
| 形态 | doubaoya 通用 call 信封路由（与 `gongzhonghao/search-article/call` 等同构） |
| 超时 | 客户端单次调用超时 **600 秒**（长音频块转写慢，别设短） |

地址里的 `media/asr` 段（platform/slug）以**后端任务最终定的为准**。脚本侧的覆盖优先级：

```
--endpoint 参数  >  环境变量 DOUBAOYA_ASR_ENDPOINT  >  内置默认值
```

后端定名若与默认值不同，先用 `DOUBAOYA_ASR_ENDPOINT` 临时接上，**并回改本文件与
`scripts/asr_transcribe.py` 的 `DEFAULT_ENDPOINT`**，让两端重新对齐。

---

## 2. 鉴权

| 请求头 | 值 | 说明 |
|--------|------|------|
| `Content-Type` | `application/json` | 固定 |
| `Authorization` | `Bearer <DOUBAOYA_API_KEY>` | 密钥形如 `dyh_xxxxxxxx` |
| `User-Agent` | `<skill 名>/<版本>` | 脚本经 `_skill_user_agent()` 读 `../.version` 自动带上；读不到时回退 `doubaoya-skill/1.0` |

拿钥匙：**doubaoya.com → 登录 → 密钥中心 → 生成密钥**，然后：

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
```

**密钥铁律**：绝不打印、绝不写进文件、绝不回显给用户；只发往 doubaoya.com。
脚本在缺 `DOUBAOYA_API_KEY` 时**一次网络请求都不发**，直接以退出码 `2` 退出并给降级提示。

---

## 3. 请求（每个音频块一次调用）

```json
{
  "audio": "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAAD...",
  "format": "mp3",
  "language": "zh"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `audio` | string | 是 | base64 data URL，前缀固定 `data:audio/mpeg;base64,`。**base64 串长度 ≤ 10485760 个字符**（即 10 × 1024 × 1024，约合 7.8MB 原始音频）；超长音频由客户端分块，见下节 |
| `format` | string | 是 | 本 skill **恒发 `mp3`**（脚本把音频统一抽成 mono / 16kHz / 64kbps mp3）。后端至少必须支持 `mp3`；是否额外支持 `wav` 由后端决定，本 skill 不发 |
| `language` | string | 是 | `zh`（默认） / `en` / `auto`，取值来自脚本 `--language`，三选一 |

### 3.1 分块约定（客户端行为，服务端无需感知）

- 脚本按 `--chunk-seconds`（**默认 600 秒**）把整片均匀切块；64kbps 单声道下 600s 原始音频
  ≈ 4.7MB base64，距 10MB 上限留足余量。
- 抽完一块若 base64 仍超上限 → **对半递归再切**，直到每块都合规。
- 递归到 `length_s < 10`（不足 10 秒）仍超限 → 客户端报 `AUDIO_TOO_DENSE` 并**中止**
  （这类输入不正常，多半不是语音）。
- 每块**独立调用**；客户端自己记住每块在源片上的偏移 `offset_s`，拿到响应后把块内时间戳
  整体平移 `+offset_s` 再合并。
- **⇒ 服务端只需按「块内相对时间」返回时间戳，从 0 开始，不必知道分块存在。**

---

## 4. 响应（统一信封）

### 4.1 成功

```json
{
  "success": true,
  "requestId": "req_xxxxxxxx",
  "data": {
    "segments": [
      {
        "start": 0.42,
        "end": 3.18,
        "text": "白T最怕透",
        "words": [
          { "start": 0.42, "end": 0.61, "text": "白" },
          { "start": 0.61, "end": 0.80, "text": "T" },
          { "start": 0.80, "end": 1.24, "text": "最" },
          { "start": 1.24, "end": 1.70, "text": "怕" },
          { "start": 1.70, "end": 3.18, "text": "透" }
        ]
      }
    ]
  },
  "error": null,
  "notice": "（可选）本 skill 有更新的提示语"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | bool | **必须严格为 `true`** 才算成功；客户端用 `is True` 判定，其他一律按失败处理 |
| `requestId` | string | 请求追踪 ID。客户端不解析，但排障时用户/后端要对得上，**必须返回** |
| `data.segments` | array | 句/段级结果，按时间升序 |
| `segments[].start` / `.end` | number | 段的起止，**单位秒**（浮点），**块内相对时间** |
| `segments[].text` | string | 该段文本 |
| `segments[].words` | array | **词/字级时间戳**——本 skill 的核心诉求，见 4.2 |
| `words[].start` / `.end` | number | 词的起止，秒，块内相对时间 |
| `words[].text` | string | 单个词/字 |
| `error` | object \| null | 成功时为 `null` |
| `notice` | string | 可选，见第 7 节 |

### 4.2 词级 `words` 是硬要求

- 本 skill 的气口吸附、卡点裁切全靠**字级时间戳**，段级精度不够用。后端**选型上游供应商时
  必须保证词级输出**。
- 客户端容错：某个 segment 缺 `words`（或为空数组）时，**退化成用整段 `start`/`end`/`text`
  当作一个 token**——能跑，但该段的裁切精度会掉到句级。这是兜底，不是可接受的常态。
- `data` 缺失或为 `null` 时客户端按空 `{}` 处理；全片一个 token 都没有 → 客户端报
  `EMPTY_TRANSCRIPT`（纯音乐/静音）。
- 合并后客户端按 `(start, end)` 排序、丢弃空 `text` 的 token，写成 skill 的词级 ASR JSON 契约：
  `{"version": 1, "source": …, "duration_s": …, "segments": [{"text","start","end"}]}`（源片绝对时间）。

### 4.3 失败

```json
{
  "success": false,
  "requestId": "req_xxxxxxxx",
  "data": null,
  "error": {
    "code": "PROVIDER_FAILED",
    "message": "上游 ASR 服务暂时不可用"
  }
}
```

失败信封必须带 `error.code` 与 `error.message`（中文可读）。客户端从 HTTP 错误响应体里
解析同样的形状；解析不出来就退回 `HTTP_<状态码>` 作为 code。

---

## 5. 错误码

| HTTP | `error.code` | 含义 / 处理 |
|------|------------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 → 检查 `DOUBAOYA_API_KEY`，去密钥中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不对 → 检查 `audio` 的 base64 与 data URL 前缀、`format` / `language` 取值、10MB 上限 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足。**本路由是通用 call 路由，按次扣点** → 去 doubaoya.com 充值 / 续额 |
| 404 | `NOT_FOUND` | **ASR 代理路由待后端上线**（当前默认状态）→ 走 `SKILL.md` 第 6 节降级路径 |
| 502 | `PROVIDER_FAILED` | 上游 ASR 临时故障，**已自动退款、可安全重试** → 稍后重跑即可 |

**计费措辞的边界（严格按事实，不得扩写）**：

- 计费相关只有以上两条：**402 = 按次扣点、额度不足**；**502 = 上游临时故障、已自动退款、重试安全**。
- 除此之外，本契约与 skill 文档**不承诺任何退款、免费、补偿或额度返还**。任何新的计费/退款
  措辞必须先经后端核实再写进来。
  （前车之鉴：`wechat-draft-publish` 曾写了未经核实的退款承诺，已在 commit `7b14717` 删除。）

### 5.1 客户端行为（`scripts/asr_transcribe.py`）

- 所有失败统一打到 stderr：`[error] <code>: <message>`，402 / 502 / 404 三种另配上表的处置话术。
- 退出码：`0` 成功；`1` 调用/网络/ffmpeg/空结果失败；`2` 缺 `DOUBAOYA_API_KEY`。
- 客户端**不自动重试**——502 的重试由用户/agent 决定何时重跑（重试是安全的）。
- 连不上 doubaoya.com 时报 `NETWORK_ERROR`；返回非 JSON 时报 `BAD_RESPONSE`。
- 本地前置失败（与本接口无关）：`FFPROBE_FAILED`（探不到时长）、`FFMPEG_FAILED`（抽音频失败）、
  `AUDIO_TOO_DENSE`（分块到 10 秒仍超限）。

---

## 6. 给后端实现的注意事项

1. **上游供应商自选**，但必须满足：词级时间戳、单位秒、块内相对时间、支持中文。供应商名称/参数
   不进本契约，客户端不感知。
2. **必须返回 `words`**。若上游只给段级，后端需自行对齐/切分补出词级，或换供应商——直接省掉
   `words` 会让本 skill 的核心能力（气口吸附、逐字卡点）降级。
3. **时间戳一律块内相对时间**（每次调用从 0 起算）。后端**不要**尝试推断全片偏移——客户端已经
   在做平移，服务端再平移一次会双重偏移。
4. **接受 ≤ 10485760 字符的 base64 串**（约 7.8MB 原始音频）。请求体上限、网关 body limit、
   反代 `client_max_body_size` 都要放开到能容纳该量级 + JSON 开销。
5. **单次处理可能耗时到分钟级**，服务端/网关的读超时要 ≥ 600 秒，与客户端对齐；别在 60 秒切断。
6. **信封字段一个都不能少**：`success` / `requestId` / `data` / `error` 四件套恒在，失败时
   `data` 为 `null`、`error` 为对象；成功时反过来。
7. **HTTP 状态码与 `error.code` 要一致**（见第 5 节表），客户端两者都读、以 `error.code` 优先。
8. **计费**：按次扣点；上游失败（502 `PROVIDER_FAILED`）时自动退款。除此之外不要引入未在本
   契约声明的计费行为。
9. **路由上线后**：回改本文件顶部的「待后端上线」提示、第 1 节的默认地址，以及
   `scripts/asr_transcribe.py` 的 `DEFAULT_ENDPOINT`，两端同时对齐。

---

## 7. 关于响应里的 `notice` 字段

信封顶层可能出现 `notice` 字段（字符串）——这是**关于本 skill 有更新的提示**，与本次转写结果
无关。约定：

- 服务端：可选返回，纯提示性质，不改变 `success` / `data` 的语义。
- 客户端：脚本收到后原样打到 stderr（`[notice] …`），**不重试、不改变行为**。
- agent：把这句话**原样转达给用户**，不要改写、不要吞掉。

---

## 8. 与 skill 端的对应关系

| 契约条目 | `scripts/asr_transcribe.py` 落点 |
|------|------|
| 默认地址 | `DEFAULT_ENDPOINT` |
| 覆盖优先级 | `args.endpoint` → `DOUBAOYA_ASR_ENDPOINT` → `DEFAULT_ENDPOINT` |
| 10MB 上限 | `MAX_B64_BYTES` |
| 音频规格 | `extract_chunk()`（`-ac 1 -ar 16000 -b:a 64k -f mp3`） |
| 分块 / 递归对半 | `plan_chunks()` / `encode_chunks()` |
| 请求头与请求体 | `call_asr()` |
| 错误码处置 | `call_asr()` 的 `HTTPError` 分支 |
| 时间戳平移与合并 | `merge_words()` |
| `notice` 转达 | `call_asr()` 末尾 + `SKILL.md` 末节 |
