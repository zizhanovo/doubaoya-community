"""版本戳必须与它所描述的内容一致。

🔴 这条守的不是整洁，是一个**静默且专打守规矩用户**的失败模式：

  戳落后于内容 ⇒ `.version` 停在旧哈希，而服务端从主仓同步的快照算出的是新哈希；
  更新提示的判据是「哈希不等即提示、无新旧概念」⇒
    用户看到提示 → 听话升级 → 装到的还是停在旧戳的包 → **提示不消失，永远循环**。
  越守规矩的人被打得越狠，而且**任何常规检查都不会因此变红** —— 推完一切都是绿的。

`.githooks/pre-commit` 会自动盖戳，但 `core.hooksPath` 是本机 git config、
**不随 clone 生效**：没配的人钩子静默不跑 —— 那正是本仓要消灭的那种静默。
所以钩子是**便利**（不必记得），本文件是**保证**（漏了会红）。两者缺一不可。
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import stamp_versions as sv  # noqa: E402


def _skill_dirs() -> list[Path]:
    return sorted(
        p for p in (ROOT / "skills").iterdir() if p.is_dir() and (p / "SKILL.md").is_file()
    )


def _dirty_skills() -> set[str]:
    """工作树里有未提交改动的 skill —— 这些跳过，理由见下。

    🔴 判据必须是「**已提交**内容与戳一致」，不是「工作树内容与戳一致」：
    发布出去的是提交里的东西；而多会话共用同一工作树时，别人正在改的包
    永远处于"内容已变、戳还没盖"的中间态 —— 拿工作树比会把那当成缺陷，
    于是这道闸对每个开发中的人常红，第二次就有人开始忽略它。
    **一道会误报的闸等于没有闸**（本仓在 pre-push 的注释里论证过同一条）。
    """
    import subprocess

    out = subprocess.run(
        ["git", "status", "--porcelain", "--", "skills/"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    dirty = set()
    for line in out.splitlines():
        rel = line[3:].strip().strip('"')
        parts = rel.split("/")
        if len(parts) < 2 or parts[0] != "skills":
            continue
        # 🔴 `.version` 自己被改动**不算在途**。
        #    否则会开一个洞：改坏一个包的戳 → 该包被判成"在途" → 跳过 → 闸放行。
        #    实测抓到过（反向测试①第一版 exit=0），判据必须只看**内容文件**。
        if parts[-1] == ".version":
            continue
        dirty.add(parts[1])
    return dirty


def test_found_enough_skills() -> None:
    """🔴 元断言：闸自身不许空跑。

    目录扫描一旦退化成空集，下面两条会零迭代而全绿 ——
    「没找到 skill 所以没有不一致」与「真的没有不一致」外部不可区分。
    """
    assert len(_skill_dirs()) >= 8, f"只扫到 {len(_skill_dirs())} 个 skill，多半是扫描退化了"


def test_每个包的戳与内容一致() -> None:
    dirty = _dirty_skills()
    checked = 0
    stale = []
    for d in _skill_dirs():
        if d.name in dirty:
            continue  # 在途改动，见 _dirty_skills 的注释
        checked += 1
        version_file = d / ".version"
        assert version_file.is_file(), f"{d.name} 缺 .version"
        actual = version_file.read_text(encoding="utf-8").strip()
        expected = f"doubaoya-skill/{d.name}@{sv.compute_skill_hash(d)}"
        if actual != expected:
            stale.append(f"{d.name}: 戳={actual} 实际内容={expected}")
    # 🔴 元断言：全都被当成"在途"跳过时，上面的循环零迭代而全绿。
    #    「没有可检查的包」与「所有包都一致」外部不可区分。
    assert checked >= 5, (
        f"只检查了 {checked} 个包（{len(dirty)} 个因在途改动跳过）—— "
        "跳得太多，这道闸已经失去判别力；先把在途改动提交掉再跑"
    )
    assert not stale, (
        "下列包的版本戳落后于内容：\n  "
        + "\n  ".join(stale)
        + "\n\n🔴 后果不是报错，是**假更新循环**：已装该版本的用户会看到更新提示，"
        "\n   听话升级后装到的仍是停在旧戳的包，于是提示不消失、永远循环，"
        "\n   而且专打守规矩的用户。修：跑 python3 tools/stamp_versions.py 并把产物一并提交"
        "\n   （配了 core.hooksPath=.githooks 的话 pre-commit 会自动做）。"
    )


def test_versions_manifest_与各包的_version_一致() -> None:
    """versions.json 是同一事实的第二份副本，两边不许漂。"""
    manifest = json.loads((ROOT / "versions.json").read_text(encoding="utf-8"))["skills"]
    names = {d.name for d in _skill_dirs()}
    dirty = _dirty_skills()
    assert set(manifest) == names, (
        f"versions.json 的 slug 集与 skills/ 不一致："
        f"多出 {sorted(set(manifest) - names)}，缺少 {sorted(names - set(manifest))}"
    )
    drift = [
        f"{d.name}: manifest={manifest[d.name]} .version={(d / '.version').read_text(encoding='utf-8').strip()}"
        for d in _skill_dirs()
        if d.name not in dirty
        and manifest[d.name] != (d / ".version").read_text(encoding="utf-8").strip()
    ]
    assert not drift, "versions.json 与 .version 漂了：\n  " + "\n  ".join(drift)
