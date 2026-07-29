from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


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


if __name__ == "__main__":
    unittest.main()
