"""skill 薄层化四道闸的测试（dby-cli-rebuild tasks 4.2 / 4.3 / 4.6 / 4.7，spec skill-thin-layer）。

四道闸都在 tools/validate_community.py：无脚本、禁用写法、调用约定、上下文预算。每道闸：
真仓通过 + 在副本里注入一处变异必须红（红的信息要点名文件/包）。tasks 里的破坏验证是在真仓上
手工做一遍，这里把同样的变异固化下来，免得闸被改松了没人发现。
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "tools" / "validate_community.py"
SPEC = importlib.util.spec_from_file_location("doubaoya_community_validator_for_thin_layer", VALIDATOR)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)

GATES = (
    "validate_no_skill_scripts",
    "validate_no_forbidden_invocations",
    "validate_call_convention",
    "validate_context_budget",
)


class ThinLayerFixture(unittest.TestCase):
    def fixture_root(self) -> Path:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        root = Path(directory)
        shutil.copytree(ROOT / "skills", root / "skills")
        (root / "cli").mkdir()
        shutil.copy(ROOT / "cli" / "package.json", root / "cli" / "package.json")
        shutil.copytree(ROOT / "cli" / "src", root / "cli" / "src")
        (root / "tools").mkdir()
        for name in ("call-convention.md", "skill_budget.json"):
            shutil.copy(ROOT / "tools" / name, root / "tools" / name)
        return root

    def assert_red(self, gate: str, root: Path, *needles: str) -> str:
        with self.assertRaises(validator.ValidationError) as caught:
            getattr(validator, gate)(root)
        message = str(caught.exception)
        for needle in needles:
            self.assertIn(needle, message)
        return message


class RealRepoPasses(ThinLayerFixture):
    def test_真仓四道闸都过(self) -> None:
        for gate in GATES:
            with self.subTest(gate=gate):
                getattr(validator, gate)(validator.ROOT)

    def test_四道闸都已注册(self) -> None:
        defined, reachable = validator.registered_gates(VALIDATOR.read_text(encoding="utf-8"))
        for gate in GATES:
            self.assertIn(gate, defined)
            self.assertIn(gate, reachable, f"{gate} 定义了但没注册进 validate_repository")

    def test_副本也过(self) -> None:
        root = self.fixture_root()
        for gate in GATES:
            with self.subTest(gate=gate):
                getattr(validator, gate)(root)


class NoScripts(ThinLayerFixture):
    def test_往_dby_write_scripts_塞一个脚本_红(self) -> None:
        root = self.fixture_root()
        (root / "skills" / "dby-write" / "scripts" / "x.mjs").write_text("console.log(1)\n", encoding="utf-8")
        self.assert_red("validate_no_skill_scripts", root, "skills/dby-write/scripts/x.mjs")

    def test_没有_scripts_的包新长出_scripts_红(self) -> None:
        root = self.fixture_root()
        (root / "skills" / "dby-deai" / "scripts").mkdir()
        (root / "skills" / "dby-deai" / "scripts" / "run.py").write_text("print(1)\n", encoding="utf-8")
        self.assert_red("validate_no_skill_scripts", root, "skills/dby-deai/scripts/run.py")

    def test_镜像目录里长出_cli_src_没有的文件_红(self) -> None:
        root = self.fixture_root()
        (root / "skills" / "dby-api" / "scripts" / "lib" / "evil.mjs").write_text("fetch('x')\n", encoding="utf-8")
        self.assert_red("validate_no_skill_scripts", root, "evil.mjs", "cli/src")

    def test_过渡期文件删了清单没删_红(self) -> None:
        root = self.fixture_root()
        (root / "skills" / "dby-image" / "scripts" / "wechat-crops.mjs").unlink()
        self.assert_red("validate_no_skill_scripts", root, "dby-image/scripts/wechat-crops.mjs")


class ForbiddenInvocations(ThinLayerFixture):
    def test_塞一条_curl_红(self) -> None:
        root = self.fixture_root()
        skill_md = root / "skills" / "dby-write" / "SKILL.md"
        skill_md.write_text(skill_md.read_text(encoding="utf-8") + "\ncurl -s https://doubaoya.com/api/wechat/topics\n", encoding="utf-8")
        self.assert_red("validate_no_forbidden_invocations", root, "skills/dby-write/SKILL.md", "curl")

    def test_references_里写回_node_脚本_红(self) -> None:
        root = self.fixture_root()
        ref = next((root / "skills" / "dby-image" / "references").glob("*.md"))
        ref.write_text(ref.read_text(encoding="utf-8") + '\nnode scripts/gen.mjs "一只鸭子"\n', encoding="utf-8")
        self.assert_red("validate_no_forbidden_invocations", root, "node scripts/gen.mjs")


class CallConvention(ThinLayerFixture):
    def mutate_block(self, root: Path, skill: str, old: str, new: str) -> None:
        skill_md = root / "skills" / skill / "SKILL.md"
        text = skill_md.read_text(encoding="utf-8")
        self.assertIn(old, text)
        skill_md.write_text(text.replace(old, new, 1), encoding="utf-8")

    def test_删掉_node_v_那一行_红(self) -> None:
        root = self.fixture_root()
        line = next(l for l in validator.call_convention_block(root).split("\n") if "`node -v`" in l)
        self.mutate_block(root, "dby-publish", line + "\n", "")
        self.assert_red("validate_call_convention", root, "skills/dby-publish/SKILL.md")

    def test_确切版本与包版本不符_红(self) -> None:
        root = self.fixture_root()
        version = json.loads((root / "cli" / "package.json").read_text(encoding="utf-8"))["version"]
        # 假版本不能写死成某个正式号：包版本升到那个号时，替换变成空操作，闸不会红。
        bogus = "9.9.9"
        self.assertNotEqual(version, bogus)
        self.mutate_block(root, "dby-image", f"@doubaoya/cli@{version}", f"@doubaoya/cli@{bogus}")
        self.assert_red("validate_call_convention", root, f"@doubaoya/cli@{bogus}", version)

    def test_包版本升了而约定段没跟_红(self) -> None:
        root = self.fixture_root()
        package = root / "cli" / "package.json"
        data = json.loads(package.read_text(encoding="utf-8"))
        data["version"] = "2.0.1"
        package.write_text(json.dumps(data), encoding="utf-8")
        self.assert_red("validate_call_convention", root, "2.0.1")

    def test_整段删掉_红(self) -> None:
        root = self.fixture_root()
        self.mutate_block(root, "dby-write", validator.call_convention_block(root), "")
        self.assert_red("validate_call_convention", root, "skills/dby-write/SKILL.md", "调用约定段")


class ContextBudget(ThinLayerFixture):
    def registry(self, root: Path) -> dict:
        return json.loads((root / "tools" / "skill_budget.json").read_text(encoding="utf-8"))

    def test_必读_reference_追加两万字_红(self) -> None:
        root = self.fixture_root()
        skill, entry = next((k, v) for k, v in self.registry(root)["skills"].items() if v.get("required"))
        target = root / "skills" / skill / entry["required"][0]
        target.write_text(target.read_text(encoding="utf-8") + "字" * 20000, encoding="utf-8")
        self.assert_red("validate_context_budget", root, skill, "超出")

    def test_必读路径指向不存在的文件_红(self) -> None:
        root = self.fixture_root()
        data = self.registry(root)
        skill = next(k for k, v in data["skills"].items() if v.get("required"))
        data["skills"][skill]["required"][0] = "references/不存在.md"
        (root / "tools" / "skill_budget.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        self.assert_red("validate_context_budget", root, "references/不存在.md", "不存在")

    def test_口径(self) -> None:
        self.assertEqual(validator.context_tokens("中文"), 2)
        self.assertEqual(validator.context_tokens("abcd efgh"), 2)
        self.assertEqual(validator.context_tokens("中a"), 2)


if __name__ == "__main__":
    unittest.main()
