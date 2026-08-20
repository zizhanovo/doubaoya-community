"""合并后 rewrite 包的 self-check。

三合一之后 `wechat-rewrite` 的脚本是**唯一**还在解析平台规则的东西（原来三个包各有一份），
而规则从「一个大文件切章节」改成了「一平台一文件」。这两件事各带一个会静默失败的形状：

  · 规则文件与脚本的平台表**对不上**——脚本认得 `知乎`，references/ 下却没有 `知乎.md`。
    这种错不会抛异常，只会让某个平台的改写规则**静默变成空**。
  · 全平台关键词 `all` 不带文案时走不通——合并前的版本就是这样，且**与自己的帮助文本矛盾**
    （帮助写的是 `rewrite.py all [文案内容]`，文案是可选的）。

不做框架、不搭 fixture：直接拿真实的 references/ 跑真实的脚本。
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SKILL_DIR = Path(__file__).resolve().parents[2] / "skills" / "wechat-rewrite"
MODULE_PATH = SKILL_DIR / "scripts" / "rewrite.py"
SPEC = importlib.util.spec_from_file_location("doubaoya_rewrite", MODULE_PATH)
assert SPEC and SPEC.loader
rewrite = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rewrite)


class RewritePlatformRulesTests(unittest.TestCase):
    def test_every_supported_platform_has_a_rules_file_with_real_content(self):
        """脚本的平台表与 references/ 必须一一对应，且每份都不能是空壳。

        少一份文件 = 那个平台的 System Prompt 静默变成空，agent 照着空规则改写，
        不会有任何一层报错。
        """
        for platform in rewrite.SUPPORTED_PLATFORMS:
            with self.subTest(platform=platform):
                rules = rewrite.extract_platform_rules(platform)
                self.assertIsNotNone(rules, f"{platform} 取不到规则")
                # 每份规则至少要有角色定位和工作流两段，否则就是个空壳
                self.assertIn("# Role:", rules)
                self.assertIn("Workflow", rules)
                self.assertGreater(len(rules), 500, f"{platform} 的规则短得不像真规则")

    def test_platform_file_map_covers_exactly_the_supported_platforms(self):
        """别名表 / 平台表 / 文件名表三者不许有一个漂掉。"""
        self.assertEqual(set(rewrite.PLATFORM_FILE), set(rewrite.SUPPORTED_PLATFORMS))
        self.assertEqual(set(rewrite.PLATFORM_ALIAS.values()), set(rewrite.SUPPORTED_PLATFORMS))

    def test_rules_files_on_disk_match_the_platform_table(self):
        """反向：references/ 下不许有平台表之外的孤儿规则文件（合并时最容易留下的垃圾）。"""
        on_disk = {p.stem for p in (SKILL_DIR / "references").glob("*.md")}
        self.assertEqual(on_disk, set(rewrite.PLATFORM_FILE.values()))

    def test_all_keyword_resolves_to_every_platform(self):
        """`all` / `全部` / `所有` 不带文案也要能用——帮助文本承诺了文案是可选的。

        合并前的版本在「只给一个 token」的分支里只查平台别名表，查不到 all 就打印帮助
        并以退出码 1 结束，与自己的帮助文本直接矛盾。
        """
        for keyword in sorted(rewrite.ALL_KEYWORDS):
            with self.subTest(keyword=keyword):
                self.assertEqual(rewrite.resolve_platforms([keyword]), rewrite.SUPPORTED_PLATFORMS)

    def test_aliases_resolve_to_the_canonical_platform(self):
        """别名是用户真会敲的东西（xhs / b站 / dy），漂了就是「未识别的平台」。"""
        self.assertEqual(rewrite.resolve_platforms(["xhs"]), ["小红书"])
        self.assertEqual(rewrite.resolve_platforms(["b站"]), ["哔站（B站）"])
        self.assertEqual(rewrite.resolve_platforms(["dy,zhihu"]), ["抖音", "知乎"])
        self.assertEqual(rewrite.resolve_platforms(["微博"]), [])


if __name__ == "__main__":
    unittest.main()
