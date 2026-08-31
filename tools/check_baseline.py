#!/usr/bin/env python3
"""发版质量门——两段式里 **CI（纯离线）** 这一段（design.md D3）。

查两件事：本次发版涉及的每个包，其**当前内容哈希**在 evals/baseline.json
里 ① 有没有记录，② 记录里有没有 **unusable 洞**。有无洞的记录 = 发布者在本地
对这一版内容跑过质量门并产出了结论（tools/release_gate.py 写入的）；
没记录或有洞 = 质量门未对这一版产生（完整的）结论，中止发版
——spec「未跑质量门就发版 → 中止」由这里强制。

🔴 为什么「有记录」不够、必须再查洞（design.md D4b，2026-08-31 实测教训）：
   首版 --establish 大并发（243 条 × 3 轮、8 并发）撞限流，把 dby-charter 判出
   18 条话术 14 条 unusable（单独重跑 18/18 稳定——洞是限流产物不是包缺陷）。
   而本脚本旧实现全文不含 unusable 字样，只查「(skill, hash) 有没有条目」——
   一条塞满 unusable 的条目照样让 CI 放行；比对逻辑那边退步又只认
   「基线 pass、本次 fail」，基线是 unusable 就永远比不出退步。后果：那 14 条
   话术从此不受监控，且没有任何地方会红——看着覆盖了，其实没有。
   现在：哈希算「有结论」的前提是该 (skill, hash) 下**所有**条目零 unusable。

🔴 这一段**不调模型、不配密钥、不联网判定**——这是 D3 的核心：
   昂贵、会抖、会不可用的那半留在本地由发布者主动跑；CI 只查本仓文件，
   因此零假阳性，永远不会因为网络或模型抖动拦错人。
   （CI 里跑模型判定的替代方案在 design.md 里已否决：要凭空扩大凭证暴露面，
   且 CI 环境下的模型行为与开发机不一致，会把噪声写进基线。）

「本次发版涉及的包」怎么定：index.json 里 versions[0].ref == 本次 tag 的 active 包
——盖戳脚本只给这批哈希变了的包插新头条，正是这次要发出去的内容。
哈希不信任 index 里记的那份，而是用 stamp_versions.compute_skill_hash 现场重算
——同一把尺子，还顺带兜住「基线记的是旧内容」的错位。

用法：
    python3 tools/check_baseline.py release-20260831-0756   # CI：查这个 tag 涉及的包
    python3 tools/check_baseline.py                         # 本地：查全部在架包

退出码：0 = 全部有记录（或 tag 早于索引机制，跳过）；1 = 有包缺结论，中止发版。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import baseline as baseline_mod  # noqa: E402  「洞」的定义只有一处（unusable_cases），不复制
from stamp_versions import compute_skill_hash  # noqa: E402  哈希必须与盖戳/基线同一把尺子

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "index.json"
SKILLS = ROOT / "skills"
BASELINE_PATH = ROOT / "evals" / "baseline.json"


def involved_skills(tag: "str | None") -> "list[str]":
    """本次发版涉及的包。给了 tag 就按 index.json 的头条 ref 圈定；
    没给 tag（本地手跑）就查全部有 SKILL.md 的在架目录。"""
    if tag is None:
        return sorted(p.parent.name for p in SKILLS.glob("*/SKILL.md"))
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    out = []
    for slug, entry in index.get("skills", {}).items():
        if entry.get("status") != "active":
            continue
        versions = entry.get("versions") or []
        if versions and versions[0].get("ref") == tag:
            out.append(slug)
    return sorted(out)


def main(argv: "list[str] | None" = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    tag = argv[0] if argv else None

    slugs = involved_skills(tag)
    if tag and not slugs:
        # 与 release_notes.py 的老 tag 兜底同一态度：早于索引/基线机制的 tag 不拦。
        print(f"{tag} 下没有盖过戳的包（早于索引机制或空发版），离线校验跳过。")
        return 0

    if not BASELINE_PATH.exists():
        print("🔴 evals/baseline.json 不存在——质量门从未产生结论，中止发版。\n"
              "   先在本地跑 python3 tools/release_gate.py --establish 建立基线并提交。",
              file=sys.stderr)
        return 1

    entries = json.loads(BASELINE_PATH.read_text(encoding="utf-8")).get("entries", [])
    # (skill, hash) → 该哈希下全部条目累积的 unusable 洞（"kind:用例" 清单）。
    # 哈希在键里出现 = 有记录；对应清单为空 = 记录无洞，才算有结论。
    recorded: "dict[str, dict[str, list[str]]]" = {}
    for e in entries:
        holes = [f"{e.get('kind')}:{cid}" for cid in baseline_mod.unusable_cases(e)]
        recorded.setdefault(e.get("skill"), {}).setdefault(e.get("hash"), []).extend(holes)

    missing = []
    for slug in slugs:
        skill_dir = SKILLS / slug
        if not (skill_dir / "SKILL.md").is_file():
            missing.append((slug, "skills/ 下找不到该包目录"))
            continue
        h = compute_skill_hash(skill_dir)
        by_hash = recorded.get(slug, {})
        if h not in by_hash:
            missing.append((slug, f"当前内容哈希 {h} 在基线中无记录"))
        elif by_hash[h]:
            # 有记录但有洞：拿不到可信答案的用例既过不了退步比对（基线不是 pass
            # 就永远比不出退步），也不该被「存在性」放行——放行即产生监控盲区。
            missing.append((slug, f"基线条目含 unusable 洞（拿不到可信答案，"
                                  f"不构成质量门结论）：{'、'.join(by_hash[h])}"))
        else:
            print(f"  ✓ {slug} @ {h} 有无洞的基线记录")

    if missing:
        print("\n🔴 以下包缺质量门结论，中止发版（质量门未对这一版内容产生完整结论）：",
              file=sys.stderr)
        for slug, why in missing:
            print(f"  {slug}: {why}", file=sys.stderr)
        print("   修法：本地跑 python3 tools/release_gate.py（或首次 --establish），"
              "把 evals/baseline.json 一并提交后重新打 tag。\n"
              "   含 unusable 洞的多为大并发撞限流（实测：8 并发 729 次调用产出 14 条"
              "假性不可用，单独重跑全部稳定）——降低 --workers 只对受影响的包重跑即可补上。",
              file=sys.stderr)
        return 1

    print(f"\n离线校验通过：{len(slugs)} 个包的当前内容哈希均有无洞的基线记录。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
