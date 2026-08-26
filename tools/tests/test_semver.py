"""语义版本：每个包必须有一个合法的 semver，且**内容变了它必须跟着变**。

## 为什么需要它（哈希已经有了，为什么还要一个人写的数）

内容哈希回答「**是不是同一份东西**」—— 机器要的，更新提示靠它。
semver 回答「**这次改了什么、会不会弄坏我**」—— 人要的，哈希永远答不了。

2026-08-22 真出过一次：`dby-image` 一条 BREAKING（出图改走 driver）**主动把用户升上来**，
而他们收到的全部信息是「有更新，运行 /dby-update」—— 一个字没说这是破坏性变更。

## 枢纽：让手写的数不骗人

哈希是派生的、不会骗人；semver 是人写的、**会烂** ——
实证：`dby-publish` 2026-08-22 一天内改了四次，frontmatter 仍停在 `1.4.0`。

所以本文件的价值不在「检查有没有版本号」，在这一条：

    内容哈希变了 ⇒ semver 必须也变，且严格递增。

哈希由此成为 semver 的**诚实性保证**。

🔴 **诚实边界**：这道闸只能强制「变了」，**判不出 major / minor / patch 选得对不对** ——
那需要人。别让它看起来能。口径写在 docs/versioning.md，供人判断时有依据。
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import warnings
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import stamp_versions as sv  # noqa: E402
import skill_index  # noqa: E402

SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def _skills() -> list[Path]:
    return sorted(p for p in (ROOT / "skills").iterdir() if (p / "SKILL.md").is_file())


def _declared(d: Path) -> str | None:
    for line in (d / "SKILL.md").read_text(encoding="utf-8").split("\n"):
        if line.startswith("version:"):
            return line[len("version:"):].strip()
    return None


def test_扫到了足够多的包() -> None:
    """🔴 元断言：闸自身不许空跑。

    目录扫描退化成空集时，下面每一条都会零迭代而全绿 ——
    「没找到包所以没问题」与「真的没问题」外部不可区分。
    """
    assert len(_skills()) >= 8, f"只扫到 {len(_skills())} 个包，多半是扫描退化了"


@pytest.mark.parametrize("d", _skills(), ids=lambda p: p.name)
def test_每个包都有合法的_semver(d: Path) -> None:
    v = _declared(d)
    assert v is not None, (
        f"{d.name} 的 SKILL.md frontmatter 缺 version: —— "
        "ClawHub 官方就读这里（文档例子逐字为 `version: 1.2.0`）"
    )
    assert SEMVER.match(v), (
        f"{d.name} 的 version 不是三段语义版本：{v!r}。"
        "只接受 `X.Y.Z`（三段非负整数，无前导零、无前缀 v、无预发布后缀）—— "
        "口径统一才比得出大小，递增闸才成立。"
    )


def _committed_stamp(slug: str) -> str | None:
    """上一次提交里那个包的 .version（用来判断"内容是不是变了"）。"""
    r = subprocess.run(
        ["git", "show", f"HEAD:skills/{slug}/.version"],
        cwd=ROOT, capture_output=True, text=True,
    )
    return r.stdout.strip() or None if r.returncode == 0 else None


def _committed_version(slug: str) -> str | None:
    r = subprocess.run(
        ["git", "show", f"HEAD:skills/{slug}/SKILL.md"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if r.returncode != 0:
        return None
    for line in r.stdout.split("\n"):
        if line.startswith("version:"):
            return line[len("version:"):].strip()
    return None


def _tuple(v: str) -> tuple[int, int, int]:
    m = SEMVER.match(v)
    assert m, v
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)))


def test_内容变了_semver_必须严格递增() -> None:
    """本文件的枢纽。

    判据是**逐段数值比较**，不是字符串比 —— `1.10.0` > `1.9.0` 而字符串比会判反。
    """
    checked = 0
    skipped_new = 0
    skipped_backfill = 0
    skipped_same = 0
    violations = []
    for d in _skills():
        slug = d.name
        old_stamp = _committed_stamp(slug)
        old_ver = _committed_version(slug)
        if old_stamp is None:
            skipped_new += 1
            continue  # 真·新包：上一版根本没有这个目录
        if old_ver is None or not SEMVER.match(old_ver):
            # 🔴 回填期：上一版还没有（合法的）semver，无从比较大小。
            #    这一档**必须与"新包"分开计数** —— 2026-08-22 实测，第一版把两者
            #    合并成 `old_ver is None: continue`，于是给 6 个老包首次补 version 那次，
            #    11 个包里只有 1 个被真正检查，而闸照样全绿。**闸在跑但没在判。**
            skipped_backfill += 1
            continue
        new_stamp = f"doubaoya-skill/{slug}@{sv.compute_skill_hash(d)}"
        new_ver = _declared(d)
        if new_stamp == old_stamp:
            skipped_same += 1
            continue  # 内容没变，版本不必动
        checked += 1
        if new_ver is None or not SEMVER.match(new_ver):
            continue  # 合法性由上面那条报，这里不重复
        if _tuple(new_ver) <= _tuple(old_ver):
            violations.append(f"{slug}: 内容变了但 version 是 {old_ver} → {new_ver}（未严格递增）")

    # 🔴 元断言：跳过太多时这道闸已经没有判别力，宁可红也不要假绿。
    #    回填期（skipped_backfill）是一次性的：所有包都补过 version 之后它必然归零。
    total = len(_skills())
    assert checked + skipped_new + skipped_backfill + skipped_same == total, (
        f"计数漏了包（{checked}+{skipped_new}+{skipped_backfill}+{skipped_same} != {total}）—— "
        "解析有问题，此时这道闸的判别力不可信"
    )

    assert not violations, (
        "下列包的内容变了而语义版本没跟上：\n  "
        + "\n  ".join(violations)
        + "\n\n哈希会如实变化，semver 不会 —— 这道闸就是拿哈希去逼它说实话。"
        "\n口径见 docs/versioning.md：patch=措辞/补例子，minor=新增能力或向后兼容的行为变化，"
        "\nmajor=破坏性（改名/删能力/红线变更/契约变更）。"
        "\n⚠️ 闸判不出你选得对不对，只判它变没变 —— 选哪一档是你的判断。"
    )


def test_versions_manifest_与_frontmatter_不冲突() -> None:
    """两处都叫"版本"，但是**两种不同的版本**，不许被混着读。

    versions.json 存的是**内容哈希**（doubaoya-skill/<slug>@<hash12>），
    frontmatter 存的是**语义版本**（X.Y.Z）。这条断言钉死它们形状不同，
    防止哪天有人"顺手统一"成一种，把两个不同的问题合并成一个答不了的问题。
    """
    manifest = json.loads((ROOT / "versions.json").read_text(encoding="utf-8"))["skills"]
    for d in _skills():
        assert "@" in manifest[d.name], f"{d.name} 在 versions.json 里不是哈希形态"
        v = _declared(d)
        if v:
            assert not SEMVER.match(manifest[d.name]), (
                f"{d.name}: versions.json 变成了语义版本形态 —— 它该存内容哈希。"
                "两者答的不是同一个问题，合并即失去其中一个。"
            )


def _committed_text(slug: str) -> str | None:
    r = subprocess.run(["git", "show", f"HEAD:skills/{slug}/SKILL.md"], cwd=ROOT, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def stale_changelogs(pairs: list[tuple[str, str, str]]) -> list[str]:
    """(slug, 上一版 SKILL.md, 当前 SKILL.md) → 「内容变了但 changelog 一字未改」的 slug。

    只看被点名的包（调用方已经判定哈希变了）。两边都没写也算「未改」——那正是 auto 占位会顶上的情形。
    """
    return [
        slug for slug, old, new in pairs
        if skill_index.frontmatter_field(old, "changelog") == skill_index.frontmatter_field(new, "changelog")
    ]


def test_哈希变了但_changelog_未变_只警告不红() -> None:
    """changelog 是给用户看的「这次改了什么」；哈希变了它没跟着变，用户看到的就是一句过期说明。

    🔴 只 warning 不 fail：第一趟发布时 11 个包都还没养成写 changelog 的习惯，红了等于把整仓卡住；
    盖戳会用 semver 档位生成 auto 占位顶上。升为阻断留给第二趟决定（design.md 风险表）。
    """
    pairs = []
    for d in _skills():
        slug = d.name
        old_stamp = _committed_stamp(slug)
        old_text = _committed_text(slug)
        if old_stamp is None or old_text is None:
            continue
        new_stamp = f"doubaoya-skill/{slug}@{sv.compute_skill_hash(d)}"
        if new_stamp != old_stamp:
            pairs.append((slug, old_text, (d / "SKILL.md").read_text(encoding="utf-8")))
    stale = stale_changelogs(pairs)
    if stale:
        warnings.warn(
            f"这些包的内容变了、frontmatter 的 changelog: 却一字未改：{stale}。"
            "用户在 dby-update 预检里看到的会是一句过期的变更说明——请在 SKILL.md 里更新 changelog:。",
            UserWarning,
            stacklevel=1,
        )


def test_stale_changelog_判定_合成样本() -> None:
    """闸的判据本身：同一句 ⇒ 过期；改了 ⇒ 不报；折叠块与单行同一口径。"""
    old = "---\nname: x\nversion: 1.0.0\nchangelog: 首发\n---\n"
    same = "---\nname: x\nversion: 1.0.1\nchangelog: 首发\n---\n"
    folded_same = "---\nname: x\nversion: 1.0.1\nchangelog: >-\n  首发\n---\n"
    changed = "---\nname: x\nversion: 1.0.1\nchangelog: 修了个错别字\n---\n"
    none_both = "---\nname: x\nversion: 1.0.1\n---\n"
    assert stale_changelogs([("a", old, same)]) == ["a"]
    assert stale_changelogs([("a", old, folded_same)]) == ["a"]
    assert stale_changelogs([("a", old, changed)]) == []
    assert stale_changelogs([("a", none_both, none_both)]) == ["a"], "两边都没写也算未改"
    with pytest.warns(UserWarning, match="一字未改"):
        if stale_changelogs([("a", old, same)]):
            warnings.warn("这些包的内容变了、changelog 一字未改", UserWarning, stacklevel=1)
