---
name: celebrity-slice
description: 都爆鸭·明星切片（直播录像 → 50-70 秒竖版 9:16 高级种草短视频切片）。五闸流水线：词级 ASR 转写 → 校对+标注 → 选段 → 组合（气口吸附 + 字幕烧制）→ 双层 QA（12 项机检 + 语义四指标清零）。零第三方依赖（Python 标准库 + ffmpeg/ffprobe），ASR 走 doubaoya 云端代理。触发词：明星切片、直播切片、直播录像剪辑、切片带货、高级种草、竖版短视频、9:16、口播剪辑、直播高光、气口、EDL、karaoke 字幕、字幕烧制。
---

# 都爆鸭 · 明星切片（直播录像 → 高级种草竖版切片）

本鸭一句话定位：**把一场直播录像剪成 50-70 秒的竖版（9:16）高级种草短视频切片**——完整走五闸流水线（ASR → 校对+标注 → 选段 → 组合 → QA），话术克制、气口自然、字幕忠于音频、每段可溯源。

- 方法论细节：`references/methodology.md`（定位红线、三硬对齐、前3秒、气口、贴纸、QA 四指标）
- 数值规则单一事实源：`references/rules.json`（脚本与 agent 共读，**不要在别处复制数值**）
- ASR 接口契约：`references/asr-api.md`（**代理路由待后端上线**，上线前走「降级路径」）

适用对象：直播切片剪辑、带货短视频运营、服装/生活方式类主播团队。

> ❌ **最关键的一条纪律（先记住）**
> **字幕必须忠于音频：校对只纠错（错字/人名/品牌名），绝不改写成音频里没说过的营销文案。**
> 明星切片默认是高级种草定位：不剪成低价直播间风格，默认不拿价格做开头钩子（细则见 methodology.md 的 `price_rule` 解读）。

## 0. 环境要求

- Python 3（脚本零第三方依赖，仅标准库）
- `ffmpeg` / `ffprobe` 在 PATH 里（抽音频、能量分析、裁切拼接、烧字幕）

## 1. 拿钥匙（DOUBAOYA_API_KEY）

调用 ASR 接口需要一把密钥（API Key）。拿钥匙四步走：

1. 打开 **doubaoya.com**
2. **登录**
3. 进入 **密钥中心**
4. 点 **生成密钥**

密钥形如 `dyh_xxxxxxxx`。拿到后配进环境变量：

```bash
export DOUBAOYA_API_KEY="dyh_xxxxxxxx"
```

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `DOUBAOYA_API_KEY` | 都爆鸭密钥，形如 `dyh_…` | 仅闸 1 ASR 需要 |

> 安全约定：**永远不要把密钥打印出来、写进日志、贴进对话或提交进仓库**。脚本只在请求头里用它，不会回显。

## 2. 数据契约（所有脚本共读的 JSON 形状）

**词级 ASR JSON**（`asr_transcribe.py` 产出，其余三个脚本的 `--asr` 输入）：

```json
{
  "version": 1,
  "source": "live.mp4",
  "duration_s": 3600.5,
  "segments": [
    { "text": "白", "start": 12.30, "end": 12.45 },
    { "text": "T", "start": 12.45, "end": 12.60 }
  ]
}
```

**EDL JSON**（agent 在选段闸手写；`snap_breath.py` / `validate_edl.py` / `make_captions.py --edl` 的输入）：

```json
{
  "clips": [
    {
      "id": "c1",
      "source_start": 12.3,
      "source_end": 18.9,
      "selection_reason": "痛点+证据开头",
      "selling_point": "白T不透",
      "visual_point": "上身抻拉",
      "risk_note": "",
      "signal_level": 3,
      "cuts": [ { "start": 13.0, "end": 13.4, "reason": "口水词" } ]
    }
  ]
}
```

`signal_level`（1-6，对应 rules.json `selection_signals.levels`）与 `cuts`（段内清洗，源坐标删除区间）可选。**红线：气口是资产，cuts 只删明确标出的词区间，默认不动停顿。**

