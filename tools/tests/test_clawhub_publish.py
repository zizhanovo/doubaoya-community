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

    def test_load_manifest_rejects_a_blank_display_name(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clawhub.json"
            path.write_text(
                json.dumps({"schema_version": 1, "owner": "acme", "skills": {"a": {"displayName": "  "}}}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(publisher.ManifestError, "displayName"):
                publisher.load_manifest(path)


class ClawhubCommandTests(unittest.TestCase):
    MANIFEST = {
        "schema_version": 1,
        "owner": "doubaoya",
        "skills": {"gzh-search": {"displayName": "公众号文章批量搜索", "topics": ["微信公众号", "选题"]}},
    }

    def test_command_carries_the_chinese_display_name(self):
        # ClawHub 不读 SKILL.md frontmatter，displayName 只能从 --name 来；漏了就变成 "Gzh Search"。
        command = publisher.build_command(self.MANIFEST, "gzh-search", root=Path("/repo"))
        self.assertEqual(command[command.index("--name") + 1], "公众号文章批量搜索")
        self.assertEqual(command[command.index("--owner") + 1], "doubaoya")
        self.assertEqual(command[command.index("--slug") + 1], "gzh-search")
        self.assertEqual(command[command.index("--topics") + 1], "微信公众号,选题")
        self.assertEqual(command[3], str(Path("/repo") / "skills" / "gzh-search"))

    def test_dry_run_and_commit_are_opt_in(self):
        plain = publisher.build_command(self.MANIFEST, "gzh-search")
        self.assertNotIn("--dry-run", plain)
        self.assertNotIn("--source-commit", plain)
        stamped = publisher.build_command(self.MANIFEST, "gzh-search", commit="deadbeef", dry_run=True)
        self.assertEqual(stamped[stamped.index("--source-commit") + 1], "deadbeef")
        self.assertEqual(stamped[-1], "--dry-run")

    def test_no_topics_means_no_empty_flag(self):
        manifest = {"schema_version": 1, "owner": "acme", "skills": {"a": {"displayName": "甲"}}}
        self.assertNotIn("--topics", publisher.build_command(manifest, "a"))


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
        # mera 的壳 2026-08-18 已从仓库删除（平台能力本就已退役），账本随之只剩一条。
        expected = ["seedream-5-lite"]
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
        self.assertIn("image-gen", publishable)

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
