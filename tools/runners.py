#!/usr/bin/env python3
"""可插拔判定后端（design.md D2）：一个 runner = 命令模板 + 返回值提取方式，仅此两样。

为什么抽象成这个形状：判定用哪个 agent CLI 跑是**运行时选择，不是架构约束**。
多轮、稳定性、三值域校验这些判定逻辑全在调用方（trigger_bench / case_bench），
与后端无关——新增一个 runner 只需在 RUNNERS 里加一个条目，判定代码一行不动。

方法论上的另一层理由（design.md D2）：grader 与被判定对象用不同后端更可信，
同一个模型自己判自己的产出会偏松。所以 grader 默认走 pi，而 executor 默认走 claude。

🔴 与后端无关的铁律：无论走结构化通道还是自由文本，返回值都必须**校验**落在
   受限取值域（valid）内，拿不到可信答案返回 None（计为不可用），**不编一个**。
   结构化输出也可能是意外形状——校验不许因为通道结构化就取消。
   这条教训源自 trigger_bench.py：CLI 会往 stdout 混诊断行（实测见过
   `Client.listTools() called but server does not advertise tools capability`），
   把最后一行当答案会把噪声记成一次判定、再被多轮比较判成抖动，顶高真实抖动率。

三个后端的非交互调用形态（实机核对过，不是推测）：
    claude  claude -p --model <m> <prompt>
    codex   codex exec [-m <m>] --ephemeral <prompt>
    pi      pi -p --no-session --mode json [--provider <p>] [--model <m>] <prompt>

🔴 模型默认值不许跨后端串用（2026-08-31 实测教训）：
   `pi -p --no-session --mode json --model sonnet "…"` 直接失败，stdout 是非 JSON 的
   纯文本报错「No API key found for amazon-bedrock.」——`sonnet` 这个别名被 pi 解析到
   amazon-bedrock provider，本机没有该 provider 的 key。而**不传** `--model` 时 pi 用
   自己的默认（实测解析为 provider=deepseek, model=deepseek-v4-flash），能正常跑通。
   所以：只有 claude 有可靠的别名默认（sonnet）；pi / codex 不写死默认模型，
   model=None 时命令行里不出现模型参数，让 CLI 用自己的默认。
"""
from __future__ import annotations

import json
import subprocess
import sys
import time

# 各后端「不显式指定时」的默认模型。None = 不给 CLI 传模型参数（用 CLI 自己的默认）。
# 别把 claude 的 "sonnet" 复制给别的后端——见模块 docstring 里 pi 的实测报错。
DEFAULT_MODELS = {"claude": "sonnet", "codex": None, "pi": None}

# 重试的指数退避参数（2026-08-31 实测教训）：首版 --establish 一次跑 243 条触发
# 用例 × 3 轮 = 729 次调用、8 并发、持续 30+ 分钟，dby-charter 的 18 条话术被判出
# 14 条 unusable；随后单独重跑同一包 18/18 稳定、正例 10/10、负例 0/8、零不可用——
# 那 14 条是大并发撞限流/超时的产物，不是包的缺陷。旧实现 tries=2 且失败后立刻
# 重试，瞬时限流两枪都撞在同一堵墙上，被直接记成不可用。
# 现在第 n 次重试前睡 BACKOFF_BASE * 2**(n-1) 秒（2 → 4 → 8…），封顶 BACKOFF_CAP，
# 给瞬时故障一个恢复窗口，把「瞬时限流」和「真正的不可用」区分开。
# 🔴 判据不因此放宽：重试耗尽仍拿不到可信答案，照旧返回 None 计为不可用、不编造——
#    退避只是给瞬时故障一个机会，不是把不可用洗成可用。
BACKOFF_BASE = 2.0
BACKOFF_CAP = 8.0


def _norm(token: str) -> str:
    """把一行输出削成候选 token：去围饰字符、去尾标点。不做更多加工——
    加工越多，越容易把噪声「削成」合法答案，宁可少认不可错认。"""
    return token.strip().strip("`'\"“”。.，, ")


def _match(token: str, valid: set) -> "str | None":
    """token 落在取值域里才算数；顺带容忍大小写（模型爱回 Pass/PASS 这种）。"""
    t = _norm(token)
    if t in valid:
        return t
    if t.lower() in valid:
        return t.lower()
    return None


