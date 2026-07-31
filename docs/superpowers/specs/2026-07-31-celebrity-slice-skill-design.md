# celebrity-slice skill 包设计（明星切片能力迁入都爆鸭）

日期：2026-07-31
状态：已获用户批准的设计稿（spec），待写实现计划

## 1. 背景与目标

把 `<本地项目路径>` 项目的核心能力封装为都爆鸭社区仓的一个标准 skill：**直播录像 → 50-70 秒竖版（9:16）高级种草短视频切片**，完整走五闸流水线（校对→标注→选段→组合→QA）。

形态：**方法论 + 零依赖本地脚本 + ASR 走 doubaoya 云端信封**（用户已确认）。与源项目近期实际生产路线一致（SKILL.md 当提示词 + agent 直跑 ffmpeg），不依赖源项目的 studio Web 服务。

### 非目标（明确不做）
- 不搬 studio Web 工作台（server.py 的 HTTP 服务与 UI）、任务台账、skill 达尔文演化机制
- 不搬 v2 遗留 output/ 及一次性构建脚本
- doubaoya 后端的 ASR 代理路由**本次不实现**，另起独立任务；本 spec 只锁接口契约
- 不引入任何第三方 Python 依赖（全库约定：仅标准库 + 外部 ffmpeg/ffprobe）

## 2. skill 目录结构

```
skills/celebrity-slice/
├── .version                  # tools/stamp_versions.py 生成，不手写
├── SKILL.md                  # 主入口：适用场景 + 五闸工作流 + 脚本用法 + 密钥 + 错误表 + notice 段
├── references/
│   ├── methodology.md        # 完整方法论（源自明星切片 skills/明星切片/SKILL.md v3）
│   ├── rules.json            # 数值规则单一事实源
│   └── asr-api.md            # doubaoya ASR 代理接口契约（后端上线前标注"待上线"）
└── scripts/                  # 全部零第三方依赖
    ├── asr_transcribe.py     # 抽音频→切块→POST doubaoya ASR→合并词级 JSON + SRT
    ├── make_captions.py      # 词级 ASR + agent 校对稿 → SRT / ASS（含 karaoke 样式）
    ├── snap_breath.py        # 气口吸附：RMS 能量分析，把 EDL 切点吸到静音谷
    └── validate_edl.py       # QA 机检：12 项机械检查，输出机检清单 JSON
```

frontmatter `name: celebrity-slice`（必须与目录名逐字相同，全仓唯一）。

## 3. 内容来源与移植映射

| 新文件 | 来源 | 说明 |
|---|---|---|
| references/methodology.md | 明星切片 `skills/明星切片/SKILL.md`（460 行，v3） | 定位红线（高级种草/不剪低价直播间风格/默认不拿价格做开头钩子）、三硬对齐（语义段↔字幕页↔画面段）、气口保护、前3秒规则、话术筛选、贴纸、QA 四指标清零。改写时去掉 studio/REST 相关段落与一切开发者绝对路径 |
| references/rules.json | `flow/pipeline.json` 的 price/pacing/energy/clean/caption/breath 规则 + `studio/scoring_rules.json` 的 selection_signals/rubric/power_words + `studio/caption_styles.json` | 合并为一个 JSON；脚本与 agent 共读，不在代码硬编码数值 |
| scripts/asr_transcribe.py | 新写；分块限制参考 `skills/明星切片/references/mimo-v2-5-asr.md`（base64 ≤10MB/次） | ffmpeg 抽音频、按大小切块、逐块调 doubaoya、按偏移合并词级时间戳 |
| scripts/make_captions.py | `studio/server.py` 的字级对齐、校对稿传播、SRT/ASS/karaoke 生成逻辑 | 抽取改写为 CLI |
| scripts/snap_breath.py | `studio/server.py` 的 `snap_clips`（:1278）与 `_compute_energy_windows`（:1370） | 抽取改写为 CLI |
| scripts/validate_edl.py | `studio/server.py` 的 `validate_edl`（:2234-2451） | 抽取改写为 CLI，阈值读 rules.json |

## 4. 工作流（SKILL.md 主线）

1. **ASR**：`asr_transcribe.py <视频>` → 词级转写 JSON + SRT。降级路径：后端未上线或无 `DOUBAOYA_API_KEY` 时，提示用户提供现成 srt/vtt，或自跑本机 whisper
2. **校对 + 标注**：agent 按 methodology 纠错字幕（只纠错不改写、忠于音频）、标注话术段/能量点/品信息
3. **选段**：按 rules.json 的 selection_signals 与 rubric 选核心话术段
4. **组合**：agent 写 EDL JSON → `snap_breath.py` 吸附气口 → ffmpeg 裁切拼接 9:16 → `make_captions.py` 生成并烧字幕
5. **QA（两层）**：
   - 机械层：`validate_edl.py` 12 项检查（fail 级 7 项：EDL 非空/源存在/区间合法/不超时长/不重叠/cuts 合法/id 唯一；warn 级 5 项：无过短碎片/切点贴气口(附能量标注)/cuts 贴字边界/字级时间戳回验/总时长与溯源字段），fail 必须清零
   - 语义层：四指标（cross_cut_caption_count / split_semantic_across_screen_count / orphan_caption_fragment_count / screen_without_complete_meaning_count）由 agent 按 methodology 自评归零，写入 QA 报告
6. **交付**：成片 mp4 + captions.srt/.ass + source_map.json（每段可追溯源时间戳）+ 机检清单

## 5. ASR 接口契约（references/asr-api.md，兼作后端实现 spec）

- 路由：走通用信封 `POST https://doubaoya.com/api/apis/<platform>/asr/call`（platform/slug 由后端任务定，契约只锁信封与数据形状）
- 请求：base64 音频块 ≤10MB/次，带格式与偏移元数据
- 响应：`{success, requestId, data: {segments: [{start, end, text, words: [{start, end, text}]}]}, error}`
- 鉴权：`DOUBAOYA_API_KEY`；User-Agent 用 `_skill_user_agent()` 读 `.version`
- 计费措辞按事实写：通用 call 路由**扣点**；错误表含 `402 INSUFFICIENT_CREDITS` 与 `502 PROVIDER_FAILED（自动退款、重试安全）`。不得写任何未经后端核实的退款承诺（前车之鉴：wechat-draft-publish 假承诺已在 commit 7b14717 修掉）
- 上游 ASR 供应商（MiMo 或其他）由后端任务决定，不进本契约

## 6. 发布 checklist（照全库既有约定）

1. 脚本统一加 `_skill_user_agent()` helper（读 `../.version`，回退 `doubaoya-skill/1.0`）
2. SKILL.md 末尾加逐字一致的「关于响应里的 notice 字段」转达段
3. README.md 技能清单加一行，计数自洽（validate_community 强制对账）
4. `python3 tools/stamp_versions.py` 生成 `.version` 并更新 versions.json
5. `python3 tools/validate_community.py` 跑绿——注意：全部文件不得出现 `/Users/<name>/` 开发者路径、不得含密钥
6. `tools/tests/` pytest 跑绿

## 7. 已裁决的设计决策记录

- **QA 机检脚本保留**（用户看过 12 项逻辑后确认）：机械层是全流水线唯一确定性质量保障，恰好覆盖 agent 直跑 ffmpeg 的高频翻车点；语义四指标留在方法论层由 agent 自评
- **ASR 走 doubaoya 云端代理**而非直连 MiMo 或本地 whisper 优先：用户只需一把钥匙，与全库一致；本地 whisper 降级为兜底提示
- **后端 ASR 路由另起任务**：skill 先上架，ASR 部分标注"待后端上线"
