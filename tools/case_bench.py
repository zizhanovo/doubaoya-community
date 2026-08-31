#!/usr/bin/env python3
"""执行层判定：包被触发之后，产出到底对不对？

与 tools/trigger_bench.py 的分工（spec「两类判据并存且互不替代」）：
  triggers.jsonl 回答「这句话该不该命中本包」——触发层，trigger_bench 管；
  cases.jsonl    回答「本包跑完之后产出对不对」——执行层，本脚本管。
  一个包触发层通过绝不等于执行层通过，反之亦然。

判据来源：各包 `evals/cases.jsonl`，格式见 tools/evals-format.md，每行：
  {"id","prompt","costly":bool,"assertions":[{"kind":"check","cmd":...}|{"kind":"assert","text":...}]}

角色分工（design.md D1，承自官方 skill-creator 的 executor/grader 拆分）：
  executor —— 经 `codex sandbox`（OS 级写隔离，design.md D8）在一次性临时目录里
              执行 prompt；沙箱不可用时拒绝执行，绝不降级裸跑；
              以 `--output-format stream-json` 运行并从事件流验证**本包 skill
              真的被调起**（design.md D9），未调起的那一轮判 unusable——
              否则测的是裸模型不是 skill（首轮真跑实锤过：145 个 skill 的候选集里
              隐式路由不中，而 prompt 自带平台词的用例靠裸模型复述就 grep 全绿）；
  grader   —— check 断言跑命令看退出码（快、确定、免费），
              assert 断言才交模型判定（慢、要钱、会抖——所以能 check 的不许写 assert）。

后端可插拔（design.md D2）：executor 与 grader 各自可选 claude / codex / pi。
grader 默认 pi——`--mode json` 直出结构化结果，且换一个后端来判、不让模型给自己打分。
但三值域校验（pass/fail/unclear）与后端无关，任何 runner 拿不到可信答案都计不可用。

🔴 多轮：默认 --rounds 3，只有每轮判定一致的用例计入判定；跨轮不一致的列为「抖动」，
   既不计通过也不计失败。--rounds 1/2 仍可跑，但输出会标明不构成放行依据。
   与 trigger_bench 同源：本仓实证过模型判定会抖，单轮结论不是证据。

用法：
    python3 tools/case_bench.py --dry                       # 不调模型：自检用例 + 覆盖状态报告
    python3 tools/case_bench.py --skills dby-banned-words   # 只跑这个包
    python3 tools/case_bench.py --rounds 3 --json out.json
    python3 tools/case_bench.py --include-costly            # 连真花钱的用例一起跑

退出码：0 = 跑完（判定结果看输出）；1 = 用例/候选集有问题；2 = 模型调用或前置条件不可用。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import runners  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"

GRADES = ("pass", "fail", "unclear")  # grader 的全部合法取值，一个不多
EXEC_TIMEOUT = 600    # executor 是一整个 agent 会话，会用工具、跑脚本，给足
CHECK_TIMEOUT = 60    # check 是本地命令，卡到一分钟就不是判据是事故
OUTPUT_CAP = 30_000   # grader prompt 里产出的截断上限（字符）

# 「有外部后果」是语义判断，脚本测不出来，人工维护这张表（spec 的四条判据）。
# 加包时对着四条过一遍：会写用户磁盘？改远端状态？产生费用？输出被当合规结论？
EXTERNAL_CONSEQUENCE = {
    "dby-update": "会写用户磁盘（对账并改动本机安装的包）",
    "dby-publish": "会改远端状态（推公众号草稿箱）",
    "dby-banned-words": "输出被用户当作合规结论使用",
}


# ---------------------------------------------------------------- 判据加载

def discover_coverage(skills_dir: Path) -> "list[dict]":
    """扫描 skills/ **全部**包，报告两类判据的有无。
    不做任何过滤——spec 要求缺判据的包必须可见，不许静默跳过。"""
    rows = []
    for skill_md in sorted(skills_dir.glob("*/SKILL.md")):
        d = skill_md.parent
        rows.append({
            "slug": d.name,
            "triggers": (d / "evals" / "triggers.jsonl").exists(),
            "cases": (d / "evals" / "cases.jsonl").exists(),
        })
    return rows


def load_cases(slug: str, skills_dir: Path) -> "list[dict]":
    """读一个包的 cases.jsonl 并严格校验格式——格式错在加载期就炸（exit 1），
    不让烂用例混进判定再以离奇方式失败。"""
    path = skills_dir / slug / "evals" / "cases.jsonl"
    if not path.exists():
        return []
    cases, seen = [], set()
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            raise SystemExit(f"{path}:{i} 不是合法 JSON：{e}")
        cid, prompt = obj.get("id"), obj.get("prompt")
        if not isinstance(cid, str) or not cid or not isinstance(prompt, str) or not prompt:
            raise SystemExit(f'{path}:{i} 格式错：需要非空的 "id" 与 "prompt"，实际 {obj!r}')
        if cid in seen:
            raise SystemExit(f"{path}:{i} id 重复：{cid!r}（报告与基线按 id 归因，必须包内唯一）")
        seen.add(cid)
        costly = obj.get("costly", False)  # 可省略，默认不花钱
        if not isinstance(costly, bool):
            raise SystemExit(f'{path}:{i} "costly" 必须是 bool，实际 {obj["costly"]!r}')
        asserts = obj.get("assertions")
        if not isinstance(asserts, list) or not asserts:
            raise SystemExit(f'{path}:{i} "assertions" 必须是非空数组')
        for j, a in enumerate(asserts):
            if not isinstance(a, dict) or a.get("kind") not in ("check", "assert"):
                raise SystemExit(f'{path}:{i} 断言#{j + 1} 的 "kind" 必须是 check 或 assert')
            key = "cmd" if a["kind"] == "check" else "text"
            if not isinstance(a.get(key), str) or not a[key]:
                raise SystemExit(f'{path}:{i} 断言#{j + 1}（{a["kind"]}）缺非空的 "{key}"')
        cases.append({"id": cid, "prompt": prompt, "costly": costly,
                      "assertions": asserts, "owner": slug, "line": i})
    return cases


# ---------------------------------------------------------------- executor

def sandbox_wrap(cmd: "list[str]") -> "list[str]":
    """把 executor 命令包进 OS 级沙箱（design.md D8，macOS seatbelt，codex 自带）。

    🔴 为什么必须有这一层：`cwd=临时目录` **不是隔离**——cwd 只决定工作目录，
       一个跳过权限门的 agent 照样能用绝对路径写任何位置、执行任意命令、读 ~/.ssh。
       真正的写边界由内核给：workspace-write 下工作区内 `touch ./x` 成功，
       `touch $HOME/x` 被拒（Operation not permitted）——实测确认，不是推测。
       注意 sandbox_mode 必须显式传：默认是 read-only，连 /tmp 都不可写。

    沙箱与 executor 是两件事：executor 默认仍是 claude（fidelity——这些包就是
    给用户在 Claude Code 里用的），只是借 codex 的沙箱能力来约束它的执行。

    🔴 为什么必须显式放开网络（2026-08-31 实测，别删）：默认 workspace-write
       **同时**挡住网络与 Keychain。executor 是个 agent——它要连模型 API，
       凭证又存在 macOS Keychain 里。不放开的实测后果：claude 一起来就是
       `Not logged in · Please run /login`，整批用例 5/5 判不可用。
       加上 network_access=true 后两者一并放开，executor 才跑得通。
       （`$HOME/.claude` 仍不可写，实测不影响 claude -p 运行。）

    因此这层沙箱给的是**文件写入边界**，不是网络边界：agent 能联网，
    但改不了工作区以外的任何文件。这正是这里要防的那一面——防的是
    「跳过权限的 agent 把用户磁盘写花」，不是防它上网。"""
    return ["codex", "sandbox",
            "-c", 'sandbox_mode="workspace-write"',
            "-c", "sandbox_workspace_write.network_access=true",
            "--"] + cmd


def ensure_sandbox_available() -> None:
    """沙箱不可用就拒绝执行并说明原因，🔴 绝不降级成裸跑——
    降级裸跑就是把「隔离靠祈祷」写进代码（design.md D8 的 MUST NOT）。"""
    if sys.platform != "darwin":
        print("🔴 executor 沙箱依赖 macOS seatbelt（codex sandbox），当前平台不可用。"
              "拒绝裸跑；只想自检用例用 --dry。", file=sys.stderr)
        raise SystemExit(2)
    if shutil.which("codex") is None:
        print("🔴 找不到 `codex` CLI——executor 必须经 `codex sandbox` 包裹后执行。"
              "装上 codex 再跑；拒绝裸跑；只想自检用例用 --dry。", file=sys.stderr)
        raise SystemExit(2)


# executor 的事件流解析（design.md D9）。
#
# 🔴 为什么 executor 必须走 `--output-format stream-json` 而不是裸 `-p`（2026-08-31 实测，
#    证据存 tools/tests/fixtures/claude_stream_dby_banned_words.jsonl，别删这段——
#    后人会想改回「只看最终文本」，得让他看见当时的账）：
#    首轮真跑里，裸 `-p` 的判据**分不清「skill 跑了但干得不好」和「skill 压根没跑」**。
#    实测 prompt「这段广告语能直接发全平台吗，帮我查一下：…」跑出来的是模型凭自身
#    广告法知识写的散文——没有三平台比对表、没有命中词清单、没有安全改写文案。
#    追查确认 `.claude/skills` 符号链接正常、仓内 13 个包都在 agent 视野里，但在
#    **总共 145 个 skill** 的候选集里模型就是没挑中 dby-banned-words（候选集一大，
#    隐式路由就退化）。更坏的是当时「通过」的用例：prompt 里自带「小红书、抖音、
#    公众号」三个词，模型复述一遍问题 grep 就绿了——**绿的是假绿**。
#    所以判定器必须从事件流里读**实际发生的工具调用**这个机器事实，
#    而不是靠输出里有没有本包特征文案（钉字面措辞，包一改文案就假红，D9 明确否决）。
#
# 采样确认可用的完整命令（就是 sandbox_wrap 包裹后真跑成功的那条）：
#   codex sandbox -c 'sandbox_mode="workspace-write"' \
#                 -c 'sandbox_workspace_write.network_access=true' -- \
#     claude --dangerously-skip-permissions -p --verbose --output-format stream-json \
#            --model sonnet '<prompt>'
# 其中 --verbose 是 `-p` + stream-json 的配套旗标（采样即带它一次跑通）。
#
# 采到的事件形状（每行一个 JSON 事件）：
#   {"type":"system","subtype":"init", ...}           ← 会话初始化（含 skills 候选清单）
#   {"type":"assistant","message":{"content":[
#       {"type":"tool_use","name":"Skill",
#        "input":{"skill":"dby-banned-words","args":"…"}}, ...]}}   ← skill 被调起的机器事实
#   {"type":"assistant","message":{"content":[
#       {"type":"tool_use","name":"Bash",
#        "input":{"command":"cd …/.claude/skills/dby-banned-words && python3 scripts/…"}}]}}
#   {"type":"result","subtype":"success","is_error":false,"result":"<最终文本>", ...}

def parse_stream_events(stdout: str) -> "list[dict]":
    """把 stream-json 的 stdout 逐行解析成事件列表；解析不动的行跳过。"""
    events = []
    for line in stdout.splitlines():
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


def stream_final_text(events: "list[dict]") -> "str | None":
    """从 result 事件取最终文本（实测：type=result 的事件带 "result" 字段装完整回答）。
    没有 result 事件、或 is_error 为真，都返回 None——拿不到可信产出不编一个。"""
    for ev in reversed(events):
        if ev.get("type") != "result":
            continue
        if ev.get("is_error"):
            return None
        text = ev.get("result")
        return text if isinstance(text, str) else None
    return None


def stream_skill_invoked(events: "list[dict]", slug: str) -> bool:
    """本包 skill 有没有被真的调起来——只认事件流里的**工具调用**，不认输出措辞。

    两条判据（都来自采样到的机器事实，见上方事件形状）：
      1. Skill 工具被调且 input.skill == 本包 slug（实测形状：
         {"name":"Skill","input":{"skill":"dby-banned-words","args":"…"}}）；
      2. 任一工具调用的 input 里出现 `skills/<slug>/` 路径段——覆盖 agent 直接
         Bash/Read 本包脚本的形态（实测 Skill 调起后接的就是
         `cd …/.claude/skills/dby-banned-words && python3 scripts/check_multi.py …`；
         对「用 <slug> 的某某脚本跑一下」类 prompt，agent 也可能不走 Skill 工具
         而直接执行脚本，那同样是在真实使用本包，不该误判成没跑）。"""
    needle = f"skills/{slug}/"
    for ev in events:
        if ev.get("type") != "assistant":
            continue
        content = ev.get("message", {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            inp = block.get("input")
            if block.get("name") == "Skill" and isinstance(inp, dict) \
                    and inp.get("skill") == slug:
                return True
            if inp is not None and needle in json.dumps(inp, ensure_ascii=False):
                return True
    return False


def stream_tool_results(events: "list[dict]") -> str:
    """把事件流里的**工具结果**（type=user 事件中的 tool_result 块）拼成一段文本，
    供 run_case_once 落成 tools.txt（design.md D10）。

    🔴 为什么必须有 tools.txt（2026-08-31 第二轮真跑实测，别删这段）：
       第二轮 3 轮真跑 5/5 全抖，根因是断言打的是 agent 的**自由文本总结**，
       而总结每次措辞都变。同一采样里最终文本 267 字符（摘要）、工具结果 2851 字符
       （脚本真实输出）；原短语「全网最低价」在工具结果里**有**、最终文本里**没有**
       ——agent 的表格把命中词按脚本的 span 粒度写成「全网、最低」。钉摘要就是钉沙子。
       所以 check 断言要打的机器输出在这里：脚本 stdout 原文都在 tool_result 里
       （fixture 里 check_multi.py 的整段 JSON 就是这么回来的）。

    tool_result 的 content 实测有两种形状：字符串（fixture 里就是），或内容块数组
    （通用形状，块里 type=="text" 的取 text）。两种都收，解析不动的原样跳过。"""
    parts: "list[str]" = []
    for ev in events:
        if ev.get("type") != "user":
            continue
        content = ev.get("message", {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            c = block.get("content")
            if isinstance(c, str):
                parts.append(c)
            elif isinstance(c, list):
                for item in c:
                    if isinstance(item, dict) and item.get("type") == "text"                             and isinstance(item.get("text"), str):
                        parts.append(item["text"])
    # 结果之间留分隔行：一条用例往往有多次工具调用（fixture 里是 Skill 展开 + 脚本输出），
    # 粘在一起会让「grep 断言命中的是哪次调用」变得不可读。
    return "\n\n----- tool result -----\n\n".join(parts)


# 「本包 skill 未被调用」的整轮哨兵值（design.md D9：该轮判 unusable，
# 绝不让它走到「断言通过」——否则执行层测的是裸模型，不是 skill）。
SKILL_NOT_INVOKED = "skill_not_invoked"


def execute_prompt(prompt: str, runner: str, model: str, workdir: Path,
                   slug: str) -> "tuple[str, bool, str] | None":
    """executor：在临时目录里、经 OS 沙箱包裹执行一条用例的 prompt，
    返回 (最终文本, 本包 skill 是否被真的调起, 工具结果文本)；executor 本身失败返回 None。

    分工要摆对：临时目录只负责「产物落在哪、不弄脏用户工作区」；
    **隔离**由外层 `codex sandbox` 负责（见 sandbox_wrap 的注释——cwd 不算隔离）。

    为什么 claude 要加 --dangerously-skip-permissions：`-p` 非交互拿不到权限确认，
    不加会卡死在权限门上。这个开关的正当性来自外层沙箱兜底，**不**来自 cwd 是临时目录。

    🔴 目前只支持 claude 做 executor：验证「skill 真的被调用」（design.md D9）依赖
       事件流里的工具调用，而只有 claude 的 stream-json 形状经过实测采样（见上方注释与
       fixture）。codex/pi 想当 executor，先采它们的事件流、加提取器、补 fixture 测试，
       再放开——没验证就放行等于把 D9 的「必须验证」降级成「假定调用了」。
    """
    if runner != "claude":
        print(f"🔴 executor 暂只支持 claude（--runner {runner} 无法验证 skill 是否被调用，"
              "见 design.md D9 与 execute_prompt 注释）。", file=sys.stderr)
        raise SystemExit(2)
    cmd = runners.RUNNERS[runner]["build"](model, prompt)
    cmd = cmd[:1] + ["--dangerously-skip-permissions", "--verbose",
                     "--output-format", "stream-json"] + cmd[1:]
    cmd = sandbox_wrap(cmd)  # 无论哪个 runner，一律经沙箱（design.md D8）
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=EXEC_TIMEOUT, cwd=str(workdir))
    except FileNotFoundError:
        print(f"🔴 找不到 `{cmd[0]}` CLI —— executor 不可用；只想自检用例用 --dry。", file=sys.stderr)
        raise SystemExit(2)
    except subprocess.TimeoutExpired:
        return None
    if p.returncode != 0:
        return None
    events = parse_stream_events(p.stdout)
    text = stream_final_text(events)
    if text is None:
        return None
    return text, stream_skill_invoked(events, slug), stream_tool_results(events)


def _setup_workdir(workdir: Path, skills_dir: Path) -> None:
    """把仓内 skills/ 以项目级 skills 目录的身份挂进临时工作区。

    被测的必须是**仓里这一版**的包，而不是开发机上恰好装着的旧版；
    `.claude/skills` 符号链接让 agent 在 cwd 下发现仓内包——spec 的
    「候选集只取仓内包」在执行层靠它落地。

    已接受的限制（design.md D8）：沙箱的 workspace-write 只限写不限读，
    被测 agent 仍看得见用户级 ~/.claude 下的仓外 skill。这在执行层**不算缺陷**：
    用户的真实环境本来就装着别的 skill，带着它们跑反而更接近真实。
    触发层要干净候选集，是因为它测「在我们这些包之间选谁」；
    执行层测的是「被调用之后干得对不对」，两者要求不同。"""
    (workdir / ".claude").mkdir()
    (workdir / ".claude" / "skills").symlink_to(skills_dir)


# ---------------------------------------------------------------- grader

def truncate_output(text: str, cap: int = OUTPUT_CAP) -> str:
    """grader prompt 不能无限长；超长产出保头保尾、中间截断并注明。
    截断本身也是提示——断言应当锚在可定位的具体细节上，而不是整段泛读。"""
    if len(text) <= cap:
        return text
    half = cap // 2
    return text[:half] + "\n…（产出过长，中间已截断）…\n" + text[-half:]


def build_grader_prompt(output: str, statement: str, tools: "str | None" = None) -> str:
    """grader 的判卷材料分两段（design.md D10）：工具结果（机器输出）+ 最终回答。

    为什么两段都给：实测（2026-08-31 第二轮真跑）同一采样里最终文本 267 字符是摘要、
    工具结果 2851 字符才是脚本真实输出，「全网最低价」只在后者里出现——只给最终文本，
    锚在机器事实上的陈述（如「命中词与脚本输出一致」）就没有判定依据；
    而「解释得对不对」类陈述又必须看最终回答。两段分开标注，让陈述各取所需。"""
    tools_block = ""
    if tools:
        tools_block = (
            "<工具结果开始>（agent 调用工具/脚本得到的机器输出，原样）\n"
            f"{truncate_output(tools)}\n"
            "<工具结果结束>\n\n"
        )
    return (
        "你是判卷人。下面给出一次程序运行的产出（可能含工具结果与最终回答两段），"
        "再给出一条关于它的陈述，判断这条陈述对这次产出是否成立。\n\n"
        f"{tools_block}"
        "<最终回答开始>\n"
        f"{truncate_output(output)}\n"
        "<最终回答结束>\n\n"
        f"陈述：{statement}\n\n"
        "只回答一个词：成立回答 pass；不成立回答 fail；"
        "产出里的信息不足以判定、或陈述本身含糊到无法判定，回答 unclear。"
        "不要解释、不要标点、不要引号。"
    )


def grade_assert(output: str, statement: str, runner: str, model: "str | None",
                 provider: "str | None" = None, meta: "dict | None" = None,
                 tools: "str | None" = None) -> "str | None":
    """assert 断言交 grader 模型判定。返回 pass/fail/unclear；
    拿不到可信答案返回 None（计为不可用，**不编一个**）。

    model=None = 不指定模型、用后端 CLI 自己的默认——对 pi 这是唯一可靠形态
    （实测 `pi --model sonnet` 被解析到无 key 的 amazon-bedrock，直接报错；
    见 tools/runners.py 模块 docstring）。meta 传 dict 时会被写入实际使用的
    provider/model（pi 从 JSON 回报实际值，其余后端记请求值并标明来源）。

    🔴 三值域校验在 runners.ask 里强制：无论后端是结构化通道还是自由文本，
       只认 pass/fail/unclear 三个词，其余（含 CLI 混进 stdout 的诊断行）
       一律不算数——trigger_bench 用注释写死的教训，原样继承（design.md D2）。"""
    return runners.ask(runner, build_grader_prompt(output, statement, tools), model,
                       set(GRADES), provider=provider, meta=meta)


def run_check(cmd: str, cwd: Path) -> str:
    """check 断言：按退出码判定，0 = pass，其余 = fail（design.md D1：能脚本判的绝不交模型）。
    在用例自己的临时目录里跑——output.txt 与产物文件都在那里。"""
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           timeout=CHECK_TIMEOUT, cwd=str(cwd))
    except subprocess.TimeoutExpired:
        return "fail"  # 判据要的是确定性，卡死的命令不能算成立
    return "pass" if p.returncode == 0 else "fail"


# ---------------------------------------------------------------- 单轮与多轮

def run_case_once(case: dict, exec_runner: str, exec_model: "str | None",
                  grader_runner: str, grader_model: "str | None",
                  grader_provider: "str | None", skills_dir: Path,
                  grader_meta: "dict | None" = None) -> "list[dict] | str | None":
    """跑一条用例的一轮：executor 执行 + 逐条断言判定。
    返回逐断言结果列表；executor 本身失败返回 None（整轮不可用）；
    本包 skill 未被调用返回 SKILL_NOT_INVOKED 哨兵（整轮不可用，design.md D9——
    此时产出是裸模型写的，断言判它没有意义，判了反而可能假绿）。"""
    with tempfile.TemporaryDirectory(prefix="case_bench_") as td:
        work = Path(td)
        _setup_workdir(work, skills_dir)
        res = execute_prompt(case["prompt"], exec_runner, exec_model, work, case["owner"])
        if res is None:
            return None
        out, invoked, tools = res
        if not invoked:
            # 🔴 D9：skill 没被调起 ⇒ 该轮 unusable，绝不走到「断言通过」。
            #    首轮真跑的教训：prompt 自带平台词时，裸模型复述问题就能让 grep 全绿。
            return SKILL_NOT_INVOKED
        # 产出落盘，这是 tools/evals-format.md 写定的契约：
        #   output.txt —— agent 的最终文本（摘要，措辞会变）；
        #   tools.txt  —— 事件流里的工具结果（脚本真实输出，机器事实）。
        # 🔴 check 断言应打 tools.txt / 产物文件，不打 output.txt（design.md D10）：
        #    实测最终文本 267 字符 vs 工具结果 2851 字符，「全网最低价」只在后者里，
        #    agent 表格把命中词按脚本粒度写成「全网、最低」——grep 摘要 5/5 全抖。
        (work / "output.txt").write_text(out, encoding="utf-8")
        (work / "tools.txt").write_text(tools, encoding="utf-8")
        results = []
        for a in case["assertions"]:
            if a["kind"] == "check":
                results.append({"kind": "check", "desc": a["cmd"],
                                "result": run_check(a["cmd"], work)})
            else:
                results.append({"kind": "assert", "desc": a["text"],
                                "result": grade_assert(out, a["text"], grader_runner,
                                                       grader_model, provider=grader_provider,
                                                       meta=grader_meta, tools=tools)})
        return results


def case_verdict(assertion_results: "list[dict] | str | None") -> str:
    """一轮的整例判定。优先级有讲究：
      fail 最先——只要有一条断言实锤不成立，整例就是失败，别的噪声掩盖不了它；
      其次 unusable——有断言拿不到可信答案，整例不可用，不编造；
      再次 unclear——断言写得不可判定，是**用例**的缺陷不是包的缺陷（design.md D2）；
      全 pass 才算 pass。
    SKILL_NOT_INVOKED 哨兵（本包 skill 未被调用）同 executor 失败一样判 unusable
    （design.md D9）——那一轮测的是裸模型不是 skill，断言结果无效。"""
    if assertion_results is None or assertion_results == SKILL_NOT_INVOKED:
        return "unusable"
    rs = [r["result"] for r in assertion_results]
    if "fail" in rs:
        return "fail"
    if any(r is None for r in rs):
        return "unusable"
    if "unclear" in rs:
        return "unclear"
    return "pass"


def aggregate_rounds(case: dict, per_round: "list[list[dict] | None]") -> dict:
    """多轮聚合。三档，不是两档（与 trigger_bench 同一套规则）：
    任何一轮不可用 → unusable（不算判对判错，更不算抖动——混进哪档都污染判据）；
    各轮判定不一致 → flaky（抖动，不计通过也不计失败）；
    各轮一致 → stable，判定取该一致值。"""
    verdicts = [case_verdict(r) for r in per_round]
    rec = {"case": case, "verdicts": verdicts, "rounds_detail": per_round}
    if any(v == "unusable" for v in verdicts):
        rec["bucket"] = "unusable"
    elif len(set(verdicts)) > 1:
        rec["bucket"] = "flaky"
    else:
        rec["bucket"] = "stable"
        rec["verdict"] = verdicts[0]
    return rec


# ---------------------------------------------------------------- 报告

def coverage_lines(coverage: "list[dict]") -> "tuple[list[str], list[str], list[str]]":
    """返回（覆盖表、缺口清单、有外部后果但缺执行层判据清单）三段文本。"""
    table, gaps, external = [], [], []
    for row in coverage:
        t = "有" if row["triggers"] else "无"
        c = "有" if row["cases"] else "无"
        table.append(f"  {row['slug']:<20} 触发层 {t}   执行层 {c}")
        missing = []
        if not row["triggers"]:
            missing.append("triggers.jsonl")
        if not row["cases"]:
            missing.append("cases.jsonl")
        if missing:
            gaps.append(f"  {row['slug']}: 缺 {' 与 '.join(missing)}")
        if not row["cases"] and row["slug"] in EXTERNAL_CONSEQUENCE:
            external.append(f"  {row['slug']}: {EXTERNAL_CONSEQUENCE[row['slug']]}")
    return table, gaps, external


def print_coverage_report(coverage: "list[dict]") -> bool:
    """打印覆盖状态；返回是否存在「有外部后果但缺执行层判据」的包。
    存在时整体判定不得报告为全部通过（spec 硬性要求）。"""
    table, gaps, external = coverage_lines(coverage)
    print(f"覆盖状态（skills/ 全部 {len(coverage)} 个包，两类判据互不替代）：")
    for ln in table:
        print(ln)
    if gaps:
        print("\n缺口（缺判据的包不许静默跳过）：")
        for ln in gaps:
            print(ln)
    if external:
        print("\n🔴 有外部后果但缺执行层判据（整体判定不得报告为全部通过）：")
        for ln in external:
            print(ln)
    return bool(external)


def print_case_detail(rec: dict) -> None:
    """逐条归因：一条用例的每条断言各自给结果，指明是哪条不成立/不可判。
    只给整例总体成败是 spec 明令禁止的。"""
    case = rec["case"]
    label = rec.get("verdict", rec["bucket"])
    print(f"  [{case['owner']}:{case['id']}] {label}")
    detail = next((d for d in rec["rounds_detail"] if isinstance(d, list)), None)
    if detail is None:
        if any(d == SKILL_NOT_INVOKED for d in rec["rounds_detail"]):
            print("    （本包 skill 未被调用——产出是裸模型写的，断言未判，design.md D9）")
        else:
            print("    （executor 各轮均失败，无断言结果）")
        return
    for k, r in enumerate(detail, 1):
        shown = r["result"] if r["result"] is not None else "unusable(拿不到可信答案)"
        print(f"    断言#{k} [{r['kind']}] {shown} —— {r['desc']}")


# ---------------------------------------------------------------- 主流程

def main(argv: "list[str] | None" = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skills", help="逗号分隔，只跑这几个包；默认跑所有有 cases.jsonl 的包")
    ap.add_argument("--rounds", type=int, default=3,
                    help="跑几轮（默认 3；少于 3 轮的结果不构成放行依据）")
    ap.add_argument("--dry", action="store_true", help="不调模型，只自检用例并输出覆盖状态报告")
    ap.add_argument("--runner", default="claude", choices=sorted(runners.RUNNERS),
                    help="executor 用哪个后端（默认 claude；真跑目前只支持 claude——"
                         "验证 skill 被调用依赖实测过的 stream-json 事件形状，design.md D9）")
    # 🔴 模型默认值按后端解析（runners.DEFAULT_MODELS），不在这里写死——
    #    "sonnet" 只对 claude 成立；实测 `pi --model sonnet` 被解析到无 key 的
    #    amazon-bedrock 直接报错，pi 必须不传 --model 才用得上它自己的可用默认。
    ap.add_argument("--model", default=None,
                    help="executor 用哪个模型（默认按后端定：claude=sonnet，其余用 CLI 自己的默认）")
    # grader 默认 pi：结构化输出 + 换个后端来判、不让模型给自己打分（design.md D2）
    ap.add_argument("--grader-runner", default="pi", choices=sorted(runners.RUNNERS),
                    help="grader 用哪个后端（默认 pi）")
    ap.add_argument("--grader-model", default=None,
                    help="grader 用哪个模型（默认不指定，用后端 CLI 自己的默认——"
                         "pi 只有这个形态实测可用）")
    ap.add_argument("--grader-provider", default=None,
                    help="grader 后端的 provider（仅 pi 用得上，不传用 pi 自己的默认）")
    ap.add_argument("--include-costly", action="store_true",
                    help="连 costly: true 的用例一起跑（默认跳过并列入「已跳过」）")
    ap.add_argument("--workers", type=int, default=2,
                    help="并发数（默认 2——每条用例是一整个 agent 会话，比触发盲测重得多）")
    ap.add_argument("--json", help="把逐轮原始结果写进这个文件")
    args = ap.parse_args(argv)

    if args.rounds < 1:
        print("🔴 --rounds 至少为 1", file=sys.stderr)
        return 1

    # 模型默认按各自后端解析，绝不跨后端串用（理由见上方 --model 的注释）。
    if args.model is None:
        args.model = runners.DEFAULT_MODELS[args.runner]
    if args.grader_model is None:
        args.grader_model = runners.DEFAULT_MODELS[args.grader_runner]

    coverage = discover_coverage(SKILLS)
    if not coverage:
        print("🔴 skills/ 下没有任何包", file=sys.stderr)
        return 1
    external_gap = print_coverage_report(coverage)

    known = {r["slug"] for r in coverage}
    targets = args.skills.split(",") if args.skills else [r["slug"] for r in coverage if r["cases"]]
    cases: "list[dict]" = []
    for slug in targets:
        if slug not in known:
            print(f"🔴 --skills 里的 {slug} 不是仓内包（候选集只取本仓 skills/）", file=sys.stderr)
            return 1
        c = load_cases(slug, SKILLS)
        if not c:
            print(f"🔴 {slug} 没有 evals/cases.jsonl", file=sys.stderr)
            return 1
        cases.extend(c)

    # costly 门（design.md D6）：默认不跑会花真钱/有不可逆副作用的用例，
    # 被跳过的必须列出来——静默省略是 spec 明令禁止的。
    skipped = [] if args.include_costly else [c for c in cases if c["costly"]]
    runnable = cases if args.include_costly else [c for c in cases if not c["costly"]]

    print(f"\n用例：{len(cases)} 条（可跑 {len(runnable)}，costly 跳过 {len(skipped)}）× {args.rounds} 轮")
    for c in runnable:
        tag = "  [costly]" if c["costly"] else ""
        print(f"  [{c['owner']}:{c['id']}] {len(c['assertions'])} 条断言{tag}")
    if skipped:
        print("\n已跳过（costly: true，默认不执行，--include-costly 才跑）：")
        for c in skipped:
            print(f"  [{c['owner']}:{c['id']}] 会产生外部费用或不可逆副作用")

    if args.dry:
        print("\n--dry：未调用模型。用例格式与覆盖状态自检通过。")
        return 0

    # design.md D8：executor 必须跑在 OS 沙箱里，沙箱不可用直接拒绝，绝不降级裸跑。
    ensure_sandbox_available()

    # design.md D9：验证「skill 真的被调用」只实测了 claude 的 stream-json 事件形状，
    # 其余后端没有经过采样的提取器——没验证就跑等于把「必须验证」降级成「假定调用了」。
    # 在这里整批拒绝（而不是在线程里逐条炸），报错清楚且不烧模型调用。
    if args.runner != "claude":
        print(f"🔴 executor 暂只支持 claude：--runner {args.runner} 拿不到可验证的"
              "工具调用事件流（design.md D9）。要支持它，先采样其事件形状、"
              "加提取器并补 fixture 测试。--dry 不受影响。", file=sys.stderr)
        return 2

    # design.md D7：执行层用例会真实调各包脚本，多数需要 DOUBAOYA_API_KEY。
    # 缺密钥时全部记「未跑」，绝不记通过——「跑不了 ≠ 通过」就落在这里。
    # 用例格式没有逐条声明依赖的字段，分不清哪条真需要密钥，
    # 宁可全标未跑，也不把「因缺密钥而失败」错记成包的失败。
    if not os.environ.get("DOUBAOYA_API_KEY"):
        print("\n🔴 未跑：缺 DOUBAOYA_API_KEY，以下用例本次未执行（未跑 ≠ 通过）：")
        for c in runnable:
            print(f"  [{c['owner']}:{c['id']}]")
        return 2

    print(f"\nexecutor: {args.runner}/{args.model or '(CLI 默认)'}   "
          f"grader: {args.grader_runner}/{args.grader_model or '(CLI 默认)'}   并发 {args.workers}")
    done = [0]
    # grader 实际用到的 provider/model（pi 会在 JSON 里回报实际值，design.md D4：
    # 基线要记实际的尺子，别名/默认漂移了才看得见）。多线程共享一个 dict：
    # 各轮回报的是同一身份，重复覆盖无害。
    grader_meta: "dict" = {}

    def run_round(c):
        r = run_case_once(c, args.runner, args.model, args.grader_runner,
                          args.grader_model, args.grader_provider, SKILLS, grader_meta)
        done[0] += 1
        print(f"\r  {done[0]}/{len(runnable) * args.rounds}", end="", file=sys.stderr)
        return r

    per_case: "list[list]" = [[] for _ in runnable]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for _ in range(args.rounds):
            for i, detail in enumerate(pool.map(run_round, runnable)):
                per_case[i].append(detail)
    print(file=sys.stderr)

    records = [aggregate_rounds(c, rounds) for c, rounds in zip(runnable, per_case)]
    stable = [r for r in records if r["bucket"] == "stable"]
    flaky = [r for r in records if r["bucket"] == "flaky"]
    unusable = [r for r in records if r["bucket"] == "unusable"]
    tally = Counter(r["verdict"] for r in stable)

    # unclear 与 fail 分开计数：unclear 是断言写得不可判定——用例的缺陷，
    # 修法是改断言；fail 才是包的缺陷，修法是改包。混着数会把账记错在包头上。
    print(f"\n稳定 {len(stable)} 条（pass {tally['pass']} / fail {tally['fail']} / "
          f"unclear {tally['unclear']}），抖动 {len(flaky)} 条，不可用 {len(unusable)} 条"
          "（抖动与不可用不计入判定）")

    print("\n逐条归因：")
    for r in records:
        print_case_detail(r)
    if flaky:
        print("\n抖动用例（多跑几轮也定不下来，不计通过也不计失败，别拿它下结论）：")
        for r in flaky:
            print(f"  [{r['case']['owner']}:{r['case']['id']}] 各轮判定 {r['verdicts']}")
    if unusable:
        print("\n不可用用例（executor 失败、本包 skill 未被调用、或断言拿不到可信答案，不编造结果）：")
        for r in unusable:
            tag = ""
            if any(d == SKILL_NOT_INVOKED for d in r["rounds_detail"]):
                tag = "  ← 有轮次本包 skill 未被调用（design.md D9：测的是裸模型，不算数）"
            print(f"  [{r['case']['owner']}:{r['case']['id']}] 各轮判定 {r['verdicts']}{tag}")
        # 与 trigger_bench 同一条实测教训（2026-08-31，8 并发 729 次调用产出 14 条
        # 假性不可用、单独重跑全稳）：成片 unusable 先怀疑并发撞限流，再怀疑包。
        print("  提示：成片的 unusable（且非「skill 未被调用」）多为大并发撞限流/超时——"
              f"建议降低 --workers（本次 {args.workers}）后只对受影响的包重跑。")

    if args.rounds < 3:
        print(f"\n⚠️ 本次只跑了 {args.rounds} 轮（少于 3 轮）：结果不构成放行依据，"
              "只能当线索用。放行判定必须 --rounds 3 起。")
    if external_gap:
        print("\n🔴 整体判定：非全部通过——存在有外部后果但缺执行层判据的包（见上方清单）。")

    if args.json:
        # 身份记录（design.md D4）：model 一栏尽量记**实际**用的模型，
        # model_source 标明来源——"reported" = 后端 JSON 里回报的实测值（pi 有），
        # "requested" = 只拿得到请求值（claude/codex，或 grader 本次没跑过 assert 断言）。
        # 两种来源必须可区分，否则「换了尺子」在基线里看不出来。
        grader_ident = ({"model": grader_meta.get("model"),
                         "provider": grader_meta.get("provider"),
                         "model_source": grader_meta.get("source")}
                        if grader_meta.get("source") == "reported" else
                        {"model": args.grader_model, "provider": args.grader_provider,
                         "model_source": "requested"})
        payload = {
            "rounds": args.rounds,
            # executor 的输出是自由文本，拿不到实际模型 ID，只能记请求值
            "executor": {"runner": args.runner, "model": args.model,
                         "model_source": "requested"},
            "grader": dict(grader_ident, runner=args.grader_runner,
                           model_requested=args.grader_model),
            "coverage": coverage,
            "skipped_costly": [{"owner": c["owner"], "id": c["id"]} for c in skipped],
            "results": [
                {"owner": r["case"]["owner"], "id": r["case"]["id"], "bucket": r["bucket"],
                 "verdict": r.get("verdict"), "verdicts": r["verdicts"],
                 "rounds_detail": r["rounds_detail"]}
                for r in records
            ],
        }
        Path(args.json).write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                                   encoding="utf-8")
        print(f"\n逐轮原始结果 → {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
