# skill 质量门

判定各包「该不该被触发」和「被触发之后干得对不对」，并让「这一版比上一版差了」成为**可被发现的事实**，而不是靠人记。

判据格式见 [`evals-format.md`](evals-format.md)。行为契约见 openspec change `skill-quality-gate` 的 spec。

---

## 三层判据，互不替代（design.md D10）

| 层 | 放哪 | 回答什么 | 判定器 | 成本 |
|---|---|---|---|---|
| 脚本层 | `tools/tests/` 的 pytest + 包内 `scripts/*.selfcheck.mjs` | 各包脚本自身的确定性行为对不对（违禁词透传、限额校验、主题安全、渲染保真、出图参数校验…） | pytest / node | 免费、秒级、零抖动 |
| 触发层 | `skills/<slug>/evals/triggers.jsonl` | 这句话该不该命中本包 | `trigger_bench.py` | 短 prompt，便宜 |
| agent 执行层 | `skills/<slug>/evals/cases.jsonl` | 包被调起之后，agent 编排得对不对（选对脚本、参数拼对、结果解释对） | `case_bench.py` | 贵（3 轮沙箱 agent 会话），所以要少 |

**一个包触发层通过，绝不等于执行层也通过。** 违禁词检测触发判对了、却漏检了违禁词，照样出事——这正是执行层存在的理由。

🔴 **能在脚本层测的，不许拿到 agent 层测。** 这是 2026-08-31 第二轮真跑用 5/5 全抖
换来的规则：拿 3 轮沙箱 agent 会话测一个确定性脚本，是用最贵、最抖的手段测最确定的
东西。执行层因此三次返工（沙箱没开网 → skill 没被调起 → 判据打错对象）。现在的分工
是刻意的：一个便宜且稳的宽覆盖（脚本层），加一个昂贵但精准的窄覆盖（agent 层只测
编排），好过一个又贵又抖的中覆盖。

🔴 **agent 层的 check 断言打 `tools.txt`（工具结果）或产物文件，不打 agent 摘要。**
判定器把事件流里的工具结果落成 `tools.txt`、最终文本落成 `output.txt`。实测同一采样里
最终文本 267 字符是摘要、工具结果 2851 字符才是脚本真实输出，「全网最低价」只在后者里
（agent 表格把命中词按脚本的 span 粒度写成「全网、最低」）——grep 摘要就是钉沙子。
断言写法与完整示例见 [`evals-format.md`](evals-format.md)。

---

## 为什么不挂 pre-push

`.githooks/pre-push` 里已经论证过一条原则：**只放一条、跑 0.1 秒、零假阳性的闸**。因为阻塞式闸一旦慢或吵，第二次就有人 `--no-verify`，第三次成肌肉记忆，然后真该拦的那天它也被跳过。

质量门要调模型：慢、要钱、会因为网络或额度不可用。它正是那条原则点名要挡在外面的东西。所以它**不挂 pre-push**，改为两段式：

```
本地（慢、要模型）           CI（快、纯离线）
release_gate.py       →      check_baseline.py
跑判定、比对、写基线          只查基线里有没有这个哈希的记录
```

昂贵会抖的那半留在本地由发布者主动跑；CI 那半只读本仓文件，不调模型、不配密钥、不联网，因此**零假阳性**。而「没跑质量门就不许发版」照样强制得住——CI 查不到记录就中止。

---

## 发版命令序列

```bash
# 1. 看一眼当前各包对基线的覆盖状态（不调模型，随时可跑）
python3 tools/release_gate.py --dry

# 2. 跑质量门：脚本层（免费，先跑）→ 触发层 + 执行层（要模型）→ 比对基线 + 更新基线
#    脚本层 = pytest tools/tests + 各包 scripts/*.selfcheck.mjs；
#    🔴 脚本层红时门在**跑任何模型调用之前**就中止——确定性行为坏了还烧钱跑 agent 层
#    是花钱确认已知事实。也可单独先跑：python3 -m pytest tools/tests/ -q
python3 tools/release_gate.py

# 3. 盖版本戳、重算哈希闭集（改过 skills/ 才需要）
python3 tools/stamp_versions.py && python3 tools/build_known_hashes.py

# 4. 提交，基线文件必须一起进这次提交
git add evals/baseline.json index.json known-hashes.json versions.json skills/
git commit

# 5. 打 tag 推双远端，CI 会跑离线校验
```

