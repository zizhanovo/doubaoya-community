"""`known-hashes.json` 是**对外发布面**，它的老结构一个字节都不许动。

🔴 装在用户机器上的 dby-update 对账器按 raw URL 直取这份文件
（skills/dby-update/scripts/reconcile.mjs:69 的 KNOWN_URL），
并在 classify() 里做 **`knownHashes[name].includes(hash)`**（同文件 :121）。

把 `skills` 的数组元素从字符串改成对象，那一行当场失效 ⇒
所有历史包被判成 `foreign` ⇒ **每一台已安装的机器对账全错**，而且是静默的
（它不会报错，只会把用户自己的包认成别人的）。

所以新信息只能加**兄弟键**（versionLog），不能改原地。本文件把这条钉死。
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KNOWN = json.loads((ROOT / "known-hashes.json").read_text(encoding="utf-8"))
HASH = re.compile(r"^[0-9a-f]{12}$")


def test_skills_仍是_slug_到字符串数组() -> None:
    skills = KNOWN["skills"]
    assert isinstance(skills, dict) and skills, "skills 不是非空对象"
    for slug, arr in skills.items():
        assert isinstance(arr, list), f"{slug} 的值不是数组"
        for h in arr:
            assert isinstance(h, str), (
                f"{slug} 的数组元素是 {type(h).__name__} 而不是字符串 —— "
                "已安装的 reconcile.mjs 做的是 .includes(hash)，"
                "改成对象会让每台机器把自己的包认成别人的（静默，不报错）"
            )
            assert HASH.match(h), f"{slug} 有个不像 12 位哈希的元素：{h!r}"


def test_元断言_扫到了足够多的条目() -> None:
    """闸自身不许空跑：skills 空了或解析退化时，上面那条会零迭代而全绿。"""
    total = sum(len(v) for v in KNOWN["skills"].values())
    assert len(KNOWN["skills"]) >= 50, f"只扫到 {len(KNOWN['skills'])} 个 slug"
    assert total >= 300, f"只扫到 {total} 个历史版本"


def test_versionLog_是兄弟键且不影响老结构() -> None:
    vl = KNOWN.get("versionLog")
    assert isinstance(vl, dict) and vl, "versionLog 缺失或为空"
    for slug, entries in vl.items():
        assert slug in KNOWN["skills"], f"versionLog 里的 {slug} 不在 skills 里"
        for e in entries:
            assert set(e) == {"hash", "version", "date", "subject"}, (
                f"{slug} 的条目字段是 {sorted(e)} —— 形状变了，消费方会读空"
            )
            assert HASH.match(e["hash"])
            # version 允许留空：早期版本发布时 frontmatter 里根本没有它，
            # 追认一个假的会让"跨度说明"凭空多出没发生过的中间版本。
            assert e["version"] == "" or re.fullmatch(r"\d+\.\d+\.\d+", e["version"]), e


def test_versionLog_里的哈希都在闭集里() -> None:
    """两处不许漂：日志里出现的版本，闭集必须认得。"""
    drift = [
        f"{slug}:{e['hash']}"
        for slug, entries in KNOWN["versionLog"].items()
        for e in entries
        if e["hash"] not in KNOWN["skills"].get(slug, [])
    ]
    assert not drift, "versionLog 里有闭集不认识的哈希：" + ", ".join(drift[:5])
