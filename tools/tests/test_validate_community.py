from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest


VALIDATOR = Path(__file__).resolve().parents[1] / "validate_community.py"
SPEC = importlib.util.spec_from_file_location("doubaoya_community_validator", VALIDATOR)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


class CommunityValidatorTests(unittest.TestCase):
    def test_repository_is_valid(self):
        validator.validate_repository()

    def test_frontmatter_rejects_duplicate_name(self):
        with tempfile.TemporaryDirectory() as directory:
            skill = Path(directory) / "SKILL.md"
            skill.write_text("---\nname: first\nname: second\ndescription: fixture\n---\n", encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "invalid name frontmatter"):
                validator.frontmatter_name(skill)

    def test_vendor_manifest_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / "skills" / "wechat-mp-exporter"
            destination.parent.mkdir(parents=True)
            shutil.copytree(validator.MP_ARK, destination)
            with (destination / "SKILL.md").open("a", encoding="utf-8") as handle:
                handle.write("\nmodified\n")
            with self.assertRaisesRegex(validator.ValidationError, "SHA-256 mismatch"):
                validator.validate_vendor(root)

    def test_vendor_manifest_rejects_unknown_schema_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / "skills" / "wechat-mp-exporter"
            destination.parent.mkdir(parents=True)
            shutil.copytree(validator.MP_ARK, destination)
            provenance = destination / "assets" / "vendor-provenance.json"
            value = json.loads(provenance.read_text(encoding="utf-8"))
            value["source_checkout"] = str(Path("/", "Users", "example", "mp-ark"))
            provenance.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "unexpected vendor provenance keys"):
                validator.validate_vendor(root)

    def routing_fixture(self, root: Path) -> Path:
        destination = root / "skills" / "doubaoya"
        (destination / "references").mkdir(parents=True)
        shutil.copy2(validator.ROUTING, destination / "references" / "wechat-routing.json")
        shutil.copy2(validator.SKILLS / "doubaoya" / "SKILL.md", destination / "SKILL.md")
        routing = json.loads(validator.ROUTING.read_text(encoding="utf-8"))
        names = set()
        for route in routing["routes"]:
            if route.get("primary_skill"):
                names.add(route["primary_skill"])
            names.update(route.get("candidate_skills", []))
        for name in names:
            skill = root / "skills" / name
            skill.mkdir(parents=True, exist_ok=True)
            (skill / "SKILL.md").write_text(f"---\nname: {name}\ndescription: fixture\n---\n", encoding="utf-8")
        return destination / "references" / "wechat-routing.json"

    def mutate_json(self, path: Path, mutation) -> None:
        value = json.loads(path.read_text(encoding="utf-8"))
        mutation(value)
        path.write_text(json.dumps(value), encoding="utf-8")

    def test_routing_rejects_unknown_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)
            self.mutate_json(routing, lambda value: value["routes"][0].update({"fallback": "cloud"}))
            with self.assertRaisesRegex(validator.ValidationError, "unexpected route mp-ark-local-archive keys"):
                validator.validate_routing(root)

    def test_routing_rejects_lost_metric_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)
            self.mutate_json(routing, lambda value: value["routes"][0]["unsupported"].remove("comment_count"))
            with self.assertRaisesRegex(validator.ValidationError, "unsupported metrics are incomplete"):
                validator.validate_routing(root)

    def test_routing_rejects_cloud_without_api_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)

            def remove_auth_boundary(value):
                value["routes"][1]["auth"]["requires_doubaoya_api_key"] = False

            self.mutate_json(routing, remove_auth_boundary)
            with self.assertRaisesRegex(validator.ValidationError, "invalid cloud auth boundary"):
                validator.validate_routing(root)

    def repository_fixture(self, root: Path) -> None:
        shutil.copytree(validator.SKILLS, root / "skills")
        shutil.copy2(validator.ROOT / "README.md", root / "README.md")

    def test_readme_rejects_stale_count_and_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            readme = root / "README.md"
            readme.write_text(readme.read_text(encoding="utf-8").replace("共 52 个", "共 51 个"), encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "README Skill count is stale"):
                validator.validate_readme(root)

    def test_artifacts_reject_developer_paths_and_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.mkdir(exist_ok=True)
            developer_path = Path("/", "Users", "example", "private")
            (root / "README.md").write_text(f"checkout: {developer_path}\n", encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "developer path found"):
                validator.validate_artifacts(root)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "tools" / "__pycache__"
            cache.mkdir(parents=True)
            (cache / "state.py").write_text("value = 1\n", encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "runtime/cache artifact found"):
                validator.validate_artifacts(root)


if __name__ == "__main__":
    unittest.main()