def _extract_lines(stdout: str, valid: set) -> "str | None":
    """自由文本通道：倒着逐行扫，只认取值域里的 token（claude / codex 用）。

    倒着扫是因为答案按惯例在末尾，但**不假设**它就是最后一行——
    末尾可能是 CLI 自己的诊断输出，见模块 docstring 的铁律。"""
    for line in reversed(stdout.strip().split("\n")):
        hit = _match(line, valid)
        if hit is not None:
            return hit
    return None


def _pi_events(stdout: str) -> "list[dict]":
    """把 pi --mode json 的 stdout 解析成事件列表。

    实测（2026-08-31，`pi -p --no-session --mode json`）：输出是 **JSONL 事件流**，
    每行一个事件（message_update / message_end / turn_end / agent_end …），
    不是单个 JSON 对象。这里逐行解析，整体是单个 JSON 对象的形状也兼容
    （当作只有一行的事件流）；解析不动的行跳过——它们交给自由文本兜底。"""
    events = []
    for line in stdout.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(obj, dict):
            events.append(obj)
    return events


def _pi_final_messages(stdout: str) -> "list[dict]":
    """取出「最终 assistant 消息」：type 为 message_end / turn_end 且
    message.role == "assistant" 的事件里的 message 对象，按出现顺序返回。"""
    out = []
    for ev in _pi_events(stdout):
        if ev.get("type") not in ("message_end", "turn_end"):
            continue
        msg = ev.get("message")
        if isinstance(msg, dict) and msg.get("role") == "assistant":
            out.append(msg)
    return out


def _extract_pi_json(stdout: str, valid: set) -> "str | None":
    """pi --mode json 的结构化通道。

    🔴 结构化通道**只认最终 assistant 消息里 type == "text" 的内容块**
      （message_end / turn_end 事件 → message.content[] → item["type"]=="text" 的
      item["text"]）。绝不从 thinking 块、thinking_end 事件、或任意层级的
      "content" key 里捞——实测（2026-08-31）thinking_end 事件的 "content" 字段装的
      是**思考过程**，旧实现按 key 名深度捞会把它混进候选池；这次没出事只是因为
      思考内容恰好不是合法 token（被取值域校验挡住），是运气不是设计——思考里
      完全可能恰好出现 pass/fail 这样的合法词，届时就是错判。

    结构化 ≠ 免校验：最终仍只认取值域里的 token（design.md D2 写死的铁律，
    不因通道结构化而放宽）。分层退路保留：结构化捞不到 → 退回自由文本扫行
    （pi 报错时 stdout 是非 JSON 纯文本，实测如「No API key found for
    amazon-bedrock.」）→ 仍拿不到返回 None，不编造。"""
    candidates: "list[str]" = []
    for msg in _pi_final_messages(stdout):
        blocks = msg.get("content")
        if not isinstance(blocks, list):
            continue
        for item in blocks:
            if isinstance(item, dict) and item.get("type") == "text" \
                    and isinstance(item.get("text"), str):
                candidates.append(item["text"])
    # 后出现的消息/块更接近最终回答，倒着核验
    for text in reversed(candidates):
        for line in reversed(text.strip().split("\n")):
            hit = _match(line, valid)
            if hit is not None:
                return hit
    # 兜底：当自由文本扫（pi 报错输出、或某些版本 json 模式下混入的裸行）。
    # 注意 JSONL 的原始行本身带花括号，_match 不会把整行事件误认成 token。
    return _extract_lines(stdout, valid)


def _pi_reported_identity(stdout: str) -> "dict | None":
    """从 pi 的 JSON 输出里取**实际使用**的 provider/model（design.md D4 的依据）。

    实测（2026-08-31）：message_end / turn_end 事件的 message 对象直接带
    "provider" 与 "model" 字段（不传 --model 时为 deepseek / deepseek-v4-flash）。
    这是「请求别名 ≠ 实际模型」问题的解——基线记实际值，换了尺子才看得见。
    取最后一条带 model 的 assistant 消息；捞不到返回 None（调用方退回记请求值）。"""
    ident = None
    for msg in _pi_final_messages(stdout):
        model = msg.get("model")
        if isinstance(model, str) and model:
            provider = msg.get("provider")
            ident = {"provider": provider if isinstance(provider, str) else None,
                     "model": model}
    return ident


