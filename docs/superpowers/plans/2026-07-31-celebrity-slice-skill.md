# celebrity-slice Skill 包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把明星切片项目的核心能力（直播录像 → 50-70 秒竖版 9:16 高级种草短视频切片，五闸流水线）封装为 doubaoya-community 标准 skill `celebrity-slice` 并通过全仓校验发布。

**Architecture:** 形态 = 方法论（methodology.md）+ 零依赖本地脚本（4 个 CLI）+ ASR 走 doubaoya 云端信封。数值规则单一事实源 `references/rules.json`（脚本与 agent 共读）；每个脚本纯逻辑与外部进程（ffmpeg/ffprobe/urllib）分离，纯逻辑用 tools/tests/ 下 pytest 覆盖。不搬 studio Web 服务，不实现后端 ASR 路由（只锁契约，标注"待后端上线"）。

**Tech Stack:** Python 3 标准库（argparse/json/difflib/array/math/base64/urllib）、ffmpeg/ffprobe 外部命令、pytest（unittest.TestCase 风格，与既有 tools/tests/ 一致）。

**Spec:** `docs/superpowers/specs/2026-07-31-celebrity-slice-skill-design.md`（已批准）

## Global Constraints

以下硬约束逐条来自 spec，对全部 7 个 Task 生效：

- 零第三方 Python 依赖：仅标准库 + 外部 ffmpeg/ffprobe（spec §1 非目标）。
- frontmatter `name: celebrity-slice` 必须与目录名 `skills/celebrity-slice/` 逐字相同，且全仓唯一（validate_community 强制）。
- skill 目录内全部文件不得出现 `/Users/<name>/`、`/home/<name>/` 等开发者绝对路径，不得含任何密钥（spec §6.5）。
- 数值规则只读 `references/rules.json`，脚本代码不硬编码阈值/样式/聚合参数（spec §3 rules.json 行）。
- 计费措辞按事实写：通用 call 路由**扣点**；错误表含 `402 INSUFFICIENT_CREDITS` 与 `502 PROVIDER_FAILED（自动退款、重试安全）`；**不得写任何未经后端核实的退款承诺**（前车之鉴 commit 7b14717）（spec §5）。
- 密钥铁律：`DOUBAOYA_API_KEY` 绝不打印、绝不写进文件、绝不回显；只发往 doubaoya.com（照 trending-hub 范本）。
- 脚本统一带 `_skill_user_agent()` helper（逐字用 `tools/migrate_user_agent.py` 的 HELPER 模板：读 `../.version`，回退 `doubaoya-skill/1.0`）（spec §6.1）。
- SKILL.md 末尾加逐字一致的「关于响应里的 notice 字段」转达段（spec §6.2，从 trending-hub/SKILL.md 末尾逐字复制）。
- 测试放 `tools/tests/`（pytest），**不放 skill 目录内**——skill 目录是发布物。
- `.version` 由 `tools/stamp_versions.py` 生成，不手写（spec §2）。
- 不搬 studio Web 工作台 / 任务台账 / skill 达尔文演化机制 / v2 遗留 output（spec §1 非目标）。
- doubaoya 后端 ASR 代理路由本次不实现，另起独立任务；本 skill 只锁接口契约并标注"待后端上线"（spec §1 非目标、§7）。
- 字幕忠于音频：校对只纠错不改写（红线，进 methodology.md，脚本层不做任何"润色"）。
- 每个 Task 独立 commit，commit message 见各 Task 末尾，均以 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 结尾；全程不 push。

**跨 Task 固定数据契约**（所有脚本共读，Task 1 的 SKILL.md 里成文）：

- **词级 ASR JSON**：`{"version": 1, "source": "<视频文件名>", "duration_s": <float>, "segments": [{"text": "字", "start": 1.23, "end": 1.45}, …]}`——`segments` 是按时间排序的词/字级 token 流（与源项目 `asr_chars()` 返回值同构）。
- **EDL JSON**：`{"clips": [{"id": "c1", "source_start": 12.3, "source_end": 18.9, "selection_reason": "…", "selling_point": "…", "visual_point": "", "risk_note": "", "signal_level": 3, "cuts": [{"start": 13.0, "end": 13.4, "reason": "口水词"}]}]}`——`signal_level`/`cuts` 可选。
- **校对稿 JSON**：`{"sentences": [{"start": 1.2, "end": 3.4, "original": "ASR 原文", "corrected": "纠错后", "status": "confirmed"}]}`——仅 `status=="confirmed"` 的句子生效。
- **机检清单 JSON**：`{"checks": [{"check": "…", "status": "pass|warn|fail", "detail": "…"}], "pass": bool, "total_duration": float}`。

---

## Task 1：skill 骨架（SKILL.md + methodology.md + rules.json）

**Files:**
- Create: `skills/celebrity-slice/SKILL.md`
- Create: `skills/celebrity-slice/references/methodology.md`
- Create: `skills/celebrity-slice/references/rules.json`
- Test: 无 Python 测试。验收 = validate_community 的 frontmatter 校验逻辑对该目录通过 + 开发者路径 grep 为零（局部验证命令见 Step 4；**不要跑全量 `validate_community.py`**——README 计数要到 Task 7 才更新，全量跑必 fail，这是预期内的）。

**Interfaces:**
- Consumes: 源项目内容（改写来源）：明星切片 `skills/明星切片/SKILL.md`（460 行 v3）、`flow/pipeline.json`、`studio/scoring_rules.json`、`studio/caption_styles.json`。
- Produces: 三个发布物文件。`references/rules.json` 顶层键（后续 Task 2-5 的脚本按这些键名读取，固定契约）：`price_rule` / `pacing_rule` / `energy_rule` / `clean_rule` / `caption_rule` / `breath_rule` / `caption_group_rule` / `selection_signals` / `rubric` / `power_words` / `rules` / `caption_styles`。

### Steps

- [ ] 1. 建目录 `skills/celebrity-slice/references/` 与 `skills/celebrity-slice/scripts/`（scripts 本 Task 先空着，`mkdir -p` 即可，git 不追踪空目录没关系——Task 2 会放第一个脚本）。

- [ ] 2. 写 `skills/celebrity-slice/references/rules.json`。三个来源 JSON 合并、保留原键名、数值逐字不动；仅 `note` 字段改写（去掉 studio/flow 路径引用，改指本 skill 的脚本名）；新增 `caption_group_rule`（把源码 `_group_sentences` 里硬编码的 0.55/16/8 外化，消除硬编码——Global Constraints 要求）。完整内容：

```json
{
  "version": "2026-07-31",
  "note": "celebrity-slice 数值规则单一事实源。scripts/*.py 与 agent 共读本文件，代码不硬编码数值。合并自源项目 pipeline 规则（price/pacing/energy/clean/caption/breath）、选段打分规则（selection_signals/rubric/power_words/rules）与字幕样式（caption_styles），键名保留原样。",
  "price_rule": {
    "default": "do_not_use_price_as_hook",
    "allowed_when": [
      "source audio explicitly says the price",
      "user wants conversion-first product traffic",
      "price is late in the arc or offloaded to title/comment/product card",
      "price is labelled as live-session information when time-sensitive"
    ],
    "avoid": [
      "repeated price chants",
      "low-price promotion tone in premium 明星切片",
      "unsupported permanent price or stock promises"
    ]
  },
  "pacing_rule": {
    "default": "preserve_breath_and_action_beats",
    "keep_when": [
      "anchor finishes a thought naturally",
      "garment proof needs a visible beat",
      "viewer needs time to read a dense subtitle",
      "section transition would otherwise feel abrupt",
      "attitude/body movement helps celebrity-style seeding"
    ],
    "timing_guidance": {
      "numeric_source": "breath_rule",
      "proof_line_tail_seconds": "breath_rule.evidence_tail_s",
      "major_section_buffer_seconds": "breath_rule.paragraph_lead_s"
    },
    "avoid": [
      "cutting inside syllables or trailing particles",
      "interrupting hand/product proof",
      "subtitles that change too fast to read",
      "sentence-collage pacing with no expressive beat"
    ]
  },
  "energy_rule": {
    "note": "能量-ASR 互证参数（机制来源 auto-editor：解码音频算每窗 RMS）。snap_breath.py 与 validate_edl.py 只读本段；气口窗内 RMS 低于全片 P{p_quiet} = quiet（可信切点），高于 P{p_noisy} = noisy（背景音/叫卖，不宜作切点），其间 = mid。",
    "window_ms": 100,
    "p_quiet": 20,
    "p_noisy": 50
  },
  "clean_rule": {
    "note": "段内清洗（EDL clip.cuts）与拼接顺滑参数。渲染时保留区间间音频 acrossfade（audio_crossfade_s）；cut 边界距最近字边界超过 cut_boundary_char_tol_s 时 validate_edl.py 给 warn（cuts 应贴字边界）。split_edit_range_s=重口播拼接的 split edit/crossfade 可测试区间；ambient_bed_volume_ratio=噪声地板断裂时铺源环境声的音量比例区间。红线：气口是资产，清洗只删明确标出的词区间，默认不动停顿。",
    "audio_crossfade_s": 0.06,
    "cut_boundary_char_tol_s": 0.1,
    "split_edit_range_s": [0.12, 0.25],
    "ambient_bed_volume_ratio": [0.03, 0.04]
  },
  "caption_rule": {
    "note": "字幕-分镜边界参数。字幕跨明显视觉切点时：在切点前 visual_cut_guard_s 内结束，或切点后同区间再开始（保护间隔取区间内值）。methodology.md 的字幕边界配方引用本段字段名，不另存数值。",
    "visual_cut_guard_s": [0.04, 0.06]
  },
  "breath_rule": {
    "note": "气口/留白数值单一事实源。snap_breath.py 与 validate_edl.py 只读本段，不许硬编码；字级时间戳上相邻字间隔 >= breath_gap_min_s 视为气口候选，>= strong_gap_min_s 为强气口。",
    "pad_start_s": 0.12,
    "pad_end_s": 0.10,
    "evidence_tail_s": [0.15, 0.35],
    "paragraph_lead_s": [0.2, 0.5],
    "min_pause_untouched_s": 0.6,
    "long_pause_tighten_to_s": 0.8,
    "min_clip_s": 1.0,
    "snap_tolerance_s": 0.5,
    "breath_gap_min_s": 0.3,
    "strong_gap_min_s": 1.0,
    "verify_tolerance_s": 0.3
  },
  "caption_group_rule": {
    "note": "字幕/语句聚合规则（源自源项目 group_captions，从代码硬编码外化）：相邻字间隔 > gap_flush_s 换块；累计字数 >= max_chars_flush，或 >= punct_flush_min_chars 且当前字是标点时换块。make_captions.py 与 asr_transcribe.py 的 SRT 输出共读本段。",
    "gap_flush_s": 0.55,
    "max_chars_flush": 16,
    "punct_flush_min_chars": 8
  },
  "selection_signals": {
    "levels": [
      {
        "level": 1,
        "name": "价格锚点/限时逼单",
        "description": "报价、到手价、限量、倒计时逼单。注意：明星切片定位下受 price_rule 约束——价格默认不做钩子，只做后段短 CTA 或 offload 到标题/商品卡。",
        "example": "今天到手价还是活动价三百六十八"
      },
      {
        "level": 2,
        "name": "产品演示高潮",
        "description": "上身、对比、怼镜头、抻拉/翻面等动作证明，画面强于口播。",
        "example": "你看我就是完全盖住屁股我身高一米六穿鞋一米六零体重八十斤然后你们可以参考一下"
      },
      {
        "level": 3,
        "name": "痛点共鸣",
        "description": "点出观众的真实顾虑/踩坑经历（透、变形、起球、闷汗、显胖）。",
        "example": "他的克重那么高你看洗个几次他还是那种变形的感觉"
      },
      {
        "level": 4,
        "name": "信任背书",
        "description": "专柜价对比、面料产地、供应商、销量/名人同款等可追溯背书。",
        "example": "这款面料在BC专柜它就是卖一万多而且它是长青的"
      },
      {
        "level": 5,
        "name": "金句口播",
        "description": "一句话可独立成钩子/收束的金句，短、有态度、可做开场句。",
        "example": "好的面料自己会说话"
      },
      {
        "level": 6,
        "name": "真实反应/翻车",
        "description": "主播真实情绪、意外、自嘲、翻车瞬间，人味强、适合做真实感切片。",
        "example": "哇今天我是不是有点憔悴啊多喝水好累"
      }
    ],
    "boundary_signals": {
      "start_phrases": ["接下来给大家看", "我给你们讲", "来我们试一下", "来我给你看", "我给你们上身", "你看这是"],
      "end_phrases": ["好我们看下一个", "拍完扣1", "链接挂好了", "可以扣一", "给大家返场返一下", "留下你的身高体重"],
      "no_cut_points": [
        "句中（任何一个字的中间，入出点必须落在字间气口）",
        "逻辑展开中（因为/所以/但是/然后 刚起头未闭合）",
        "报数据报尺码念到一半（身高体重/克重/价格数字未念完）",
        "动作证明进行中（抻拉面料/上身展示未到可见节拍）"
      ]
    }
  },
  "rubric": {
    "note": "电商五维 rubric。每维 0-20 分四档锚点，总分 0-100 = 五维之和（total 必须等于五维和）。选段 agent 在选段闸末按本表给每份方案自评，写进 EDL 或选段说明。",
    "total_max": 100,
    "dimensions": [
      {
        "key": "hook",
        "name": "钩子",
        "description": "前 3 秒钩子潜力：开场句能否让刷到的人停下。",
        "max": 20,
        "anchors": {
          "0-5": "开场是过程性口播/寒暄/报库存，无信息增量，3 秒内给不出停留理由。",
          "6-10": "开场点到产品或场景，但平铺直叙（如「今天我们新款」），需要观众自己等后文。",
          "11-15": "开场带痛点/反差/具体数字之一（如「白色的还不透」），3 秒内能建立一个疑问。",
          "16-20": "开场即金句或强反差（如「好的面料自己会说话」「一万多的面料三百多穿」），停留理由即时且强。"
        }
      },
      {
        "key": "demo",
        "name": "演示",
        "description": "演示效果强度：画面动作证明（上身/抻拉/对比/怼镜头）强于纯口播。",
        "max": 20,
        "anchors": {
          "0-5": "全程坐播口述，无任何产品动作，画面信息约等于电台。",
          "6-10": "有产品出镜但静态（拿着/挂着讲），动作不构成证据。",
          "11-15": "有一处明确动作证明（上身展示/抻拉面料/翻面看工艺），画面能替口播作证。",
          "16-20": "动作证明贯穿且有对比参照（身高体重参照上身、专柜同款对比、怼镜头看纱线），静音也能看懂卖点。"
        }
      },
      {
        "key": "emotion",
        "name": "情绪",
        "description": "情绪浓度：主播的真实情绪/态度/人味（不等于喊叫）。",
        "max": 20,
        "anchors": {
          "0-5": "念稿感，语气平直无起伏，无个人态度。",
          "6-10": "有礼貌性热情但模板化（「宝宝们」「姐妹们」堆叠），情绪不指向内容。",
          "11-15": "对卖点有真实的态度输出（笃定/嫌弃对比款/自嘲），情绪与内容咬合。",
          "16-20": "有记忆点的情绪瞬间（翻车自嘲/意外真实反应/强烈笃定的断言），可单独做人设切片。"
        }
      },
      {
        "key": "standalone",
        "name": "独立",
        "description": "脱离上下文独立可看性：不看直播全场也能看懂这条切片。",
        "max": 20,
        "anchors": {
          "0-5": "满是指代词（「这个」「刚才那个」「上一件」），不看前文不知所云。",
          "6-10": "能看懂在卖衣服，但产品是什么/为什么好，缺关键上下文。",
          "11-15": "产品身份+核心卖点在片内自洽，个别指代需观众脑补。",
          "16-20": "完整微叙事：是什么→为什么好→凭什么信，零上下文观众也能完整接收。"
        }
      },
      {
        "key": "cta",
        "name": "转化",
        "description": "转化钩子力：给观众的下一步动作是否明确、可信、不惹反感（受 price_rule 约束：价格不做钩子）。",
        "max": 20,
        "anchors": {
          "0-5": "无任何行动指向，看完即划走。",
          "6-10": "有泛泛引导（「喜欢的拍」）但无具体动作/时机/稀缺信息。",
          "11-15": "有具体行动点（尺码怎么拍/链接位置/扣 1 返场）且出现在内容之后不打断。",
          "16-20": "行动点+可信稀缺（现货数量少/最后返场）自然收束，且价格未做钩子（合规 price_rule）。"
        }
      }
    ]
  },
  "power_words": {
    "note": "词级 karaoke 字幕强调词单一事实源（strong 色）。中文电商：价格数字（阿拉伯/中文数字+块/元/折）、限量词、行动词。make_captions.py 只读本段做正则/词面匹配，不硬编码。",
    "regex_patterns": [
      "[0-9０-９]+(?:块|元|折)",
      "[一二三四五六七八九十百千两零]{3,}"
    ],
    "words": ["最后", "仅剩", "现货", "拍", "上链接", "扣1", "扣一"]
  },
  "rules": [
    {
      "tag": "痛点",
      "type": "keyword",
      "weight": 2,
      "max_hits": 3,
      "keywords": ["透", "闷", "勒", "压迫", "显胖", "起球", "变形", "缩水", "扎人", "刺痒", "廉价", "怕热", "出汗", "紧绷", "闷汗", "最怕"]
    },
    {
      "tag": "面料证据",
      "type": "keyword",
      "weight": 2,
      "max_hits": 4,
      "keywords": ["面料", "棉", "克重", "垂感", "亲肤", "贴肤", "透气", "零压", "无压", "空间感", "同源", "意大利", "BC", "纱", "织", "柔软", "丝滑", "质感", "工艺", "水洗", "缩率"]
    },
    {
      "tag": "版型证据",
      "type": "keyword",
      "weight": 2,
      "max_hits": 4,
      "keywords": ["版型", "宽松", "落肩", "廓形", "松量", "oversize", "剪裁", "肩线", "袖", "领口", "下摆", "遮肉", "显瘦", "上身", "身材", "男女", "unisex", "百搭"]
    },
    {
      "tag": "场景",
      "type": "keyword",
      "weight": 1,
      "max_hits": 2,
      "keywords": ["夏天", "夏季", "通勤", "度假", "日常", "搭配", "出街", "旅行", "衬衫", "外套", "叠穿"]
    },
    {
      "tag": "CTA",
      "type": "keyword",
      "weight": 1,
      "max_hits": 2,
      "keywords": ["拍", "下单", "链接", "现货", "库存", "数量不多", "最后", "抓紧", "先抢"]
    },
    {
      "tag": "具体数字",
      "type": "regex",
      "weight": 1,
      "max_hits": 2,
      "pattern": "[0-9０-９]+"
    },
    {
      "tag": "重复喊价",
      "type": "keyword_repeat",
      "weight": -3,
      "min_count": 2,
      "keywords": ["368", "价格", "块钱", "到手价", "活动价", "专柜价", "多少钱"]
    },
    {
      "tag": "空洞夸张",
      "type": "keyword",
      "weight": -2,
      "max_hits": 3,
      "keywords": ["绝绝子", "天花板", "无敌", "炸裂", "天花乱坠", "哇塞", "成功人士"]
    },
    {
      "tag": "口水词",
      "type": "filler_density",
      "weight": -3,
      "threshold": 0.28,
      "min_len": 6,
      "chars": "啊呢吧呀嘛哦嗯诶哎呦",
      "words": ["这个", "那个", "就是", "然后", "反正", "对不对", "是不是", "怎么说"]
    },
    {
      "tag": "重复内容",
      "type": "duplicate",
      "weight": -3,
      "threshold": 0.6,
      "min_len": 8
    }
  ],
  "caption_styles": {
    "note": "字幕样式单一事实源（声明式）。make_captions.py 的 ASS 生成只读本段，不硬编码样式。default=静态样式；karaoke=词级逐字高亮（中文按字幕块内逐字换色高亮、不缩放字体避免整行重排抖动）。颜色为 ASS &HAABBGGRR。strong_color 用于命中 power_words 的字。max_chars_per_line=0 表示不折行。",
    "default_style": "default",
    "play_res": [1080, 1920],
    "styles": {
      "default": {
        "name": "静态",
        "font": "PingFang SC",
        "font_size": 72,
        "primary_color": "&H00FFFFFF",
        "outline_color": "&H00000000",
        "back_color": "&H7F000000",
        "bold": 1,
        "outline": 3,
        "shadow": 0,
        "alignment": 2,
        "margin_l": 60,
        "margin_r": 60,
        "margin_v": 220,
        "max_chars_per_line": 0,
        "karaoke": false
      },
      "karaoke": {
        "name": "逐字高亮 karaoke",
        "font": "PingFang SC",
        "font_size": 72,
        "primary_color": "&H00FFFFFF",
        "highlight_color": "&H005AB4E8",
        "strong_color": "&H005A5AFF",
        "outline_color": "&H00000000",
        "back_color": "&H7F000000",
        "bold": 1,
        "outline": 3,
        "shadow": 0,
        "alignment": 2,
        "margin_l": 60,
        "margin_r": 60,
        "margin_v": 220,
        "max_chars_per_line": 16,
        "karaoke": true
      }
    }
  }
}
```

