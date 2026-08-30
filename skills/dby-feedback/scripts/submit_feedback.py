#!/usr/bin/env python3
"""都爆鸭 · 反馈提交脚本（零依赖，仅用 Python 3 标准库）。

流程分两步，中间隔着「用户过目」这道人工闸：

    1. prepare：按白名单采集机器事实 + agent 写好的报告 → 拼成待发送载荷，
       过一遍凭证/高熵检测，把**最终要发出去的那份**逐字节写进 --out 并打印到 stdout。
       agent 把 stdout 原样呈现给用户过目——呈现的就是要发的，不是摘要。
    2. send：用户明确同意后（--user-consented），把 --out 那份文件**原样**POST 出去。
       发送前再过一遍检测（双闸的机器侧）。端点不通或未配置 → 落本地 markdown，
       给出绝对路径与手动送达方式，退出码非 0，绝不丢弃已写好的反馈。

用法：
    python3 submit_feedback.py prepare --category bug|friction|idea --report <md> --out <payload.json>
                               [--scope-root DIR] [--agent NAME] [--command "退出码:命令"]...
    python3 submit_feedback.py send --payload <payload.json> --user-consented [--scope-root DIR]
    python3 submit_feedback.py keep --payload <payload.json> [--scope-root DIR]   # 用户不发、要留底
    python3 submit_feedback.py reset-id [--scope-root DIR]                        # 重置安装标识
    python3 submit_feedback.py --selfcheck                                        # 离线自检，不联网

隐私红线（与 SKILL.md、references/report-protocol.md 同一契约）：
  - 机器事实**只采白名单字段**（下面的显式常量是唯一事实源）；同一文件里的白名单外字段
    根本不进内存中的待发送结构，不是发送前再删。
  - 检测命中时不发送、不打印命中内容本身——只报位置与规则名（密钥一个字符都不进日志）。
  - 未拿到 --user-consented（用户拒绝、无回应都算未同意）绝不发送。

退出码：0 = 成功；2 = 发送失败已落本地文件；3 = 检测命中；4 = 未取得用户同意；1 = 参数/环境错误。
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from math import log2

# ---------------------------------------------------------------- 采集白名单（隐私的地基）
# 🔴 机器事实的允许清单——**这里是唯一事实源**，采集代码只按这几张表取字段。
# 清单之外的任何键（appid、author、publicAccountName、targetAccount、ipProfile、
# 用户正文、号章程、创作 DNA、任何凭证）即使出现在被读的文件里，也不进内存中的待发送结构。
# tools/validate_community.py 的采集白名单闸会核对这些常量里没有已知敏感字段名。
ORIGIN_FIELD_WHITELIST = ("slug", "version", "hash", "ref", "installedAt")
# lock 的 per-skill 条目里 pinReason 是用户手写的自由文本，**故意不在清单里**。
LOCK_FIELD_WHITELIST = ("version", "hash", "installedAt", "pinned")
# 运行环境事实：Node 版本、操作系统、agent 类型、本次执行过的本仓命令与退出码。
RUNTIME_FACT_WHITELIST = ("node", "os", "agentType", "commands")

CATEGORIES = ("bug", "friction", "idea")

# ---------------------------------------------------------------- 凭证 / 高熵检测（双闸的机器侧）
# 判据参考 gitleaks / TruffleHog 的已知密钥形状 + 高熵串，落成本仓自己的规则表。
# 扫描面是**全部待发送内容**（含 agent 写的正文——自然语言叙述恰恰最可能夹带密钥）。
SECRET_RULES = (
    # dyh_ 真钥匙：后跟 12+ 位含数字的字母数字串；占位符（dyh_… / dyh_xxx）天然不命中。
    ("doubaoya-key", re.compile(r"\bdyh_(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{12,}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("github-pat", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("openai-style-key", re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b")),
    ("private-key-block", re.compile("-----BEGIN " + "[A-Z0-9 ]*" + "PRIVATE KEY-----")),
    ("bearer-header", re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{16,}")),
)
# 高熵串：长于 24 的连续 token，香农熵超过阈值就当疑似凭证。
# 纯十六进制（本包自己的安装标识、12 位包哈希）熵上限 4.0 bits/char，天然低于阈值。
ENTROPY_TOKEN = re.compile(r"[A-Za-z0-9+/=_\-]{24,}")
ENTROPY_THRESHOLD = 4.2


def _entropy_bits_per_char(token: str) -> float:
    counts: dict[str, int] = {}
    for ch in token:
        counts[ch] = counts.get(ch, 0) + 1
    n = len(token)
    return -sum((c / n) * log2(c / n) for c in counts.values())


def scan_secrets(text: str) -> list[dict]:
    """返回命中列表，每项只含规则名与位置（行、列、长度）——**绝不包含命中内容本身**。"""
    hits: list[dict] = []
    for rule, pattern in SECRET_RULES:
        for m in pattern.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            col = m.start() - (text.rfind("\n", 0, m.start()) + 1) + 1
            hits.append({"rule": rule, "line": line, "col": col, "length": m.end() - m.start()})
    for m in ENTROPY_TOKEN.finditer(text):
        token = m.group(0)
        if _entropy_bits_per_char(token) >= ENTROPY_THRESHOLD:
            line = text.count("\n", 0, m.start()) + 1
            col = m.start() - (text.rfind("\n", 0, m.start()) + 1) + 1
            hits.append({"rule": "high-entropy", "line": line, "col": col, "length": len(token)})
    return sorted(hits, key=lambda h: (h["line"], h["col"]))


def report_hits(hits: list[dict]) -> None:
    sys.stderr.write("🔴 检测到疑似凭证/高熵串，不发送。请处理后重新 prepare：\n")
    for h in hits:
        sys.stderr.write(f"  第 {h['line']} 行第 {h['col']} 列：疑似 {h['rule']}（长度 {h['length']}，内容不回显）\n")


# ---------------------------------------------------------------- 机器事实采集（只按白名单取）
def _filtered(data: dict, whitelist: tuple[str, ...]) -> dict:
    """只取白名单字段——清单外的键**在这一步就被丢弃**，不进返回的结构。"""
    return {k: data[k] for k in whitelist if isinstance(data, dict) and k in data}


def collect_machine_facts(scope_root: str, agent_type: str | None, commands: list[dict]) -> dict:
    """按白名单采集机器事实。scope_root 默认是家目录（与 dby-update 的 global scope 同根）。

    ponytail: 只扫 <scope_root>/.claude/skills/ 这一处装机位（global scope 的默认位）；
    project scope / 其他 agent 目录不扫。升级路径是照 reconcile.mjs 的多 scope 枚举来，
    但那要把它的 scope 语义整个搬过来，首版先按最常见的装法采。
    """
    packages: list[dict] = []
    skills_dir = os.path.join(scope_root, ".claude", "skills")
    if os.path.isdir(skills_dir):
        for name in sorted(os.listdir(skills_dir)):
            origin_path = os.path.join(skills_dir, name, ".dby", "origin.json")
            try:
                with open(origin_path, "r", encoding="utf-8") as f:
                    origin = json.load(f)
            except (OSError, ValueError):
                continue
            entry = _filtered(origin, ORIGIN_FIELD_WHITELIST)
            if entry:
                packages.append(entry)

    lock: dict = {}
    try:
        with open(os.path.join(scope_root, ".dby", "lock.json"), "r", encoding="utf-8") as f:
            raw_lock = json.load(f)
        skills_map = raw_lock.get("skills") if isinstance(raw_lock, dict) else None
        if isinstance(skills_map, dict):
            lock = {slug: _filtered(entry, LOCK_FIELD_WHITELIST) for slug, entry in sorted(skills_map.items())}
    except (OSError, ValueError):
        lock = {}

    try:
        node = subprocess.run(
            ["node", "--version"], capture_output=True, text=True, timeout=5
        ).stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        node = None

    facts = {
        "node": node,
        "os": f"{platform.system()} {platform.release()}",
        "agentType": agent_type,
        "commands": commands,
    }
    # 结构性自证：runtime 事实的键就是白名单本身，多一个键都装不进去。
    facts = _filtered(facts, RUNTIME_FACT_WHITELIST)
    facts["packages"] = packages
    facts["lock"] = lock
    return facts


# ---------------------------------------------------------------- 安装标识（假名标识符）
# 本地随机生成、不从机器名/用户名/邮箱/密钥等任何可识别信息派生、支持重置。
# ⚠️ 它是假名标识符，不是「匿名」——措辞红线见 references/maintainer-loop.md。
def _id_path(scope_root: str) -> str:
    return os.path.join(scope_root, ".dby", "feedback-id")


def install_id(scope_root: str, reset: bool = False) -> str:
    import secrets

    path = _id_path(scope_root)
    if not reset:
        try:
            with open(path, "r", encoding="utf-8") as f:
                existing = f.read().strip()
            if re.fullmatch(r"[0-9a-f]{32}", existing):
                return existing
        except OSError:
            pass
    fresh = secrets.token_hex(16)  # 唯一输入是系统 CSPRNG，不掺任何机器/用户信息
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(fresh + "\n")
    return fresh


# ---------------------------------------------------------------- 端点配置（后端形态未定，字段名与地址都可配）
def _script_dir() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def load_endpoint_config() -> dict:
    """端点地址与请求体字段名都来自 scripts/endpoint.json；环境变量 DOUBAOYA_FEEDBACK_URL 可覆盖地址。

    后端上线后只需改配置文件发新版，不动代码（design 的 Open Questions）。
    """
    with open(os.path.join(_script_dir(), "endpoint.json"), "r", encoding="utf-8") as f:
        config = json.load(f)
    env_url = os.environ.get("DOUBAOYA_FEEDBACK_URL")
    if env_url:
        config = dict(config)
        config["url"] = env_url
    url = config.get("url")
    # 只许 https，或本机回环（自检/联调用 stub）——反馈数据不走明文出网。
    if url and not (url.startswith("https://") or url.startswith("http://127.0.0.1") or url.startswith("http://localhost")):
        raise SystemExit(f"端点地址必须是 https（或本机回环）：{url}")
    return config


def _skill_user_agent() -> str:
    """读取包根 .version 里发布时盖的版本戳；没有则退回通用值（向后兼容）。"""
    try:
        version_path = os.path.join(_script_dir(), "..", ".version")
        with open(version_path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        return value or "doubaoya-skill/1.0"
    except OSError:
        return "doubaoya-skill/1.0"


# ---------------------------------------------------------------- prepare / send / keep
def build_payload(category: str, report_text: str, facts: dict, installation: str, fields: dict) -> str:
    """按配置的字段名拼载荷，返回**最终要发出去的那份**序列化文本（含末尾换行）。"""
    payload = {
        fields["category"]: category,
        fields["report"]: report_text,
        fields["machineFacts"]: facts,
        fields["installId"]: installation,
        fields["skillVersion"]: _skill_user_agent(),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def cmd_prepare(args: argparse.Namespace) -> int:
    if args.category not in CATEGORIES:
        sys.stderr.write(f"错误：--category 只认 {'/'.join(CATEGORIES)}\n")
        return 1
    try:
        with open(args.report, "r", encoding="utf-8") as f:
            report_text = f.read()
    except OSError as exc:
        sys.stderr.write(f"错误：读不到报告文件：{exc}\n")
        return 1
    commands = []
    for item in args.command or []:
        code, _, cmd = item.partition(":")
        try:
            commands.append({"exit": int(code), "cmd": cmd})
        except ValueError:
            sys.stderr.write(f"错误：--command 需要「退出码:命令」格式，拿到 {item!r}\n")
            return 1
    facts = collect_machine_facts(args.scope_root, args.agent, commands)
    config = load_endpoint_config()
    serialized = build_payload(args.category, report_text, facts, install_id(args.scope_root), config["fields"])

    hits = scan_secrets(serialized)
    if hits:
        report_hits(hits)
        return 3
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(serialized)
    # stdout 打印的就是写进 --out 的那份，逐字节一致——agent 把它原样呈现给用户过目。
    sys.stdout.write(serialized)
    return 0


def _fallback_markdown(payload: dict, fields: dict) -> str:
    """把载荷完整还原成一份人可读的 markdown——报告正文 + 机器事实，一个字不丢。"""
    return (
        f"{payload.get(fields['report'], '')}\n\n---\n\n"
        "## 随附机器事实（白名单采集）\n\n```json\n"
        + json.dumps(
            {
                fields["category"]: payload.get(fields["category"]),
                fields["machineFacts"]: payload.get(fields["machineFacts"]),
                fields["installId"]: payload.get(fields["installId"]),
                fields["skillVersion"]: payload.get(fields["skillVersion"]),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n```\n"
    )


def write_local_copy(serialized: str, scope_root: str) -> str:
    """反馈落成本地 markdown 文件，返回绝对路径。端点不通不是弄丢反馈的理由。"""
    config = load_endpoint_config()
    payload = json.loads(serialized)
    category = payload.get(config["fields"]["category"], "feedback")
    directory = os.path.join(scope_root, ".dby", "feedback")
    os.makedirs(directory, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.abspath(os.path.join(directory, f"{stamp}-{category}.md"))
    # 同一秒内落两份不许互相覆盖——覆盖旧文件就是丢反馈
    counter = 2
    while os.path.exists(path):
        path = os.path.abspath(os.path.join(directory, f"{stamp}-{category}-{counter}.md"))
        counter += 1
    with open(path, "w", encoding="utf-8") as f:
        f.write(_fallback_markdown(payload, config["fields"]))
    return path


MANUAL_DELIVERY = (
    "手动送达方式：到 GitHub 仓库 zizhanovo/doubaoya-community 开一个 issue，"
    "把上面这份文件的内容贴进去；GitHub 访问不畅时用 Gitee 同名仓库。\n"
)


def cmd_send(args: argparse.Namespace) -> int:
    try:
        with open(args.payload, "rb") as f:
            body = f.read()
    except OSError as exc:
        sys.stderr.write(f"错误：读不到载荷文件：{exc}\n")
        return 1

    # 双闸的机器侧在发送前再跑一遍：prepare 之后文件若被改过，这里是最后一道扫描。
    hits = scan_secrets(body.decode("utf-8"))
    if hits:
        report_hits(hits)
        return 3

    # 🔴 人工闸：没有用户的明确同意（拒绝、无回应都算未同意）就不发送。
    # 这个开关只由 agent 在用户**看过全文并明确说发**之后传入。
    if not args.user_consented:
        sys.stderr.write("未取得用户明确同意（缺 --user-consented），不发送。用户过目全文并同意后再来。\n")
        return 4

    config = load_endpoint_config()
    url = config.get("url")
    if not url:
        path = write_local_copy(body.decode("utf-8"), args.scope_root)
        sys.stderr.write("提交端点尚未配置，反馈已落本地文件（内容没丢）：\n")
        sys.stdout.write(path + "\n")
        sys.stderr.write(MANUAL_DELIVERY)
        return 2

    request = urllib.request.Request(
        url,
        data=body,
        method=config.get("method", "POST"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": _skill_user_agent(),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            envelope = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        path = write_local_copy(body.decode("utf-8"), args.scope_root)
        reason = getattr(exc, "reason", exc)
        sys.stderr.write(f"提交失败（{reason}），反馈已落本地文件（内容没丢）：\n")
        sys.stdout.write(path + "\n")
        sys.stderr.write(MANUAL_DELIVERY)
        return 2

    # 统一信封：先看 success；notice 原样转达（走 stderr，stdout 留给结果）。
    notice = envelope.get("notice") if isinstance(envelope, dict) else None
    if notice:
        sys.stderr.write(f"[notice] {notice}\n")
    if isinstance(envelope, dict) and envelope.get("success"):
        request_id = envelope.get("requestId") or ""
        sys.stdout.write(f"已提交。后续追问可引用标识：{request_id}\n")
        return 0
    error = (envelope or {}).get("error") or {} if isinstance(envelope, dict) else {}
    path = write_local_copy(body.decode("utf-8"), args.scope_root)
    sys.stderr.write(
        f"端点返回失败（{error.get('code', 'UNKNOWN')}: {error.get('message', '无消息')}），"
        "反馈已落本地文件（内容没丢）：\n"
    )
    sys.stdout.write(path + "\n")
    sys.stderr.write(MANUAL_DELIVERY)
    return 2


def cmd_keep(args: argparse.Namespace) -> int:
    """用户看过全文决定不发、但想留底：只落本地，不发任何请求。"""
    try:
        with open(args.payload, "r", encoding="utf-8") as f:
            serialized = f.read()
    except OSError as exc:
        sys.stderr.write(f"错误：读不到载荷文件：{exc}\n")
        return 1
    path = write_local_copy(serialized, args.scope_root)
    sys.stdout.write(path + "\n")
    return 0


# ---------------------------------------------------------------- 自检（离线、零依赖、不出本机）
def selfcheck() -> None:  # noqa: PLR0915 — 自检逐条对应 spec 的 requirement，长是应得的
    import shutil
    import tempfile
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    pkg_root = os.path.abspath(os.path.join(_script_dir(), ".."))
    skill_md = open(os.path.join(pkg_root, "SKILL.md"), encoding="utf-8").read()
    protocol = open(os.path.join(pkg_root, "references", "report-protocol.md"), encoding="utf-8").read()
    loop = open(os.path.join(pkg_root, "references", "maintainer-loop.md"), encoding="utf-8").read()

    # ── R1/R2 触发与提议纪律（行为契约落在文字上，自检核文字在场）─────────────
    assert "不要求用户先学任何命令" in skill_md, "R1：自然抱怨触发的承诺不在 SKILL.md"
    for marker in ("一句话", "可忽略", "不再提"):
        assert marker in skill_md, f"R2：提议纪律缺「{marker}」"

    # ── R3 三类分支实质不同 ────────────────────────────────────────────────
    for marker in ("操作序列", "卡在哪一个具体动作", "现在的做法是什么"):
        assert marker in protocol, f"R3：分支提问缺「{marker}」"
    assert "不要求用户客观描述缺陷" in protocol, "R3：friction 分支缺特殊约定"

    # ── R4/R5 真实记录与观察推测 ──────────────────────────────────────────
    assert "每个细节必须对应真实工具调用记录" in protocol, "R4：真实记录约束不在 references"
    assert "标注为未核实" in protocol, "R4：未核实标注规则缺失"
    assert "观察" in protocol and "推测" in protocol, "R5：观察/推测分层缺失"
    assert "不要求给出解决方案" in protocol, "R5：解决方案豁免缺失"

    # ── R7 取材约束的正反例 ────────────────────────────────────────────────
    assert "✅ 正例" in protocol and "❌ 反例" in protocol, "R7：正反例缺失"

    # ── 消费端与假名措辞（D8 / R9 文档面）────────────────────────────────
    assert "修复队列" in loop and "openspec" in loop, "消费端说明缺失"
    assert "假名" in loop and "GDPR" in loop, "假名标识措辞红线缺失"
    for text, where in ((skill_md, "SKILL.md"), (protocol, "protocol"), (loop, "loop")):
        for i, line in enumerate(text.splitlines(), 1):
            if "匿名" in line:
                assert ("不要" in line or "不得" in line or "别用" in line or "不是「匿名」" in line), (
                    f"措辞红线：{where}:{i} 出现「匿名」却不在禁止语境里"
                )

    with tempfile.TemporaryDirectory() as tmp:
        # ── R6 白名单采集：造一个允许与禁止字段混住的 origin.json ────────────
        root_a = os.path.join(tmp, "machine-a")
        pkg = os.path.join(root_a, ".claude", "skills", "dby-write", ".dby")
        os.makedirs(pkg)
        with open(os.path.join(pkg, "origin.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "slug": "dby-write", "version": "1.0.0", "hash": "abcdef123456",
                    "ref": "release-20260830-0001", "installedAt": "2026-08-30T00:00:00Z",
                    # 禁止字段与诱饵：一个都不许进采集结果
                    "appid": "wx-forbidden-1", "author": "forbidden-author",
                    "publicAccountName": "forbidden-account", "targetAccount": "forbidden-target",
                    "ipProfile": "forbidden-profile", "articleBody": "用户的文章正文",
                },
                f,
            )
        os.makedirs(os.path.join(root_a, ".dby"))
        with open(os.path.join(root_a, ".dby", "lock.json"), "w", encoding="utf-8") as f:
            json.dump(
                {"version": 1, "skills": {"dby-write": {
                    "version": "1.0.0", "hash": "abcdef123456", "installedAt": "2026-08-30T00:00:00Z",
                    "pinned": True, "pinReason": "用户手写的自由文本，可能含任何东西",
                }}},
                f,
            )
        facts = collect_machine_facts(root_a, "claude-code", [{"exit": 1, "cmd": "node reconcile.mjs --dry-run"}])
        flat = json.dumps(facts, ensure_ascii=False)
        for forbidden in ("appid", "author", "publicAccountName", "targetAccount", "ipProfile",
                          "articleBody", "forbidden", "pinReason", "自由文本", "文章正文"):
            assert forbidden not in flat, f"R6：禁止字段/值进了待发送结构：{forbidden}"
        assert facts["packages"][0]["slug"] == "dby-write", "R6：白名单内字段没采到"
        assert facts["lock"]["dby-write"]["pinned"] is True, "R6：lock 白名单字段没采到"

        # ── R10 安装标识：两台“机器”不同、同机稳定、重置后变化 ────────────────
        root_b = os.path.join(tmp, "machine-b")
        os.makedirs(root_b)
        id_a, id_b = install_id(root_a), install_id(root_b)
        assert id_a != id_b, "R10：两台机器生成了相同标识"
        assert install_id(root_a) == id_a, "R10：同机重复调用不稳定"
        id_a2 = install_id(root_a, reset=True)
        assert id_a2 != id_a and install_id(root_a) == id_a2, "R10：重置没生效"
        assert re.fullmatch(r"[0-9a-f]{32}", id_a2), "R10：标识不是 32 位十六进制随机串"

        # ── R8 检测：dyh_ / token 形状 / 高熵串逐个命中（样本全部动态拼出，不落字面量）──
        fake_dyh = "dyh_" + "a1b2c3" * 3                       # 18 位含数字 → doubaoya-key
        fake_gh = "gh" + "p_" + "A" * 10 + "1" * 12            # → github-token
        fake_sk = "sk-" + "proj-" + "Zx9" * 8                  # → openai-style-key
        high_entropy = "".join(chr(65 + (i * 7) % 26) + chr(97 + (i * 11) % 26) + str(i % 10) + "+/"[i % 2] for i in range(10))
        assert _entropy_bits_per_char(high_entropy) >= ENTROPY_THRESHOLD, "自检样本熵不足，换个样本"
        for sample, rule in ((fake_dyh, "doubaoya-key"), (fake_gh, "github-token"),
                             (fake_sk, "openai-style-key"), (high_entropy, "high-entropy")):
            found = scan_secrets("前文\n报告里夹了 " + sample + " 这么一串\n后文")
            assert any(h["rule"] == rule for h in found), f"R8：{rule} 没被扫出来"
            assert all(sample not in json.dumps(h) for h in found), "R8：命中内容泄进了检测结果"
            assert found[0]["line"] == 2, "R8：位置信息（行号）不对"
        assert scan_secrets("干净的中文叙述，含一条命令 node scripts/reconcile.mjs --dry-run 与哈希 abcdef123456") == [], (
            "R8：干净文本被误报"
        )
        # 安装标识（32 位十六进制）不该触发高熵误报——十六进制熵上限 4.0 < 阈值
        assert scan_secrets("installId: " + id_a2) == [], "R8：安装标识被误报为高熵串"

        # ── prepare：载荷 stdout 与 --out 文件逐字节一致（R8 呈现闸的机器保障）──
        report_path = os.path.join(tmp, "report.md")
        with open(report_path, "w", encoding="utf-8") as f:
            f.write("# 反馈：排版脚本报错\n\n## 操作序列\n1. 跑了 render 脚本，退出码 1\n")
        out_path = os.path.join(tmp, "payload.json")

        class Args:
            category, report, out, scope_root, agent, command = "bug", report_path, out_path, root_a, "claude-code", ["1:python3 render.py"]

        rc = cmd_prepare(Args())
        assert rc == 0, f"prepare 失败：{rc}"
        payload_text = open(out_path, encoding="utf-8").read()
        # stdout 上面已直接写出；这里用同一构造路径复算，断言逐字节一致
        config = load_endpoint_config()
        rebuilt = build_payload("bug", open(report_path, encoding="utf-8").read(),
                                json.loads(payload_text)[config["fields"]["machineFacts"]],
                                id_a2, config["fields"])
        assert rebuilt == payload_text, "R8：呈现/发送两份不一致（不是同一构造）"

        # prepare 撞上凭证 → 非发送态、不写载荷（R8 检测闸）
        dirty_report = os.path.join(tmp, "dirty.md")
        with open(dirty_report, "w", encoding="utf-8") as f:
            f.write("报错原文里带着 " + fake_dyh + "\n")
        dirty_out = os.path.join(tmp, "dirty-payload.json")

        class DirtyArgs(Args):
            report, out = dirty_report, dirty_out

        assert cmd_prepare(DirtyArgs()) == 3, "R8：检测命中没有拦下 prepare"
        assert not os.path.exists(dirty_out), "R8：命中时载荷不该落盘"

        # ── R8 同意闸：没有 --user-consented 一律不发（stub 收不到任何请求）────
        received: list[dict] = []

        class Stub(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802 — http.server 的约定
                body = self.rfile.read(int(self.headers["Content-Length"]))
                received.append({"path": self.path, "body": body})
                reply = json.dumps({"success": True, "requestId": "req_selfcheck", "data": {},
                                    "error": None, "notice": "自检通道"}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(reply)

            def log_message(self, *a):  # 静音
                pass

        server = HTTPServer(("127.0.0.1", 0), Stub)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        stub_url = f"http://127.0.0.1:{server.server_port}/feedback"
        os.environ["DOUBAOYA_FEEDBACK_URL"] = stub_url
        try:
            class SendArgs:
                payload, scope_root, user_consented = out_path, root_a, False

            assert cmd_send(SendArgs()) == 4, "R8：未同意居然没被拦"
            assert received == [], "R8：未同意时不该有任何请求发出"

            # 用户同意 → stub 收到的必须与过目的那份逐字节一致（R8 发送闸）
            class ConsentArgs(SendArgs):
                user_consented = True

            assert cmd_send(ConsentArgs()) == 0, "发送成功路径失败"
            assert len(received) == 1, "该恰好发出一次请求"
            assert received[0]["body"].decode("utf-8") == payload_text, "R8：发出的与过目的不是同一份（逐字节比对失败）"
            assert received[0]["path"] == "/feedback", "端点路径没按配置走"

            # 发送前的第二遍扫描：载荷文件在 prepare 之后被塞进凭证 → send 也要拦
            tampered = os.path.join(tmp, "tampered.json")
            with open(tampered, "w", encoding="utf-8") as f:
                f.write(payload_text[:-2] + fake_dyh + payload_text[-2:])

            class TamperedArgs(ConsentArgs):
                payload = tampered

            assert cmd_send(TamperedArgs()) == 3, "R8：发送前第二遍扫描没拦住事后塞进的凭证"
            assert len(received) == 1, "R8：命中后不该再发请求"

            # ── R9 降级：端点不可达 → 落本地、路径绝对、内容完整、退出码非 0 ────
            os.environ["DOUBAOYA_FEEDBACK_URL"] = "http://127.0.0.1:1/unreachable"
            rc = cmd_send(ConsentArgs())
            assert rc == 2, f"R9：端点不通该退出码 2，拿到 {rc}"
            saved = sorted(os.listdir(os.path.join(root_a, ".dby", "feedback")))
            assert len(saved) == 1 and saved[0].endswith("-bug.md"), "R9：本地文件没落盘"
            saved_path = os.path.join(root_a, ".dby", "feedback", saved[0])
            assert os.path.isabs(saved_path), "R9：路径不是绝对路径"
            saved_text = open(saved_path, encoding="utf-8").read()
            assert "排版脚本报错" in saved_text and "机器事实" in saved_text, "R9：落盘内容不完整"

            # 端点未配置（url 为 null 且无环境变量）→ 同样降级，且一个请求都不发
            del os.environ["DOUBAOYA_FEEDBACK_URL"]
            if load_endpoint_config().get("url") is None:
                assert cmd_send(ConsentArgs()) == 2, "R9：端点未配置该降级"
                assert len(received) == 1, "R9：未配置时不该有请求发出"

            # keep：用户不发但要留底 → 只落盘、零请求
            class KeepArgs:
                payload, scope_root = out_path, root_a

            assert cmd_keep(KeepArgs()) == 0, "keep 失败"
            assert len(received) == 1, "keep 不该发出任何请求"
            # 同一秒内多次落盘不许互相覆盖（覆盖旧文件就是丢反馈）
            saved_all = os.listdir(os.path.join(root_a, ".dby", "feedback"))
            assert len(saved_all) >= 2, "R9：同秒落盘互相覆盖了（丢反馈）"
        finally:
            os.environ.pop("DOUBAOYA_FEEDBACK_URL", None)
            server.shutdown()
            thread.join(timeout=5)
            shutil.rmtree(os.path.join(root_a, ".dby", "feedback"), ignore_errors=True)

    # 破坏演练自证：上面这些断言都不是恒真（任取一条的反命题必须为假）
    assert scan_secrets("dyh_" + "z" * 20) == [], "占位形状（无数字）不该命中——命中说明判据宽了"
    print(
        "selfcheck ok: 白名单采集（禁止字段零命中）/ 安装标识（随机·稳定·可重置）/ "
        "凭证与高熵检测（含位置·不回显）/ 呈现=发送逐字节一致 / 同意闸 / 二遍扫描 / "
        "降级落盘 / keep 零请求 / 文档契约在场"
    )


def main() -> int:
    if "--selfcheck" in sys.argv:
        selfcheck()
        return 0
    parser = argparse.ArgumentParser(description="都爆鸭 · 反馈提交（prepare → 用户过目 → send）")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("prepare", help="采集机器事实并拼出待发送载荷（打印全文供用户过目）")
    p.add_argument("--category", required=True, choices=CATEGORIES)
    p.add_argument("--report", required=True, help="agent 写好的报告 markdown 文件")
    p.add_argument("--out", required=True, help="载荷输出路径（send 时原样发送这份）")
    p.add_argument("--scope-root", default=os.path.expanduser("~"))
    p.add_argument("--agent", default=None, help="agent 类型，如 claude-code")
    p.add_argument("--command", action="append", help="本次执行过的本仓命令，格式「退出码:命令」，可多次")
    p.set_defaults(fn=cmd_prepare)

    s = sub.add_parser("send", help="用户明确同意后原样发送载荷")
    s.add_argument("--payload", required=True)
    s.add_argument("--user-consented", action="store_true",
                   help="仅当用户看过全文并明确同意后才传入；拒绝或无回应都不许带")
    s.add_argument("--scope-root", default=os.path.expanduser("~"))
    s.set_defaults(fn=cmd_send)

    k = sub.add_parser("keep", help="用户不发但要留底：只落本地文件，不发请求")
    k.add_argument("--payload", required=True)
    k.add_argument("--scope-root", default=os.path.expanduser("~"))
    k.set_defaults(fn=cmd_keep)

    r = sub.add_parser("reset-id", help="重置安装标识（旧标识即刻作废）")
    r.add_argument("--scope-root", default=os.path.expanduser("~"))
    r.set_defaults(fn=lambda a: (sys.stdout.write("安装标识已重置\n"), 0)[1] if install_id(a.scope_root, reset=True) else 1)

    args = parser.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
