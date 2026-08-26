from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


TOOLS = Path(__file__).resolve().parents[1]


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, TOOLS / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


publisher = _load("doubaoya_clawhub_publish", "clawhub_publish.py")
validator = _load("doubaoya_community_validator_for_clawhub", "validate_community.py")


class ClawhubManifestTests(unittest.TestCase):
    def test_real_manifest_covers_every_skill(self):
        manifest = publisher.load_manifest()
        publisher.check_coverage(manifest, publisher.discover_slugs())

    def test_real_manifest_passes_the_repository_validator(self):
        validator.validate_clawhub_manifest()

    def test_coverage_rejects_a_missing_skill(self):
        manifest = {"schema_version": 1, "owner": "acme", "skills": {"a": {"displayName": "甲"}}}
        with self.assertRaisesRegex(publisher.ManifestError, r"missing=\['b'\]"):
            publisher.check_coverage(manifest, ["a", "b"])

    def test_coverage_rejects_a_stale_entry(self):
        manifest = {"schema_version": 1, "owner": "acme", "skills": {"a": {"displayName": "甲"}, "gone": {"displayName": "旧"}}}
        with self.assertRaisesRegex(publisher.ManifestError, r"extra=\['gone'\]"):
            publisher.check_coverage(manifest, ["a"])

    @staticmethod
    def _index(skills: dict) -> dict:
        return {"schemaVersion": 1, "generatedAt": "x", "ref": "release-20260101-0000", "owner": "acme", "skills": skills}

    def test_load_manifest_rejects_a_blank_display_name(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "index.json"
            path.write_text(
                json.dumps(self._index({"a": {"displayName": "  ", "topics": [], "status": "active", "knownHashes": [], "versions": []}})),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(publisher.ManifestError, "displayName"):
                publisher.load_manifest(path)

    def test_load_manifest_takes_version_and_changelog_from_the_index_and_skips_non_active(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "index.json"
            head = {"version": "1.2.3", "hash": "a" * 12, "ref": "release-20260101-0000", "releasedAt": "x",
                    "changelog": "这一版改了什么", "changelogSource": "user"}
            path.write_text(json.dumps(self._index({
                "a": {"displayName": "甲", "topics": ["t"], "status": "active", "knownHashes": ["a" * 12], "versions": [head]},
                "old-a": {"displayName": "old-a", "topics": [], "status": "renamed", "redirectTo": "a", "knownHashes": [], "versions": []},
                "gone": {"displayName": "gone", "topics": [], "status": "retired", "knownHashes": [], "versions": []},
            }), ensure_ascii=False), encoding="utf-8")
            manifest = publisher.load_manifest(path)
            self.assertEqual(set(manifest["skills"]), {"a"}, "改名 / 下架的条目不上架")
            self.assertEqual(manifest["owner"], "acme")
            self.assertEqual(manifest["skills"]["a"], {"displayName": "甲", "topics": ["t"], "version": "1.2.3", "changelog": "这一版改了什么"})

    def test_real_index_gives_every_skill_a_version_and_changelog(self):
        manifest = publisher.load_manifest()
        for slug, entry in manifest["skills"].items():
            self.assertRegex(entry["version"], r"^\d+\.\d+\.\d+$", slug)
            self.assertTrue(entry["changelog"].strip(), f"{slug} 的当前版没有 changelog")


class ClawhubCommandTests(unittest.TestCase):
    # slug 用**虚构**的 demo-skill，不用仓里真实存在的包名：build_command 只做字符串拼装、
    # 不碰磁盘，用真名换不来任何覆盖度，却会跟着那个包一起退役
    # （这份 fixture 原本写的是 gzh-search，两批合并之后那个包就没了）。
    MANIFEST = {
        "schema_version": 1,
        "owner": "doubaoya",
        "skills": {"demo-skill": {"displayName": "公众号文章批量搜索", "topics": ["微信公众号", "选题"]}},
    }

    def test_command_carries_the_chinese_display_name(self):
        # ClawHub 不读 SKILL.md frontmatter，displayName 只能从 --name 来；漏了就变成 "Demo Skill"。
        command = publisher.build_command(self.MANIFEST, "demo-skill", root=Path("/repo"))
        self.assertEqual(command[command.index("--name") + 1], "公众号文章批量搜索")
        self.assertEqual(command[command.index("--owner") + 1], "doubaoya")
        self.assertEqual(command[command.index("--slug") + 1], "demo-skill")
        self.assertEqual(command[command.index("--topics") + 1], "微信公众号,选题")
        self.assertEqual(command[3], str(Path("/repo") / "skills" / "demo-skill"))

    def test_dry_run_and_commit_are_opt_in(self):
        plain = publisher.build_command(self.MANIFEST, "demo-skill")
        self.assertNotIn("--dry-run", plain)
        self.assertNotIn("--source-commit", plain)
        stamped = publisher.build_command(self.MANIFEST, "demo-skill", commit="deadbeef", dry_run=True)
        self.assertEqual(stamped[stamped.index("--source-commit") + 1], "deadbeef")
        self.assertEqual(stamped[-1], "--dry-run")

    def test_no_topics_means_no_empty_flag(self):
        manifest = {"schema_version": 1, "owner": "acme", "skills": {"a": {"displayName": "甲"}}}
        command = publisher.build_command(manifest, "a")
        self.assertNotIn("--topics", command)
        self.assertNotIn("--version", command)
        self.assertNotIn("--changelog", command)

    def test_command_carries_version_and_changelog_from_the_index(self):
        manifest = {"schema_version": 1, "owner": "acme", "skills": {
            "a": {"displayName": "甲", "topics": ["t"], "version": "2.0.0", "changelog": "契约变更，老用法可能失效"}}}
        command = publisher.build_command(manifest, "a")
        self.assertEqual(command[command.index("--version") + 1], "2.0.0")
        self.assertEqual(command[command.index("--changelog") + 1], "契约变更，老用法可能失效")


class RetirementGateTests(unittest.TestCase):
    """发布闸：挂了「⛔ 已下架」牌的 Skill 不许被发上架。"""

    @staticmethod
    def _repo(directory: str, skills: dict[str, str]) -> Path:
        root = Path(directory)
        for slug, description in skills.items():
            skill = root / "skills" / slug
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                f"---\nname: {slug}\ndescription: >-\n  {description}\n---\n\n# {slug}\n",
                encoding="utf-8",
            )
        return root

    def test_the_real_retired_skills_are_refused(self):
        # 这张清单是**账本**，不是断言糖：真仓库里挂了下架牌的就该恰好是这些。
        # 新下架一个能力时这条会打红 —— 那正是它的用途，把清单补上即可。
        # mera 的壳 2026-08-18 删除、seedream-5-lite 的墓碑壳 2026-08-19 删除
        # （两者的**能力**本就已退役），账本随之清空。
        # 🔴 空账本不等于闸没用：下面 test_marker_is_read_from_the_skill_not_hardcoded_by_slug
        # 用合成样本证明「挂牌就拒、摘牌就放行」，闸的行为与本账本是否为空无关。
        expected = []
        publishable, refused = publisher.partition_publishable(publisher.discover_slugs())
        self.assertEqual(sorted(slug for slug, _ in refused), expected)
        for slug, reason in refused:
            self.assertNotIn(slug, publishable)
            self.assertIn("已下架", reason)

    def test_every_other_skill_still_publishes(self):
        # 一条坏的不该阻断全部。
        slugs = publisher.discover_slugs()
        publishable, refused = publisher.partition_publishable(slugs)
        self.assertEqual(len(publishable) + len(refused), len(slugs))
        # 别写死包名（原来写的是 image-gen，随批 3 退役了），也别写成
        # `assertIn(sorted(publishable)[0], publishable)` 那种恒真句——那比写死更糟，
        # 它永远绿，等于没有断言。要证的性质是：**没被拒的就该全部在可发布里**。
        self.assertTrue(publishable, "一个可发布的包都没有，说明闸把全部包都拒了")
        self.assertEqual(sorted(publishable), sorted(set(slugs) - {slug for slug, _ in refused}))

    def test_marker_is_read_from_the_skill_not_hardcoded_by_slug(self):
        # 变异验证的自动化版本：同一个 slug，挂牌就拒，摘牌就放行——闸读的是标记不是名字。
        with tempfile.TemporaryDirectory() as directory:
            root = self._repo(directory, {"seedream-5-lite": "⛔ 已下架，请勿使用。改用 image-gen。"})
            self.assertIsNotNone(publisher.retirement_reason("seedream-5-lite", root=root))
        with tempfile.TemporaryDirectory() as directory:
            root = self._repo(directory, {"seedream-5-lite": "本鸭帮你一行命令出图。"})
            self.assertIsNone(publisher.retirement_reason("seedream-5-lite", root=root))

    def test_merely_mentioning_a_retirement_elsewhere_is_not_a_marker(self):
        # 判据是位置锚定的挂牌，不是关键词匹配：正文里提到下架、或 description 中段提到，都不算。
        with tempfile.TemporaryDirectory() as directory:
            root = self._repo(
                directory,
                {
                    "talks-about-it": "查公众号文章。注意 seedream-lite 已下架，⛔ 别再调它。",
                    "plain-single-line": "正常能力。",
                },
            )
            (root / "skills" / "plain-single-line" / "SKILL.md").write_text(
                "---\nname: plain-single-line\ndescription: 正常能力，随手提一句 ⛔ 已下架 的旧能力。\n---\n",
                encoding="utf-8",
            )
            self.assertIsNone(publisher.retirement_reason("talks-about-it", root=root))
            self.assertIsNone(publisher.retirement_reason("plain-single-line", root=root))

    def test_single_line_description_can_also_carry_the_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self._repo(directory, {"gone": "x"})
            (root / "skills" / "gone" / "SKILL.md").write_text(
                "---\nname: gone\ndescription: ⛔ 已下架，请改用别的。\n---\n",
                encoding="utf-8",
            )
            self.assertIn("已下架", publisher.retirement_reason("gone", root=root) or "")


if __name__ == "__main__":
    unittest.main()