- [ ] 3. 写 `skills/celebrity-slice/references/methodology.md`。从明星切片 `skills/明星切片/SKILL.md`（v3，460 行）改写：**保留**定位红线 / 价格规则 / 话术筛选 / 三硬对齐（语义段↔字幕页↔画面段）/ 前3秒规则 / 气口保护 / 拼接顺滑 / 源素材可追溯 / 贴纸风格 / QA 四指标清零；**删掉** studio/REST 段落（POST /snap、AGENT_API、达尔文演化、v3 目录契约、Remotion 段——含开发者绝对路径）；数值引用全部改指 `references/rules.json` 字段名。完整内容：

````markdown
# 明星切片方法论（celebrity-slice）

直播录像 → 50-70 秒竖版（9:16）高级种草短视频切片的完整方法论。数值型规则的单一事实源在 `references/rules.json`，本文件只引用字段名、不复制数值（消灭两处真相）：

- 气口/留白/吸附：`rules.json` 的 `breath_rule`
- 段内清洗/拼接顺滑：`rules.json` 的 `clean_rule`
- 字幕-分镜保护间隔：`rules.json` 的 `caption_rule`
- 能量互证：`rules.json` 的 `energy_rule`
- 价格/节奏开关清单：`rules.json` 的 `price_rule` / `pacing_rule`
- 选段信号分级/电商五维/强调词：`rules.json` 的 `selection_signals` / `rubric` / `power_words`
- 字幕聚合与样式：`rules.json` 的 `caption_group_rule` / `caption_styles`

## 定位

明星切片不是普通直播带货回放。

默认方向：

- 高级种草、同款感、基础款穿搭信任
- 用画面证据建立信任，不靠吵闹促销
- 重点讲清产品身份、版型、面料、舒适度、场景和审美
- 话术短、准、完整；去掉弱信息和空热闹

除非用户明确要转化优先的直播切片，否则不要剪成低价直播间风格。（定位红线。）

## 价格规则

默认不要把价格做成开头钩子。允许说价与必须避免的完整开关清单以 `rules.json` 的 `price_rule`（`allowed_when` / `avoid`）为准，本节是它的操作解读：

只有同时满足这些条件，才考虑在正片里说价格：

- 源音频明确说了价格
- 用户目标是转化、挂车或商品卡流量
- 价格被表达为本场直播信息，不是永久承诺
- 价格放在后段，通常接近结尾

明星切片 / 同款感内容优先选择：

- 正片不说价格
- 或只在结尾保留一句很短的价格信息
- 或把价格放到标题、评论、商品卡里

不要保留重复喊价、重复库存、连续报价数字、夸张语气词、廉价感强的促销话术。

## 话术筛选

只保留能推进种草链路的话：

1. 产品身份或同款感钩子
2. 观众痛点或画面对比
3. 面料、材质、工艺证据
4. 版型、松量、舒适度、场景证据
5. 有源素材支撑且必要的 CTA

（选段时的高光信号分级与打分锚点以 `rules.json` 的 `selection_signals.levels` 与 `rubric` 为准。）

删除会稀释信任的话：

- 空洞夸张：`天花乱坠`、`绝绝子`、过多 `哇`
- 假身份幻想：如 `成功人士`，除非用户明确要这种调性
- ASR 错字、人名噪声、犹豫、断裂半句话
- 没有依据的明星背书
- 没有合规上下文的高价对比
- 高级种草里重复喊价、喊库存

字幕必须忠于音频。如果剪辑导致半句话别扭，应调整源时间戳，不要把字幕改写成未说过的营销文案。（字幕保真红线。）

字幕块必须尊重明显分镜边界。一句话字幕不要挂在两个不同画面上。如果画面切点明显，应把剪辑点移动到句子/短语边界，或在视觉切点前后留出保护间隔（秒数取 `rules.json` 的 `caption_rule.visual_cut_guard_s` 区间）。

## 语义段、字幕页、画面段必须对齐（三硬对齐）

这是硬规则：观众看到的一屏画面，必须承载一个完整、可理解的语义小段。不要让"同一句话 / 同一个意思"被拆到两个明显不同的屏幕里，也不要让一个屏幕只承担半句残片。

制作时先定义语义段，再做字幕和画面：

```text
semantic_id
meaning_summary
spoken_start
spoken_end
visual_start
visual_end
caption_start
caption_end
screen_id
```

对齐原则：

- 一个 `semantic_id` 默认对应一个连续画面段和一个字幕页/字幕组
- 明显视觉切点必须落在语义边界，而不是落在句子中间
- 如果一句话必须跨画面，只有在画面动作连续、切点不可感知、观众不会以为换了意思时才允许
- 如果画面换了场景/景别/身体位置，字幕也要在同一位置换页，语义也要完成一次收束
- 不要为了字幕长度好看，把一个完整意思拆成两个互不完整的屏幕
- 不要为了画面节奏，把一个句子的前半放 A 屏、后半放 B 屏，让观众重新理解上下文

优先修法：

1. 移动画面切点到语义结束处。
2. 如果画面必须先切，提前结束上一字幕页，并把下一语义段延后几帧开始。
3. 如果字幕页太长，按自然短语拆，但每一页都必须能独立读懂。
4. 如果拆完仍别扭，放弃这句或保留更长连续源段，不要硬拼。

错误示例：

```text
A屏字幕：这么薄的面料
B屏字幕：还能不透
```

除非 A/B 画面是同一个动作的连续证明，否则这会让观众觉得意思被拆断。更好的做法是让整句留在同一屏，或把语义改成两个独立可理解的字幕页：

```text
A屏字幕：面料很薄
B屏字幕：但上身不透
```

QA 必须输出这些计数：

```text
cross_cut_caption_count = 0
split_semantic_across_screen_count = 0
orphan_caption_fragment_count = 0
screen_without_complete_meaning_count = 0
```

任何一个大于 `0`，都不能作为高级明星切片交付。

## 前 3 秒

不要把普通产品名当默认开头。明星切片的 `0-3s` 通常应该先给观众一个继续看的理由，再介绍产品身份。

优先开头：

- 痛点 + 证据：`白T最怕透` -> `这么薄还能不透`
- 视觉反差：普通基础款，但面料、版型、上身感出乎意料
- 身体/面料证据：垂感、薄度、亲肤、不透、无压迫
- 同款感，但必须一眼能从画面里看出来

避免开头：

- 普通点名：`先来看这件...`
- 泛泛分类：`它就是一件普通的白T`
- 价格、库存、倒计时、直播间紧迫感
- 先讲明星/身份幻想，再证明产品价值

如果最强的一句话在源素材后段，可以前置，但句子必须完整，下一个切点不能像机械拼接。

推荐结构：

```text
0.0-3.5   证据 / 反差 / 痛点钩子
3.5-6.5   产品身份或基础款反差
6.5+      面料、舒适度、场景、收束证据
```

开头判断标准：

```text
弱：先来看这件T恤
强：那么薄的面料还能不透，这就很神奇
```

## 气口和节奏

不要把剪辑压得没有呼吸。（默认与例外的开关清单以 `rules.json` 的 `pacing_rule` 为准；全部秒数以 `breath_rule` 为准，本节只引用字段名。）

明星切片需要气口，因为价值常常来自主播状态、身体动作、衣服垂落、面料被触摸、观众读懂画面的半拍。删弱话术是对的，但删掉每个停顿会让视频紧张、廉价、像句子拼贴。

这些地方要保留或补出小气口：

- 主播自然说完一个意思
- 衣服转身、触摸、垂感、全身展示
- 面部表情或态度能增强同款感
- 密集字幕之后需要可读性缓冲
- 产品身份、证据、CTA 之间发生段落切换

实操时间：

- 不要切在音节、笑声、吸气、语气词尾巴里
- 重要证据句后保留自然尾巴，时长取 `breath_rule.evidence_tail_s` 区间
- 大段落或突兀画面变化前留缓冲，时长取 `breath_rule.paragraph_lead_s` 区间
- 切点吸附气口用 `scripts/snap_breath.py`（容差 `breath_rule.snap_tolerance_s`，入出点垫片 `breath_rule.pad_start_s` / `breath_rule.pad_end_s`）；短于 `breath_rule.min_clip_s` 的碎片段会被 `scripts/validate_edl.py` 警告
- 用动作/画面节拍做过渡垫，不要随便塞死空气
- 收紧后闭眼听一遍：应该像一个人在讲话，不像句子拼贴

QA 要标记：

- 半个字、被夹断的语气词
- 手部/商品证据被切断
- 字幕快到读不完
- 价格/CTA 早于产品价值建立
- 连续多个切点没有任何表情或画面气口
- `0-6s` 听起来像孤立句子，而不是一个人在表达观点

## 拼接顺滑

当用户说"生硬、跳帧、每句话像单独贴上去"，先修剪辑点本身，再加装饰性转场。（音频参数全部取 `rules.json` 的 `clean_rule` 字段。）

默认做法：

- 尽量保留源音频自然尾巴，不要夹断末尾语气、呼吸、元音
- 使用很短的音频 crossfade，时长取 `clean_rule.audio_crossfade_s`
- 如果拼接处噪声地板突然消失，从源素材非人声处提取干净环境声，低音量铺底（音量比例取 `clean_rule.ambient_bed_volume_ratio` 区间）
- 重口播拼接可测试 split edit：下一句声音先到一点，或上一句尾巴压过下一画面一点，时长在 `clean_rule.split_edit_range_s` 区间内取值
- 主播位置变化大时，画面保持硬切；视觉叠化容易产生人脸/身体重影
- 视觉转场必须逐帧检查，出现双脸、身体重影、衣服糊影就拒绝
- 不要随便拉长尾字；只有源音节真的被夹断，且拉伸听不出合成感时才用
- 切点附近字幕可以延后几帧，但不能明显音画不同步

贴纸只能做轻桥接，不能拿来遮丑。拼接仍然别扭时，优先判断为选句问题：减少碎句，保留更长的连续源段，删掉短身份/短上下文碎片。

已验证配方（真实交付复盘沉淀）：

- 先减少话术块数量，再调效果；从 8 个碎块降到 6 个完整意思块
- 短身份/短上下文如果制造句子拼贴感，即使有信息也删
- 主播身体位置变化大时用硬切，不用视觉叠化
- 重口播衔接用 `clean_rule.split_edit_range_s` 区间内偏中值做音频 split edit / crossfade
- 铺极低源环境声（音量比例 `clean_rule.ambient_bed_volume_ratio`），让噪声地板连续
- 先用无贴纸版本做节奏 QA；贴纸只能辅助，不能修复语感

拼接 QA：

- 不看字幕只听；如果像分开录的句子硬贴，先重选源段
- 检查每个视觉切点附近字幕；明显切点不能被同一字幕跨过去
- 检查每个语义段是否在同一屏幕内完成；不要让同一个意思被两个明显不同画面切开
- 逐帧看切点；拒绝人物重影、双脸、衣服糊影
- 对比干音频和环境声铺底版；铺底应该只在拿掉时被感觉到
- 字幕不要正好贴着刺耳画面切点弹出，必要时延后几帧
- 高级种草宁可少一个卖点，也不要多一个生硬拼接

字幕边界配方：

- 用 EDL 的视觉切点做判断，不用音频 crossfade 点代替
- 如果字幕跨过明显视觉切点，在切点前 `caption_rule.visual_cut_guard_s` 区间内结束，或切点后同区间再开始
- 如果夹字幕会太短，就移动源素材切点，不要留下闪烁字幕
- 字幕页先按 `semantic_id` 分组，再按视觉切点夹边界；不要让自动断句决定屏幕语义
- QA 打印所有 `start < cut < end` 的字幕，优质商业切片预期数量为 `0`

## 源素材可追溯

每个最终片段都必须能回溯到源素材（`source_map.json`，由 `scripts/make_captions.py --edl … --source-map-out …` 生成）：

```text
clip_id
source_start
source_end
final_start
final_end
selection_reason
selling_point
visual_point
risk_note
```

字幕必须来自 ASR/源时间戳重映射，或来自剪后音频重新识别。不要虚构更漂亮但音频里没说过的字幕。

## 贴纸风格

使用克制的小红书高级拼贴 / 编辑部风格：

- 米白纸卡
- 细咖色箭头
- 浅色圈注
- 轻阴影
- 低饱和
- 中文字体渲染稳定

每个贴纸必须记录：

```text
time_range
sticker_text
visual_target
placement
why_here
no_go_zones_checked
motion
verdict
```

贴纸用于支撑证据，不用于把画面贴满。避开脸、嘴、手部证据、核心商品证据、字幕和直播 UI。

不要用贴纸解释剪辑结构，例如 `先确认是哪件`、`接到热天场景`，除非用户明确要教程风。高级明星切片优先使用少量、贴着可见证据的贴纸：

- 开头痛点/证据
- 面料或不透证据
- 版型/松量证据
- 天气/场景证据

如果贴纸的主要作用是让硬切不那么随机，应先修切点或字幕边界。

前 `0-3s` 贴纸应做成序列，而不是堆一个大主张：

```text
0.0-1.0: 观众痛点卡
1.0-2.0: 贴近但不遮挡衣服证据的反差卡
2.0-3.0: 用细线、箭头、边缘对齐连接答案/证据卡
```

示例：

```text
白T最怕透 -> 这么薄？ -> 还能不透
```

贴纸序列要强化口播钩子，不要代替口播。如果音频开头弱，先改音频顺序，不要靠大贴纸硬救。

## QA 契约（双层）

交付前必须检查——机械层用 `scripts/validate_edl.py`（12 项机检，fail 级必须清零），另加：

- `ffprobe` 时长、分辨率、fps
- 完整 `ffmpeg -f null` 解码
- EDL 连续性和最终时长一致
- SRT/ASS 字幕时间不超出视频时长
- 关键画面 contact sheet
- 使用贴纸时输出贴纸 QA 表
- 说明价格、库存等时效性限制

高级明星切片还要额外确认（语义层，agent 按本文件自评并写入 QA 报告）：

- 列出删掉的废话/夸张话术，以及为什么删
- 确认保留的话术链条每句都有必要
- 确认每个 `semantic_id` 都在同一屏幕内完成，或跨屏原因是"连续动作且切点不可感知"
- 对比新 `0-3s` 和"产品名优先开头"
- 检查 `0-6s` 画面里贴纸、字幕、商品、脸是否冲突
- 第一句话完整，没有头尾被夹断
- 第一个重要切点没有不自然气口或声调跳变
- 开头不出现价格，除非用户明确要转化优先直播切片
- `cross_cut_caption_count = 0`
- `split_semantic_across_screen_count = 0`
- `orphan_caption_fragment_count = 0`
- `screen_without_complete_meaning_count = 0`
````

- [ ] 4. 写 `skills/celebrity-slice/SKILL.md`（主入口）。结构照 trending-hub 范本：frontmatter → 定位 → 拿钥匙 → 数据契约 → 五闸工作流 → 脚本用法 → 接口契约指引 → 错误码 → 降级路径 → 目录结构 → 逐字 notice 段。完整内容：

````markdown
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
````

- [ ] 5. 局部验证（不跑全量 validate_community，README 未更新前全量必 fail）：

