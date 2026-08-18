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

    @staticmethod
    def route(value: dict, route_id: str) -> dict:
        """按 id 取路由：按下标取会在新增一条路由时静默指向别人（已踩过）。"""
        return next(route for route in value["routes"] if route["id"] == route_id)

    def test_routing_rejects_unknown_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)
            self.mutate_json(routing, lambda value: self.route(value, "mp-ark-local-archive").update({"fallback": "cloud"}))
            with self.assertRaisesRegex(validator.ValidationError, "unexpected route mp-ark-local-archive keys"):
                validator.validate_routing(root)

    def test_routing_rejects_lost_metric_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)
            self.mutate_json(routing, lambda value: self.route(value, "mp-ark-local-archive")["unsupported"].remove("comment_count"))
            with self.assertRaisesRegex(validator.ValidationError, "unsupported metrics are incomplete"):
                validator.validate_routing(root)

    def test_routing_rejects_cloud_without_api_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)

            def remove_auth_boundary(value):
                self.route(value, "doubaoya-cloud-public-data")["auth"]["requires_doubaoya_api_key"] = False

            self.mutate_json(routing, remove_auth_boundary)
            with self.assertRaisesRegex(validator.ValidationError, "invalid cloud auth boundary"):
                validator.validate_routing(root)

    def test_routing_rejects_authoring_route_below_cloud(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)

            def demote_authoring(value):
                self.route(value, "doubaoya-authoring-delivery")["priority"] = 80
                value["routes"] = sorted(value["routes"], key=lambda route: -route["priority"])

            self.mutate_json(routing, demote_authoring)
            with self.assertRaisesRegex(validator.ValidationError, "authoring route must precede"):
                validator.validate_routing(root)

    def test_authoring_chain_rejects_missing_forward_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            skill = root / "skills" / "wechat-hot-write" / "SKILL.md"
            text = skill.read_text(encoding="utf-8")
            skill.write_text(text[: text.index(validator.NEXT_STEP_HEADING)], encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "has no .* section"):
                validator.validate_authoring_chain(root)

    def test_authoring_chain_rejects_section_naming_no_downstream_skill(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            skill = root / "skills" / "wechat-title" / "SKILL.md"
            text = skill.read_text(encoding="utf-8")
            start = text.index(validator.NEXT_STEP_HEADING)
            end = text.index("\n## ", start)
            # 有标题、有正文、没点名任何下游——比整节缺失更难肉眼发现的断头方式。
            skill.write_text(
                text[:start] + f"{validator.NEXT_STEP_HEADING}\n\n到此为止。\n" + text[end + 1 :],
                encoding="utf-8",
            )
            with self.assertRaisesRegex(validator.ValidationError, "names no downstream Skill"):
                validator.validate_authoring_chain(root)

    def test_authoring_chain_rejects_dead_skill_link_in_dby(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            # dby 是任务后导航的单一事实源，它整篇都要扫——链上 skill 只扫「下一步」那一节。
            skill = root / "skills" / "dby" / "SKILL.md"
            skill.write_text(skill.read_text(encoding="utf-8") + "\n\n排版走 `wechat-render`。\n", encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "dby/SKILL.md routes to Skills"):
                validator.validate_authoring_chain(root)

    def test_authoring_chain_rejects_dead_skill_link(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            skill = root / "skills" / "wechat-banned-words" / "SKILL.md"
            text = skill.read_text(encoding="utf-8")
            # `wechat-render` 只是一个 API 端点，不是 Skill——正是幻觉引用最爱的那种名字。
            skill.write_text(
                text.replace(validator.NEXT_STEP_HEADING, f"{validator.NEXT_STEP_HEADING}\n\n排版走 `wechat-render`。", 1),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(validator.ValidationError, "wechat-render"):
                validator.validate_authoring_chain(root)

    def repository_fixture(self, root: Path) -> None:
        shutil.copytree(validator.SKILLS, root / "skills")
        shutil.copy2(validator.ROOT / "README.md", root / "README.md")

    def test_banned_word_gate_rejects_ghost_fields(self):
        # 三个字段上游从来没回过。文档教 agent 读 `matchedWords` 的那阵子，「为空 ⇒ 合规 ✅」
        # 是个恒真判据，每一段文案都被放行——变异证据分别覆盖「全仓禁」与「只在违禁词 Skill 禁」两类。
        for skill_name, injection, ghost in (
            ("wechat-banned-words", "若 `matchedWords` 为空则合规。", "matchedWords"),
            ("multi-banned-words", "读 `data.suggestions` 拿建议。", "suggestions"),
            ("doubao-websearch", "整体风险等级看 `riskLevel`。", "riskLevel"),
        ):
            with self.subTest(skill=skill_name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.repository_fixture(root)
                skill = root / "skills" / skill_name / "SKILL.md"
                skill.write_text(skill.read_text(encoding="utf-8") + f"\n\n{injection}\n", encoding="utf-8")
                with self.assertRaisesRegex(validator.ValidationError, f"still names .{ghost}."):
                    validator.validate_banned_word_fields(root)

    def test_banned_word_gate_keeps_the_real_suggestions_field(self):
        # `result.suggestions` 是搜索能力的真字段。闸若一刀切禁掉 `suggestions`，
        # 就会把这份没问题的文档打红，逼着后来的人删掉正确的指引——所以按 Skill 分域禁。
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            search_skill = root / "skills" / "doubao-websearch" / "SKILL.md"
            self.assertIn("result.suggestions", search_skill.read_text(encoding="utf-8"))
            validator.validate_banned_word_fields(root)

    def test_readme_rejects_stale_count_and_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            readme = root / "README.md"
            # 计数从 skills/ 现场数出来：写死数字会随每次新增 Skill 变成哑弹（已哑过一次）。
            count = len(validator.discover_skill_dirs(root))
            readme.write_text(
                readme.read_text(encoding="utf-8").replace(f"共 {count} 个", f"共 {count - 1} 个"),
                encoding="utf-8",
            )
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
