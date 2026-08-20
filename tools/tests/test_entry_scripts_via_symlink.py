"""每个入口脚本经**软链**调用时必须照常干活，而不是静默空跑。

为什么要真起进程：validate_community.py 里那条静态闸认的是「守卫附近有没有 realpathSync」，
它是行距启发式，守卫写散了就绕得过去。这条测试不看写法，只看**行为**——同一个只读旗标，
分别经真路径和绝对软链路径调用，退出码 / stdout / stderr 必须逐字一致，且不许两头都是空的。
形态怎么变都逃不掉。

软链形态照抄 skills CLI 装出来的常态：``.claude/skills/<n>`` 是指向 ``.agents/skills/<n>`` 的
**目录**软链，调用时给的是绝对路径。只有「绝对路径穿软链」这一种组合会炸——``cd`` 进去用
相对路径反而躲得过（getcwd() 给的是物理路径），所以 fixture 必须用绝对路径。
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / "skills"

# 每个入口脚本用哪个**只读**旗标去探。不是所有脚本都有 --help，逐个注明：
#   · doubaoya.mjs           —— 无参即打印 USAGE 并 exit 0（`--help` 会被当成未知命令）
#   · preprocess-and-publish —— 没有 --help；无参时 die("缺少 --html …") 走 stderr + exit 1，
#                                 这本身就是好判据：修之前经软链跑是 rc=0 且 stderr 空。
#   · 其余                    —— 支持 --help，打印用法后 exit 0
ENTRY_FLAGS: dict[str, list[str]] = {
    "dby-update/scripts/reconcile.mjs": ["--help"],
    "doubaoya/scripts/doubaoya.mjs": [],
    "wechat-article-pipeline/scripts/account-verify.mjs": ["--help"],
    "wechat-article-pipeline/scripts/design-studio.mjs": ["--help"],
    "wechat-article-pipeline/scripts/extract-theme.mjs": ["--help"],
    "wechat-article-pipeline/scripts/fetch-article.mjs": ["--help"],
    "wechat-article-pipeline/scripts/gen-image.mjs": ["--help"],
    "wechat-article-pipeline/scripts/import-theme.mjs": ["--help"],
    "wechat-article-pipeline/scripts/pipeline.mjs": ["--help"],
    "wechat-article-pipeline/scripts/plan-figures.mjs": ["--help"],
    "wechat-article-pipeline/scripts/preprocess-and-publish.mjs": [],
    "wechat-article-pipeline/scripts/render-wechat-html.mjs": ["--help"],
    "wechat-article-pipeline/scripts/validate-theme.mjs": ["--help"],
    "wechat-draft-publish/scripts/preprocess-and-publish.mjs": [],
    "wechat-theme-studio/scripts/validate-theme.mjs": ["--help"],
}


def discover_entry_scripts() -> list[str]:
    """从目录现算入口脚本，不写死名单——写死的名单会在新增脚本那天静默漏掉它。

    判据：``skills/*/scripts/*.mjs`` 里同时出现 ``process.argv[1]`` 与 ``import.meta.url``，
    也就是「自己判断要不要跑 main」的那一类。纯被 import 的模块和无条件自跑的自检脚本
    （selfcheck-remote-theme.mjs）天然不在里面——它们没有守卫，也就没有这个病。
    """
    found = []
    for path in sorted(SKILLS.glob("*/scripts/*.mjs")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "process.argv[1]" in text and "import.meta.url" in text:
            found.append(path.relative_to(SKILLS).as_posix())
    return found


class EntryScriptSymlinkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("没有 node，跑不了这条行为测试")

    def run_script(self, script: Path, args: list[str]) -> tuple[int, str, str]:
        result = subprocess.run(
            ["node", str(script), *args],
            capture_output=True,
            text=True,
            timeout=60,
            # 离线：不带钥匙、不联网。这些旗标都只打印用法或校验参数。
            env={**os.environ, "DOUBAOYA_API_KEY": "", "NO_COLOR": "1"},
            cwd=str(ROOT),
        )
        return result.returncode, result.stdout, result.stderr

    def test_every_entry_script_declares_a_readonly_flag(self):
        """新增了入口脚本却没给它声明探测旗标 ⇒ 当场红。漏掉一个 = 这条测试对它完全没看。"""
        discovered = set(discover_entry_scripts())
        declared = set(ENTRY_FLAGS)
        self.assertEqual(
            sorted(discovered - declared),
            [],
            "有入口脚本没进 ENTRY_FLAGS，本测试看不住它。给它挑一个只读旗标补进表里。",
        )
        self.assertEqual(
            sorted(declared - discovered),
            [],
            "ENTRY_FLAGS 里点名的脚本已经不存在（或不再是入口脚本了），把它从表里删掉。",
        )
        self.assertGreater(len(discovered), 0, "一个入口脚本都没扫到 = 测试在空转，而空转长得跟通过一样")

    def test_symlinked_call_matches_real_call(self):
        # ⚠️ macOS 的 tmpdir() 自己就是条软链（/var → /private/var）。不先 realpath 解开，
        #    「走真路径」那一头其实也经了软链，对照组整个作废（前人在 reconcile 那条自检上踩过）。
        directory = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, directory, True)

        for relative in discover_entry_scripts():
            skill_name, _, tail = relative.partition("/")
            with self.subTest(script=relative):
                args = ENTRY_FLAGS[relative]
                link = directory / f"link-{relative.replace('/', '-')}"
                link.symlink_to(SKILLS / skill_name)

                real_rc, real_out, real_err = self.run_script(SKILLS / relative, args)
                link_rc, link_out, link_err = self.run_script(link / tail, args)

                # 报错文案里会出现调用时那条路径，逐字比之前先归一，否则比的是路径不是行为。
                link_out = link_out.replace(str(link), str(SKILLS / skill_name))
                link_err = link_err.replace(str(link), str(SKILLS / skill_name))

                self.assertTrue(
                    (real_out + real_err).strip(),
                    f"{relative} 走真路径就什么都没输出——fixture 前提不成立，"
                    f"这个旗标（{args or '无参'}）选错了，换一个真会打印东西的只读旗标。",
                )
                self.assertEqual(
                    (link_rc, link_out, link_err),
                    (real_rc, real_out, real_err),
                    f"{relative} 经软链调用和走真路径不是一回事。"
                    f"典型形态：软链那次 rc=0、stdout 零字节——整个脚本静默空跑了，"
                    f"入口守卫又退化成拿 argv[1] 字面比 import.meta.url 了。",
                )


if __name__ == "__main__":
    unittest.main()