```bash
cd /path/to/doubaoya-community  # 仓库根目录
python3 - <<'PY'
import importlib.util, json, pathlib
spec = importlib.util.spec_from_file_location("vc", "tools/validate_community.py")
vc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vc)
p = pathlib.Path("skills/celebrity-slice")
name = vc.frontmatter_name(p / "SKILL.md")   # 复用 validate_community 的 frontmatter 校验逻辑
assert name == "celebrity-slice" == p.name, name
rules = json.loads((p / "references" / "rules.json").read_text(encoding="utf-8"))
for key in ("price_rule", "pacing_rule", "energy_rule", "clean_rule", "caption_rule",
            "breath_rule", "caption_group_rule", "selection_signals", "rubric",
            "power_words", "rules", "caption_styles"):
    assert key in rules, key
print("Task 1 targeted validation: ok")
PY
# 开发者路径 & 密钥双查（celebrity-slice 目录必须零命中）
grep -rnE "/(Users|home)/[^/ ]+/" skills/celebrity-slice/ && echo "FAIL: developer path" || echo "no developer paths"
grep -rnE "dyh_[A-Za-z0-9]{12,}" skills/celebrity-slice/ && echo "FAIL: key-like string" || echo "no key strings"
# （文档里的示例占位符 dyh_xxxxxxxx 只有 8 位，不会误命中）
```

- [ ] 6. Commit：

```
feat(celebrity-slice): skill 骨架（SKILL.md + methodology.md + rules.json）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---
## Task 2：scripts/validate_edl.py（12 项机检 CLI）

**Files:**
- Create: `skills/celebrity-slice/scripts/validate_edl.py`
- Test: `tools/tests/test_celebrity_slice_validate_edl.py`

**Interfaces:**
- Consumes: EDL JSON、词级 ASR JSON、`references/rules.json`（`breath_rule`/`clean_rule`/`energy_rule` 三段）、可选源视频（ffprobe）与能量 JSON（snap_breath.py 产出，含 `window_ms`/`rms_db`）。
- Produces: 机检清单 JSON（契约见 Global Constraints）。退出码 0 = fail 清零，1 = 有 fail。
- CLI：`python3 validate_edl.py --edl EDL.json --asr WORDS.json [--video SRC.mp4] [--energy ENERGY.json] [--rules RULES.json] [--out REPORT.json]`
- 纯逻辑核心（测试直接调，不碰 ffprobe）：
  - `run_checks(edl: dict, chars: list, rules: dict, video_exists: bool, video_duration, energy=None) -> dict`
  - `normalize_clip(c: dict) -> dict` / `check_clip_cuts(c: dict) -> list` / `clip_keep_ranges(c: dict) -> list` / `clip_net_duration(c: dict) -> float`
  - `breath_boundaries(chars: list, rule: dict)` / `_nearest_boundary_dist(t: float, cands: list)` / `_range_text_raw(chars: list, s: float, e: float, tol: float) -> str`
  - `_percentile(sorted_vals: list, p: float) -> float` / `classify_energy(data: dict, rule: dict, t0: float, t1: float)`
- 外部进程封装（测试不覆盖，CLI 用）：`probe_duration(path)`（ffprobe，失败返回 None）。

源码出处：`studio/server.py` 的 `validate_edl`（:2234-2451）、`normalize_clip`/`check_clip_cuts`/`clip_keep_ranges`/`clip_net_duration`（:1539-1614）、`breath_boundaries`（:1256）、`_range_text_raw`（:1666）、`classify_energy`/`_percentile`（:1407-1487）。移植改动（单源 CLI 化）：v3 多源检查折叠为"源视频存在"；`溯源字段完整`与`总时长合理`按 spec 合并为第 12 项；`清洗后净时长`并入第 8 项`无过短碎片`；阈值全走 rules.json。

### Steps

- [ ] 1. 写失败测试 `tools/tests/test_celebrity_slice_validate_edl.py`（unittest 风格，与既有 tools/tests 一致；rules 直接读真实 `references/rules.json`，顺带回归 Task 1 的键名契约）：

```python
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "skills" / "celebrity-slice" / "scripts" / "validate_edl.py"
SPEC = importlib.util.spec_from_file_location("cs_validate_edl", MODULE_PATH)
assert SPEC and SPEC.loader
validate_edl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_edl)

RULES = json.loads(
    (ROOT / "skills" / "celebrity-slice" / "references" / "rules.json").read_text(encoding="utf-8")
)


def make_chars(spans):
    """[(text, start, end)] -> 词级 token 流。"""
    return [{"text": t, "start": s, "end": e} for t, s, e in spans]


def clip(cid, s, e, **kw):
    base = {"id": cid, "source_start": s, "source_end": e,
            "selection_reason": "理由", "selling_point": "卖点"}
    base.update(kw)
    return base


# 连续口播 0-30s（每字 0.5s），在 10.0-10.4 处留一个 0.4s 气口（>= breath_gap_min_s 0.3）
CHARS = make_chars(
    [("字%d" % i, i * 0.5, i * 0.5 + 0.5) for i in range(20)]          # 0.0 - 10.0
    + [("字%d" % i, 10.4 + (i - 20) * 0.5, 10.4 + (i - 20) * 0.5 + 0.5)  # 10.4 - 30.4
       for i in range(20, 60)]
)


def status_of(report, name_prefix):
    for c in report["checks"]:
        if c["check"].startswith(name_prefix):
            return c["status"]
    raise AssertionError("check not found: %s" % name_prefix)