**校对稿 JSON**（agent 在校对闸产出；`make_captions.py --proofread` 输入，仅 `status=="confirmed"` 的句子生效）：

```json
{
  "sentences": [
    { "start": 12.3, "end": 15.1, "original": "白提最怕透", "corrected": "白T最怕透", "status": "confirmed" }
  ]
}
```

## 3. 五闸工作流

### 闸 1 — ASR（词级转写）

```bash
python3 "$SKILL_PATH/scripts/asr_transcribe.py" 直播录像.mp4 --out-json words.json --out-srt raw.srt
```

产出词级 JSON + 参考 SRT。**后端未上线或无 `DOUBAOYA_API_KEY` 时脚本会明确报错并给降级路径**（见第 6 节）。

### 闸 2 — 校对 + 标注（agent 人工智能层）

按 `references/methodology.md` 逐句校对 `raw.srt` / `words.json`：**只纠错不改写、忠于音频**（错字、人名、品牌名、明显同音错）；产出校对稿 `proofread.json`（契约见第 2 节）。同时通读转写做标注：话术段（对照 rules.json `selection_signals.levels` 六级信号）、能量点、品信息（卖点/风险词）。

### 闸 3 — 选段

按 rules.json 的 `selection_signals`（六级高光信号 + 边界信号词 + no_cut_points）与 `rubric`（电商五维 0-100 自评，total 必须等于五维之和）选核心话术段，手写 EDL JSON（契约见第 2 节）。目标总时长 50-70s。

### 闸 4 — 组合

```bash
# 4.1 切点吸附气口（--apply 直接回写 EDL 坐标；同时产出能量互证标注）
python3 "$SKILL_PATH/scripts/snap_breath.py" --edl edl.json --asr words.json \
    --video 直播录像.mp4 --energy energy.json --apply --out edl_snapped.json

# 4.2 ffmpeg 逐段裁切 + 拼接 9:16（横版源居中裁切示例；agent 按实际分辨率调整）
ffmpeg -y -ss 12.34 -to 18.90 -i 直播录像.mp4 \
    -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -crf 18 -c:a aac clip_01.mp4
printf "file 'clip_01.mp4'\nfile 'clip_02.mp4'\n" > concat.txt
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy raw_no_caption.mp4

# 4.3 生成成片时间轴字幕（--edl 把源时间轴重映射到成片时间轴，并产出溯源 source_map.json）
python3 "$SKILL_PATH/scripts/make_captions.py" --asr words.json --proofread proofread.json \
    --edl edl_snapped.json --format srt --source-map-out source_map.json --out captions.srt
python3 "$SKILL_PATH/scripts/make_captions.py" --asr words.json --proofread proofread.json \
    --edl edl_snapped.json --format ass --style karaoke --out captions.ass

# 4.4 烧字幕
ffmpeg -y -i raw_no_caption.mp4 -vf "ass=captions.ass" -c:v libx264 -crf 18 -c:a copy final.mp4
```

注意：带 `cuts` 的 clip 要在 4.2 前先按保留区间展开成子段（cuts 的合法性由闸 5 机检把关）。

### 闸 5 — QA（两层，都过才能交付）

**机械层**（12 项机检，fail 必须清零，脚本退出码 0 = 清零）：

```bash
python3 "$SKILL_PATH/scripts/validate_edl.py" --edl edl_snapped.json --asr words.json \
    --video 直播录像.mp4 --energy energy.json --out qa_report.json
```

fail 级 7 项：EDL 非空 / 源存在 / 区间合法 / 不超时长 / 不重叠 / cuts 合法 / id 唯一。
warn 级 5 项：无过短碎片 / 切点贴气口（附能量标注）/ cuts 贴字边界 / 字级时间戳回验 / 总时长与溯源字段。

**语义层**：四指标由 agent 按 methodology.md 自评归零并写入 QA 报告：
`cross_cut_caption_count` / `split_semantic_across_screen_count` / `orphan_caption_fragment_count` / `screen_without_complete_meaning_count` 必须全为 0。

