from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "stamp_versions.py"
SPEC = importlib.util.spec_from_file_location("doubaoya_stamp_versions", MODULE_PATH)
assert SPEC and SPEC.loader
stamp_versions = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stamp_versions)


class StampVersionsTests(unittest.TestCase):
    def _make_skill(self, root: Path, name: str, skill_md: str, script: str) -> Path:
        skill_dir = root / "skills" / name
        (skill_dir / "scripts").mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
        (skill_dir / "scripts" / "run.py").write_text(script, encoding="utf-8")
        return skill_dir

    def test_hash_is_stable_across_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_dir = self._make_skill(root, "demo", "# demo\n", "print('hi')\n")
            first = stamp_versions.compute_skill_hash(skill_dir)
            second = stamp_versions.compute_skill_hash(skill_dir)
            self.assertEqual(first, second)
            self.assertEqual(len(first), 12)

    def test_hash_changes_when_script_content_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_dir = self._make_skill(root, "demo", "# demo\n", "print('hi')\n")
            before = stamp_versions.compute_skill_hash(skill_dir)
            (skill_dir / "scripts" / "run.py").write_text("print('bye')\n", encoding="utf-8")
            after = stamp_versions.compute_skill_hash(skill_dir)
            self.assertNotEqual(before, after)

    def test_hash_excludes_existing_version_file_self_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_dir = self._make_skill(root, "demo", "# demo\n", "print('hi')\n")
            before = stamp_versions.compute_skill_hash(skill_dir)
            (skill_dir / ".version").write_text("doubaoya-skill/demo@stale00000\n", encoding="utf-8")
            after = stamp_versions.compute_skill_hash(skill_dir)
            self.assertEqual(before, after, ".version 自身不应计入哈希（否则无法幂等自洽）")

    def test_stamp_all_writes_version_files_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_skill(root, "alpha", "# alpha\n", "print('a')\n")
            self._make_skill(root, "beta", "# beta\n", "print('b')\n")
            result = stamp_versions.stamp_all(root / "skills", root / "index.json", warn=lambda _m: None)

            self.assertEqual(set(result.keys()), {"alpha", "beta"})
            for name, value in result.items():
                self.assertTrue(value.startswith(f"doubaoya-skill/{name}@"))
                version_file = root / "skills" / name / ".version"
                self.assertTrue(version_file.is_file())
                self.assertEqual(version_file.read_text(encoding="utf-8").strip(), value)

            # 兼容视图 versions.json 仍然长老样子：主仓同步脚本与老对账器读的是它。
            manifest = json.loads((root / "versions.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["skills"], result)
            self.assertIn("generatedAt", manifest)
            index = json.loads((root / "index.json").read_text(encoding="utf-8"))
            for name in result:
                entry = index["skills"][name]
                self.assertEqual(entry["status"], "active")
                self.assertEqual(entry["versions"][0]["hash"], result[name].rsplit("@", 1)[1])

    def test_stamp_all_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_skill(root, "alpha", "# alpha\n", "print('a')\n")
            first = stamp_versions.stamp_all(root / "skills", root / "index.json", warn=lambda _m: None)
            second = stamp_versions.stamp_all(root / "skills", root / "index.json", warn=lambda _m: None)
            self.assertEqual(first, second, "内容不变时重复盖戳必须产出相同结果")

    def test_manifest_carries_release_ref(self):
        """对账器靠顶层 ref 把安装源固定到 repo#<tag>；字段永远为空 = 永远不固定。"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_skill(root, "alpha", "# alpha\n", "print('a')\n")
            versions_file = root / "versions.json"
            stamp_versions.stamp_all(root / "skills", root / "index.json", warn=lambda _m: None)
            manifest = json.loads(versions_file.read_text(encoding="utf-8"))
            self.assertRegex(manifest["ref"], r"^release-\d{8}-\d{4}$")
            self.assertEqual(stamp_versions.read_manifest_ref(versions_file), manifest["ref"])
            index = json.loads((root / "index.json").read_text(encoding="utf-8"))
            self.assertEqual(index["ref"], manifest["ref"], "视图的 ref 必须来自索引")

    def test_ref_is_kept_when_nothing_changed_and_rotated_when_hash_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_dir = self._make_skill(root, "alpha", "# alpha\n", "print('a')\n")
            index_file, versions_file = root / "index.json", root / "versions.json"
            stamp_versions.stamp_all(root / "skills", index_file, warn=lambda _m: None)
            # 把上一次的 ref 换成一个明显不同的合法值，看它是否被沿用
            index = json.loads(index_file.read_text(encoding="utf-8"))
            index["ref"] = "release-20000101-0000"
            index_file.write_text(json.dumps(index), encoding="utf-8")
            stamp_versions.stamp_all(root / "skills", index_file, warn=lambda _m: None)
            self.assertEqual(stamp_versions.read_manifest_ref(versions_file), "release-20000101-0000", "哈希没变时不该凭空换一个没人打过的 tag 名")
            (skill_dir / "scripts" / "run.py").write_text("print('b')\n", encoding="utf-8")
            stamp_versions.stamp_all(root / "skills", index_file, warn=lambda _m: None)
            self.assertNotEqual(stamp_versions.read_manifest_ref(versions_file), "release-20000101-0000", "哈希变了必须换新 ref")

    def test_make_ref_format_and_tag_reminder(self):
        from datetime import datetime, timezone

        ref = stamp_versions.make_ref(datetime(2026, 8, 25, 15, 41, tzinfo=timezone.utc))
        self.assertEqual(ref, "release-20260825-1541")
        reminder = stamp_versions.tag_reminder(ref)
        self.assertIn(f"git tag {ref}", reminder)
        self.assertIn(f"git push origin {ref}", reminder)

    def test_read_manifest_ref_rejects_garbage(self):
        with tempfile.TemporaryDirectory() as tmp:
            versions_file = Path(tmp) / "versions.json"
            self.assertIsNone(stamp_versions.read_manifest_ref(versions_file))
            versions_file.write_text(json.dumps({"ref": "main", "skills": {}}), encoding="utf-8")
            self.assertIsNone(stamp_versions.read_manifest_ref(versions_file), "ref 只认 release-YYYYMMDD-HHMM 这一种形态")


FRONTMATTER = "---\nname: alpha\ndescription: 演示\nversion: {version}\n{changelog}---\n\n# alpha\n"


class IndexVersionsTests(unittest.TestCase):
    """索引的 versions[]：变了插条目、没变不插；changelog 有写记 user、没写按档位生成 auto。"""

    def _skill(self, root: Path, version: str, changelog: str = "", script: str = "print('a')\n") -> Path:
        skill_dir = root / "skills" / "alpha"
        (skill_dir / "scripts").mkdir(parents=True, exist_ok=True)
        line = f"changelog: {changelog}\n" if changelog else ""
        (skill_dir / "SKILL.md").write_text(FRONTMATTER.format(version=version, changelog=line), encoding="utf-8")
        (skill_dir / "scripts" / "run.py").write_text(script, encoding="utf-8")
        return skill_dir

    def _stamp(self, root: Path) -> tuple[dict, list[str]]:
        warnings: list[str] = []
        stamp_versions.stamp_all(root / "skills", root / "index.json", warn=warnings.append)
        return json.loads((root / "index.json").read_text(encoding="utf-8")), warnings

    def test_changed_hash_inserts_a_new_version_entry_with_user_changelog(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._skill(root, "1.0.0", changelog="首发")
            index, _ = self._stamp(root)
            first = index["skills"]["alpha"]["versions"]
            self.assertEqual(len(first), 1)
            self.assertEqual((first[0]["version"], first[0]["changelog"], first[0]["changelogSource"]), ("1.0.0", "首发", "user"))
            self.assertRegex(first[0]["ref"], r"^release-\d{8}-\d{4}$")
            self.assertTrue(first[0]["releasedAt"])

            self._skill(root, "1.1.0", changelog="加了一个开关", script="print('b')\n")
            index, warnings = self._stamp(root)
            versions = index["skills"]["alpha"]["versions"]
            self.assertEqual(len(versions), 2, "哈希变了必须在头部插一条")
            self.assertEqual(versions[0]["version"], "1.1.0")
            self.assertEqual(versions[0]["changelog"], "加了一个开关")
            self.assertEqual(versions[0]["changelogSource"], "user")
            self.assertEqual(versions[1]["version"], "1.0.0", "旧条目原样往后排")
            self.assertEqual(versions[0]["hash"], (root / "skills" / "alpha" / ".version").read_text().strip().rsplit("@", 1)[1])
            self.assertFalse([w for w in warnings if "changelog" in w], warnings)

    def test_unchanged_hash_only_touches_generated_at(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._skill(root, "1.0.0", changelog="首发")
            before, _ = self._stamp(root)
            after, _ = self._stamp(root)
            self.assertEqual(before["skills"], after["skills"], "内容没变，versions 一个字都不许动")
            self.assertEqual(before["ref"], after["ref"])
            self.assertIn("generatedAt", after)

    def test_missing_changelog_gets_auto_placeholder_by_semver_level(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._skill(root, "1.0.0")
            index, warnings = self._stamp(root)
            head = index["skills"]["alpha"]["versions"][0]
            self.assertEqual(head["changelogSource"], "auto")
            self.assertIn("自动生成", head["changelog"])
            self.assertTrue(any("没写 changelog" in w for w in warnings), warnings)

            self._skill(root, "2.0.0", script="print('c')\n")
            index, warnings = self._stamp(root)
            head = index["skills"]["alpha"]["versions"][0]
            self.assertEqual(head["changelogSource"], "auto")
            self.assertIn("契约变更", head["changelog"], "major 档位的占位文案要说清老用法可能失效")
            self.assertTrue(any("major" in w for w in warnings), warnings)

    def test_user_changelog_wins_over_auto(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._skill(root, "1.0.0")
            self._stamp(root)
            self._skill(root, "1.0.1", changelog="修了个错别字", script="print('d')\n")
            index, warnings = self._stamp(root)
            head = index["skills"]["alpha"]["versions"][0]
            self.assertEqual((head["changelog"], head["changelogSource"]), ("修了个错别字", "user"))
            self.assertNotIn("自动生成", head["changelog"])

    def test_stale_user_changelog_is_warned_not_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._skill(root, "1.0.0", changelog="同一句")
            self._stamp(root)
            self._skill(root, "1.0.1", changelog="同一句", script="print('e')\n")
            index, warnings = self._stamp(root)
            self.assertEqual(index["skills"]["alpha"]["versions"][0]["changelogSource"], "user")
            self.assertTrue(any("一字未改" in w for w in warnings), warnings)

    def test_hand_written_fields_survive_restamping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._skill(root, "1.0.0", changelog="首发")
            index, _ = self._stamp(root)
            index["skills"]["alpha"]["displayName"] = "阿尔法"
            index["skills"]["alpha"]["topics"] = ["演示"]
            (root / "index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
            self._skill(root, "1.0.1", changelog="改一下", script="print('f')\n")
            index, _ = self._stamp(root)
            self.assertEqual(index["skills"]["alpha"]["displayName"], "阿尔法")
            self.assertEqual(index["skills"]["alpha"]["topics"], ["演示"])
            clawhub = json.loads((root / "tools" / "clawhub.json").read_text(encoding="utf-8"))
            self.assertEqual(clawhub["skills"]["alpha"], {"displayName": "阿尔法", "topics": ["演示"]})


class DriftReminderTests(unittest.TestCase):
    """漂移**产生**的那一刻就提醒：主仓那份生成表读的是 versions.json，哈希一变它就过期了。"""

    def _table(self, root: Path, entries: dict[str, str]) -> Path:
        table = root / stamp_versions.GENERATED_TABLE_NAME
        body = ",\n".join(f'  "{name}": "{value}"' for name, value in entries.items())
        table.write_text(
            "export const latestSkillVersions: Record<string, string> = {\n" + body + "\n};\n",
            encoding="utf-8",
        )
        return table

    def test_reminder_appears_when_a_hash_changed(self):
        message = stamp_versions.drift_reminder(
            {"alpha": "doubaoya-skill/alpha@old000000000"},
            {"alpha": "doubaoya-skill/alpha@new000000000"},
            table=None,
        )
        self.assertIsNotNone(message)
        self.assertIn("alpha", message)
        self.assertIn("1 个 skill", message)
        self.assertIn(stamp_versions.SYNC_COMMAND, message, "必须带上具体命令，不能只说「请同步」")
        self.assertIn("收不到更新提醒", message, "必须说清后果")

    def test_reminder_covers_added_and_removed_skills(self):
        message = stamp_versions.drift_reminder(
            {"gone": "doubaoya-skill/gone@aaaaaaaaaaaa"},
            {"fresh": "doubaoya-skill/fresh@bbbbbbbbbbbb"},
            table=None,
        )
        self.assertIn("gone", message)
        self.assertIn("fresh", message)

    def test_long_change_list_is_truncated(self):
        previous = {}
        versions = {f"s{i}": f"doubaoya-skill/s{i}@{i:012d}" for i in range(9)}
        message = stamp_versions.drift_reminder(previous, versions, table=None)
        self.assertIn("9 个 skill", message)
        self.assertIn("另有 4 个未列出", message)
        self.assertNotIn("s8", message)

    def test_no_reminder_when_nothing_changed(self):
        same = {"alpha": "doubaoya-skill/alpha@aaaaaaaaaaaa"}
        self.assertIsNone(stamp_versions.drift_reminder(same, dict(same), table=None))

    def test_no_reminder_when_nothing_changed_even_with_main_repo_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            same = {"alpha": "doubaoya-skill/alpha@aaaaaaaaaaaa"}
            table = self._table(Path(tmp), {"alpha": "doubaoya-skill/alpha@stale0000000"})
            self.assertIsNone(stamp_versions.drift_reminder(same, dict(same), table=table))

    def test_reminder_is_upgraded_when_main_repo_table_is_confirmed_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            table = self._table(Path(tmp), {"alpha": "doubaoya-skill/alpha@old000000000"})
            message = stamp_versions.drift_reminder(
                {"alpha": "doubaoya-skill/alpha@old000000000"},
                {"alpha": "doubaoya-skill/alpha@new000000000"},
                table=table,
            )
            self.assertIn("已确认", message)
            self.assertIn("1 条对不上", message)
            self.assertIn(stamp_versions.SYNC_COMMAND, message)

    def test_reminder_says_no_sync_needed_when_main_repo_table_already_matches(self):
        with tempfile.TemporaryDirectory() as tmp:
            table = self._table(Path(tmp), {"alpha": "doubaoya-skill/alpha@new000000000"})
            message = stamp_versions.drift_reminder(
                {"alpha": "doubaoya-skill/alpha@old000000000"},
                {"alpha": "doubaoya-skill/alpha@new000000000"},
                table=table,
            )
            self.assertIn("无需再同步", message)
            self.assertNotIn(stamp_versions.SYNC_COMMAND, message)

    def test_unreadable_main_repo_table_falls_back_to_generic_reminder(self):
        with tempfile.TemporaryDirectory() as tmp:
            message = stamp_versions.drift_reminder(
                {},
                {"alpha": "doubaoya-skill/alpha@new000000000"},
                table=Path(tmp) / "does-not-exist.ts",
            )
            self.assertIn(stamp_versions.SYNC_COMMAND, message)
            self.assertNotIn("已确认", message)

    def test_locate_generated_table_returns_none_when_main_repo_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {stamp_versions.CATALOG_ENV: str(Path(tmp) / "nowhere" / "index.ts")}
            with mock.patch.dict(os.environ, env):
                self.assertIsNone(stamp_versions.locate_generated_table())

    def test_locate_generated_table_follows_catalog_env_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            table = self._table(Path(tmp), {"alpha": "doubaoya-skill/alpha@aaaaaaaaaaaa"})
            with mock.patch.dict(os.environ, {stamp_versions.CATALOG_ENV: str(Path(tmp) / "index.ts")}):
                self.assertEqual(stamp_versions.locate_generated_table(), table)


class ReadManifestSkillsTests(unittest.TestCase):
    def test_missing_or_broken_manifest_reads_as_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "versions.json"
            self.assertEqual(stamp_versions.read_manifest_skills(missing), {})
            missing.write_text("{ not json", encoding="utf-8")
            self.assertEqual(stamp_versions.read_manifest_skills(missing), {})

    def test_reads_skills_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "versions.json"
            manifest.write_text(
                json.dumps({"generatedAt": "x", "skills": {"alpha": "doubaoya-skill/alpha@a"}}),
                encoding="utf-8",
            )
            self.assertEqual(
                stamp_versions.read_manifest_skills(manifest),
                {"alpha": "doubaoya-skill/alpha@a"},
            )


if __name__ == "__main__":
    unittest.main()