class FailChecksTests(unittest.TestCase):
    def run_checks(self, edl, chars=CHARS, video_exists=True, duration=3600.0, energy=None):
        return validate_edl.run_checks(edl, chars, RULES, video_exists, duration, energy)

    def test_empty_edl_fails(self):
        report = self.run_checks({"clips": []})
        self.assertFalse(report["pass"])
        self.assertEqual(status_of(report, "片段存在"), "fail")

    def test_all_green_pass_case(self):
        # 两段合计 55s，落在 20-120s；切点全部贴在气口/媒体边缘
        edl = {"clips": [clip("c1", 0.0, 10.0), clip("c2", 10.4, 55.4)]}
        chars = make_chars([("字%d" % i, i * 0.5, i * 0.5 + 0.5) for i in range(20)]
                           + [("字%d" % i, 10.4 + (i - 20) * 0.5, 10.9 + (i - 20) * 0.5)
                              for i in range(20, 110)])
        report = self.run_checks(edl, chars=chars)
        self.assertTrue(report["pass"], report)
        self.assertTrue(all(c["status"] == "pass" for c in report["checks"]), report)

    def test_bad_interval_fails(self):
        report = self.run_checks({"clips": [clip("c1", 8.0, 3.0)]})
        self.assertEqual(status_of(report, "时间区间合法"), "fail")
        self.assertFalse(report["pass"])

    def test_over_duration_fails(self):
        report = self.run_checks({"clips": [clip("c1", 0.0, 50.0)]}, duration=30.0)
        self.assertEqual(status_of(report, "不超出源视频时长"), "fail")

    def test_unknown_duration_warns_not_fails(self):
        report = self.run_checks({"clips": [clip("c1", 0.0, 30.0)]}, duration=None)
        self.assertEqual(status_of(report, "不超出源视频时长"), "warn")

    def test_overlap_fails(self):
        edl = {"clips": [clip("c1", 0.0, 10.0), clip("c2", 8.0, 30.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "源区间不重叠"), "fail")

    def test_illegal_cuts_fail(self):
        edl = {"clips": [clip("c1", 0.0, 30.0,
                              cuts=[{"start": 5.0, "end": 4.0, "reason": "x"}])]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "段内清洗 cuts 合法"), "fail")

    def test_out_of_range_cut_fails(self):
        edl = {"clips": [clip("c1", 10.0, 30.0,
                              cuts=[{"start": 5.0, "end": 12.0, "reason": "越界"}])]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "段内清洗 cuts 合法"), "fail")

    def test_duplicate_id_fails(self):
        edl = {"clips": [clip("c1", 0.0, 10.0), clip("c1", 10.4, 30.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "clip id 唯一"), "fail")

    def test_missing_video_fails(self):
        report = self.run_checks({"clips": [clip("c1", 0.0, 30.0)]},
                                 video_exists=False, duration=None)
        self.assertEqual(status_of(report, "源视频存在"), "fail")


class WarnChecksTests(unittest.TestCase):
    def run_checks(self, edl, chars=CHARS, energy=None):
        return validate_edl.run_checks(edl, chars, RULES, True, 3600.0, energy)

    def test_tiny_clip_warns_but_still_passes(self):
        min_clip = RULES["breath_rule"]["min_clip_s"]
        edl = {"clips": [clip("c1", 0.0, min_clip / 2), clip("c2", 10.4, 40.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "无过短碎片"), "warn")
        self.assertTrue(report["pass"])  # warn 不拉 fail

    def test_net_duration_after_cuts_warns(self):
        edl = {"clips": [clip("c1", 0.0, 3.0,
                              cuts=[{"start": 0.2, "end": 2.9, "reason": "口水"}]),
                         clip("c2", 10.4, 40.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "无过短碎片"), "warn")

    def test_off_breath_cut_warns_with_energy_note(self):
        # 出点 5.25 落在字中间（离最近气口 > snap_tolerance_s 0.5）
        edl = {"clips": [clip("c1", 0.0, 5.25), clip("c2", 10.4, 40.0)]}
        energy = {"window_ms": 100, "rms_db": [-30.0] * 600}  # 全片同能量 → mid
        report = self.run_checks(edl, energy=energy)
        self.assertEqual(status_of(report, "切点贴合气口"), "warn")
        detail = [c for c in report["checks"] if c["check"].startswith("切点贴合气口")][0]["detail"]
        self.assertIn("[能量 mid]", detail)

    def test_cut_off_char_boundary_warns(self):
        # 字边界都在 0.5 的整数倍上；cut 边界 5.23 距最近字边界 0.23 > 0.1
        edl = {"clips": [clip("c1", 0.0, 10.0,
                              cuts=[{"start": 5.23, "end": 6.0, "reason": "x"}]),
                         clip("c2", 10.4, 40.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "cuts 贴字边界"), "warn")

    def test_silent_range_warns_on_text_verify(self):
        edl = {"clips": [clip("c1", 200.0, 230.0)]}  # 字级时间戳只铺到 30.4s
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "字级时间戳回验"), "warn")

    def test_total_duration_and_trace_fields_warn(self):
        c = clip("c1", 0.0, 10.0)
        c["selection_reason"] = ""
        report = self.run_checks({"clips": [c]})  # 总时长 10s < 20s 且缺溯源
        self.assertEqual(status_of(report, "总时长与溯源字段"), "warn")

    def test_no_asr_degrades_breath_check_to_warn(self):
        report = self.run_checks({"clips": [clip("c1", 0.0, 30.0)]}, chars=[])
        self.assertEqual(status_of(report, "切点贴合气口"), "warn")
        self.assertEqual(status_of(report, "字级时间戳回验"), "warn")


class HelperTests(unittest.TestCase):
    def test_breath_boundaries_finds_gap(self):
        starts, ends = validate_edl.breath_boundaries(CHARS, RULES["breath_rule"])
        self.assertIn((10.4, 0.4), starts)  # 气口后第一字 start
        self.assertIn((10.0, 0.4), ends)    # 气口前最后一字 end
        self.assertEqual(starts[0], (0.0, None))  # 媒体起点

    def test_clip_net_duration_subtracts_cuts(self):
        c = validate_edl.normalize_clip(
            {"id": "c1", "source_start": 0.0, "source_end": 10.0,
             "cuts": [{"start": 2.0, "end": 4.0, "reason": "x"}]})
        self.assertAlmostEqual(validate_edl.clip_net_duration(c), 8.0, places=3)

    def test_classify_energy_percentiles(self):
        data = {"window_ms": 100, "rms_db": [-60.0] * 20 + [-30.0] * 60 + [-10.0] * 20}
        rule = RULES["energy_rule"]
        # 前 2s 全是最低能量窗 → quiet；末 2s 全是最高能量窗 → noisy
        self.assertEqual(validate_edl.classify_energy(data, rule, 0.0, 1.9), "quiet")
        self.assertEqual(validate_edl.classify_energy(data, rule, 8.1, 10.0), "noisy")
        self.assertEqual(validate_edl.classify_energy(data, rule, 3.0, 6.0), "mid")


if __name__ == "__main__":
    unittest.main()
```

- [ ] 2. 跑 `python3 -m pytest tools/tests/test_celebrity_slice_validate_edl.py -q`，确认因脚本不存在而失败（import 阶段 FileNotFoundError）。

- [ ] 3. 写 `skills/celebrity-slice/scripts/validate_edl.py` 上半部分（docstring + 工具函数 + clip 归一化/cuts 校验 + 气口/能量纯函数）：

```python
#!/usr/bin/env python3
"""明星切片 QA 机检：对 EDL 草稿做 12 项机械检查，输出机检清单 JSON。

fail 级 7 项（必须清零才能交付）：
  1 片段存在  2 源视频存在  3 时间区间合法  4 不超出源视频时长
  5 源区间不重叠  6 段内清洗 cuts 合法  7 clip id 唯一
warn 级 5 项（人工复核，不拦交付）：
  8 无过短碎片（含清洗后净时长）  9 切点贴合气口（附能量标注）
  10 cuts 贴字边界  11 字级时间戳回验  12 总时长与溯源字段

阈值全部读 ../references/rules.json（breath_rule/clean_rule/energy_rule），不硬编码。
纯逻辑（run_checks）与 ffprobe 探测（probe_duration）分离，纯逻辑可离线测试。

用法:
    python3 validate_edl.py --edl edl.json --asr words.json --video source.mp4 \
        [--energy energy.json] [--rules rules.json] [--out report.json]

退出码：0 = fail 清零；1 = 存在 fail 项。
"""
import argparse
import json
import math
import os
import subprocess
import sys


def default_rules_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "references", "rules.json")


def load_rules(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def normalize_clip(c: dict) -> dict:
    """EDL clip 归一化：数值取整到毫秒、补齐溯源字段、清洗 cuts。"""
    out = {
        "id": str(c.get("id") or c.get("clip_id") or ""),
        "source_start": round(float(c.get("source_start", 0)), 3),
        "source_end": round(float(c.get("source_end", 0)), 3),
        "selection_reason": str(c.get("selection_reason", "")),
        "selling_point": str(c.get("selling_point", "")),
        "visual_point": str(c.get("visual_point", "")),
        "risk_note": str(c.get("risk_note", "")),
    }
    if c.get("signal_level") is not None:
        try:
            lv = int(c["signal_level"])
            if 1 <= lv <= 6:
                out["signal_level"] = lv
        except (TypeError, ValueError):
            pass
    if isinstance(c.get("cuts"), list):
        cuts = []
        for x in c["cuts"]:
            if not isinstance(x, dict):
                continue
            try:
                cs, ce = round(float(x["start"]), 3), round(float(x["end"]), 3)
            except (KeyError, TypeError, ValueError):
                continue
            cuts.append({"start": cs, "end": ce, "reason": str(x.get("reason", ""))})
        cuts.sort(key=lambda x: (x["start"], x["end"]))
        if cuts:
            out["cuts"] = cuts
    return out


def check_clip_cuts(c: dict) -> list:
    """cuts 硬校验：须在 clip 区间内、end>start、互不重叠。返回错误列表。"""
    errs = []
    cuts = c.get("cuts") or []
    cid = c.get("id") or "?"
    s, e = c["source_start"], c["source_end"]
    for i, x in enumerate(cuts):
        if not x["end"] > x["start"]:
            errs.append("%s cuts[%d] 需 end > start（[%.3f,%.3f]）" % (cid, i, x["start"], x["end"]))
        if x["start"] < s - 0.001 or x["end"] > e + 0.001:
            errs.append("%s cuts[%d] [%.3f,%.3f] 越界（clip 区间 [%.3f,%.3f]）"
                        % (cid, i, x["start"], x["end"], s, e))
    for a, b in zip(cuts, cuts[1:]):
        if b["start"] < a["end"] - 0.001:
            errs.append("%s cuts 重叠：[%.3f,%.3f] ↔ [%.3f,%.3f]"
                        % (cid, a["start"], a["end"], b["start"], b["end"]))
    return errs


def clip_keep_ranges(c: dict) -> list:
    """clip 区间减去 cuts 后的保留区间 [(start,end)]（忽略非法 cut 的越界部分）。"""
    s, e = c["source_start"], c["source_end"]
    ranges = []
    cur = s
    for x in sorted(c.get("cuts") or [], key=lambda x: (x["start"], x["end"])):
        a, b = max(cur, x["start"]), min(e, x["end"])
        if b <= a:
            continue
        if a - cur > 0.01:
            ranges.append((round(cur, 3), round(a, 3)))
        cur = max(cur, b)
    if e - cur > 0.01:
        ranges.append((round(cur, 3), round(e, 3)))
    return ranges or [(round(s, 3), round(e, 3))]


def clip_net_duration(c: dict) -> float:
    return round(sum(b - a for a, b in clip_keep_ranges(c)), 3)


def breath_boundaries(chars: list, rule: dict):
    """在词级时间戳上找气口。返回 (starts, ends)，chars 为空返回 None。
    starts=[(气口后第一字 start, 气口 gap 秒|None)]（入点候选，含媒体起点）
    ends  =[(气口前最后一字 end, 气口 gap 秒|None)]（出点候选，含媒体终点）
    gap=None 表示媒体边缘（前/后没有字）。"""
    if not chars:
        return None
    min_gap = float(rule["breath_gap_min_s"])
    starts, ends = [], []
    starts.append((float(chars[0]["start"]), None))
    for prev, cur in zip(chars, chars[1:]):
        gap = float(cur["start"]) - float(prev["end"])
        if gap >= min_gap:
            ends.append((float(prev["end"]), round(gap, 3)))
            starts.append((float(cur["start"]), round(gap, 3)))
    ends.append((float(chars[-1]["end"]), None))
    return starts, ends


def _nearest_boundary_dist(t: float, cands: list):
    if not cands:
        return None
    return min(abs(x[0] - t) for x in cands)


def _range_text_raw(chars: list, s: float, e: float, tol: float) -> str:
    """词级时间戳上 [s,e]（容差 tol）区间的文本（按字符中点判断）。"""
    return "".join(c["text"] for c in chars
                   if s - tol <= (float(c["start"]) + float(c["end"])) / 2 <= e + tol).strip()


FLOOR_DB = -80.0


def _percentile(sorted_vals: list, p: float) -> float:
    if not sorted_vals:
        return FLOOR_DB
    idx = max(0, min(len(sorted_vals) - 1, int(round(p / 100.0 * (len(sorted_vals) - 1)))))
    return sorted_vals[idx]


def classify_energy(data: dict, rule: dict, t0: float, t1: float):
    """[t0,t1] 秒区间的能量分类：窗中位 RMS 与全片 P{p_quiet}/P{p_noisy} 比较。
    返回 "quiet"|"mid"|"noisy"，区间无窗返回 None。"""
    if not isinstance(data, dict):
        return None
    rms = data.get("rms_db") or []
    if not rms or t1 <= t0:
        return None
    w = float(data["window_ms"]) / 1000.0
    i0 = max(0, int(t0 / w))
    i1 = min(len(rms), max(i0 + 1, int(math.ceil(t1 / w))))
    vals = sorted(rms[i0:i1])
    if not vals:
        return None
    med = vals[len(vals) // 2]
    srt = sorted(rms)
    q = _percentile(srt, float(rule["p_quiet"]))
    n = _percentile(srt, float(rule["p_noisy"]))
    if med < q:
        return "quiet"
    if med > n:
        return "noisy"
    return "mid"
```

- [ ] 4. 写 `validate_edl.py` 下半部分（`run_checks` 12 项 + ffprobe 封装 + main）：

```python
def run_checks(edl: dict, chars: list, rules: dict,
               video_exists: bool, video_duration, energy=None) -> dict:
    """12 项机检（纯逻辑）。chars=词级 token 流（空列表=无 ASR，气口类检查降级 warn）；
    video_duration=None 表示无法探测；energy=snap_breath.py 产出的能量 JSON（可选）。"""
    brule = dict(rules.get("breath_rule") or {})
    crule = dict(rules.get("clean_rule") or {})
    erule = dict(rules.get("energy_rule") or {})
    clips = [normalize_clip(c) for c in (edl.get("clips") or [])]
    checks = []

    def add(name, status, detail):
        checks.append({"check": name, "status": status, "detail": detail})

    # 1 片段存在（fail）
    if not clips:
        add("片段存在", "fail", "EDL 为空")
        return {"checks": checks, "pass": False, "total_duration": 0.0}
    add("片段存在", "pass", "共 %d 个片段" % len(clips))

    # 2 源视频存在（fail）
    add("源视频存在", "pass" if video_exists else "fail",
        "源视频可读" if video_exists else "源视频不存在或不可读（检查 --video 路径）")

    # 3 时间区间合法（fail）
    bad = [c["id"] for c in clips if not (c["source_end"] > c["source_start"] >= 0)]
    add("时间区间合法", "fail" if bad else "pass",
        ("非法区间: %s" % ", ".join(bad)) if bad
        else "所有片段 source_start < source_end 且 >= 0")

    # 4 不超出源视频时长（fail；时长探测不到降 warn 不误伤）
    if video_duration is None:
        add("不超出源视频时长", "warn", "无法探测源时长（ffprobe 失败或未提供 --video），跳过")
    else:
        over = ["%s(源 %.1fs)" % (c["id"], video_duration)
                for c in clips if c["source_end"] > video_duration + 0.05]
        add("不超出源视频时长", "fail" if over else "pass",
            ("超界片段: %s" % ", ".join(over)) if over
            else "所有片段在源时长 %.1fs 界内" % video_duration)

    # 5 源区间不重叠（fail）
    ordered = sorted(clips, key=lambda c: c["source_start"])
    overlaps = ["%s ↔ %s" % (a["id"], b["id"]) for a, b in zip(ordered, ordered[1:])
                if b["source_start"] < a["source_end"] - 0.001]
    add("源区间不重叠", "fail" if overlaps else "pass",
        ("重叠: %s" % "; ".join(overlaps)) if overlaps else "无重叠")

    # 6 段内清洗 cuts 合法（fail）
    with_cuts = [c for c in clips if c.get("cuts")]
    cut_errs = []
    for c in with_cuts:
        cut_errs.extend(check_clip_cuts(c))
    add("段内清洗 cuts 合法", "fail" if cut_errs else "pass",
        "; ".join(cut_errs) if cut_errs
        else ("%d 段共 %d 个 cuts，均在段内且互不重叠"
              % (len(with_cuts), sum(len(c["cuts"]) for c in with_cuts))
              if with_cuts else "无 cuts"))

    # 7 clip id 唯一（fail）
    ids = [c["id"] for c in clips]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    add("clip id 唯一", "fail" if dup else "pass",
        ("重复 id: %s" % ", ".join(dup)) if dup else "无重复")

    # 8 无过短碎片（warn，含清洗后净时长）
    min_clip = float(brule["min_clip_s"])
    tiny = [c["id"] for c in clips if (c["source_end"] - c["source_start"]) < min_clip]
    tiny_net = ["%s(净%.1fs)" % (c["id"], clip_net_duration(c))
                for c in with_cuts
                if c["id"] not in tiny and clip_net_duration(c) < min_clip]
    parts = []
    if tiny:
        parts.append("过短片段: %s" % ", ".join(tiny))
    if tiny_net:
        parts.append("清洗后过短: %s" % ", ".join(tiny_net))
    add("无过短碎片(≥%.1fs)" % min_clip, "warn" if parts else "pass",
        ("; ".join(parts) + "，易产生句子拼贴感") if parts
        else "所有片段（含清洗后净时长）≥ %.1fs（breath_rule.min_clip_s）" % min_clip)

    # 9 切点贴合气口（warn 不 fail：人可故意切；附能量标注）
    tol = float(brule["snap_tolerance_s"])
    b = breath_boundaries(chars, brule) if chars else None

    def energy_note(t):
        if not (isinstance(energy, dict) and energy.get("rms_db")):
            return ""
        lab = classify_energy(energy, erule, t - 0.15, t + 0.15)
        return ("[能量 %s]" % lab) if lab else ""

    if b is None:
        add("切点贴合气口(≤%.1fs)" % tol, "warn", "无字级 ASR，跳过气口检查")
    else:
        starts, ends = b
        off = []
        for c in clips:
            ds = _nearest_boundary_dist(c["source_start"], starts)
            de = _nearest_boundary_dist(c["source_end"], ends)
            p = []
            if ds is not None and ds > tol:
                p.append("入点离最近气口 %.2fs%s" % (ds, energy_note(c["source_start"])))
            if de is not None and de > tol:
                p.append("出点离最近气口 %.2fs%s" % (de, energy_note(c["source_end"])))
            if p:
                off.append("%s（%s）" % (c["id"], "、".join(p)))
        add("切点贴合气口(≤%.1fs)" % tol, "warn" if off else "pass",
            ("疑似切在字中间: %s。可用 snap_breath.py 一键吸附" % "; ".join(off)) if off
            else "所有入出点距最近气口 ≤ %.1fs（breath_rule.snap_tolerance_s）" % tol)

    # 10 cuts 贴字边界（warn）
    tolc = float(crule["cut_boundary_char_tol_s"])
    bounds = sorted({float(x["start"]) for x in chars} | {float(x["end"]) for x in chars})
    if not with_cuts:
        add("cuts 贴字边界(≤%.2fs)" % tolc, "pass", "无 cuts")
    elif not bounds:
        add("cuts 贴字边界(≤%.2fs)" % tolc, "warn", "无字级 ASR，跳过")
    else:
        off_cut = []
        for c in with_cuts:
            for x in c["cuts"]:
                for t in (x["start"], x["end"]):
                    dmin = min(abs(bv - t) for bv in bounds)
                    if dmin > tolc:
                        off_cut.append("%s cut@%.2f 离最近字边界 %.2fs" % (c["id"], t, dmin))
        add("cuts 贴字边界(≤%.2fs)" % tolc, "warn" if off_cut else "pass",
            ("; ".join(off_cut) + "。cut 边界应贴字级时间戳") if off_cut
            else "所有 cut 边界距最近字边界 ≤ %.2fs（clean_rule）" % tolc)

    # 11 字级时间戳回验（warn）
    vtol = float(brule["verify_tolerance_s"])
    if not chars:
        add("字级时间戳回验", "warn", "无字级 ASR，跳过")
    else:
        empty = [c["id"] for c in clips
                 if not _range_text_raw(chars, c["source_start"], c["source_end"], vtol)]
        add("字级时间戳回验", "warn" if empty else "pass",
            ("区间取不到任何转写文字（纯静音/越界？）: %s" % ", ".join(empty)) if empty
            else "所有片段区间都能在字级时间戳上取到非空文本（容差 %.1fs）" % vtol)

    # 12 总时长与溯源字段（warn）
    total = sum(c["source_end"] - c["source_start"] for c in clips)
    missing = [c["id"] for c in clips if not (c["selection_reason"] and c["selling_point"])]
    p12 = []
    if not (20 <= total <= 120):
        p12.append("总时长 %.1fs 超出常规切片范围 20-120s" % total)
    if missing:
        p12.append("缺 selection_reason/selling_point: %s" % ", ".join(missing))
    add("总时长与溯源字段", "warn" if p12 else "pass",
        "; ".join(p12) if p12
        else "总时长 %.1fs 合理；所有片段带 selection_reason + selling_point" % total)

    ok = all(c["status"] != "fail" for c in checks)
    return {"checks": checks, "pass": ok, "total_duration": round(total, 3)}


def probe_duration(path):
    """ffprobe 探测视频时长（秒）；失败返回 None（外部进程封装，测试不覆盖）。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=True)
        return float(out.stdout.strip())
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="明星切片 QA 机检（12 项，阈值读 rules.json）")
    ap.add_argument("--edl", required=True, help="EDL JSON 路径")
    ap.add_argument("--asr", required=True, help="词级 ASR JSON 路径（segments 词流）")
    ap.add_argument("--video", default=None, help="源视频路径（探测时长与存在性）")
    ap.add_argument("--energy", default=None, help="能量 JSON（snap_breath.py 产出，可选）")
    ap.add_argument("--rules", default=default_rules_path(), help="rules.json 路径")
    ap.add_argument("--out", default=None, help="机检清单输出路径（缺省打到 stdout）")
    args = ap.parse_args()

    with open(args.edl, encoding="utf-8") as f:
        edl = json.load(f)
    with open(args.asr, encoding="utf-8") as f:
        chars = json.load(f).get("segments") or []
    rules = load_rules(args.rules)
    energy = None
    if args.energy and os.path.isfile(args.energy):
        with open(args.energy, encoding="utf-8") as f:
            energy = json.load(f)

    video_exists = bool(args.video) and os.path.isfile(args.video)
    duration = probe_duration(args.video) if video_exists else None
    report = run_checks(edl, chars, rules, video_exists, duration, energy)

    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        sys.stderr.write("[ok] 机检清单 → %s（pass=%s）\n" % (args.out, report["pass"]))
    else:
        print(text)
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] 5. 跑 `python3 -m pytest tools/tests/test_celebrity_slice_validate_edl.py -q` 到全绿；再 `python3 -m py_compile skills/celebrity-slice/scripts/validate_edl.py`。

- [ ] 6. Commit：

```
feat(celebrity-slice): validate_edl.py 12 项机检 CLI + 测试

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

## Task 3：scripts/snap_breath.py（气口吸附 + RMS 能量互证）

**Files:**
- Create: `skills/celebrity-slice/scripts/snap_breath.py`
- Test: `tools/tests/test_celebrity_slice_snap_breath.py`

**Interfaces:**
- Consumes: EDL JSON、词级 ASR JSON、`rules.json` 的 `breath_rule`/`energy_rule`、可选源视频（ffmpeg 解码算能量）或已有能量 JSON。
- Produces: 吸附结果 JSON `{"clips": [吸附行…], "rule": breath_rule, "energy_rule": …|null}`；`--apply` 时附带回写坐标后的 `"edl"`；`--energy PATH` 兼作能量缓存读写（存在则读，不存在且有 `--video` 则计算后写入，供 validate_edl.py 复用）。
- CLI：`python3 snap_breath.py --edl EDL.json --asr WORDS.json [--video SRC.mp4] [--energy ENERGY.json] [--apply] [--rules RULES.json] [--out OUT.json]`
- 纯逻辑核心（测试直接调）：
  - `breath_boundaries(chars: list, rule: dict)`（与 Task 2 同名同签名同实现——skill 脚本各自独立零依赖，允许这份 15 行的受控重复；两处必须逐字一致）
  - `snap_clips(clips: list, starts: list, ends: list, rule: dict, energy=None, energy_rule=None) -> list`
  - `rms_windows(pcm: bytes, window_samples: int) -> list`（s16le PCM → 每窗 RMS dBFS）
  - `_percentile` / `classify_energy` / `gap_energy_at(data: dict, rule: dict, t: float, gap, side: str)`
- 外部进程封装：`compute_energy(video: str, window_ms: int) -> dict`（ffmpeg 管道解码，内部循环喂 `rms_windows`）。

源码出处：`studio/server.py` 的 `snap_clips`（:1278-1328）、`_compute_energy_windows`（:1370-1404）、`breath_boundaries`（:1256）、`classify_energy`/`gap_energy_at`/`_percentile`（:1407-1499）。移植改动：去 pid/项目上下文，纯函数收参数；能量三级缓存简化为单文件缓存（--energy 路径）；PCM→RMS 拆成纯函数 `rms_windows` 以便离线测试。

### Steps

- [ ] 1. 写失败测试 `tools/tests/test_celebrity_slice_snap_breath.py`：

```python
from __future__ import annotations

import array
import importlib.util
import json
import math
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "skills" / "celebrity-slice" / "scripts" / "snap_breath.py"
SPEC = importlib.util.spec_from_file_location("cs_snap_breath", MODULE_PATH)
assert SPEC and SPEC.loader
snap_breath = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(snap_breath)

RULES = json.loads(
    (ROOT / "skills" / "celebrity-slice" / "references" / "rules.json").read_text(encoding="utf-8")
)
BRULE = RULES["breath_rule"]

# 词流：0-10s 连续（每字 0.5s），10.0→10.4 有 0.4s 气口，10.4-20.4 连续
CHARS = ([{"text": "字", "start": i * 0.5, "end": i * 0.5 + 0.5} for i in range(20)]
         + [{"text": "字", "start": 10.4 + i * 0.5, "end": 10.9 + i * 0.5} for i in range(20)])


class BoundariesTests(unittest.TestCase):
    def test_gap_detected(self):
        starts, ends = snap_breath.breath_boundaries(CHARS, BRULE)
        self.assertIn((10.4, 0.4), starts)
        self.assertIn((10.0, 0.4), ends)

    def test_media_edges_have_none_gap(self):
        starts, ends = snap_breath.breath_boundaries(CHARS, BRULE)
        self.assertEqual(starts[0], (0.0, None))
        self.assertEqual(ends[-1], (20.4, None))  # 最后一字 end，媒体终点 gap=None

    def test_empty_chars_returns_none(self):
        self.assertIsNone(snap_breath.breath_boundaries([], BRULE))


class SnapTests(unittest.TestCase):
    def snap(self, clips, energy=None):
        starts, ends = snap_breath.breath_boundaries(CHARS, BRULE)
        return snap_breath.snap_clips(clips, starts, ends, BRULE,
                                      energy=energy, energy_rule=RULES["energy_rule"])

    def test_snap_within_tolerance_applies_pads(self):
        # 入点 10.2 距气口后首字 10.4 = 0.2 <= 0.5；出点 9.8 距气口前末字 10.0 = 0.2
        rows = self.snap([{"source_start": 10.2, "source_end": 15.0}])
        row = rows[0]
        self.assertTrue(row["start_snapped"])
        self.assertAlmostEqual(row["snapped_start"], 10.4 - BRULE["pad_start_s"], places=3)
        self.assertAlmostEqual(row["gap_before_s"], 0.4, places=3)

    def test_end_snap_adds_pad_end(self):
        rows = self.snap([{"source_start": 0.0, "source_end": 9.8}])
        row = rows[0]
        self.assertTrue(row["end_snapped"])
        self.assertAlmostEqual(row["snapped_end"], 10.0 + BRULE["pad_end_s"], places=3)

    def test_no_snap_outside_tolerance(self):
        # 5.25 深处字中间，两端候选距离都 > snap_tolerance_s（除媒体边缘外无气口）
        rows = self.snap([{"source_start": 3.3, "source_end": 5.25}])
        row = rows[0]
        self.assertFalse(row["snapped"])
        self.assertEqual(row["snapped_start"], 3.3)
        self.assertEqual(row["snapped_end"], 5.25)

    def test_inverted_after_snap_gives_up(self):
        # 极短段横跨同一气口：入点吸到 10.4-pad、出点吸到 10.0+pad → 反转 → 放弃
        rows = self.snap([{"source_start": 10.2, "source_end": 10.3}])
        row = rows[0]
        self.assertFalse(row["snapped"])
        self.assertEqual(row.get("note"), "吸附后区间反转，放弃")

    def test_bad_clip_reports_error(self):
        rows = self.snap([{"source_start": "abc"}])
        self.assertIn("error", rows[0])

    def test_energy_annotation_on_snapped_gap(self):
        # 全片 20s 基本安静（P20/P50 都是 -60），只有 10.0-10.4s（窗 100-103）是高能量
        energy = {"window_ms": 100, "rms_db": [-60.0] * 100 + [-10.0] * 4 + [-60.0] * 96}
        rows = self.snap([{"source_start": 10.2, "source_end": 15.0}], energy=energy)
        # 吸附气口区间 [10.0,10.4] 中位能量高于全片 P50 → noisy
        self.assertEqual(rows[0]["start_energy"], "noisy")


class RmsTests(unittest.TestCase):
    def _pcm(self, samples):
        a = array.array("h", samples)
        return a.tobytes()

    def test_silence_hits_floor(self):
        out = snap_breath.rms_windows(self._pcm([0] * 1600), 1600)
        self.assertEqual(out, [snap_breath.FLOOR_DB])

    def test_full_scale_near_zero_db(self):
        out = snap_breath.rms_windows(self._pcm([32767, -32767] * 800), 1600)
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0], 0.0, delta=0.1)

    def test_partial_window_dropped(self):
        out = snap_breath.rms_windows(self._pcm([1000] * 2000), 1600)
        self.assertEqual(len(out), 1)  # 尾部不满一窗丢弃


if __name__ == "__main__":
    unittest.main()
```

- [ ] 2. 跑 `python3 -m pytest tools/tests/test_celebrity_slice_snap_breath.py -q`，确认因脚本不存在失败。

- [ ] 3. 写 `skills/celebrity-slice/scripts/snap_breath.py`（完整）：

```python
#!/usr/bin/env python3
"""气口吸附：把 EDL 切点吸附到词级时间戳的静音谷（气口），并做 RMS 能量互证标注。

吸附规则（数值全读 ../references/rules.json 的 breath_rule/energy_rule，不硬编码）：
  入点 → 气口后第一字 start − pad_start_s；出点 → 气口前最后一字 end + pad_end_s。
  搜索窗 ±snap_tolerance_s；窗内无气口该端不动；两端都没吸到 snapped=false。
能量互证（机制来源 auto-editor：解码音频逐窗算 RMS）：吸附到的气口做
  quiet（低于全片 P{p_quiet}，可信气口）/ mid / noisy（高于 P{p_noisy}，背景音）标注。

纯逻辑（breath_boundaries/snap_clips/rms_windows/classify_energy）与 ffmpeg
子进程（compute_energy）分离，纯逻辑可离线测试。

用法:
    python3 snap_breath.py --edl edl.json --asr words.json \
        [--video source.mp4] [--energy energy.json] [--apply] \
        [--rules rules.json] [--out snapped.json]

--energy 是能量缓存路径：文件存在直接读；不存在且给了 --video 则计算后写入
（validate_edl.py 的 --energy 参数可复用同一文件）。
--apply 时输出附带 "edl"：吸附成功的 clip 坐标已回写，可直接进组合闸。
"""
import argparse
import array
import json
import math
import os
import subprocess
import sys

FLOOR_DB = -80.0
SAMPLE_RATE = 16000


def default_rules_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "references", "rules.json")


def load_rules(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def breath_boundaries(chars: list, rule: dict):
    """在词级时间戳上找气口。返回 (starts, ends)，chars 为空返回 None。
    starts=[(气口后第一字 start, 气口 gap 秒|None)]（入点候选，含媒体起点）
    ends  =[(气口前最后一字 end, 气口 gap 秒|None)]（出点候选，含媒体终点）
    gap=None 表示媒体边缘（前/后没有字）。"""
    if not chars:
        return None
    min_gap = float(rule["breath_gap_min_s"])
    starts, ends = [], []
    starts.append((float(chars[0]["start"]), None))
    for prev, cur in zip(chars, chars[1:]):
        gap = float(cur["start"]) - float(prev["end"])
        if gap >= min_gap:
            ends.append((float(prev["end"]), round(gap, 3)))
            starts.append((float(cur["start"]), round(gap, 3)))
    ends.append((float(chars[-1]["end"]), None))
    return starts, ends


def _percentile(sorted_vals: list, p: float) -> float:
    if not sorted_vals:
        return FLOOR_DB
    idx = max(0, min(len(sorted_vals) - 1, int(round(p / 100.0 * (len(sorted_vals) - 1)))))
    return sorted_vals[idx]


def classify_energy(data: dict, rule: dict, t0: float, t1: float):
    """[t0,t1] 秒区间的能量分类：窗中位 RMS 与全片 P{p_quiet}/P{p_noisy} 比较。
    返回 "quiet"|"mid"|"noisy"，区间无窗返回 None。"""
    if not isinstance(data, dict):
        return None
    rms = data.get("rms_db") or []
    if not rms or t1 <= t0:
        return None
    w = float(data["window_ms"]) / 1000.0
    i0 = max(0, int(t0 / w))
    i1 = min(len(rms), max(i0 + 1, int(math.ceil(t1 / w))))
    vals = sorted(rms[i0:i1])
    if not vals:
        return None
    med = vals[len(vals) // 2]
    srt = sorted(rms)
    q = _percentile(srt, float(rule["p_quiet"]))
    n = _percentile(srt, float(rule["p_noisy"]))
    if med < q:
        return "quiet"
    if med > n:
        return "noisy"
    return "mid"


def gap_energy_at(data: dict, rule: dict, t: float, gap, side: str):
    """snap 端点能量：端点 t 吸附到的气口区间做分类。
    side="start"：气口在入点前 [t-gap, t]；side="end"：气口在出点后 [t, t+gap]。
    gap=None（媒体边缘）→ 取端点外 0.3s。"""
    if gap is None:
        span = 0.3
        t0, t1 = (t - span, t) if side == "start" else (t, t + span)
    else:
        t0, t1 = (t - float(gap), t) if side == "start" else (t, t + float(gap))
    return classify_energy(data, rule, max(0.0, t0), t1)


def snap_clips(clips: list, starts: list, ends: list, rule: dict,
               energy=None, energy_rule=None) -> list:
    """把每段 (source_start, source_end) 吸附到最近气口（纯函数）。"""
    tol = float(rule["snap_tolerance_s"])
    pad_s, pad_e = float(rule["pad_start_s"]), float(rule["pad_end_s"])
    out = []
    for c in clips:
        try:
            s, e = float(c["source_start"]), float(c["source_end"])
        except (KeyError, TypeError, ValueError):
            out.append({"error": "clip 需含数字 source_start/source_end", "snapped": False})
            continue
        cand_s = min(starts, key=lambda x: abs(x[0] - s)) if starts else None
        cand_e = min(ends, key=lambda x: abs(x[0] - e)) if ends else None
        s_ok = cand_s is not None and abs(cand_s[0] - s) <= tol
        e_ok = cand_e is not None and abs(cand_e[0] - e) <= tol
        ns = max(0.0, cand_s[0] - pad_s) if s_ok else s
        ne = cand_e[0] + pad_e if e_ok else e
        note = ""
        if ns >= ne:  # 极短段两端吸到同一气口两侧会反转，放弃吸附
            ns, ne, s_ok, e_ok = s, e, False, False
            note = "吸附后区间反转，放弃"
        row = {
            "source_start": round(s, 3), "source_end": round(e, 3),
            "snapped_start": round(ns, 3), "snapped_end": round(ne, 3),
            "snapped": bool(s_ok or e_ok),
            "start_snapped": bool(s_ok), "end_snapped": bool(e_ok),
            "start_shift_s": round(ns - s, 3), "end_shift_s": round(ne - e, 3),
            "gap_before_s": cand_s[1] if s_ok else None,
            "gap_after_s": cand_e[1] if e_ok else None,
            "start_energy": (gap_energy_at(energy, energy_rule, cand_s[0], cand_s[1], "start")
                             if (energy and s_ok) else None),
            "end_energy": (gap_energy_at(energy, energy_rule, cand_e[0], cand_e[1], "end")
                           if (energy and e_ok) else None),
        }
        if note:
            row["note"] = note
        out.append(row)
    return out


def rms_windows(pcm: bytes, window_samples: int) -> list:
    """s16le mono PCM → 每满窗 RMS(dBFS) 列表（纯函数，尾部不满一窗丢弃）。"""
    samples = array.array("h")
    usable = len(pcm) - len(pcm) % 2
    samples.frombytes(pcm[:usable])
    out = []
    for w in range(len(samples) // window_samples):
        seg = samples[w * window_samples:(w + 1) * window_samples]
        acc = 0
        for v in seg:
            acc += v * v
        rms = math.sqrt(acc / window_samples)
        db = 20 * math.log10(rms / 32768.0) if rms > 0 else FLOOR_DB
        out.append(round(max(db, FLOOR_DB), 1))
    return out


def compute_energy(video: str, window_ms: int) -> dict:
    """ffmpeg 解码源音频为 s16le mono 16k 管道读入，逐窗算 RMS（外部进程封装）。"""
    win = max(1, int(SAMPLE_RATE * window_ms / 1000))
    bytes_per_win = win * 2
    cmd = ["ffmpeg", "-v", "error", "-i", str(video), "-map", "0:a:0",
           "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    rms = []
    buf = b""
    try:
        while True:
            chunk = proc.stdout.read(1024 * 512)
            if not chunk:
                break
            buf += chunk
            n_full = len(buf) // bytes_per_win
            if not n_full:
                continue
            block, buf = buf[:n_full * bytes_per_win], buf[n_full * bytes_per_win:]
            rms.extend(rms_windows(block, win))
    finally:
        proc.stdout.close()
        proc.wait()
    return {"version": 1, "window_ms": window_ms, "sample_rate": SAMPLE_RATE,
            "windows": len(rms), "rms_db": rms}


def main() -> int:
    ap = argparse.ArgumentParser(description="EDL 切点气口吸附 + RMS 能量互证（规则读 rules.json）")
    ap.add_argument("--edl", required=True, help="EDL JSON 路径")
    ap.add_argument("--asr", required=True, help="词级 ASR JSON 路径（segments 词流）")
    ap.add_argument("--video", default=None, help="源视频路径（现算能量用；有 --energy 缓存可省）")
    ap.add_argument("--energy", default=None, help="能量 JSON 缓存路径（存在则读；不存在且有 --video 则算完写入）")
    ap.add_argument("--apply", action="store_true", help="把吸附成功的坐标回写进输出的 edl 字段")
    ap.add_argument("--rules", default=default_rules_path(), help="rules.json 路径")
    ap.add_argument("--out", default=None, help="输出路径（缺省打到 stdout）")
    args = ap.parse_args()

    with open(args.edl, encoding="utf-8") as f:
        edl = json.load(f)
    with open(args.asr, encoding="utf-8") as f:
        chars = json.load(f).get("segments") or []
    rules = load_rules(args.rules)
    brule = rules["breath_rule"]
    erule = rules["energy_rule"]

    b = breath_boundaries(chars, brule)
    if b is None:
        sys.stderr.write("[error] NO_ASR: 词级 JSON 里 segments 为空，无法找气口\n")
        return 1
    starts, ends = b

    energy = None
    if args.energy and os.path.isfile(args.energy):
        with open(args.energy, encoding="utf-8") as f:
            energy = json.load(f)
    elif args.video and os.path.isfile(args.video):
        energy = compute_energy(args.video, int(erule["window_ms"]))
        if args.energy:
            with open(args.energy, "w", encoding="utf-8") as f:
                json.dump(energy, f, ensure_ascii=False)
            sys.stderr.write("[ok] 能量缓存 → %s（%d 窗）\n" % (args.energy, energy["windows"]))

    clips = edl.get("clips") or []
    rows = snap_clips(clips, starts, ends, brule, energy=energy, energy_rule=erule)
    result = {"clips": rows, "rule": brule, "energy_rule": erule if energy else None}
    if args.apply:
        for c, row in zip(clips, rows):
            if row.get("snapped"):
                c["source_start"], c["source_end"] = row["snapped_start"], row["snapped_end"]
        result["edl"] = {"clips": clips}

    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        sys.stderr.write("[ok] 吸附结果 → %s（%d 段，%d 段有吸附）\n"
                         % (args.out, len(rows), sum(1 for r in rows if r.get("snapped"))))
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

注意 `--apply --out edl_snapped.json` 的输出顶层是吸附报告，回写后的 EDL 在 `edl` 键下；SKILL.md 闸 4 的 `make_captions.py --edl` / `validate_edl.py --edl` 消费的是 `edl_snapped.json` 里的 `edl` 子对象（agent 取出另存，或直接 `python3 -c` 摘出）。实现时在 `--apply` 的 stderr 提示里写明这一点：`sys.stderr.write("[hint] 回写后的 EDL 在输出的 edl 键下\n")`（加进 main 的 apply 分支）。

- [ ] 4. 跑 `python3 -m pytest tools/tests/test_celebrity_slice_snap_breath.py -q` 到全绿；`python3 -m py_compile skills/celebrity-slice/scripts/snap_breath.py`；再对照检查 `breath_boundaries` 与 Task 2 的实现逐字一致（`diff <(sed -n '/^def breath_boundaries/,/^    return starts, ends$/p' skills/celebrity-slice/scripts/snap_breath.py) <(sed -n '/^def breath_boundaries/,/^    return starts, ends$/p' skills/celebrity-slice/scripts/validate_edl.py)` 应为空）。

- [ ] 5. Commit：

```
feat(celebrity-slice): snap_breath.py 气口吸附 CLI + 测试

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---
## Task 4：scripts/make_captions.py（SRT / ASS / karaoke 字幕 + source_map）

**Files:**
- Create: `skills/celebrity-slice/scripts/make_captions.py`
- Test: `tools/tests/test_celebrity_slice_make_captions.py`

**Interfaces:**
- Consumes: 词级 ASR JSON、可选校对稿 JSON（`sentences[].status=="confirmed"` 生效）、可选 EDL JSON（重映射到成片时间轴）、`rules.json` 的 `caption_group_rule`/`caption_styles`/`power_words`。
- Produces: SRT 或 ASS 文本（stdout 或 `--out`）；`--edl` + `--source-map-out` 时另产 `source_map.json`（`[{"id","source_start","source_end","final_start","final_end","selection_reason","selling_point"}]`）。
- CLI：`python3 make_captions.py --asr WORDS.json [--proofread PROOFREAD.json] [--edl EDL.json] --format srt|ass [--style NAME] [--source-map-out MAP.json] [--rules RULES.json] [--out FILE]`
- 纯逻辑核心（测试直接调）：
  - `fmt_srt_time(t: float) -> str` / `fmt_ass_time(t: float) -> str`
  - `sentence_src_chars(sent: dict, chars: list) -> list` / `explode_token_times(src_chars: list) -> list` / `align_texts(src: str, dst: str, src_times: list) -> list` / `align_sentence(sent: dict, chars: list) -> list`
  - `effective_chars(chars: list, doc) -> list`（校对稿传播：confirmed 句用 corrected 对齐字符替换该时间段原始字符）
  - `group_sentences(norm_chars: list, group_rule: dict) -> list` / `caption_blocks(eff: list, group_rule: dict) -> list`
  - `remap_words(eff: list, clips: list) -> tuple`（源时间轴 → 成片时间轴 + source_map）
  - `power_word_spans(text: str, rules: dict) -> list` / `get_caption_style(rules: dict, name: str = "") -> tuple`
  - `ass_header_for(style: dict, play_res) -> str` / `wrap_lines(text: str, max_chars: int) -> str` / `ass_dialogue(start: float, end: float, text: str) -> str` / `karaoke_markup(tokens: list, cur_idx: int, strong_idx: set, style: dict, max_chars: int) -> str`
  - `ass_render(blocks: list, style: dict, play_res, rules: dict) -> str` / `srt_render(blocks: list) -> str`

源码出处：`studio/server.py` 的 `_fmt_srt_time`/`_fmt_ass_time`（:754-761）、`_align_texts`（:489）、`_sentence_src_chars`/`_explode_token_times`/`align_sentence`（:517-557）、`effective_chars`（:583-619）、`_group_sentences`（:313-348）、`_caption_blocks`（:846-870）、`_power_word_spans`（:825）、`ass_header_for`/`_wrap_lines`/`_ass_dialogue`/`_karaoke_markup`/`ass_render`/`build_subtitles`（:802-982）。移植改动：去 pid/文件系统上下文，全部收参数；样式/强调词/聚合参数改读 rules.json；新增 `remap_words`（源→成片时间轴 + source_map，spec §4.6 交付物需要）。**karaoke 实现忠实源码**：块内每个有时长的字各出一条 Dialogue、用 `\c` 换色高亮当前字（supoclip 式逐字高亮，不是传统 `\k` 标签），测试按此断言。

### Steps

- [ ] 1. 写失败测试 `tools/tests/test_celebrity_slice_make_captions.py`：

```python
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "skills" / "celebrity-slice" / "scripts" / "make_captions.py"
SPEC = importlib.util.spec_from_file_location("cs_make_captions", MODULE_PATH)
assert SPEC and SPEC.loader
mc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mc)

RULES = json.loads(
    (ROOT / "skills" / "celebrity-slice" / "references" / "rules.json").read_text(encoding="utf-8")
)
GROUP = RULES["caption_group_rule"]


def chars_of(text, start=0.0, step=0.5):
    return [{"text": ch, "start": round(start + i * step, 3), "end": round(start + (i + 1) * step, 3)}
            for i, ch in enumerate(text)]


class TimeFormatTests(unittest.TestCase):
    def test_srt_time(self):
        self.assertEqual(mc.fmt_srt_time(3723.45), "01:02:03,450")
        self.assertEqual(mc.fmt_srt_time(0.0), "00:00:00,000")

    def test_ass_time(self):
        self.assertEqual(mc.fmt_ass_time(3723.456), "1:02:03.46")
        self.assertEqual(mc.fmt_ass_time(0.0), "0:00:00.00")


class GroupingTests(unittest.TestCase):
    def norm(self, chars):
        return [{"c": c["text"], "start": c["start"], "end": c["end"], "inserted": False}
                for c in chars]

    def test_gap_flush(self):
        a = chars_of("你好", 0.0)
        b = chars_of("再见", 2.0)  # 间隔 1.0 > gap_flush_s 0.55
        sents = mc.group_sentences(self.norm(a + b), GROUP)
        self.assertEqual([s["text"] for s in sents], ["你好", "再见"])

    def test_max_chars_flush(self):
        sents = mc.group_sentences(self.norm(chars_of("字" * 20, 0.0, 0.1)), GROUP)
        self.assertEqual(len(sents[0]["text"]), GROUP["max_chars_flush"])

    def test_punct_flush(self):
        # 标点前 9 字 >= punct_flush_min_chars(8) → 遇「，」flush
        sents = mc.group_sentences(
            self.norm(chars_of("这个面料真的不错，后半句还在继续说", 0.0, 0.1)), GROUP)
        self.assertEqual(sents[0]["text"], "这个面料真的不错，")


class ProofreadPropagationTests(unittest.TestCase):
    def test_confirmed_correction_keeps_timing(self):
        chars = chars_of("白提最怕透", 10.0)
        doc = {"sentences": [{"start": 10.0, "end": 12.5,
                              "original": "白提最怕透", "corrected": "白T最怕透",
                              "status": "confirmed"}]}
        eff = mc.effective_chars(chars, doc)
        self.assertEqual("".join(c["c"] for c in eff), "白T最怕透")
        self.assertAlmostEqual(eff[0]["start"], 10.0, places=3)   # 首字时间不变
        self.assertAlmostEqual(eff[-1]["end"], 12.5, places=3)    # 末字时间不变

    def test_pending_sentence_keeps_original(self):
        chars = chars_of("白提最怕透", 10.0)
        doc = {"sentences": [{"start": 10.0, "end": 12.5,
                              "original": "白提最怕透", "corrected": "白T最怕透",
                              "status": "pending"}]}
        eff = mc.effective_chars(chars, doc)
        self.assertEqual("".join(c["c"] for c in eff), "白提最怕透")

    def test_inserted_punct_is_zero_width(self):
        chars = chars_of("面料很薄", 0.0)
        doc = {"sentences": [{"start": 0.0, "end": 2.0,
                              "original": "面料很薄", "corrected": "面料很薄，",
                              "status": "confirmed"}]}
        eff = mc.effective_chars(chars, doc)
        self.assertTrue(eff[-1]["inserted"])
        self.assertEqual(eff[-1]["start"], eff[-1]["end"])  # 插入标点不占时间


class RemapTests(unittest.TestCase):
    def test_remap_shifts_to_final_timeline(self):
        eff = [{"c": "字", "start": 10.0 + i * 0.5, "end": 10.5 + i * 0.5, "inserted": False}
               for i in range(8)]  # 10.0 - 14.0
        clips = [{"id": "c1", "source_start": 10.0, "source_end": 12.0,
                  "selection_reason": "r", "selling_point": "s"},
                 {"id": "c2", "source_start": 12.0, "source_end": 14.0,
                  "selection_reason": "r", "selling_point": "s"}]
        mapped, source_map = mc.remap_words(eff, clips)
        self.assertAlmostEqual(mapped[0]["start"], 0.0, places=3)
        self.assertEqual(len(mapped), 8)
        self.assertEqual(source_map[1]["final_start"], 2.0)
        self.assertEqual(source_map[1]["source_start"], 12.0)


class RenderTests(unittest.TestCase):
    def blocks(self, text="好的面料自己会说话，", start=0.0):
        eff = [{"c": ch, "start": start + i * 0.3, "end": start + (i + 1) * 0.3,
                "inserted": False} for i, ch in enumerate(text)]
        return mc.caption_blocks(eff, GROUP)

    def test_srt_render_format(self):
        out = mc.srt_render(self.blocks())
        self.assertIn("1\n00:00:00,000 --> ", out)
        self.assertIn("好的面料自己会说话，", out)

    def test_ass_header_from_rules(self):
        style, name = mc.get_caption_style(RULES, "")
        self.assertEqual(name, RULES["caption_styles"]["default_style"])
        header = mc.ass_header_for(style, RULES["caption_styles"]["play_res"])
        self.assertIn("PlayResX: 1080", header)
        self.assertIn("PlayResY: 1920", header)
        self.assertIn("Style: Default,PingFang SC,72", header)

    def test_unknown_style_returns_none(self):
        style, name = mc.get_caption_style(RULES, "nope")
        self.assertIsNone(style)
        self.assertEqual(name, "nope")

    def test_static_ass_one_dialogue_per_block(self):
        style, _ = mc.get_caption_style(RULES, "default")
        blocks = self.blocks()
        out = mc.ass_render(blocks, style, RULES["caption_styles"]["play_res"], RULES)
        self.assertEqual(out.count("Dialogue:"), len(blocks))

    def test_karaoke_one_dialogue_per_timed_char(self):
        style, _ = mc.get_caption_style(RULES, "karaoke")
        blocks = self.blocks("最后三件现货")
        out = mc.ass_render(blocks, style, RULES["caption_styles"]["play_res"], RULES)
        timed = sum(1 for b in blocks for t in b["chars"] if t["end"] - t["start"] > 0.0005)
        self.assertEqual(out.count("Dialogue:"), timed)
        self.assertIn("{\\c" + style["highlight_color"] + "&}", out)   # 当前字高亮色
        self.assertIn("{\\c" + style["strong_color"] + "&}", out)      # power word（最后/现货）强调色

    def test_power_word_spans_from_rules(self):
        spans = mc.power_word_spans("今天到手价368块最后三件", RULES)
        hit = "".join("今天到手价368块最后三件"[a:z] for a, z in sorted(set(spans)))
        self.assertIn("368块", hit)
        self.assertIn("最后", hit)


if __name__ == "__main__":
    unittest.main()
```

- [ ] 2. 跑 `python3 -m pytest tools/tests/test_celebrity_slice_make_captions.py -q`，确认因脚本不存在失败。

- [ ] 3. 写 `skills/celebrity-slice/scripts/make_captions.py` 上半部分（docstring + 时间格式 + 字级对齐 + 校对稿传播 + 聚合 + 重映射）：

```python
#!/usr/bin/env python3
"""词级 ASR + 校对稿 → SRT / ASS（含 karaoke 逐字高亮）字幕；可按 EDL 重映射到成片时间轴。

- 校对稿传播：proofread.json 里 status=="confirmed" 的句子用 corrected 文本 difflib
  对齐到原始字级时间戳（equal 继承原时间、replace 按块内位置继承、insert 零宽锚定、
  delete 只推进锚点），其余时间段保持原始 ASR——只纠错不改写、忠于音频。
- 聚合/样式/强调词全读 ../references/rules.json（caption_group_rule / caption_styles /
  power_words），不硬编码。
- karaoke：字幕块内每个有时长的字各出一条 Dialogue（当前字持续期 = 本字 start →
  下一字 start），当前字 highlight 色、power word 字 strong 色、其余主色；只换色
  不缩放字体（缩放会整行重排抖动）。
- --edl：把源时间轴词流重映射到成片时间轴（按 clip 顺序累加），并可产出溯源
  source_map.json。带 cuts 的 clip 请先按保留区间展开成子段再传入。

用法:
    python3 make_captions.py --asr words.json [--proofread proofread.json] \
        [--edl edl.json] --format srt|ass [--style karaoke] \
        [--source-map-out source_map.json] [--rules rules.json] [--out captions.srt]
"""
import argparse
import difflib
import json
import os
import re
import sys

PUNCT = "。！？?!，,"


def default_rules_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "references", "rules.json")


def load_rules(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fmt_srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return "%02d:%02d:%02d,%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def fmt_ass_time(t: float) -> str:
    cs = int(round(t * 100))
    return "%d:%02d:%02d.%02d" % (cs // 360000, cs // 6000 % 60, cs // 100 % 60, cs % 100)


def sentence_src_chars(sent: dict, chars: list) -> list:
    """取落在句子 [start,end] 时间范围内的 ASR 字符（按字符中点判断）。"""
    s0, e0 = float(sent["start"]), float(sent["end"])
    return [c for c in chars
            if s0 - 0.021 <= (float(c["start"]) + float(c["end"])) / 2 <= e0 + 0.021]


def explode_token_times(src_chars: list) -> list:
    """ASR token 可能是多字符（如 "Hello"）。按 token 时长均分到每个字符，
    保证与 difflib 的字符级 opcodes 一一对应。返回 [(ch, start, end)]。"""
    units = []
    for c in src_chars:
        txt = str(c["text"])
        if not txt:
            continue
        st, en = float(c["start"]), float(c["end"])
        step = (en - st) / len(txt)
        for k, ch in enumerate(txt):
            units.append((ch, st + k * step, st + (k + 1) * step))
    return units


def align_texts(src: str, dst: str, src_times: list) -> list:
    """把 dst 每个字符对齐到 src 的时间戳。src_times: [(start,end)] 与 src 等长。
    返回 [(start, end, inserted)]，与 dst 等长。"""
    out = []
    anchor = src_times[0][0] if src_times else 0.0  # 句首插入锚点
    sm = difflib.SequenceMatcher(a=src, b=dst, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(j2 - j1):
                st, en = src_times[i1 + k]
                out.append((st, en, False))
        elif tag == "replace":
            n_src = i2 - i1
            for k in range(j2 - j1):
                st, en = src_times[i1 + min(k, n_src - 1)]
                out.append((st, en, False))
        elif tag == "insert":
            for _ in range(j2 - j1):
                out.append((anchor, anchor, True))
        if i2 > i1:
            anchor = src_times[i2 - 1][1]
    return out


def align_sentence(sent: dict, chars: list) -> list:
    """把一个校对句的 corrected 文本对齐到字级时间。返回 [{"c","start","end","inserted"}]。"""
    original = str(sent.get("original", ""))
    corrected = str(sent.get("corrected") or original)
    src_chars = sentence_src_chars(sent, chars)
    if not src_chars:
        s0 = round(float(sent.get("start", 0)), 3)
        return [{"c": ch, "start": s0, "end": s0, "inserted": True} for ch in corrected]
    units = explode_token_times(src_chars)
    src_text = "".join(u[0] for u in units)
    src_times = [(round(u[1], 3), round(u[2], 3)) for u in units]
    if original == src_text:
        orig_times = src_times
    else:
        orig_times = [(t[0], t[1]) for t in align_texts(src_text, original, src_times)]
    aligned = align_texts(original, corrected, orig_times)
    return [{"c": ch, "start": round(t[0], 3), "end": round(t[1], 3), "inserted": bool(t[2])}
            for ch, t in zip(corrected, aligned)]


def effective_chars(chars: list, doc) -> list:
    """生效字符流：confirmed 校对句用 corrected 对齐字符替换该时间段的原始 ASR 字符，
    其余保持原始。返回 [{"c","start","end","inserted"}]。"""
    norm = [{"c": str(c["text"]), "start": round(float(c["start"]), 3),
             "end": round(float(c["end"]), 3), "inserted": False} for c in chars]
    if not isinstance(doc, dict) or not isinstance(doc.get("sentences"), list):
        return norm
    conf = [s for s in doc["sentences"]
            if isinstance(s, dict) and s.get("status") == "confirmed"]
    if not conf:
        return norm
    conf.sort(key=lambda s: float(s.get("start", 0)))
    out = []
    i, n = 0, len(chars)

    def mid(c):
        return (float(c["start"]) + float(c["end"])) / 2

    for s in conf:
        try:
            s0, e0 = float(s["start"]), float(s["end"])
        except (KeyError, TypeError, ValueError):
            continue
        while i < n and mid(chars[i]) < s0 - 0.021:
            out.append(norm[i])
            i += 1
        out.extend(align_sentence(s, chars))
        while i < n and mid(chars[i]) <= e0 + 0.021:
            i += 1
    while i < n:
        out.append(norm[i])
        i += 1
    return out


def group_sentences(norm_chars: list, group_rule: dict) -> list:
    """归一化字符 [{"c","start","end","inserted"}] -> 语句。聚合规则读 caption_group_rule：
    间隔 > gap_flush_s 换块；累计字数 >= max_chars_flush，或 >= punct_flush_min_chars
    且当前字是标点时换块。inserted（不占时间）字符不参与间隔判断。"""
    gap_flush = float(group_rule["gap_flush_s"])
    max_chars = int(group_rule["max_chars_flush"])
    punct_min = int(group_rule["punct_flush_min_chars"])
    sentences = []
    current = []

    def flush():
        if not current:
            return
        text = "".join(c["c"] for c in current).strip()
        if text:
            timed = [c for c in current if not c.get("inserted")] or current
            sentences.append({
                "start": round(timed[0]["start"], 3),
                "end": round(timed[-1]["end"], 3),
                "text": text,
                "chars": [{"c": c["c"], "start": round(c["start"], 3),
                           "end": round(c["end"], 3)} for c in current],
            })
        current.clear()

    previous = None
    for c in norm_chars:
        if previous is not None and not c.get("inserted") and (c["start"] - previous["end"] > gap_flush):
            flush()
        current.append(c)
        text = "".join(x["c"] for x in current)
        if len(text) >= max_chars or (len(text) >= punct_min and c["c"] in PUNCT):
            flush()
        if not c.get("inserted"):
            previous = c
    flush()
    return sentences


def caption_blocks(eff: list, group_rule: dict) -> list:
    """生效字符流 → 字幕块 [{"text","start","end","chars"}]。chars 与 text 同步维护
    （karaoke 逐字高亮用；chars 里 end<=start 的为插入标点等零宽字符，不作时间锚）。"""
    blocks = []
    for s in group_sentences(eff, group_rule):
        b = {"text": s["text"], "start": s["start"], "end": s["end"],
             "chars": list(s["chars"])}
        # 纯标点块并入前块，避免零时长字幕
        if blocks and all(ch in PUNCT for ch in b["text"]):
            blocks[-1]["text"] += b["text"]
            blocks[-1]["chars"] += b["chars"]
            blocks[-1]["end"] = max(blocks[-1]["end"], b["end"])
        else:
            # 块首标点跟随前块，字幕不以标点开头
            if blocks:
                lead = ""
                while b["text"] and b["text"][0] in PUNCT:
                    lead += b["text"][0]
                    b["text"] = b["text"][1:]
                    if b["chars"]:
                        blocks[-1]["chars"].append(b["chars"].pop(0))
                if lead:
                    blocks[-1]["text"] += lead
            blocks.append(b)
    return blocks


def remap_words(eff: list, clips: list) -> tuple:
    """按 EDL 把源时间轴生效字符流映射到成片时间轴（clip 定义顺序顺拼）。
    返回 (mapped_eff, source_map)。带 cuts 的 clip 请先展开为保留区间子段。"""
    out, source_map, cursor = [], [], 0.0
    for c in clips:
        s, e = float(c["source_start"]), float(c["source_end"])
        dur = e - s
        shift = cursor - s
        for w in eff:
            m = (float(w["start"]) + float(w["end"])) / 2
            if s - 0.021 <= m <= e + 0.021:
                out.append({"c": w["c"],
                            "start": round(float(w["start"]) + shift, 3),
                            "end": round(float(w["end"]) + shift, 3),
                            "inserted": bool(w.get("inserted"))})
        source_map.append({"id": str(c.get("id", "")),
                           "source_start": round(s, 3), "source_end": round(e, 3),
                           "final_start": round(cursor, 3), "final_end": round(cursor + dur, 3),
                           "selection_reason": str(c.get("selection_reason", "")),
                           "selling_point": str(c.get("selling_point", ""))})
        cursor += dur
    return out, source_map
```

- [ ] 4. 写 `make_captions.py` 下半部分（样式解析 + ASS/SRT 渲染 + main）：

```python
def power_word_spans(text: str, rules: dict) -> list:
    """按 rules.json power_words（声明式）在 text 上找强调词区间 [(i,j))。"""
    pw = rules.get("power_words") or {}
    pats = [p for p in pw.get("regex_patterns", []) if isinstance(p, str)]
    words = [w for w in pw.get("words", []) if isinstance(w, str) and w]
    if words:
        pats.append("|".join(re.escape(w) for w in words))
    spans = []
    for p in pats:
        try:
            for m in re.finditer(p, text):
                if m.end() > m.start():
                    spans.append((m.start(), m.end()))
        except re.error:
            continue
    return spans


def get_caption_style(rules: dict, name: str = ""):
    """返回 (style_dict|None, resolved_name)。name 为空取 default_style。"""
    doc = rules.get("caption_styles") or {}
    name = name or str(doc.get("default_style") or "default")
    st = (doc.get("styles") or {}).get(name)
    if not isinstance(st, dict):
        return None, name
    return dict(st), name


def ass_header_for(style: dict, play_res) -> str:
    try:
        rx, ry = int(play_res[0]), int(play_res[1])
    except (TypeError, ValueError, IndexError):
        rx, ry = 1080, 1920
    return ("[Script Info]\n"
            "ScriptType: v4.00+\n"
            "PlayResX: %s\n"
            "PlayResY: %s\n"
            "\n"
            "[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, "
            "Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV\n"
            "Style: Default,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n"
            "\n"
            "[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            % (rx, ry, style["font"], style["font_size"], style["primary_color"],
               style["outline_color"], style["back_color"], style["bold"], style["outline"],
               style["shadow"], style["alignment"], style["margin_l"], style["margin_r"],
               style["margin_v"]))


def wrap_lines(text: str, max_chars: int) -> str:
    if not max_chars or max_chars <= 0 or len(text) <= max_chars:
        return text
    return "\\N".join(text[i:i + max_chars] for i in range(0, len(text), max_chars))


def ass_dialogue(start: float, end: float, text: str) -> str:
    return "Dialogue: 0,%s,%s,Default,,0,0,0,,%s\n" % (
        fmt_ass_time(start), fmt_ass_time(end), text.replace("\n", " "))


def karaoke_markup(tokens: list, cur_idx: int, strong_idx: set, style: dict,
                   max_chars: int) -> str:
    """块内全文，当前字 highlight 色、power word 字 strong 色、其余主色。
    只换色不缩放字体（缩放会整行重排抖动）。颜色变化处才发 \\c 标签。"""
    primary = style["primary_color"] + "&"
    hi = style.get("highlight_color", primary) + "&"
    strong = style.get("strong_color", primary) + "&"
    parts = []
    cur_color = primary
    count = 0
    for i, tok in enumerate(tokens):
        col = hi if i == cur_idx else (strong if i in strong_idx else primary)
        txt = str(tok["c"]).replace("\n", " ")
        if max_chars and count and count % max_chars == 0:
            parts.append("\\N")
        if col != cur_color:
            parts.append("{\\c%s}" % col)
            cur_color = col
        parts.append(txt)
        count += len(txt)
    return "".join(parts)


def ass_render(blocks: list, style: dict, play_res, rules: dict) -> str:
    lines = [ass_header_for(style, play_res)]
    max_chars = int(style.get("max_chars_per_line") or 0)
    if not style.get("karaoke"):
        for b in blocks:
            lines.append(ass_dialogue(b["start"], b["end"],
                                      wrap_lines(b["text"].replace("\n", " "), max_chars)))
        return "".join(lines)
    # karaoke：块内每个有时长的字各出一条 Dialogue（当前字持续期 = 本字 start → 下一字 start）
    for b in blocks:
        tokens = b.get("chars") or []
        if not tokens:
            lines.append(ass_dialogue(b["start"], b["end"], b["text"]))
            continue
        tok_text = "".join(str(t["c"]) for t in tokens)
        # power word 字符区间 → token 下标（token 可能多字符，如英文词）
        spans = power_word_spans(tok_text, rules)
        strong_idx = set()
        pos = 0
        for i, t in enumerate(tokens):
            tlen = len(str(t["c"]))
            for (a, z) in spans:
                if pos < z and a < pos + tlen:
                    strong_idx.add(i)
                    break
            pos += tlen
        timed = [i for i, t in enumerate(tokens) if t["end"] - t["start"] > 0.0005]
        if not timed:
            lines.append(ass_dialogue(b["start"], b["end"], b["text"]))
            continue
        for k, i in enumerate(timed):
            st = tokens[i]["start"]
            en = tokens[timed[k + 1]]["start"] if k + 1 < len(timed) else b["end"]
            if en - st < 0.001:
                en = st + 0.001
            lines.append(ass_dialogue(st, en,
                                      karaoke_markup(tokens, i, strong_idx, style, max_chars)))
    return "".join(lines)


def srt_render(blocks: list) -> str:
    parts = []
    for i, b in enumerate(blocks):
        parts.append("%d\n%s --> %s\n%s\n" % (
            i + 1, fmt_srt_time(b["start"]), fmt_srt_time(b["end"]), b["text"]))
    return "\n".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description="词级 ASR + 校对稿 → SRT/ASS 字幕（规则读 rules.json）")
    ap.add_argument("--asr", required=True, help="词级 ASR JSON 路径（segments 词流，源时间轴）")
    ap.add_argument("--proofread", default=None, help="校对稿 JSON（status=confirmed 的句子生效）")
    ap.add_argument("--edl", default=None, help="EDL JSON：给了就重映射到成片时间轴")
    ap.add_argument("--format", default="srt", choices=["srt", "ass"])
    ap.add_argument("--style", default="", help="ASS 样式名（rules.json caption_styles.styles，缺省 default_style）")
    ap.add_argument("--source-map-out", default=None, help="溯源 source_map.json 输出路径（需配 --edl）")
    ap.add_argument("--rules", default=default_rules_path(), help="rules.json 路径")
    ap.add_argument("--out", default=None, help="字幕输出路径（缺省打到 stdout）")
    args = ap.parse_args()

    rules = load_rules(args.rules)
    with open(args.asr, encoding="utf-8") as f:
        chars = json.load(f).get("segments") or []
    if not chars:
        sys.stderr.write("[error] NO_ASR: 词级 JSON 里 segments 为空\n")
        return 1
    doc = None
    if args.proofread:
        with open(args.proofread, encoding="utf-8") as f:
            doc = json.load(f)
    eff = effective_chars(chars, doc)

    if args.edl:
        with open(args.edl, encoding="utf-8") as f:
            clips = json.load(f).get("clips") or []
        eff, source_map = remap_words(eff, clips)
        if args.source_map_out:
            with open(args.source_map_out, "w", encoding="utf-8") as f:
                json.dump(source_map, f, ensure_ascii=False, indent=2)
            sys.stderr.write("[ok] 溯源映射 → %s（%d 段）\n" % (args.source_map_out, len(source_map)))
    elif args.source_map_out:
        sys.stderr.write("[error] --source-map-out 需要配合 --edl 使用\n")
        return 1

    blocks = caption_blocks(eff, rules["caption_group_rule"])
    if args.format == "ass":
        style, resolved = get_caption_style(rules, args.style)
        if style is None:
            sys.stderr.write("[error] UNKNOWN_STYLE: %s（可选: %s，见 rules.json caption_styles）\n"
                             % (resolved,
                                "/".join(sorted((rules.get("caption_styles") or {}).get("styles") or {}))))
            return 1
        play_res = (rules.get("caption_styles") or {}).get("play_res") or [1080, 1920]
        content = ass_render(blocks, style, play_res, rules)
    else:
        content = srt_render(blocks)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(content)
        sys.stderr.write("[ok] %d 个字幕块 → %s\n" % (len(blocks), args.out))
    else:
        sys.stdout.write(content)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] 5. 跑 `python3 -m pytest tools/tests/test_celebrity_slice_make_captions.py -q` 到全绿；`python3 -m py_compile skills/celebrity-slice/scripts/make_captions.py`。

- [ ] 6. Commit：

```
feat(celebrity-slice): make_captions.py SRT/ASS/karaoke 字幕 CLI + 测试

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---
## Task 5：scripts/asr_transcribe.py（doubaoya ASR 客户端）

**Files:**
- Create: `skills/celebrity-slice/scripts/asr_transcribe.py`
- Test: `tools/tests/test_celebrity_slice_asr_transcribe.py`

**Interfaces:**
- Consumes: 源视频（ffmpeg 抽音频）、`DOUBAOYA_API_KEY` 环境变量、doubaoya ASR 信封接口（契约 = Task 6 的 asr-api.md；分块限制 base64 ≤10MB/次，参考源项目 mimo-v2-5-asr.md）、`rules.json` 的 `caption_group_rule`（SRT 输出聚合用）。
- Produces: 词级 ASR JSON（Global Constraints 契约：`{"version":1,"source":…,"duration_s":…,"segments":[{"text","start","end"}]}`）+ 可选 SRT。
- CLI：`python3 asr_transcribe.py VIDEO [--language zh] [--chunk-seconds 600] [--endpoint URL] [--rules RULES.json] [--out-json WORDS.json] [--out-srt OUT.srt]`。退出码：0 成功；1 调用/网络失败；2 缺 `DOUBAOYA_API_KEY`（降级路径提示）。
- 纯逻辑核心（测试直接调）：
  - `plan_chunks(duration_s: float, chunk_s: float) -> list`（均匀切块 `[(offset_s, length_s)]`）
  - `merge_words(results: list) -> list`（`[(offset_s, data)]` → 按偏移平移合并的词流）
  - `build_srt(tokens: list, group_rule: dict) -> str` / `fmt_srt_time(t: float) -> str`
  - `_skill_user_agent() -> str`（**逐字用 tools/migrate_user_agent.py 的 HELPER 模板**）
- 外部封装：`probe_duration(path)`（ffprobe）、`extract_chunk(video, offset_s, length_s) -> bytes`（ffmpeg 抽 mono 16k 64kbps mp3）、`encode_chunks(video, offset_s, length_s) -> list`（base64 超限时对半递归再切）、`call_asr(api_key, endpoint, b64, language) -> dict`（urllib，测试用 mock 打桩）。

计费/错误措辞（spec §5 固定）：402 `INSUFFICIENT_CREDITS`（通用 call 路由按次扣点，去充值）；502 `PROVIDER_FAILED`（已自动退款、可安全重试）；404 → 待后端上线 + 降级提示。**不写其他任何退款承诺。**

### Steps

- [ ] 1. 写失败测试 `tools/tests/test_celebrity_slice_asr_transcribe.py`（API 调用 urllib 打桩，分块/合并纯函数直测）：

```python
from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest import mock
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "skills" / "celebrity-slice" / "scripts" / "asr_transcribe.py"
SPEC = importlib.util.spec_from_file_location("cs_asr_transcribe", MODULE_PATH)
assert SPEC and SPEC.loader
at = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(at)

RULES = json.loads(
    (ROOT / "skills" / "celebrity-slice" / "references" / "rules.json").read_text(encoding="utf-8")
)


class PlanChunksTests(unittest.TestCase):
    def test_covers_whole_duration(self):
        chunks = at.plan_chunks(1500.0, 600.0)
        self.assertEqual(chunks, [(0.0, 600.0), (600.0, 600.0), (1200.0, 300.0)])

    def test_short_audio_single_chunk(self):
        self.assertEqual(at.plan_chunks(30.0, 600.0), [(0.0, 30.0)])

    def test_zero_duration_empty(self):
        self.assertEqual(at.plan_chunks(0.0, 600.0), [])


class MergeWordsTests(unittest.TestCase):
    def test_offset_shift_and_sort(self):
        results = [
            (600.0, {"segments": [{"start": 1.0, "end": 2.0, "text": "后",
                                   "words": [{"start": 1.0, "end": 1.5, "text": "后"}]}]}),
            (0.0, {"segments": [{"start": 3.0, "end": 4.0, "text": "前",
                                 "words": [{"start": 3.0, "end": 3.5, "text": "前"}]}]}),
        ]
        tokens = at.merge_words(results)
        self.assertEqual([t["text"] for t in tokens], ["前", "后"])
        self.assertAlmostEqual(tokens[1]["start"], 601.0, places=3)

    def test_segment_without_words_falls_back_to_text(self):
        results = [(10.0, {"segments": [{"start": 0.5, "end": 2.0, "text": "整段"}]})]
        tokens = at.merge_words(results)
        self.assertEqual(tokens, [{"text": "整段", "start": 10.5, "end": 12.0}])


class UserAgentTests(unittest.TestCase):
    def test_falls_back_when_no_version_file(self):
        # .version 由 stamp_versions.py 在发布时生成；仓库里可能有也可能没有
        ua = at._skill_user_agent()
        self.assertTrue(ua == "doubaoya-skill/1.0" or ua.startswith("doubaoya-skill/celebrity-slice@"))


def _fake_response(payload: dict):
    body = json.dumps(payload).encode("utf-8")

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.close()
            return False

    return Resp(body)


class CallAsrTests(unittest.TestCase):
    def test_success_envelope_returns_data(self):
        envelope = {"success": True, "requestId": "r1",
                    "data": {"segments": [{"start": 0.0, "end": 1.0, "text": "喂",
                                           "words": [{"start": 0.0, "end": 1.0, "text": "喂"}]}]},
                    "error": None}
        with mock.patch.object(at.urllib.request, "urlopen", return_value=_fake_response(envelope)) as m:
            data = at.call_asr("dyh_test", at.DEFAULT_ENDPOINT, "QUJD", "zh")
        self.assertEqual(len(data["segments"]), 1)
        req = m.call_args[0][0]
        self.assertEqual(req.get_header("Authorization"), "Bearer dyh_test")

    def _http_error(self, status, code, message):
        body = json.dumps({"success": False, "requestId": "r2", "data": None,
                           "error": {"code": code, "message": message}}).encode("utf-8")
        return urllib.error.HTTPError("u", status, "err", {}, io.BytesIO(body))

    def test_402_prints_credits_message(self):
        err = self._http_error(402, "INSUFFICIENT_CREDITS", "余额不足")
        stderr = io.StringIO()
        with mock.patch.object(at.urllib.request, "urlopen", side_effect=err), \
             mock.patch.object(at.sys, "stderr", stderr):
            with self.assertRaises(SystemExit):
                at.call_asr("dyh_test", at.DEFAULT_ENDPOINT, "QUJD", "zh")
        self.assertIn("INSUFFICIENT_CREDITS", stderr.getvalue())
        self.assertIn("扣点", stderr.getvalue())

    def test_502_prints_refund_retry_message(self):
        err = self._http_error(502, "PROVIDER_FAILED", "上游失败")
        stderr = io.StringIO()
        with mock.patch.object(at.urllib.request, "urlopen", side_effect=err), \
             mock.patch.object(at.sys, "stderr", stderr):
            with self.assertRaises(SystemExit):
                at.call_asr("dyh_test", at.DEFAULT_ENDPOINT, "QUJD", "zh")
        self.assertIn("已自动退款", stderr.getvalue())
        self.assertIn("重试", stderr.getvalue())

    def test_404_prints_not_launched_degradation(self):
        err = self._http_error(404, "NOT_FOUND", "no such api")
        stderr = io.StringIO()
        with mock.patch.object(at.urllib.request, "urlopen", side_effect=err), \
             mock.patch.object(at.sys, "stderr", stderr):
            with self.assertRaises(SystemExit):
                at.call_asr("dyh_test", at.DEFAULT_ENDPOINT, "QUJD", "zh")
        self.assertIn("待后端上线", stderr.getvalue())
        self.assertIn("whisper", stderr.getvalue())


class MissingKeyTests(unittest.TestCase):
    def test_main_exits_2_with_degradation_hint(self):
        stderr = io.StringIO()
        with mock.patch.dict(at.os.environ, {}, clear=True), \
             mock.patch.object(at.sys, "stderr", stderr), \
             mock.patch.object(at.sys, "argv", ["asr_transcribe.py", "fake.mp4"]):
            self.assertEqual(at.main(), 2)
        self.assertIn("DOUBAOYA_API_KEY", stderr.getvalue())
        self.assertIn("whisper", stderr.getvalue())  # 降级路径提示（spec §4.1）


class SrtTests(unittest.TestCase):
    def test_build_srt_groups_and_formats(self):
        tokens = [{"text": ch, "start": i * 0.3, "end": (i + 1) * 0.3}
                  for i, ch in enumerate("这个面料真的不错，后半句还在继续说")]
        srt = at.build_srt(tokens, RULES["caption_group_rule"])
        self.assertTrue(srt.startswith("1\n00:00:00,000 --> "))
        # 标点前 9 字 >= punct_flush_min_chars(8) → 「，」处独立成块
        self.assertIn("\n这个面料真的不错，\n", srt)


if __name__ == "__main__":
    unittest.main()
```

- [ ] 2. 跑 `python3 -m pytest tools/tests/test_celebrity_slice_asr_transcribe.py -q`，确认因脚本不存在失败。

- [ ] 3. 写 `skills/celebrity-slice/scripts/asr_transcribe.py` 上半部分（docstring + `_skill_user_agent` 逐字模板 + 时长探测 + 分块）：

```python
#!/usr/bin/env python3
"""都爆鸭 · 词级 ASR 转写：ffmpeg 抽音频 → ≤10MB 分块 → POST doubaoya ASR 代理 → 合并词级时间戳。

输出：词级 ASR JSON（本 skill 数据契约：segments=[{"text","start","end"}]，源时间轴）
+ 可选参考 SRT（聚合规则读 ../references/rules.json 的 caption_group_rule）。

鉴权：环境变量 DOUBAOYA_API_KEY（doubaoya.com → 登录 → 密钥中心 → 生成密钥）。
密钥只进请求头，绝不打印、绝不写文件。

接口契约见 ../references/asr-api.md。注意：**ASR 代理路由待后端上线**——404 或缺密钥时
本脚本会给出降级路径（用户提供现成 srt/vtt，或本机 whisper 转写后转成本契约 JSON）。

分块：契约限制 base64 音频块 ≤ 10MB/次。音频统一抽成 mono 16kHz 64kbps mp3
（8KB/s，600s 块 ≈ 4.7MB base64，留足余量）；个别块仍超限时对半递归再切。

用法:
    python3 asr_transcribe.py 直播录像.mp4 [--language zh] [--chunk-seconds 600] \
        [--endpoint URL] [--rules rules.json] [--out-json words.json] [--out-srt raw.srt]

退出码：0 成功；1 调用/网络失败；2 缺 DOUBAOYA_API_KEY。
"""
import argparse
import base64
import json
import math
import os
import subprocess
import sys
import urllib.error
import urllib.request

# 后端任务可能改 platform/slug；届时用 --endpoint 或 DOUBAOYA_ASR_ENDPOINT 覆盖（asr-api.md 有说明）
DEFAULT_ENDPOINT = "https://doubaoya.com/api/apis/media/asr/call"
MAX_B64_BYTES = 10 * 1024 * 1024   # 契约：base64 音频块 ≤ 10MB/次
AUDIO_BITRATE_KBPS = 64            # 抽音频码率（mono 16k mp3）


def _skill_user_agent() -> str:
    """读取同目录下 .version 文件里发布时盖的版本戳；没有则退回旧版通用值（向后兼容）。"""
    try:
        version_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".version")
        with open(version_path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        return value or "doubaoya-skill/1.0"
    except OSError:
        return "doubaoya-skill/1.0"


def default_rules_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "references", "rules.json")


def probe_duration(path) -> float:
    """ffprobe 探测媒体时长（秒）；失败直接退出（没有时长无法分块）。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=True)
        return float(out.stdout.strip())
    except (OSError, subprocess.SubprocessError, ValueError):
        sys.stderr.write("[error] FFPROBE_FAILED: 无法探测 %s 的时长（ffprobe 在 PATH 里吗？）\n" % path)
        raise SystemExit(1)


def plan_chunks(duration_s: float, chunk_s: float) -> list:
    """把 [0, duration] 均匀切块。返回 [(offset_s, length_s)]（纯函数）。"""
    if duration_s <= 0:
        return []
    n = max(1, int(math.ceil(duration_s / chunk_s)))
    out = []
    for i in range(n):
        off = i * chunk_s
        out.append((round(off, 3), round(min(chunk_s, duration_s - off), 3)))
    return out


def extract_chunk(video: str, offset_s: float, length_s: float) -> bytes:
    """ffmpeg 抽 [offset, offset+length) 的音频为 mono 16kHz 64kbps mp3 字节流。"""
    cmd = ["ffmpeg", "-v", "error", "-ss", str(offset_s), "-t", str(length_s),
           "-i", str(video), "-vn", "-ac", "1", "-ar", "16000",
           "-b:a", "%dk" % AUDIO_BITRATE_KBPS, "-f", "mp3", "-"]
    try:
        return subprocess.run(cmd, capture_output=True, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        sys.stderr.write("[error] FFMPEG_FAILED: 抽音频失败（offset=%.1fs len=%.1fs）\n"
                         % (offset_s, length_s))
        raise SystemExit(1)


def encode_chunks(video: str, offset_s: float, length_s: float) -> list:
    """抽块并 base64；超 10MB 限制时对半递归再切。返回 [(offset_s, b64)]。"""
    raw = extract_chunk(video, offset_s, length_s)
    b64 = base64.b64encode(raw).decode("ascii")
    if len(b64) <= MAX_B64_BYTES:
        return [(offset_s, b64)]
    if length_s < 10:
        sys.stderr.write("[error] AUDIO_TOO_DENSE: %.1fs 音频块 base64 仍超 10MB，无法继续细分\n"
                         % length_s)
        raise SystemExit(1)
    half = length_s / 2
    return (encode_chunks(video, offset_s, half)
            + encode_chunks(video, offset_s + half, length_s - half))
```

- [ ] 4. 写 `asr_transcribe.py` 下半部分（信封调用 + 错误措辞 + 合并 + SRT + main）：

```python
def call_asr(api_key: str, endpoint: str, b64: str, language: str) -> dict:
    """POST 一个音频块到 doubaoya ASR 信封接口，返回 data（契约见 asr-api.md）。"""
    payload = json.dumps({
        "audio": "data:audio/mpeg;base64," + b64,
        "format": "mp3",
        "language": language,
    }).encode("utf-8")
    request = urllib.request.Request(
        endpoint, data=payload, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + api_key,
                 "User-Agent": _skill_user_agent()})
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raw = b""
        try:
            raw = exc.read()
        except Exception:
            pass
        code, message = "HTTP_%d" % exc.code, exc.reason or "请求失败"
        try:
            err = (json.loads(raw.decode("utf-8")).get("error") or {})
            code = err.get("code", code)
            message = err.get("message", message)
        except Exception:
            pass
        if exc.code == 402 or code == "INSUFFICIENT_CREDITS":
            sys.stderr.write("[error] INSUFFICIENT_CREDITS: 额度不足（本路由按次扣点）"
                             "→ 去 doubaoya.com 充值/续额\n")
        elif exc.code == 502 or code == "PROVIDER_FAILED":
            sys.stderr.write("[error] PROVIDER_FAILED: 上游 ASR 临时故障，已自动退款、"
                             "可安全重试 → 稍后重跑即可\n")
        elif exc.code == 404:
            sys.stderr.write("[error] NOT_FOUND: ASR 代理路由待后端上线（见 references/asr-api.md）。"
                             "降级路径：请用户提供现成 srt/vtt 字幕，或本机 whisper 转写后"
                             "转成词级 JSON 契约\n")
        else:
            sys.stderr.write("[error] %s: %s\n" % (code, message))
        raise SystemExit(1)
    except urllib.error.URLError as exc:
        sys.stderr.write("[error] NETWORK_ERROR: 无法连接 doubaoya.com（%s）\n" % exc.reason)
        raise SystemExit(1)

    try:
        envelope = json.loads(body)
    except json.JSONDecodeError:
        sys.stderr.write("[error] BAD_RESPONSE: 服务端返回非 JSON 内容\n")
        raise SystemExit(1)
    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        sys.stderr.write("[error] %s: %s\n"
                         % (err.get("code", "UNKNOWN"), err.get("message", "请求未成功")))
        raise SystemExit(1)
    if envelope.get("notice"):
        # notice 是本 skill 有更新的提示，原样转达（SKILL.md 末尾约定）
        sys.stderr.write("[notice] %s\n" % envelope["notice"])
    return envelope.get("data") or {}


def merge_words(results: list) -> list:
    """[(offset_s, data)] → 全片词级 token 流（按块偏移平移时间戳，纯函数）。
    data.segments=[{start,end,text,words:[{start,end,text}]}]；无 words 时退化用整段。"""
    tokens = []
    for offset, data in results:
        for seg in (data.get("segments") or []):
            words = seg.get("words") or []
            if words:
                for w in words:
                    tokens.append({"text": str(w.get("text", "")),
                                   "start": round(float(w["start"]) + offset, 3),
                                   "end": round(float(w["end"]) + offset, 3)})
            elif seg.get("text"):
                tokens.append({"text": str(seg["text"]),
                               "start": round(float(seg["start"]) + offset, 3),
                               "end": round(float(seg["end"]) + offset, 3)})
    tokens.sort(key=lambda t: (t["start"], t["end"]))
    return [t for t in tokens if t["text"]]


def fmt_srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return "%02d:%02d:%02d,%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


PUNCT = "。！？?!，,"


def build_srt(tokens: list, group_rule: dict) -> str:
    """词流 → 参考 SRT（校对闸人读用）。聚合规则读 caption_group_rule，与
    make_captions.py 的 group_sentences 同一套参数。"""
    gap_flush = float(group_rule["gap_flush_s"])
    max_chars = int(group_rule["max_chars_flush"])
    punct_min = int(group_rule["punct_flush_min_chars"])
    blocks = []
    current = []

    def flush():
        if not current:
            return
        text = "".join(c["text"] for c in current).strip()
        if text:
            blocks.append({"start": current[0]["start"], "end": current[-1]["end"], "text": text})
        current.clear()

    previous = None
    for c in tokens:
        if previous is not None and (float(c["start"]) - float(previous["end"]) > gap_flush):
            flush()
        current.append(c)
        text = "".join(x["text"] for x in current)
        if len(text) >= max_chars or (len(text) >= punct_min and c["text"] in PUNCT):
            flush()
        previous = c
    flush()
    parts = []
    for i, b in enumerate(blocks):
        parts.append("%d\n%s --> %s\n%s\n" % (
            i + 1, fmt_srt_time(b["start"]), fmt_srt_time(b["end"]), b["text"]))
    return "\n".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description="都爆鸭 · 词级 ASR 转写（分块 → doubaoya 信封 → 合并）")
    ap.add_argument("video", help="源视频/音频路径")
    ap.add_argument("--language", default="zh", choices=["zh", "en", "auto"])
    ap.add_argument("--chunk-seconds", type=float, default=600.0,
                    help="分块长度（秒，默认 600；64kbps 下 ≈ 4.7MB base64）")
    ap.add_argument("--endpoint", default=None,
                    help="覆盖 ASR 信封地址（缺省取环境变量 DOUBAOYA_ASR_ENDPOINT，再缺省用内置默认）")
    ap.add_argument("--rules", default=default_rules_path(), help="rules.json 路径（SRT 聚合用）")
    ap.add_argument("--out-json", default=None, help="词级 JSON 输出路径（默认 <video>.words.json）")
    ap.add_argument("--out-srt", default=None, help="参考 SRT 输出路径（可选）")
    args = ap.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "取钥匙：doubaoya.com → 登录 → 密钥中心 → 生成密钥，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的密钥"\n'
            "降级路径（无密钥/后端未上线时）：提供现成 srt/vtt 字幕，或用本机 whisper\n"
            "转写后转成词级 JSON 契约（见 SKILL.md 第 6 节与 references/asr-api.md）。\n")
        return 2

    endpoint = args.endpoint or os.environ.get("DOUBAOYA_ASR_ENDPOINT") or DEFAULT_ENDPOINT
    duration = probe_duration(args.video)
    results = []
    for offset, length in plan_chunks(duration, args.chunk_seconds):
        for off2, b64 in encode_chunks(args.video, offset, length):
            sys.stderr.write("[..] ASR 块 offset=%.1fs（%.1fKB base64）\n" % (off2, len(b64) / 1024))
            results.append((off2, call_asr(api_key, endpoint, b64, args.language)))

    tokens = merge_words(results)
    if not tokens:
        sys.stderr.write("[error] EMPTY_TRANSCRIPT: 全片没有识别出任何词（纯音乐/静音？）\n")
        return 1

    out_json = args.out_json or (os.path.basename(args.video) + ".words.json")
    doc = {"version": 1, "source": os.path.basename(args.video),
           "duration_s": round(duration, 3), "segments": tokens}
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    sys.stderr.write("[ok] 词级 JSON → %s（%d 个 token）\n" % (out_json, len(tokens)))

    if args.out_srt:
        with open(args.rules, encoding="utf-8") as f:
            group_rule = json.load(f)["caption_group_rule"]
        with open(args.out_srt, "w", encoding="utf-8") as f:
            f.write(build_srt(tokens, group_rule))
        sys.stderr.write("[ok] 参考 SRT → %s\n" % args.out_srt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] 5. 跑 `python3 -m pytest tools/tests/test_celebrity_slice_asr_transcribe.py -q` 到全绿；`python3 -m py_compile skills/celebrity-slice/scripts/asr_transcribe.py`；再核对 `_skill_user_agent` 与 `tools/migrate_user_agent.py` 的 HELPER 模板逐字一致（`python3 - <<'PY'` 里读两个文件比对该函数体，或人工 diff）。

