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


if __name__ == "__main__":
    unittest.main()
