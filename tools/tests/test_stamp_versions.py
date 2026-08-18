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
            versions_file = root / "versions.json"
            result = stamp_versions.stamp_all(root / "skills", versions_file)

            self.assertEqual(set(result.keys()), {"alpha", "beta"})
            for name, value in result.items():
                self.assertTrue(value.startswith(f"doubaoya-skill/{name}@"))
                version_file = root / "skills" / name / ".version"
                self.assertTrue(version_file.is_file())
                self.assertEqual(version_file.read_text(encoding="utf-8").strip(), value)

            manifest = json.loads(versions_file.read_text(encoding="utf-8"))
            self.assertEqual(manifest["skills"], result)
            self.assertIn("generatedAt", manifest)

    def test_stamp_all_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_skill(root, "alpha", "# alpha\n", "print('a')\n")
            versions_file = root / "versions.json"
            first = stamp_versions.stamp_all(root / "skills", versions_file)
            second = stamp_versions.stamp_all(root / "skills", versions_file)
            self.assertEqual(first, second, "内容不变时重复盖戳必须产出相同结果")


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