- [ ] 6. Commit：

```
feat(celebrity-slice): asr_transcribe.py doubaoya ASR 客户端 + 测试

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---
## Task 6：references/asr-api.md（ASR 接口契约，兼作后端实现 spec）

**Files:**
- Create: `skills/celebrity-slice/references/asr-api.md`

**Interfaces:**
- Consumes: spec §5（信封路由/请求/响应/鉴权/计费措辞）、源项目 mimo-v2-5-asr.md（分块限制事实）、Task 5 已实现的请求形状（`audio`/`format`/`language` 字段与 `DEFAULT_ENDPOINT`）。
- Produces: 完整接口契约文档——doubaoya 后端 ASR 代理任务照此实现，Task 5 脚本照此调用（两端共读，单一事实源）。

### Steps

- [ ] 1. 写 `skills/celebrity-slice/references/asr-api.md`，完整内容：

````markdown
# doubaoya ASR 代理接口契约

> ⚠️ **待后端上线**：本契约是 celebrity-slice skill 与 doubaoya 后端 ASR 代理路由的
> 共读单一事实源。后端路由**尚未上线**（另起独立任务实现）；上线前调用会返回
> HTTP 404，`scripts/asr_transcribe.py` 会提示降级路径（SKILL.md 第 6 节）。
> 上游 ASR 供应商由后端任务决定，不进本契约。

## 路由

- 信封：`POST https://doubaoya.com/api/apis/media/asr/call`
- `platform/slug`（上面的 `media/asr` 段）以后端任务最终定的为准；若后端定名不同，
  用 `--endpoint` 参数或环境变量 `DOUBAOYA_ASR_ENDPOINT` 覆盖，脚本其余行为不变。
  后端定名后应回改本文件与脚本内置默认值。