第 2 步报退步会 exit 1 并逐条列出。要么修，要么显式接受：

```bash
python3 tools/release_gate.py \
  --accept-regression dby-banned-words:known-word-miss \
  --reason "上游词表临时缺失，下版修"
```

**接受退步必须给 `--reason`**，不给会在跑任何判定之前就被拒。理由随被接受条目写进基线，随 diff 可见、可回溯。这挡不住铁了心的人，但让「悄悄接受」变成留痕的动作。

---

## 首次建立基线

没有上一版可比时，用 `--establish` 只跑判定并写入，不做退步判定：

```bash
python3 tools/release_gate.py --establish
```

🔴 **建完必须人工过一遍。** 首版基线若把当前的失败项一起锁进去，之后就再也发现不了它们——它们会永远表现为「与基线一致」。失败项要么修，要么用 `--accept-regression` 显式标注并写理由。

🔴 **`evals/baseline.json` 必须先于第一个 `release-*` tag 提交。** CI 的离线校验查不到记录就中止发版，这是设计如此，但顺序错了会把自己锁在门外。

---

## 换了 runner 或模型

基线条目的键是 **(包内容哈希 × runner × 模型)**，执行层还额外含 grader 的 runner 与模型。

`claude` 判出来的和 `pi` 判出来的不是同一把尺子。换任意一项，比对会直接报**「基线不可比」**，不输出退步或改进结论——避免把「换了尺子」误读成「质量退步」。此时需要在新配置下重建基线：

```bash
python3 tools/release_gate.py --establish --runner codex --model gpt-5
```

后端可选 `claude` / `codex` / `pi`。grader 默认用 `pi`：`--mode json` 直出结构化结果，不用再从自由文本里捞答案。**grader 与被判定对象用不同后端更可信**——同一个模型既产出又判定自己的产出，判定会偏松。

⚠️ 但**执行层的 executor 目前只支持 `claude`**（design.md D9）：判定器要从
`--output-format stream-json` 事件流里验证「本包 skill 真的被调用」，而只有 claude
的事件形状经过实测采样。上面示例里的 `--runner codex` 会让触发层照跑、执行层
（case_bench）明确拒绝并说明原因。要放开其它后端，先采样其事件流、加提取器、补
fixture 测试。

---

## 几条不许绕过的红线

- **executor 必须跑在 `codex sandbox` 里**（macOS seatbelt，workspace-write）。临时目录**不是**隔离：cwd 只决定工作目录，跳过权限门的 agent 照样能用绝对路径写任何位置、读 `~/.ssh`。沙箱不可用时判定器**拒绝执行**，没有降级裸跑的分支。
- **跑不了 ≠ 通过。** 缺 `DOUBAOYA_API_KEY`、缺沙箱、模型不可用，一律记「未跑」并列出，绝不记为通过，也不覆盖基线里已有的历史结果。
- **单轮不构成证据。** 默认 3 轮，只有每轮结果一致的用例才计入放行或回滚；跨轮不一致的列为「抖动」，单独列出、不作依据。
- **`unclear` 是用例的缺陷，不是包的缺陷。** 出现 `unclear` 说明那条断言写得不可判定——改断言，不是改包。
- **能写成 `check` 的不许写成 `assert`。** 脚本可判的东西交给模型判，既慢又贵还引入噪声。
- **能在脚本层测的不许拿到 agent 层测。** 上一条往上抬一层（design.md D10）：确定性
  脚本行为下沉到 pytest / `*.selfcheck.mjs`，agent 层只留编排类用例。
- **check 打 `tools.txt` / 产物文件，不打 `output.txt`。** agent 摘要的措辞每轮都变，
  机器事实在工具结果里（实测：原短语只在工具结果里、摘要里没有）。

---

## 有外部后果的包必须有执行层判据

会写用户磁盘、会改远端状态、会产生费用、或输出会被用户当作合规结论使用的包，**必须**有 `cases.jsonl`。缺了会在判定报告里作为缺口显式列出，且整体判定不会报告为全部通过。

`case_bench.py` 每次运行都会扫全部包并报告两类判据的覆盖状态，没有判据的包不会被静默跳过。