### 交付物

`final.mp4` + `captions.srt` / `captions.ass` + `source_map.json`（每段可追溯源时间戳）+ `qa_report.json`（机检清单）。

## 4. 脚本用法速查

| 脚本 | 作用 | 关键参数 |
|------|------|----------|
| `scripts/asr_transcribe.py` | 抽音频→分块→POST doubaoya ASR→合并词级 JSON+SRT | `<video>` `--language zh` `--chunk-seconds 600` `--endpoint URL` `--out-json` `--out-srt`；退出码 2=无密钥 |
| `scripts/snap_breath.py` | EDL 切点吸附到气口 + RMS 能量互证标注 | `--edl` `--asr` `--video` `--energy`（能量缓存，读写）`--apply`（回写坐标）`--rules` `--out` |
| `scripts/make_captions.py` | 词级 ASR+校对稿 → SRT/ASS（含 karaoke），可按 EDL 重映射到成片时间轴 | `--asr` `--proofread` `--edl` `--format srt\|ass` `--style` `--source-map-out` `--rules` `--out` |
| `scripts/validate_edl.py` | 12 项机检，输出机检清单 JSON | `--edl` `--asr` `--video` `--energy` `--rules` `--out`；退出码 0=fail 清零，1=有 fail |

所有脚本的 `--rules` 默认指向 `references/rules.json`，一般不用传。

## 5. 错误码（ASR 接口）

先看信封 `success`：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

| HTTP | code | 含义 / 处理 |
|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 → 检查 `DOUBAOYA_API_KEY`，去密钥中心重生成 |
| 400 | `VALIDATION_ERROR` | 参数不对 → 检查音频 base64 / format / language 取值 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足（ASR 通用 call 路由按次扣点）→ 去 doubaoya.com 充值/续额 |
| 404 | `NOT_FOUND` | ASR 代理路由**待后端上线** → 走第 6 节降级路径 |
| 502 | `PROVIDER_FAILED` | 上游 ASR 临时故障，**已自动退款、可安全重试** → 稍后重跑即可 |

脚本会把失败统一打到 stderr：`[error] code: message`，并以非 0 退出码退出。

## 6. 降级路径（ASR 不可用时）

后端 ASR 路由未上线、或用户没有 `DOUBAOYA_API_KEY` 时，闸 1 换成任一条：

1. **用户提供现成字幕**：srt/vtt 都行。agent 把它转成第 2 节的词级 JSON（无词级时间戳就按句级填，`snap_breath.py` 的气口吸附精度会下降，如实告知用户）。
2. **本机 whisper**：用户机器上有 whisper（如 `whisper 直播录像.mp4 --model medium --language zh --word_timestamps True --output_format json`）时，agent 把其 JSON 转成本契约词级 JSON。

闸 2-5 与降级无关，照常走。

## 7. 目录结构

```
celebrity-slice/
├── SKILL.md                  # 本说明
├── references/
│   ├── methodology.md        # 完整方法论（定位红线/三硬对齐/前3秒/气口/贴纸/QA）
│   ├── rules.json            # 数值规则单一事实源
│   └── asr-api.md            # doubaoya ASR 代理接口契约（待后端上线）
└── scripts/
    ├── asr_transcribe.py     # 闸 1：抽音频→分块→ASR→合并词级 JSON+SRT
    ├── snap_breath.py        # 闸 4：气口吸附（RMS 能量互证）
    ├── make_captions.py      # 闸 4：SRT/ASS/karaoke 字幕 + source_map
    └── validate_edl.py       # 闸 5：12 项机检
```

## 关于响应里的 notice 字段

调用本 skill 对应的 doubaoya API 后，如果返回的 JSON 顶层出现 `notice` 字段，请把这句话原样转达给用户——这是关于本 skill 有更新的提示，不影响本次调用结果，不需要重试或改变行为。