## 鉴权

- 请求头 `Authorization: Bearer $DOUBAOYA_API_KEY`（doubaoya.com → 登录 → 密钥中心 → 生成密钥）
- 请求头 `User-Agent`: 脚本经 `_skill_user_agent()` 读 `.version` 版本戳自动带上
- 密钥绝不打印、绝不写文件、绝不回显；只发往 doubaoya.com

## 请求（每个音频块一次调用）

```json
{
  "audio": "data:audio/mpeg;base64,<base64_audio>",
  "format": "mp3",
  "language": "zh"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `audio` | string | base64 data URL。**base64 后 ≤ 10MB/次**（超长音频由客户端分块，见下） |
| `format` | string | `mp3` 或 `wav`（脚本统一抽成 mono 16kHz 64kbps mp3） |
| `language` | string | `zh` / `en` / `auto`，默认 `zh` |

### 分块约定（客户端行为）

- 脚本按 `--chunk-seconds`（默认 600s）均匀切块；64kbps 下 600s ≈ 4.7MB base64，留足余量
- 个别块超 10MB 时对半递归再切
- 每块独立调用；客户端记录每块的源时间偏移 `offset_s`，收到响应后把块内时间戳整体
  平移 `+offset_s` 再合并——**服务端无需感知分块**，每次调用只需返回块内相对时间戳

## 响应（统一信封）

```json
{
  "success": true,
  "requestId": "req_xxx",
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
  "error": null
}
```

- 先看 `success`：`true` 才读 `data`；否则读 `error.code` / `error.message`
- `segments[].words` 是词/字级时间戳（秒，块内相对时间）——**这是本 skill 的核心诉求**，
  后端选型上游供应商时必须保证词级输出；个别 segment 缺 `words` 时客户端退化用整段时间戳
- 顶层可能出现 `notice` 字段（skill 更新提示）：客户端原样转达给用户，不影响本次结果

## 错误码

| HTTP | error.code | 含义 / 处理 |
|------|------------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带密钥或密钥无效 → 检查 `DOUBAOYA_API_KEY`，去密钥中心重生成 |
| 400 | `VALIDATION_ERROR` | 参数不对 → 检查 `audio` base64 / `format` / `language` 取值与 10MB 限制 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足（本路由为通用 call 路由，**按次扣点**）→ 去 doubaoya.com 充值/续额 |
| 404 | `NOT_FOUND` | 路由**待后端上线** → 走 SKILL.md 第 6 节降级路径 |
| 502 | `PROVIDER_FAILED` | 上游 ASR 临时故障，**已自动退款、可安全重试** → 稍后重跑即可 |

计费事实：仅以上两条计费相关措辞（402 扣点、502 自动退款）为准，本契约不承诺任何
其他退款场景。
````

- [ ] 2. 验证：`grep -nE "/(Users|home)/[^/ ]+/" skills/celebrity-slice/references/asr-api.md` 零命中；确认文中请求字段名（`audio`/`format`/`language`）、响应形状（`data.segments[].words`）、默认 endpoint 与 Task 5 的 `asr_transcribe.py` 代码逐字一致。

- [ ] 3. Commit：

```
docs(celebrity-slice): asr-api.md ASR 代理接口契约（待后端上线）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

