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
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

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


def ask(prompt: str, model: str, valid: set[str], tries: int = 2) -> str | None:
    """返回模型挑中的 slug；拿不到可信答案返回 None（计为不可用，不编一个）。

    🔴 不要把 stdout 的最后一行**当作**答案——要**校验**它。CLI 会往 stdout 混进自己的
       诊断行（实测见过 `Client.listTools() called but server does not advertise tools
       capability - returning empty list`），照单全收会把噪声记成一次"模型选择"，
       再被多轮比较判成"抖动"，于是真实抖动率被噪声顶高、判据失真。
       判据只认候选集里的名字或 none，其余一律不算数。
    """
    for _ in range(tries):
        try:
            p = subprocess.run(
                ["claude", "-p", "--model", model, prompt],
                capture_output=True, text=True, timeout=120,
            )
        except FileNotFoundError:
            print("🔴 找不到 `claude` CLI —— 装了才能跑真实盲测；只想自检用例用 --dry。", file=sys.stderr)
            raise SystemExit(2)
        except subprocess.TimeoutExpired:
            continue
        if p.returncode != 0:
            continue
        for line in reversed(p.stdout.strip().split("\n")):
            tok = line.strip().strip("`'\"。 ")
            if tok in valid or tok == "none":
                return tok
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skills", help="逗号分隔，只测这几个包；默认测所有有 evals 的包")
    ap.add_argument("--rounds", type=int, default=3, help="跑几轮（默认 3，判定只认每轮一致的用例）")
    ap.add_argument("--dry", action="store_true", help="不调模型，只自检候选集与用例")
    ap.add_argument("--model", default="sonnet", help="盲测用哪个模型（默认 sonnet）")
    ap.add_argument("--workers", type=int, default=8, help="并发数（默认 8）")
    ap.add_argument("--json", help="把逐轮原始结果写进这个文件")
    args = ap.parse_args()

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

    print(f"模型 {args.model}，并发 {args.workers}")
    done = [0]

    def run_one(c):
        pick = ask(build_prompt(catalog, c["q"]), args.model, set(catalog))
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

    if args.json:
        Path(args.json).write_text(
            json.dumps({"rounds": args.rounds, "stable": stable, "flaky": flaky, "unusable": unusable,
                        "per_skill": {k: dict(v) for k, v in per.items()}},
                       ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n逐轮原始结果 → {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
