#!/usr/bin/env python3
"""发版质量门——两段式里**本地**这一段（design.md D3）。

分工：
  本段（发布者主动跑）：按 design.md D10 的三层顺序跑判定——
    ① 脚本层（pytest + 各包 *.selfcheck.mjs，免费秒级零抖动）
    ② 触发层（trigger_bench）③ agent 执行层（case_bench）；
    与 evals/baseline.json 逐用例比对，产出放行/退步/不可比结论并更新基线。
    ②③慢、要模型、要密钥——所以留在本地；①红时在**任何模型调用之前**就中止。
  CI 段（tools/check_baseline.py，release.yml 调）：纯离线，只查「本次发版涉及的
    每个包，其当前内容哈希在基线里有没有记录」。不调模型、不配密钥、不联网，
    因此零假阳性——spec「未产生结论就不许发版」由它强制。

🔴 刻意不挂 pre-push：.githooks/pre-push 里论证过「阻塞式闸一旦慢或吵，
   第二次就有人 --no-verify，第三次成肌肉记忆」。质量门要调模型，慢、要钱、
   会不可用，正是那条原则点名要挡在外面的闸。

结论的取值与含义：
  无退步        —— 与基线逐用例比对无「基线 pass、本次 fail」；有改进则更新基线。
  退步          —— 默认阻止放行（exit 1）、基线不动；确要带伤发版：
                   --accept-regression skill:case --reason「为什么」，理由随条目写进基线。
  基线不可比    —— runner/模型身份与基线不一致：不输出退步或改进结论（spec 硬性要求），
                   提示在当前身份下 --establish 重建。
  未跑          —— 缺 DOUBAOYA_API_KEY / 沙箱等前置：如实报告并 exit 2，
                   绝不记为通过，执行层基线条目不改写（design.md D7）。

用法：
    python3 tools/release_gate.py                     # 正常发版路径：跑判定 + 比对 + 更新基线
    python3 tools/release_gate.py --establish         # 首次建基线：只写入，不做退步判定
    python3 tools/release_gate.py --dry               # 离线：只看当前哈希对基线的覆盖，不调模型
    python3 tools/release_gate.py --accept-regression dby-x:case-1 --reason "…"

退出码：0 = 放行；1 = 退步/不可比/参数错，已阻止；2 = 判定不可用（跑不了 ≠ 通过）。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import baseline  # noqa: E402
import runners  # noqa: E402
from stamp_versions import compute_skill_hash  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"
TOOLS = Path(__file__).resolve().parent
BASELINE_PATH = baseline.BASELINE_PATH


# ---------------------------------------------------------------- 脚本层（D10 第一层）

def run_script_layer() -> int:
    """先跑脚本层：pytest（tools/tests/，内含各包脚本判据与 selfcheck 接线）+
    各包 `skills/*/scripts/*.selfcheck.mjs` 逐个真跑。免费、秒级、零抖动。

    🔴 为什么它必须排在触发层/执行层**之前**（design.md D10，2026-08-31）：
       脚本层红 = 确定性行为已经坏了，这时再去烧 3 轮沙箱 agent 会话是花钱确认一个
       已知事实——第二轮真跑 5/5 全抖的账就是「用最贵最抖的手段测最确定的东西」欠下的。
       所以脚本层失败时本函数返回非零，main() 在**跑任何模型调用之前**就中止。

    返回：0 = 全绿；1 = 有失败（阻止放行）；2 = 前置不可用（跑不了 ≠ 通过）。"""
    print("—— 脚本层（pytest + selfcheck，D10 第一层）——")
    p = subprocess.run([sys.executable, "-m", "pytest", str(TOOLS / "tests"), "-q"],
                       cwd=str(ROOT))
    if p.returncode != 0:
        print("\n🔴 脚本层 pytest 未通过：确定性行为已坏，先修它——"
              "触发层与执行层判定不再启动（不烧模型调用）。", file=sys.stderr)
        return 1
    selfchecks = sorted(SKILLS.glob("*/scripts/*.selfcheck.mjs"))
    if selfchecks:
        import shutil as _shutil
        node = _shutil.which("node")
        if node is None:
            # 跑不了 ≠ 通过（design.md D7 同一条原则）：selfcheck 没法跑就不放行。
            print("🔴 找不到 node：各包 *.selfcheck.mjs 跑不了。跑不了 ≠ 通过，"
                  "装上 node 再跑质量门。", file=sys.stderr)
            return 2
        for sc in selfchecks:
            r = subprocess.run([node, str(sc)], capture_output=True, text=True,
                               timeout=120, cwd=str(sc.parent))
            rel = sc.relative_to(ROOT).as_posix()
            if r.returncode != 0:
                print(f"🔴 selfcheck 未通过：{rel}\n{r.stdout}{r.stderr}", file=sys.stderr)
                print("🔴 脚本层未通过——触发层与执行层判定不再启动（不烧模型调用）。",
                      file=sys.stderr)
                return 1
            print(f"  ✅ {rel}")
    print("脚本层全绿。\n")
    return 0


# ---------------------------------------------------------------- 跑两个判定器

def _run_bench(script: str, extra: "list[str]") -> "tuple[int, dict | None]":
    """子进程跑一个判定器，回（退出码, 解析后的 --json 结果）。

    为什么走子进程而不是 import 调用：两个判定器的 main 都按独立 CLI 设计
    （trigger_bench.main 甚至直接读 sys.argv），子进程是它们唯一稳定的公共接口；
    顺带天然隔离——判定器崩了不连累门本身的结论输出。"""
    with tempfile.TemporaryDirectory(prefix="release_gate_") as td:
        out = Path(td) / "bench.json"
        cmd = [sys.executable, str(TOOLS / script), "--json", str(out)] + extra
        p = subprocess.run(cmd, capture_output=True, text=True)
        # 判定器自己的逐条归因都在它的 stdout 里，原样转发——门只做结论，不吞证据。
        sys.stdout.write(p.stdout)
        sys.stderr.write(p.stderr)
        data = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
        return p.returncode, data


# 🔴 模型参数只在有值时下发（2026-08-31 实测教训）：模型默认按后端解析
#    （runners.DEFAULT_MODELS），pi/codex 解析结果是 None——此时命令行里**不出现**
#    模型参数，让 CLI 用自己的默认。把 claude 的 "sonnet" 别名串给 pi，
#    会被解析到无 key 的 amazon-bedrock，每次 grader 调用都拿到非 JSON 报错、
#    被计为不可用，整批判定白跑。

def run_trigger_bench(args, slugs: "list[str]") -> "tuple[int, dict | None]":
    extra = ["--rounds", str(args.rounds), "--runner", args.runner]
    if args.model:
        extra += ["--model", args.model]
    extra += ["--skills", ",".join(slugs)]
    return _run_bench("trigger_bench.py", extra)


def run_case_bench(args, slugs: "list[str]") -> "tuple[int, dict | None]":
    extra = ["--rounds", str(args.rounds), "--runner", args.runner]
    if args.model:
        extra += ["--model", args.model]
    extra += ["--grader-runner", args.grader_runner]
    if args.grader_model:
        extra += ["--grader-model", args.grader_model]
    extra += ["--skills", ",".join(slugs)]
    if args.include_costly:
        extra.append("--include-costly")
    return _run_bench("case_bench.py", extra)


# ---------------------------------------------------------------- 判定结果 → 基线条目

def trigger_results(data: dict) -> "dict[str, dict[str, str]]":
    """trigger_bench 的 --json → {slug: {话术: 结果}}。
    用例键用话术原文而非行号——行号会随插行漂移，跨版本就对不上号了。
    稳定判对 = pass，稳定判错 = fail；flaky/unusable 记录在案但不参与退步判定。"""
    per: "dict[str, dict[str, str]]" = {}
    for rec in data.get("stable", []):
        per.setdefault(rec["owner"], {})[rec["q"]] = "fail" if rec.get("failed") else "pass"
    for bucket in ("flaky", "unusable"):
        for rec in data.get(bucket, []):
            per.setdefault(rec["owner"], {})[rec["q"]] = bucket
    return per


def case_results(data: dict) -> "dict[str, dict[str, str]]":
    """case_bench 的 --json → {slug: {用例 id: 结果}}。
    stable 取其判定值（pass/fail/unclear），flaky/unusable 原档记录。
    costly 被跳过的用例不出现在 results 里——同内容时 upsert 会保留其历史结果。"""
    per: "dict[str, dict[str, str]]" = {}
    for r in data.get("results", []):
        v = r["verdict"] if r["bucket"] == "stable" else r["bucket"]
        per.setdefault(r["owner"], {})[r["id"]] = v
    return per


def _bench_identity(block: "dict | None", fallback_model: "str | None") -> dict:
    """判定器 --json 里的身份块 → 基线条目的模型字段组（design.md D4）。

    D4 的意义是「换了尺子要能被发现」，所以 model 一栏尽量记**实际**用的模型：
    pi 的 JSON 会在 message_end 事件里回报实际 provider/model（实测 2026-08-31：
    不传 --model 时为 deepseek / deepseek-v4-flash），此时 model_source 标 "reported"；
    claude / codex 的输出拿不到实际模型 ID，退回记请求值（sonnet 这类会漂移的别名）
    并标 "requested"。🔴 两种来源用 model_source 字段区分，不许混在一个字段里
    看不出差别——否则请求了 sonnet 而实际跑的是别的模型时，基线毫无察觉，D4 失效。
    罐头结果/老格式没有身份块时同样退回请求值，如实标 "requested"。"""
    block = block or {}
    if block.get("model_source") == "reported" and block.get("model"):
        d = {"model": block["model"], "model_source": "reported"}
        if block.get("provider"):
            d["provider"] = block["provider"]
        return d
    return {"model": block.get("model") or fallback_model, "model_source": "requested"}


def build_entries(targets: "list[str]", hashes: "dict[str, str]",
                  trig_per: "dict[str, dict]", case_per: "dict[str, dict]",
                  exec_ran: bool, args, date: str,
                  tident: "dict | None" = None, eident: "dict | None" = None,
                  gident: "dict | None" = None) -> "list[dict]":
    """把本次判定拼成基线条目。执行层没跑成（exec_ran=False）时不生成 cases 条目——
    不生成就不会 upsert，也就不会把「没跑」写成任何结论（D7）。

    tident/eident/gident 是三个判定角色（盲测 / executor / grader）的模型身份块
    （见 _bench_identity），缺省时退回记请求值并标 "requested"。"""
    tident = tident or _bench_identity(None, args.model)
    eident = eident or _bench_identity(None, args.model)
    gident = gident or _bench_identity(None, args.grader_model)
    entries = []
    for slug in targets:
        has_t = (SKILLS / slug / "evals" / "triggers.jsonl").exists()
        has_c = (SKILLS / slug / "evals" / "cases.jsonl").exists()
        if has_t:
            entries.append(dict({"skill": slug, "kind": "triggers", "hash": hashes[slug],
                                 "runner": args.runner,
                                 "rounds": args.rounds, "date": date,
                                 "results": trig_per.get(slug, {})}, **tident))
        if has_c and exec_ran:
            e = dict({"skill": slug, "kind": "cases", "hash": hashes[slug],
                      "runner": args.runner,
                      "grader_runner": args.grader_runner,
                      "grader_model": gident.get("model"),
                      "grader_model_source": gident.get("model_source"),
                      "rounds": args.rounds, "date": date,
                      "results": case_per.get(slug, {})}, **eident)
            if gident.get("provider"):
                e["grader_provider"] = gident["provider"]
            entries.append(e)
        if not has_t and not has_c:
            # 两类判据都没有：留一条空结果的证据条目——质量门确实扫过这一版内容，
            # 缺口由判定报告列出（spec：缺判据的包必须可见）；没有这条，
            # CI 的离线校验会把「缺判据」误拦成「没跑质量门」，包就永远发不出去。
            entries.append({"skill": slug, "kind": "none", "hash": hashes[slug],
                            "rounds": 0, "date": date, "results": {}})
    return entries


# ---------------------------------------------------------------- 基线洞（unusable）

def unusable_holes(data: dict, entries: "list[dict]") -> "list[tuple[str, str, list[str]]]":
    """写入后仍留在基线里的 unusable 洞：[(skill, kind, 用例清单)]。

    🔴 为什么盯这个（design.md D4b，2026-08-31 实测教训）：首版 --establish
    （243 条触发用例 × 3 轮 = 729 次调用、8 并发、30+ 分钟）把 dby-charter 判出
    18 条话术 14 条 unusable；单独重跑同一包 18/18 稳定、正例 10/10、负例 0/8、
    零不可用——洞是大并发撞限流的产物，不是包的缺陷。可怕的不是洞本身，是它
    悄无声息：CI 旧实现只查「(skill, hash) 有没有记录」，有洞照样放行；比对又
    只认「基线 pass、本次 fail」，基线是 unusable 就永远比不出退步——那 14 条
    话术从此不受监控，且没有任何地方会红。所以洞必须在这里点名、由门 exit 2
    拒绝当作结论，并由 check_baseline.py 在 CI 兜底拦住发版。

    以**写入后**的条目为准（baseline.match 找回落盘的那条）：同哈希时历史结果
    已回填的瞬时洞不算洞（baseline.upsert 规则 2），只报真正留在基线里的。"""
    out = []
    for e in entries:
        stored = baseline.match(data, e) or e
        cs = baseline.unusable_cases(stored)
        if cs:
            out.append((e["skill"], e["kind"], cs))
    return out


def report_unusable_holes(holes: "list[tuple[str, str, list[str]]]") -> None:
    """点名基线里的 unusable 洞并提示重跑——不能静默，静默就是监控盲区的开端。"""
    print("\n🔴 以下条目含 unusable（拿不到可信答案的洞），不构成质量门结论；"
          "洞已随条目写入基线（diff 可见），CI 离线校验会因此拦住这些包的发版：",
          file=sys.stderr)
    for skill, kind, cs in holes:
        print(f"  [{skill}/{kind}] {len(cs)} 条：{'、'.join(cs)}", file=sys.stderr)
    slugs = sorted({s for s, _, _ in holes})
    print("   成片的 unusable 多为大并发撞限流/超时（实测 2026-08-31：8 并发 729 次"
          "调用产出 14 条假性不可用，单独重跑 18/18 稳定）。runners.ask 已带指数退避，"
          f"仍出现时请降低并发、只对受影响的包重跑补上洞：\n"
          f"   python3 tools/release_gate.py --establish --skills {','.join(slugs)}",
          file=sys.stderr)


# ---------------------------------------------------------------- 主流程

def main(argv: "list[str] | None" = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skills", help="逗号分隔，只过这几个包；默认全部仓内包")
    ap.add_argument("--rounds", type=int, default=3,
                    help="判定轮数（默认 3；少于 3 轮的结果不构成放行依据，基线不更新）")
    ap.add_argument("--runner", default="claude", help="触发层盲测与 executor 的后端")
    # 🔴 模型默认不写死别名，按后端解析（runners.DEFAULT_MODELS）：
    #    "sonnet" 只对 claude 成立；实测（2026-08-31）`pi --model sonnet` 被解析到
    #    无 key 的 amazon-bedrock、输出非 JSON 报错——照旧默认跑，grader 每次调用
    #    都被计为不可用，整批判定白跑。不显式传时对 pi/codex 不下发模型参数。
    ap.add_argument("--model", default=None,
                    help="触发层盲测与 executor 的模型（默认按后端定：claude=sonnet，"
                         "其余用 CLI 自己的默认）")
    ap.add_argument("--grader-runner", default="pi", help="grader 后端（默认 pi，见 design.md D2）")
    ap.add_argument("--grader-model", default=None,
                    help="grader 模型（默认不指定，用后端 CLI 自己的默认——pi 只有这个形态实测可用）")
    ap.add_argument("--include-costly", action="store_true",
                    help="连 costly 用例一起跑（默认跳过，历史结果在基线里保留）")
    ap.add_argument("--establish", action="store_true",
                    help="建立/重建基线：只跑判定并写入，不做退步判定（首次或换模型后用）")
    ap.add_argument("--accept-regression", action="append", default=[], metavar="SKILL:CASE",
                    help="显式接受一条退步（可重复）；必须同时给 --reason")
    ap.add_argument("--reason", help="接受退步的理由，会随被接受条目写进基线")
    ap.add_argument("--dry", action="store_true",
                    help="不调模型：只报告当前各包哈希对基线的覆盖状态")
    args = ap.parse_args(argv)

    # 模型默认按各自后端解析，绝不跨后端串用（理由见 --model 的注释与 runners.py）。
    if args.model is None:
        args.model = runners.DEFAULT_MODELS.get(args.runner)
    if args.grader_model is None:
        args.grader_model = runners.DEFAULT_MODELS.get(args.grader_runner)

    # 🔴 理由是硬门（spec：接受退步 MUST 附理由）。在跑任何判定**之前**就拦——
    #    等模型跑完几十分钟才发现少个参数，人就会开始恨这道闸，然后绕过它。
    if args.accept_regression and not (args.reason and args.reason.strip()):
        print("🔴 接受退步必须附理由：--accept-regression 需要同时给 --reason「为什么接受」。"
              "理由会与被接受条目一并写进基线，随 diff 可见。", file=sys.stderr)
        return 1

    if args.establish and args.rounds < 3:
        # 基线是之后每次发版的对照组，用不足 3 轮的非证据结果当对照组，
        # 之后的每次「退步/无退步」结论都建立在噪声上。
        print("🔴 --establish 必须 --rounds 3 起：少于 3 轮的结果不构成证据，不能进基线。",
              file=sys.stderr)
        return 1

    all_slugs = sorted(p.parent.name for p in SKILLS.glob("*/SKILL.md"))
    targets = args.skills.split(",") if args.skills else all_slugs
    for slug in targets:
        if slug not in all_slugs:
            print(f"🔴 --skills 里的 {slug} 不是仓内包", file=sys.stderr)
            return 1

    hashes = {slug: compute_skill_hash(SKILLS / slug) for slug in targets}
    date = datetime.now(timezone.utc).date().isoformat()
    data = baseline.load(BASELINE_PATH)

    if args.dry:
        print(f"--dry：未调用模型。{len(targets)} 个包的当前内容哈希对基线的覆盖：")
        for slug in targets:
            kinds = sorted({e["kind"] for e in data["entries"]
                            if e.get("skill") == slug and e.get("hash") == hashes[slug]})
            state = f"有记录（{', '.join(kinds)}）" if kinds else "无记录——发版会被 CI 离线校验拦住"
            print(f"  {slug} @ {hashes[slug]}: {state}")
        return 0

    # 🔴 脚本层先行（design.md D10）：免费判据不过，就不烧任何模型调用。
    #    --establish 同样受此门管——把已坏的确定性行为锁进首版基线是最糟的起点。
    rc_script = run_script_layer()
    if rc_script != 0:
        return rc_script

    # 触发层：所有有 triggers.jsonl 的目标包一次跑完。
    trig_slugs = [s for s in targets if (SKILLS / s / "evals" / "triggers.jsonl").exists()]
    trig_per: "dict[str, dict]" = {}
    tdata = None
    if trig_slugs:
        rc, tdata = run_trigger_bench(args, trig_slugs)
        if rc != 0 or tdata is None:
            # spec「质量门不可用」场景：跑不了 ≠ 通过，如实报告并中止。
            print(f"\n🔴 触发层判定不可用（trigger_bench 退出码 {rc}）——"
                  "跑不了 ≠ 通过，本次不产生结论，发版不可放行。", file=sys.stderr)
            return 2
        trig_per = trigger_results(tdata)

    # 执行层：有 cases.jsonl 才跑。退出码 2 = 前置不可用（缺密钥/缺沙箱）——
    # 记「未跑」，执行层条目不生成、不改写基线（D7），最终 exit 2。
    case_slugs = [s for s in targets if (SKILLS / s / "evals" / "cases.jsonl").exists()]
    case_per: "dict[str, dict]" = {}
    exec_ran = True
    cdata = None
    if case_slugs:
        rc, cdata = run_case_bench(args, case_slugs)
        if rc == 2 or (rc == 0 and cdata is None):
            exec_ran = False
        elif rc != 0:
            print(f"\n🔴 执行层判定器报错（退出码 {rc}），先修判定器/用例。", file=sys.stderr)
            return 1
        else:
            case_per = case_results(cdata)
    else:
        exec_ran = False  # 没有任何执行层判据可跑；不算「未跑」故障，下面单独措辞

    # 基线记「实际用的模型」而非仅请求别名（design.md D4）：身份块来自判定器
    # 的 --json（pi 回报实测值，claude/codex 退回请求值并标明来源）。
    entries = build_entries(
        targets, hashes, trig_per, case_per, exec_ran and bool(case_slugs), args, date,
        tident=_bench_identity((tdata or {}).get("blind"), args.model),
        eident=_bench_identity((cdata or {}).get("executor"), args.model),
        gident=_bench_identity((cdata or {}).get("grader"), args.grader_model))

    if args.establish:
        # 建基线：只写入，不做退步判定（没有可比对象）。Migration Plan 要求
        # 首版结果人工过一遍——失败要么修，要么显式接受进基线，别把失败锁成常态。
        changed = False
        for e in entries:
            changed = baseline.upsert(data, e) or changed
        baseline.save(data, BASELINE_PATH)
        print(f"\n--establish：已写入基线 {len(entries)} 条条目 → {BASELINE_PATH}"
              "（未做退步判定；首版结果请人工过一遍，失败项要么修、要么显式标注理由）")
        rc = 0
        # 🔴 有洞的条目不许静默成为「基线已建立」的一部分（实测：首版就这样漏进了
        #    14 条不受监控的话术）——点名、提示重跑，并以 exit 2 表明未产生完整结论。
        holes = unusable_holes(data, entries)
        if holes:
            report_unusable_holes(holes)
            rc = 2
        if case_slugs and not exec_ran:
            print("🔴 执行层未跑（缺前置条件），本次基线不含执行层条目。", file=sys.stderr)
            rc = 2
        return rc

    # ---- 比对 ----
    incomparable, regressions, improvements, fresh = [], [], [], []
    for e in entries:
        cmp = baseline.compare(data, e)
        if cmp["status"] == "incomparable":
            incomparable.append((e, cmp))
        elif cmp["status"] == "new":
            fresh.append(e)
        else:
            regressions += [(e, cid) for cid in cmp["regressions"]]
            improvements += [(e, cid) for cid in cmp["improvements"]]

    if incomparable:
        # spec：模型/runner 身份不一致 ⇒ MUST NOT 输出退步或改进结论。
        # 这里整体中止、基线一字不动——「换了尺子」下的任何比较数字都是误导。
        print("\n🔴 基线不可比（runner/模型标识与基线记录不一致，不输出退步或改进结论）：")
        for e, cmp in incomparable:
            print(f"  {e['skill']}/{e['kind']}: 本次 {cmp['want']}，基线已有 {cmp['have']}")
        print("   请在当前 runner/模型下重建基线：python3 tools/release_gate.py --establish")
        return 1

    if args.rounds < 3:
        # 少于 3 轮的结果不构成放行依据（spec：单轮结论不是证据）——
        # 判定照跑、比对结果当线索报出来，但不下退步结论、不更新基线、不放行。
        print(f"\n⚠️ 本次只跑了 {args.rounds} 轮（少于 3 轮）：结果不构成放行依据，"
              "基线未更新，不放行。放行判定必须 --rounds 3 起。")
        if regressions:
            print("  疑似退步（仅供参考）：" +
                  "、".join(f"{e['skill']}:{cid}" for e, cid in regressions))
        return 1

    accepted_tokens = set(args.accept_regression)
    reg_tokens = {f"{e['skill']}:{cid}" for e, cid in regressions}
    unknown = sorted(accepted_tokens - reg_tokens)
    if unknown:
        # 接受了不存在的退步 = 记账错位，宁可拦下让人重对一遍。
        print(f"🔴 --accept-regression 指到的不是本次退步条目：{unknown}", file=sys.stderr)
        return 1
    unaccepted = [(e, cid) for e, cid in regressions if f"{e['skill']}:{cid}" not in accepted_tokens]
    if unaccepted:
        print("\n🔴 退步（基线通过、本次稳定失败），已阻止放行，基线未改动：")
        for e, cid in unaccepted:
            print(f"  [{e['skill']}/{e['kind']}] {cid}")
        print("   修复后重跑；确要带伤发版：--accept-regression skill:case --reason「为什么接受」"
              "（理由会写进基线，随 diff 可见、可回溯）。")
        return 1

    # ---- 放行：把显式接受写进对应条目，更新基线 ----
    for e, cid in regressions:  # 走到这里 ⇒ 每一条退步都已被显式接受
        if "accepted_regressions" not in e:
            old = baseline.match(data, e)
            e["accepted_regressions"] = list(old.get("accepted_regressions", [])) if old else []
        baseline.accept(e, [cid], args.reason, date)

    changed = False
    for e in entries:
        changed = baseline.upsert(data, e) or changed
    wrote = baseline.save(data, BASELINE_PATH) if changed else False

    print()
    if regressions:
        print(f"结论：{len(regressions)} 条退步已显式接受放行（理由已写入基线）；其余无退步。")
    elif improvements or fresh:
        parts = []
        if improvements:
            parts.append(f"改进 {len(improvements)} 条")
        if fresh:
            parts.append(f"新入基线 {len(fresh)} 个包")
        print(f"结论：无退步（{'，'.join(parts)}），基线已更新。")
    else:
        print("结论：无退步（与基线一致），基线文件无变化。"
              if not wrote else "结论：无退步，基线已更新。")

    rc = 0
    # 🔴 洞不放行：写入后基线里仍含 unusable 的条目（同哈希历史回填不上的那些）
    #    说明质量门对这些用例没拿到可信答案——不是退步，但也绝不是「无退步放行」。
    #    exit 2 与「未跑」同一态度：拿不到结论 ≠ 通过。CI 侧 check_baseline 会兜底。
    holes = unusable_holes(data, entries)
    if holes:
        report_unusable_holes(holes)
        rc = 2
    if case_slugs and not exec_ran:
        print("\n🔴 执行层未跑（缺 DOUBAOYA_API_KEY 或沙箱等前置条件，见上方判定器输出）："
              "未跑 ≠ 通过，执行层基线条目未改写，本次不构成放行依据。", file=sys.stderr)
        rc = 2
    return rc


if __name__ == "__main__":
    sys.exit(main())