## Task 7：发布收尾（README + 版本戳 + 全量校验 + 全量测试）

**Files:**
- Modify: `README.md`（技能清单计数 +1、新增一节一行）
- Create（由工具生成，不手写）: `skills/celebrity-slice/.version`、`versions.json`（更新）

**Interfaces:**
- Consumes: Task 1-6 的全部产出。
- Produces: 发布态仓库——`tools/validate_community.py` 全绿、`tools/tests/` pytest 全绿、`.version`/`versions.json` 与内容一致。

### Steps

- [ ] 1. 改 `README.md` 技能清单计数（当前 56 → 57；以实现时 `ls skills/ | wc -l` 实际数为准，validate_community 会对账）：

```markdown
## 技能清单（共 57 个）
```

- [ ] 2. 在 README.md `### 🎬 短剧 · 文旅` 一节**之前**新增一节（行格式必须匹配 validate_community 的 `^\| \*\*([^*]+)\*\*` 正则）：

```markdown
### ✂️ 直播切片

| 技能 | 能力 |
|------|------|
| **celebrity-slice** | 直播录像剪 50-70s 竖版高级种草切片：ASR→校对→选段→气口吸附→字幕烧制→双层 QA（ASR 代理待上线，可降级本机 whisper） |
```

- [ ] 3. 盖版本戳：`python3 tools/stamp_versions.py`——生成 `skills/celebrity-slice/.version` 并更新 `versions.json`（输出应为 `stamped 57 skills -> versions.json`）。

