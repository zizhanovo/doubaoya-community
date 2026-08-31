#!/usr/bin/env python3
"""触发率盲测：一句用户话术，agent 会挑中哪个 dby-* 包？

为什么本仓自建，而不用 skill-forge 的 trigger-bench.mjs
（规格见 openspec/changes/router-trigger-ownership，design.md 的 D9）：

  那个脚本把**本机全部已装 skill** 的 name+description 打包发给模型。开发机上装着
  一堆与本仓无关的私有 skill（心理咨询、PM 系列……），这有两个问题：
    ① 不必要地把仓外数据送进 prompt；
    ② 候选集里混进永远不该命中的干扰项，噪声进了分母，结果反而更难读。
  本脚本的候选集**只取 skills/ 下的 dby-* 包**——用户装的是这些，撞的也是这些。

判据来源：各包自己的 `evals/triggers.jsonl`，每行 `{"q": "...", "expect": true|false}`，
`expect` 是**单包视角**的布尔：true = 这句话该命中本包，false = 该命中别的包。
同一句话可以在多个包的 jsonl 里出现（一处 true、别处 false），这正是"互撞对"的写法。

🔴 为什么要多轮：本仓实证过盲测会抖（同一状态跑 3 次，56 条话术里有 7–11 条 pick 会变）。
   所以默认 --rounds 3，只有**每轮结果都一致**的用例才计入判定；抖的单独列出，
   不作为放行或回滚的依据。单轮结论不构成证据。

用法：
    python3 tools/trigger_bench.py --dry                  # 不调模型，自检用例与候选集
    python3 tools/trigger_bench.py --skills dby,dby-api   # 只测这几个包
    python3 tools/trigger_bench.py --rounds 3 --json out.json

退出码：0 = 跑完（判定结果看输出）；1 = 用例/候选集有问题；2 = 模型调用不可用。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import runners  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"


def discover() -> dict[str, dict]:
    """候选集 = skills/ 下每个包的 name + description。只此一处，不碰仓外。"""
    out = {}
    for skill_md in sorted(SKILLS.glob("*/SKILL.md")):
        slug = skill_md.parent.name
        text = skill_md.read_text(encoding="utf-8")
        m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
        if not m:
            continue
        fm = m.group(1)
        d = re.search(r"^description:\s*(.*?)(?=^\w+:|\Z)", fm, re.S | re.M)
        if not d:
            continue
        desc = d.group(1)
        # 折叠块 `>-` 与多行缩进都压成一行
        desc = re.sub(r"^\s*>-?\s*", "", desc)
        desc = " ".join(line.strip() for line in desc.split("\n") if line.strip())
        out[slug] = {"slug": slug, "description": desc}
    return out


def load_cases(slug: str) -> list[dict]:
    path = SKILLS / slug / "evals" / "triggers.jsonl"
    if not path.exists():
        return []
    cases = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            raise SystemExit(f"{path}:{i} 不是合法 JSON：{e}")
        if not isinstance(obj.get("q"), str) or not isinstance(obj.get("expect"), bool):
            raise SystemExit(f'{path}:{i} 格式错：需要 {{"q": str, "expect": bool}}，实际 {obj!r}')
        cases.append({"q": obj["q"], "expect": obj["expect"], "owner": slug, "line": i})
    return cases


def build_prompt(catalog: dict[str, dict], q: str) -> str:
    listing = "\n".join(f"- {s['slug']}: {s['description']}" for s in catalog.values())
    return (
        "下面是一组可用的 skill，每行是「名字: 描述」。\n\n"
        f"{listing}\n\n"
        f"用户说：{q}\n\n"
        "只回答一个 skill 的名字（就是上面列表里的某个名字），不要解释、不要标点、不要引号。"
        "如果没有任何一个合适，回答 none。"
    )


def ask(prompt: str, model: str | None, valid: set[str], runner: str = "claude",
        meta: dict | None = None) -> str | None:
    """返回模型挑中的 slug；拿不到可信答案返回 None（计为不可用，不编一个）。

    🔴 「不把 stdout 最后一行**当作**答案，而是**校验**它落在候选集或 none 里」
       这条教训（CLI 会往 stdout 混诊断行，照单全收会把噪声记成一次"模型选择"、
       再被多轮比较判成"抖动"，顶高真实抖动率）已随后端抽象下沉到 tools/runners.py
       ——取值域校验与后端无关，任何 runner 都适用。这里只负责把候选集扩成
       「slug ∪ none」再交给 runner；默认 runner 仍是 claude，行为与旧版一致。

    model=None = 用后端 CLI 自己的默认（pi 只有这个形态实测可用，见 runners.py）；
    meta 传 dict 时会被写入实际使用的 provider/model 及其来源。
    """
    return runners.ask(runner, prompt, model, valid | {"none"}, meta=meta)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skills", help="逗号分隔，只测这几个包；默认测所有有 evals 的包")
    ap.add_argument("--rounds", type=int, default=3, help="跑几轮（默认 3，判定只认每轮一致的用例）")
    ap.add_argument("--dry", action="store_true", help="不调模型，只自检候选集与用例")
    # 🔴 模型默认按后端解析（runners.DEFAULT_MODELS）：sonnet 只对 claude 成立，
    #    实测 `pi --model sonnet` 被解析到无 key 的 amazon-bedrock 直接报错。
    ap.add_argument("--model", default=None,
                    help="盲测用哪个模型（默认按后端定：claude=sonnet，其余用 CLI 自己的默认）")
    ap.add_argument("--runner", default="claude", choices=sorted(runners.RUNNERS),
                    help="盲测用哪个后端（默认 claude，与旧版行为一致；见 tools/runners.py）")
    ap.add_argument("--workers", type=int, default=8, help="并发数（默认 8）")
    ap.add_argument("--json", help="把逐轮原始结果写进这个文件")
    args = ap.parse_args()
    if args.model is None:
        args.model = runners.DEFAULT_MODELS[args.runner]

    catalog = discover()
    print(f"候选集：{len(catalog)} 个包 —— {', '.join(catalog)}")
    if not catalog:
        print("🔴 候选集为空", file=sys.stderr)
        return 1

    targets = args.skills.split(",") if args.skills else sorted(
        d.parent.parent.name for d in SKILLS.glob("*/evals/triggers.jsonl")
    )
    cases: list[dict] = []
    for slug in targets:
        if slug not in catalog:
            print(f"🔴 --skills 里的 {slug} 不在候选集里", file=sys.stderr)
            return 1
        c = load_cases(slug)
        if not c:
            print(f"🔴 {slug} 没有 evals/triggers.jsonl", file=sys.stderr)
            return 1
        cases.extend(c)
        print(f"  {slug}: {len(c)} 例（{sum(x['expect'] for x in c)} 正 / {sum(not x['expect'] for x in c)} 负）")
    print(f"用例合计 {len(cases)} 条 × {args.rounds} 轮")

    if args.dry:
        print("\n--dry：未调用模型。用例格式与候选集自检通过。")
        return 0

    print(f"后端 {args.runner}，模型 {args.model or '(CLI 默认)'}，并发 {args.workers}")
    done = [0]
    # 实际使用的 provider/model（design.md D4：基线记实际的尺子）。
    # 多线程共享一个 dict：各轮回报同一身份，重复覆盖无害。
    blind_meta: dict = {}

    def run_one(c):
        pick = ask(build_prompt(catalog, c["q"]), args.model, set(catalog),
                   runner=args.runner, meta=blind_meta)
        done[0] += 1
        print(f"\r  {done[0]}/{len(cases) * args.rounds}", end="", file=sys.stderr)
        return pick

    rounds: list[list[str | None]] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for r in range(args.rounds):
            rounds.append(list(pool.map(run_one, cases)))
    print(file=sys.stderr)

    # 三档，不是两档：拿不到可信答案（None）既不算判对也不算判错，更不算抖动——
    # 把它混进任何一档都会污染判据。
    stable, flaky, unusable = [], [], []
    for idx, c in enumerate(cases):
        picks = [rounds[r][idx] for r in range(args.rounds)]
        rec = dict(c, picks=picks)
        if any(p is None for p in picks):
            unusable.append(rec)
            continue
        # 🔴 稳不稳看**判定**，不看 pick 字符串。
        #    负例（expect=False）只关心"是不是本包"——它在几个别的包之间跳与本包无关，
        #    按字符串比会把这种无害的跳动记成抖动，把真实抖动率顶高。
        verdicts = {(p == c["owner"]) if c["expect"] else (p != c["owner"]) for p in picks}
        if len(verdicts) == 1:
            stable.append(rec)
        else:
            flaky.append(rec)

    per = {}
    for rec in stable:
        pick, owner, exp = rec["picks"][0], rec["owner"], rec["expect"]
        ok = (pick == owner) if exp else (pick != owner)
        st = per.setdefault(owner, Counter())
        st["正例总" if exp else "负例总"] += 1
        if ok:
            st["正例命中" if exp else "负例避开"] += 1
        else:
            rec["failed"] = True

    print(f"\n稳定 {len(stable)} 条，抖动 {len(flaky)} 条，取不到答案 {len(unusable)} 条（后两档不计入判定）\n")
    for slug in targets:
        s = per.get(slug, Counter())
        pt, ph = s["正例总"], s["正例命中"]
        nt, nh = s["负例总"], s["负例避开"]
        pr = f"{ph}/{pt}" + (f" ({ph / pt:.0%})" if pt else "")
        nr = f"{nt - nh}/{nt}" + (f" ({(nt - nh) / nt:.0%})" if nt else "")
        print(f"{slug:<20} 正例命中 {pr:<14} 负例误触 {nr}")

    bad = [r for r in stable if r.get("failed")]
    if bad:
        print("\n判错的稳定用例（这些是真信号）：")
        for r in bad:
            want = r["owner"] if r["expect"] else f"≠{r['owner']}"
            print(f"  [{r['owner']}:{r['line']}] {r['q']}  期望 {want}  实际 {r['picks'][0]}")
    if flaky:
        print("\n抖动用例（多跑几轮也定不下来，先记着，别拿它下结论）：")
        for r in flaky:
            print(f"  [{r['owner']}:{r['line']}] {r['q']}  {r['picks']}")

    if unusable:
        print("\n取不到可信答案的用例（模型没回候选集里的名字 / 调用失败）：")
        for r in unusable:
            print(f"  [{r['owner']}:{r['line']}] {r['q']}  {r['picks']}")
        # 🔴 实测教训（2026-08-31）：首版 --establish 一次跑 243 条 × 3 轮 = 729 次
        #    调用、8 并发，dby-charter 被判出 14/18 不可用；单独重跑同一包 18/18
        #    稳定、零不可用——成片 unusable 多是大并发撞限流/超时的产物，不是包的
        #    缺陷。runners.ask 已带指数退避兜瞬时故障；仍成片时降并发重跑受影响的包。
        print("  提示：成片的 unusable 多为大并发撞限流/超时——"
              f"建议降低 --workers（本次 {args.workers}）后只对受影响的包重跑，"
              "别把假性不可用当包的缺陷。")

    if args.json:
        # blind 身份块（design.md D4）：model 尽量记实际值（pi 的 JSON 会回报），
        # model_source 区分 "reported"（实测值）与 "requested"（请求值，claude/codex
        # 拿不到实际模型 ID 时的退路）——两种来源不许混在一个字段里看不出差别。
        if blind_meta.get("source") == "reported":
            blind = {"runner": args.runner, "model": blind_meta.get("model"),
                     "provider": blind_meta.get("provider"), "model_source": "reported",
                     "model_requested": args.model}
        else:
            blind = {"runner": args.runner, "model": args.model,
                     "model_source": "requested", "model_requested": args.model}
        Path(args.json).write_text(
            json.dumps({"rounds": args.rounds, "blind": blind,
                        "stable": stable, "flaky": flaky, "unusable": unusable,
                        "per_skill": {k: dict(v) for k, v in per.items()}},
                       ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n逐轮原始结果 → {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
