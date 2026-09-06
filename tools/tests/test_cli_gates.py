"""dby CLI 统一化两道闸的测试：唯一请求层 + 命令名在场。

判据以主仓 openspec change dby-cli-unification 的
specs/dby-cli-coverage/spec.md 两条 Requirement 为准：
  ·「仓内只有一份请求层」
  ·「命令名在 SKILL.md 里在场」

⚠️ 本文件里标了「预期的红」的正向用例是**当前仓状态的快照**：dby-write/dby-charter/
dby-publish 的 fetch 迁移与 dby-api/SKILL.md 的重写都还在另一路进行中。等那几路收尾，
这些用例要么改写成「通过」分支，要么把已修好的文件从已知清单里划掉——别放着不管，
放着不管本身就会变成新的「闸判错东西」（见共享记忆 gate-judges-wrong-thing）。
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import unittest.mock


VALIDATOR = Path(__file__).resolve().parents[1] / "validate_community.py"
SPEC = importlib.util.spec_from_file_location("doubaoya_community_validator_for_cli_gates", VALIDATOR)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


class SkillsFixtureMixin:
    """公用：拷一份全仓 skills/ 到 tmp 目录，好在不影响真仓的前提下注入变异体。

    照抄 test_validate_community.py 里 EntryGuard 那组测试的 fixture 写法——真拷一份
    dby-api 的 dby.mjs + lib/，`_dby_command_names()` 在这份拷贝上能真跑起来，
    不需要另外 mock 掉子命令真相。
    """

    def skills_fixture_root(self) -> Path:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        root = Path(directory)
        shutil.copytree(validator.SKILLS, root / "skills")
        return root

    def neutralize_known_request_layer_reds(self, root: Path) -> None:
        """把当前仓里真实存在、但跟本次注入无关的唯一请求层违规清空掉。

        dby-publish 的 fetch 迁移此刻还没收尾（account-verify.mjs / pipeline.mjs /
        publish_draft.py 三个文件），不清掉的话主循环会先撞上它们、红的是别人的问题，
        不是这条测试真正要验的那一条。用闸自己的判据去找，不写死文件名——那几个文件
        被修好之后，这个函数天然变成空操作，不需要跟着改。
        """
        whitelist = {entry["path"] for entry in validator.SINGLE_REQUEST_LAYER_WHITELIST}
        for skill_dir in validator.discover_skill_dirs(root):
            scripts_dir = skill_dir / "scripts"
            if not scripts_dir.is_dir():
                continue
            for path in sorted(scripts_dir.rglob("*")):
                if not path.is_file() or path.suffix not in validator.CLI_SCRIPT_SUFFIXES:
                    continue
                text = path.read_text(encoding="utf-8")
                if not validator.HTTP_CALL_SITE.search(text) or not validator.DOUBAOYA_HTTP_TARGET.search(text):
                    continue
                relative = path.relative_to(root / "skills").as_posix()
                if relative in whitelist:
                    continue
                path.write_text("// neutralized for test isolation\n", encoding="utf-8")

    def neutralize_known_cli_ref_reds(self, root: Path) -> None:
        """同上，针对命令名在场闸：把当前仓里已知失配的 SKILL.md/references 清空。"""
        valid_names = validator._dby_command_names(root)
        for doc_path in validator._cli_doc_files(root):
            text = doc_path.read_text(encoding="utf-8")
            bad = False
            for _lineno, tok1, tok2 in validator._cli_references(text):
                combined = f"{tok1} {tok2}" if tok2 else None
                if (combined and combined in valid_names) or tok1 in valid_names:
                    continue
                bad = True
                break
            if bad:
                doc_path.write_text("<!-- neutralized for test isolation -->\n", encoding="utf-8")

    def ensure_dby_api_skill_has_example(self, root: Path) -> None:
        """给 fixture 里「用到 CLI 却一条命令名都没写」的包兜底塞一条真实存在的引用。

        不依赖它们此刻的真实正文——dby-api/SKILL.md 正被另一路重写，此刻是纯 `<组>/<命令>`
        占位符；dby-publish/SKILL.md 则是脚本已经 import 了 lib/locate-dby.mjs 但 SKILL.md
        原文压根没提过任何命令名（这是当前仓的真实状态，不是 fixture 缺陷，见测试报告）。
        这里塞例子只为了隔离测试「元断言 / 只写--help 闸在有例子时不会误红」，
        不代表对真仓两处内容的判断——那两处如实报红，交给对应的另一路处理。
        """
        for skill_name in ("dby-api", "dby-publish"):
            skill_md = root / "skills" / skill_name / "SKILL.md"
            skill_md.write_text(
                skill_md.read_text(encoding="utf-8") + "\n\n参考：`dby draft create`\n",
                encoding="utf-8",
            )


class SingleRequestLayerGateTests(SkillsFixtureMixin, unittest.TestCase):
    """4.4：仓内只有一份请求层。"""

    def test_current_repo_passes_after_migration(self):
        """正向：dby-write / dby-charter / dby-publish 三包的脚本都已改走
        dby-api/scripts/lib/http.mjs，仓内不再有第二份直接打 doubaoya.com 的实现——闸应当放行。
        （迁移中途这里曾是预期的红：account-verify.mjs / pipeline.mjs / publish_draft.py。）
        """
        validator.validate_single_request_layer()

    def test_whitelist_entries_hit_real_files_with_real_calls(self):
        """反向的另一半：白名单四条此刻都还命中真实存在、且确实有调用点的文件。"""
        for entry in validator.SINGLE_REQUEST_LAYER_WHITELIST:
            path = validator.ROOT / "skills" / entry["path"]
            self.assertTrue(path.is_file(), f"{entry['path']} 不存在了")
            self.assertRegex(path.read_text(encoding="utf-8"), validator.HTTP_CALL_SITE)

    def test_new_fetch_to_doubaoya_is_caught_by_file_and_line(self):
        """反向①：塞一段假 fetch("https://doubaoya.com/api/x") → 红且指到那一行。"""
        root = self.skills_fixture_root()
        self.neutralize_known_request_layer_reds(root)
        target = root / "skills" / "dby-write" / "scripts" / "injected-evil.mjs"
        before = ""
        after = (
            "// 假装重新拼了一份请求层\n"
            "export async function callDirectly() {\n"
            '  const res = await fetch("https://doubaoya.com/api/x", { method: "GET" });\n'
            "  return res.json();\n"
            "}\n"
        )
        self.assertNotEqual(before, after)  # 破坏不是空操作
        target.write_text(after, encoding="utf-8")

        with self.assertRaises(validator.ValidationError) as caught:
            validator.validate_single_request_layer(root)
        message = str(caught.exception)
        self.assertIn("injected-evil.mjs", message)
        self.assertRegex(message, r"injected-evil\.mjs:3\b")

    def test_rotten_whitelist_entry_is_caught(self):
        """反向②：白名单里塞一条不存在的路径 → 元断言红（清单腐烂）。"""
        root = self.skills_fixture_root()
        self.neutralize_known_request_layer_reds(root)
        before = validator.SINGLE_REQUEST_LAYER_WHITELIST
        after = before + (
            {"path": "dby-api/scripts/lib/does-not-exist.mjs", "reason": "fixture：故意腐烂的一条"},
        )
        self.assertNotEqual(before, after)

        with unittest.mock.patch.object(validator, "SINGLE_REQUEST_LAYER_WHITELIST", after):
            with self.assertRaisesRegex(validator.ValidationError, r"does-not-exist\.mjs.*已经不存在"):
                validator.validate_single_request_layer(root)

    def test_clean_fixture_passes(self):
        """把已知违规清空之后，拷贝出来的这份仓库应该干净——证明清空函数本身没有误伤。"""
        root = self.skills_fixture_root()
        self.neutralize_known_request_layer_reds(root)
        validator.validate_single_request_layer(root)


class CliCommandsPresentGateTests(SkillsFixtureMixin, unittest.TestCase):
    """5.2：命令名在场。"""

    def test_current_repo_skill_docs_only_reference_real_commands(self):
        """正向：所有 SKILL.md / references 里出现的 `dby <组> <命令>` 都真实存在——闸应当放行。
        （迁移中途 capability-table.md 的 `node "$D" list` 曾让这里预期红。）
        """
        validator.validate_cli_commands_present()

    def test_dby_command_names_has_real_shape(self):
        """`routes --json` 目前应该有几十条命令，且都是「组 命令」或单级形状。"""
        names = validator._dby_command_names()
        self.assertGreaterEqual(len(names), 30)
        self.assertIn("draft create", names)
        self.assertIn("doctor", names)

    def test_unknown_command_in_skill_md_is_caught_by_file_and_line(self):
        """反向③：SKILL.md 里塞 `dby nosuch cmd` → 红。"""
        root = self.skills_fixture_root()
        self.neutralize_known_cli_ref_reds(root)
        target = root / "skills" / "dby-write" / "references" / "fixture-note.md"
        before = ""
        after = "本节示例：\n\n`dby nosuch cmd`\n"
        self.assertNotEqual(before, after)
        target.write_text(after, encoding="utf-8")

        with self.assertRaises(validator.ValidationError) as caught:
            validator.validate_cli_commands_present(root)
        message = str(caught.exception)
        self.assertIn("fixture-note.md", message)
        self.assertRegex(message, r"fixture-note\.md:3\b")
        self.assertIn("nosuch cmd", message)

    def test_prose_mention_of_dby_is_not_a_false_positive(self):
        """`dby` 后面跟的英文词组只要不在代码语境里，就不是命令引用——
        真事故：`dby/SKILL.md` trigger words 里 "which dby skill" 曾被早期草稿误判成
        引用了不存在的子命令 `skill`。钉死这条，别让后人为了"扫全文"又把它改回去。
        """
        root = self.skills_fixture_root()
        self.neutralize_known_cli_ref_reds(root)
        self.ensure_dby_api_skill_has_example(root)
        target = root / "skills" / "dby-write" / "references" / "fixture-prose.md"
        target.write_text(
            "触发词：which dby skill、怎么用 dby cli 来干活。\n",
            encoding="utf-8",
        )
        validator.validate_cli_commands_present(root)  # 不许红

    def test_empty_commands_list_is_rejected(self):
        """反向④：把 `routes --json` 换成空 commands → 红（防空跑）。"""
        before_names = {"api list", "draft create", "doctor"}
        after_payload = {"ok": True, "data": {"commands": []}}
        self.assertNotEqual(len(before_names), len(after_payload["data"]["commands"]))

        fake_proc = unittest.mock.Mock(returncode=0, stdout=json.dumps(after_payload), stderr="")
        with unittest.mock.patch.object(validator.subprocess, "run", return_value=fake_proc):
            with self.assertRaisesRegex(validator.ValidationError, "只解析出 0 条命令"):
                validator.validate_cli_commands_present()

    def test_node_missing_fails_loudly_not_silently(self):
        """Node 不在时必须失败并说明，不许静默跳过整道闸。"""
        with unittest.mock.patch.object(
            validator.subprocess, "run", side_effect=OSError("no such file: node")
        ):
            with self.assertRaisesRegex(validator.ValidationError, "跑不起"):
                validator.validate_cli_commands_present()

    def test_clean_fixture_passes(self):
        """把已知违规清空、并给 dby-api/SKILL.md 兜底塞回一条例子之后，
        这份仓库应该干净——证明清空函数本身没有误伤，元断言也不是恒红。
        """
        root = self.skills_fixture_root()
        self.neutralize_known_cli_ref_reds(root)
        self.ensure_dby_api_skill_has_example(root)
        validator.validate_cli_commands_present(root)


if __name__ == "__main__":
    unittest.main()