- [ ] 4. 全量校验：`python3 tools/validate_community.py`——必须打印 `validated doubaoya-community: 57 Skills, …`。若 fail：按报错修（常见：README 计数/行格式、frontmatter name 不匹配、意外的开发者路径）。

- [ ] 5. 全量测试：`python3 -m pytest tools/tests/ -q`——既有测试 + 本计划新增 4 个测试文件全绿。

- [ ] 6. 终检三连（发布物卫生）：

```bash
grep -rnE "/(Users|home)/[^/ ]+/" skills/celebrity-slice/ || echo "no developer paths"
grep -rnE "dyh_[A-Za-z0-9]{12,}" skills/celebrity-slice/ || echo "no key strings"
git status --short   # 应只剩本 Task 触碰的文件
```

- [ ] 7. Commit（含 README.md、versions.json、skills/celebrity-slice/.version）：

```
chore(celebrity-slice): README 清单 + 版本戳 + 发布收尾

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

## Spec 覆盖对照（规划自查记录）

| Spec 章节 | 覆盖位置 |
|-----------|----------|
| §1 背景与目标 / 形态 | Goal / Architecture / Global Constraints |
| §1 非目标（不搬 studio/演化/v2、不实现后端路由、零依赖） | Global Constraints；Task 1 methodology 改写规则；Task 6 待上线标注 |
| §2 目录结构 + frontmatter 约定 | Task 1（SKILL.md/references/scripts 布局）+ Task 7（.version） |
| §3 methodology.md 来源与改写 | Task 1 Step 3 |
| §3 rules.json 三源合并 | Task 1 Step 2 |
| §3 asr_transcribe（分块限制 ≤10MB） | Task 5（MAX_B64_BYTES/encode_chunks） |
| §3 make_captions（字级对齐/校对稿传播/SRT/ASS/karaoke） | Task 4 |
| §3 snap_breath（snap_clips + _compute_energy_windows） | Task 3 |
| §3 validate_edl（12 项，阈值读 rules.json） | Task 2 |
| §4 工作流 1-6（五闸 + 降级 + 交付物） | Task 1 Step 4（SKILL.md 第 3、6 节）；source_map 由 Task 4 `remap_words` 落地 |
| §5 ASR 接口契约（信封/10MB/响应形状/鉴权/UA/计费措辞） | Task 6 + Task 5（代码与文档逐字对齐） |
| §6 发布 checklist 1-6 | helper=Task 5、notice=Task 1、README/stamp/validate/pytest=Task 7 |
| §7 裁决记录（机检保留/云端代理优先/后端另起） | Task 2（12 项全保留）；Task 5/6（云端信封 + whisper 降级 + 待上线标注） |

## 计划终检（写完计划后已执行的三项自查）

1. **spec 每节都有对应 Task**：见上表，无遗漏。
2. **无占位符**：全文无 TBD/TODO/"适当处理"/"类似 Task N"；每个代码步骤都有真实代码块；被引用的每个函数（`run_checks`/`snap_clips`/`rms_windows`/`effective_chars`/`remap_words`/`merge_words`/`plan_chunks`/`call_asr`/`build_srt` 等）都在对应 Task 里有完整定义。
3. **跨 Task 一致性**：词级 JSON 契约（`segments=[{"text","start","end"}]`）在 Task 2/3/4/5 的读法一致；`breath_boundaries` 在 Task 2/3 逐字同实现（Task 3 Step 4 有 diff 核对步骤）；rules.json 键名（`breath_rule`/`clean_rule`/`energy_rule`/`caption_group_rule`/`caption_styles`/`power_words`）与 Task 1 Step 2 的 JSON 逐一对应；`asr-api.md` 请求/响应字段与 `asr_transcribe.py` 代码逐字一致（Task 6 Step 2 有核对步骤）；SKILL.md 第 4 节的 CLI 参数表与各脚本 argparse 定义一致。

自查中发现并已当场修复的问题（对测试用例逐一手算移植代码的结果）：

- Task 3 `test_energy_annotation_on_snapped_gap` 原合成能量序列（40 低 + 160 高）算出的 P20/P50 都落在 -10，分类结果是 `mid` 而非断言的 `noisy` → 改为 100 低 + 4 高 + 96 低（只有吸附气口窗高能量），P20/P50 = -60，断言成立。
- Task 4 `test_punct_flush` 原用例「这面料真不错，」标点前仅 7 字 < `punct_flush_min_chars`(8)，不会触发标点 flush，断言必挂 → 换成标点前 9 字的用例。
- Task 5 `SrtTests` 与上同源的弱断言（子串恒真）→ 换成同一 9 字用例并断言独立成块（`\n…，\n`）。