# 模型参数在三个模板里都是**可选**的：model=None 时不出现在命令行上，
# 让 CLI 用自己的默认。这不是便利，是正确性——见模块 docstring：
# 把 claude 的 "sonnet" 别名传给 pi 会被解析到无 key 的 amazon-bedrock，实测直接报错。

def _cmd_claude(model: "str | None", prompt: str, provider: "str | None" = None) -> "list[str]":
    cmd = ["claude", "-p"]
    if model:
        cmd += ["--model", model]
    return cmd + [prompt]


def _cmd_codex(model: "str | None", prompt: str, provider: "str | None" = None) -> "list[str]":
    cmd = ["codex", "exec"]
    if model:
        cmd += ["-m", model]
    return cmd + ["--ephemeral", prompt]


def _cmd_pi(model: "str | None", prompt: str, provider: "str | None" = None) -> "list[str]":
    cmd = ["pi", "-p", "--no-session", "--mode", "json"]
    if provider:  # provider 是 pi 特有概念，不传就用 pi 自己的默认
        cmd += ["--provider", provider]
    if model:  # 🔴 不传 --model 是 pi 的正确默认形态（实测可跑通），不是缺参数
        cmd += ["--model", model]
    return cmd + [prompt]


# runner 注册表：加新后端只加一行，判定逻辑不改（design.md D2 的验收标准）。
RUNNERS = {
    "claude": {"build": _cmd_claude, "extract": _extract_lines},
    "codex": {"build": _cmd_codex, "extract": _extract_lines},
    "pi": {"build": _cmd_pi, "extract": _extract_pi_json},
}


def observed_identity(runner: str, stdout: str, model: "str | None",
                      provider: "str | None") -> dict:
    """本次调用实际用了哪个 provider/model（design.md D4：换了尺子要能被发现）。

    pi 的 JSON 输出直接回报实际值（见 _pi_reported_identity 的实测依据），
    source 标 "reported"；claude / codex 的输出拿不到实际模型 ID，只能退回记
    **请求值**（可能是 sonnet 这类会随时间漂移的别名），source 标 "requested"。
    🔴 两种来源必须用 source 字段区分开，不许混在一个字段里看不出差别——
    否则基线里一个 "sonnet" 说不清是实测还是请求，D4 的「换尺子可见」就失效。"""
    if runner == "pi":
        ident = _pi_reported_identity(stdout)
        if ident is not None:
            return dict(ident, source="reported")
    return {"provider": provider, "model": model, "source": "requested"}


def ask(runner: str, prompt: str, model: "str | None", valid: set,
        provider: "str | None" = None, tries: int = 3, timeout: int = 120,
        meta: "dict | None" = None) -> "str | None":
    """跑一次后端调用并提取答案。返回落在 valid 里的 token；拿不到可信答案返回 None。

    model=None 表示不指定模型、用后端 CLI 自己的默认（对 pi 这是唯一可靠形态，
    见模块 docstring 的实测）。调用方传入 meta（一个 dict）时，成功提取到答案后
    把实际身份写进去：{"provider","model","source"}，source 见 observed_identity。

    退出语义与 trigger_bench 保持一致：后端 CLI 不存在直接 SystemExit(2)
    （模型调用不可用），调用失败/超时/提取不到答案在 tries 内**带指数退避**重试
    （参数与实测依据见 BACKOFF_BASE / BACKOFF_CAP 的注释：大并发下的瞬时限流
    曾把 14 条好话术记成不可用），重试耗尽仍返回 None、不编造。"""
    r = RUNNERS[runner]
    cmd = r["build"](model, prompt, provider)
    for attempt in range(tries):
        if attempt:
            # 指数退避：2 → 4 → 8…封顶。只睡在重试之间，最后一次失败后不白等。
            time.sleep(min(BACKOFF_BASE * (2 ** (attempt - 1)), BACKOFF_CAP))
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except FileNotFoundError:
            print(f"🔴 找不到 `{cmd[0]}` CLI —— 该 runner 不可用；换 --runner 或只用 --dry。",
                  file=sys.stderr)
            raise SystemExit(2)
        except subprocess.TimeoutExpired:
            continue
        if p.returncode != 0:
            continue
        hit = r["extract"](p.stdout, valid)
        if hit is not None:
            if meta is not None:
                meta.update(observed_identity(runner, p.stdout, model, provider))
            return hit
    return None
