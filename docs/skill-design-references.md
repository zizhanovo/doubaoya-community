# Skill 设计参考：外部实践调研与本仓差距

> 给**维护者**看的，不随包分发。2026-08-20 调研，来源是公开仓库与官方文档。
>
> 调研动机：本仓的「路由 skill / 网关 skill / 业务 skill」三层**只活在散文里**——
> 没有任何一个字段、任何一道闸认识这三层。想知道外面有没有把它做成体系的先例。
>
> 结论先行：**有，但主流的三层切分轴跟我们不一样**；真正值得偷的不是它们的分层，
> 而是它们**把分层变成机器可校验元数据**的那几个机制。

## 目录

- [一、四个成体系的外部样本](#一四个成体系的外部样本)
- [二、五种工作流 Skill 设计模式](#二五种工作流-skill-设计模式)
- [三、官方硬约束（Anthropic best-practices）](#三官方硬约束anthropic-best-practices)
- [四、本仓差距（含实测数字）](#四本仓差距含实测数字)
- [五、可执行的下一步](#五可执行的下一步)
- [六、来源清单](#六来源清单)

---

## 一、四个成体系的外部样本

### 1. `deanpeters/Product-Manager-Skills`：显式三层 + 有向无环依赖

77 个 skill，是我们找到的**唯一一个把三层架构写进文档标题并且带闸**的仓库。

| Tier | 数量 | 特征 |
|---|---|---|
| **Component** | 28 | 自包含的产物模板，**零外部 skill 依赖** |
| **Interactive** | 29 | 多轮问答（问 3–5 个问题），然后调用 Component |
| **Workflow** | 20 | 端到端多阶段流程，引用 Component + Interactive |

铁律一句话：**「上层编排下层，下层永不向上引用」**。这是一个有向无环图，
而不是一句风格建议——它可以被脚本证伪。

真正值得抄的是配套机制：

- `catalog/skills-by-type.md` 由 `scripts/generate-catalog.py` **生成**，不是手抄
- `scripts/check-dist-freshness.py` 是**新鲜度闸**：校验 catalog 的数量与成员、
  每个 skill 恰好一个 dist 产物（无孤儿）、每个声明的 pack、`CATALOG.md` 的覆盖率
- `scripts/build-a-skill.sh` 是建包向导，保证新包一出生就长在模板上
- frontmatter 里有 `theme:` 做主题分组；有 "pack" 做捆绑发行
- 链式 skill 的规矩写死为：**「每一环消费上一环的稳定 schema」**

> 对我们的意义：这条铁律正是「没有任何路径是必经的」的机器可执行版本。
> 见 [四、本仓差距](#四本仓差距含实测数字) 第 ① 条。

### 2. `openai/skills`：三层，但轴是「成熟度」

- `.system/` —— 随 Codex 自动安装（如 `skill-creator`），用户无需动作
- `.curated/` —— 按名字安装，生产级，已审已索引
- `.experimental/` —— 必须给路径或 URL 才装

这一层跟我们无关，但它里面藏着一条**跟我们直接同构**的设计原则：
**导航型 skill 与操作型 skill 分家**——
`cloudflare`（211 行，纯决策树，只做选型不碰操作）
vs `cloudflare-deploy`（224 行，含认证、命令、故障排除）。

那就是我们的 `dby` vs `doubaoya-gateway`。区别只是：人家把它当成一条**写出来的原则**，
我们是碰巧长成了这样。

### 3. Gabe Giro 的 Router Pattern：路由层的成本论证

他有 78 个 slash command，算了一笔账：
每个 skill 的 `name` + `description` **每一轮都注入系统提示词**，
平均 ~40 token × 78 ≈ **3100 token/轮**，100 轮会话 ≈ **31 万 token**，
在干任何活之前就已经花掉了。

两个我们没有的机制：

- **`_` 前缀目录不进 skill 列表**：`p/SKILL.md` 是 dispatcher（只有它每轮加载），
  `_p-template/SKILL.md` 是共享算法，**调用时才读**。12 个包压成 1 个槽位，
  480 token/轮 → 40 token/轮
- **顶级包硬帽 + 月度 `/skill-audit`**：新包必须过一道闸——
  「它能替换现有包吗？能归进现有 router 吗？能收窄到单项目吗？」
  三个都不成立，才配拿一个顶级槽位

他也写了**什么时候不该合并**（这条同样重要）：
早期步骤相同但后续真正分叉的（`/tdd` 与 `/debug` 都从「先读代码」开始，
但一个是 RED-GREEN-REFACTOR、一个是复现-假设-修），合成一个 200 行 if 树反而更糟。
**Router 模式是给「近似克隆」用的，不是给「主题相近」用的。**

### 4. `hussi9/skill-router`：路由的可观测性

路由决策写 `~/.claude/skill_router_log.jsonl`，配 `scripts/audit-dispatch.py`，
跑一周后打分「router 有没有遵守自己的协议」。

> 对我们的意义：我们已经吃过盲测的亏（同一状态跑 3 次，56 条话术里有 7–11 条 pick 会变，
> 判据必须是「6 次稳定全错」）。**路由日志 + 审计脚本比盲测稳得多**——
> 它测的是真实调用，不是模拟采样。

### 顺手记的其他坐标

- `supabase/agent-skills`（2.5k star）：`.claude-plugin/` 打包 + **`test/` 放 skill 的 eval** + release-please 管版本
- `openclaw/clawhub`：skill 注册中心
- `VoltAgent/awesome-agent-skills`：500+ skill 索引
- `agentskills.io`：Agent Skills 开放标准

---

## 二、五种工作流 Skill 设计模式

来源：一篇逐行分析了 7 个顶级 skill 的中文调研（OpenAI / Google Labs / obra /
Trail of Bits / Dean Peters）。模式选择树：

| 模式 | 代表 | 行数 | 什么时候用 |
|---|---|---|---|
| ① 线性流程 | `vercel-deploy` (OpenAI) | 77 | 「先做 A 再做 B 最后 C」能说清 |
| ② 决策树 + 阶梯加载 | `cloudflare-deploy` (OpenAI) | 224 | 知识域有 10+ 分支，每支都有大量文档 |
| ③ 循环迭代 | `test-driven-development` (obra) | 371 | 单次会话内反复「做→验证→改进」 |
| ④ 接力棒循环 | `stitch-loop` (Google Labs) | 203 | **跨会话**推进，文件即状态 |
| ⑤ 多阶段 + 检查点 | `discovery-process` (Dean Peters) | 502 | 跨天/跨周，有阶段划分与 Go/No-Go |
| 特 思维框架 | `audit-context-building` (Trail of Bits) | 302 | 要控制的是「怎么想」而不是「做什么」 |

### 防 LLM 偷懒的四种武器

这四条对我们的「断链」问题直接对症——我们的链断在
「每一跳都被设计成默认不走」，而这四条正是把某一跳变成**必经**的手段：

1. **强硬语气** —— LLM 对命令式语气的服从率显著更高（TDD：「删掉它，重新开始。」）
2. **借口反驳表** —— 预判 LLM 的自我合理化路径并逐条堵死（TDD 列了 12 种借口）
3. **确定阈值** —— 硬性最低标准（审计：「每个函数最少 3 个不变量、5 个假设」）
4. **负面指令** —— 明说「不要做 X」（`vercel-deploy`：「不要用 curl 验证已部署的 URL」）

### Token 预算分层

| 层 | 预算 | 内容 |
|---|---|---|
| frontmatter | ~100 token | `name` + `description`，**每轮白送** |
| SKILL.md 正文 | 2K–5K token | 核心指令、决策树、流程 |
| 单个 reference | 1K–3K token | 按需加载 |
| 单次总占用 | **<10K token** | 主文件 + 1–2 个 reference |

---

## 三、官方硬约束（Anthropic best-practices）

这些不是风格偏好，是会静默出事的硬线：

- **`description` 上限 1024 字符**，超出会被截断，**没有任何地方会报错**
- `description` **必须第三人称**（它被注入系统提示词，人称不一致会影响发现）
- `description` 必须同时写清**做什么**与**什么时候用**
- **SKILL.md 正文 <500 行**，超了就往 references 拆
- **references 只准一层深**：嵌套引用时 agent 可能用 `head -100` 预览而非整读，
  拿到的是**残缺信息**。所有 reference 都要从 SKILL.md 直接链出
- reference 超过 100 行的，**开头放目录**（保证部分读取时也能看见全貌）
- **先写 eval 再写文档**：先在没有 skill 的情况下跑代表性任务、记下失败，
  再建三个测这些缺口的场景，量基线，最后写「刚好够过 eval」的内容
- **别给太多选项**：给一个默认值 + 一个逃生口，不要罗列五个库让 agent 挑
- 命名用动名词（`processing-pdfs`）或名词短语，避开 `helper` / `utils` / `tools`

---

## 四、本仓差距（含实测数字）

先说清楚哪些地方我们**已经领先**：

`doubaoya-gateway` 开头那句「**这是一个基础设施 Skill，它不干活**」
加上那张「本 Skill 管 / 不管」对照表，比调研到的任何一个仓库的边界声明都干净；
「**契约现拉，本地文档只当索引**」比 `openai/skills` 更进一步。这两条不要动。

问题是这三层**只活在散文里**。四个缺口：

### ① 层次不是元数据（最要紧）

11 个包的 frontmatter 里没有任何 `type` / `tier` / `layer` 字段，
所以「谁能引用谁」没有任何一道闸认识。

建议：加 `type: router | gateway | workflow | component`，
在 `tools/validate_community.py` 里加一条**引用方向闸**——
component 不得点名 workflow，任何包不得点名 router
（`dby` 只能被点名，不能反向依赖）。

这正是 deanpeters 那条「下层永不向上引用」的本仓版本，
也是「没有任何路径是必经的」这一根因的机器可执行解。

### ② 索引是手抄的

跟「一份契约真相手抄十处」是同一个病。
deanpeters 的解法可以照抄：**生成 + 新鲜度闸 + 生成物提交进仓**
（`generate-catalog.py` / `check-dist-freshness.py`）。
我们已经有 `known-hashes.json` 与 `tools/stamp_versions.py`，
差的是「目录 / 能力索引也是生成物」这一步。

### ③ 零 skill-level eval

`tools/tests/` 下 7 个 pytest 测的是 tooling，不是 skill 行为。
Anthropic 明确要求 eval 先于文档；`supabase/agent-skills` 有 `test/`。

最低成本起步 = 抄 `hussi9/skill-router` 的路由日志 + 审计脚本，
先让路由准确率有个**数**，而不是靠盲测采样。

### ④ 两个包超了官方红线（2026-08-20 实测）

| 包 | description 字符 | 正文行数 |
|---|---|---|
| `doubaoya` | **949**（上限 1024） | **608**（建议 <500） |
| `wechat-article-pipeline` | 360 | **522**（建议 <500） |
| `dby-charter` | 357 | 348 |
| `doubaoya-gateway` | 352 | 299 |
| `wechat-rewrite` | 286 | 114 |
| `wechat-theme-studio` | 276 | 252 |
| `dby-update` | 269 | 149 |
| `dby` | 224 | 278 |
| `wechat-draft-publish` | 199 | 330 |
| `ai-intelligence-investigator` | 192 | 129 |
| `multi-banned-words` | 110 | 192 |
| **合计 description** | **3574 字符** | —— |

复现命令：

```bash
python3 - <<'EOF'
import re, glob, os, yaml
for f in sorted(glob.glob('skills/*/SKILL.md')):
    t = open(f, encoding='utf-8').read()
    fm = yaml.safe_load(re.match(r'^---\n(.*?)\n---\n', t, re.S).group(1))
    d = re.sub(r'\s+', ' ', fm.get('description') or '').strip()
    print(f"{os.path.basename(os.path.dirname(f)):28s} desc={len(d):5d} lines={len(t.splitlines())}")
EOF
```

🔴 `doubaoya` 的 949 字符**逼近 1024 硬上限**——那条巨型触发词串再加两个词就会被截断，
而截断是静默的。

⚠️ 注意 `validate_community.py` **已经有一道长度闸**，但它盯的是另一条线：
`>250 字符` → 「在旧版宿主上会被砍」。当前 11 个包里有 **7 个**在这条线以上，
于是 949 那一条只是七条告警里的一条，**被自己的噪音淹掉了**。
缺的不是闸，是**那条真正会静默截断的硬红线**（1024）没有任何断言盯着。

---

## 五、可执行的下一步

按性价比排序：

1. **给已有的长度闸补一条硬红线**（分钟级）：`>1024` 直接红（官方硬上限，截断静默），
   `>900` 单独告警。现有的 `>250` 那条降级为提示——它一次报 7 条，
   等于把真正致命的那条埋了。这是唯一一条「不做就会静默出事」的。
2. **frontmatter 加 `type` 字段 + 引用方向闸**（半天）。直接解断链根因。
3. **拆 `doubaoya`**（608 行 → 决策树主文件 + `references/`，按模式②），
   顺手把 949 字符的 description 压到 400 以内。
4. **建一个 `_` 前缀的内部编排包**：不进 skill 列表、不吃共享预算，
   承载「内部必经、只在边界问终态」的创作前半段主干。
   （注意：`flow/pipeline.json` **根本不存在**，主干目前全系统无一处真正写着。）
5. **路由日志 + 审计脚本**，替掉盲测。

⚠️ 第 3、4 条动的是分发面，改完必须走 [`deleting-a-skill.md`](deleting-a-skill.md)
同源的迁词纪律：**改了谁的 description，就要扫谁的触发词有没有掉地上。**

---

## 六、来源清单

官方规范：

- Skill 编写最佳实践 —— https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Agent Skills 概览 —— https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Agent Skills 开放标准 —— https://agentskills.io/specification

仓库：

- `deanpeters/Product-Manager-Skills` —— https://github.com/deanpeters/Product-Manager-Skills （三层架构 + 生成式 catalog + 新鲜度闸）
- `openai/skills` —— https://github.com/openai/skills （成熟度三层；导航型 vs 操作型）
- `obra/superpowers` —— https://github.com/obra/superpowers （循环迭代模式；meta-router）
- `google-labs-code/stitch-skills` —— https://github.com/google-labs-code/stitch-skills （接力棒模式）
- `trailofbits/skills` —— https://github.com/trailofbits/skills （思维框架模式）
- `supabase/agent-skills` —— https://github.com/supabase/agent-skills （plugin 打包 + skill eval）
- `hussi9/skill-router` —— https://github.com/hussi9/skill-router （路由日志 + 审计）
- `VoltAgent/awesome-agent-skills` —— https://github.com/VoltAgent/awesome-agent-skills （500+ 索引）

文章：

- The Claude Code Router Pattern —— https://gabegiro.com/blog/claude-code-router-pattern/
- 工作流程技能怎么写？从 7 个精品项目中提炼的模式与最佳实践 —— https://www.cnblogs.com/OBCE666/articles/19953890
