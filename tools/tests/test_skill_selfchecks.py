"""把各包自带的 `scripts/*.selfcheck.mjs` 全部接进本仓测试套（design.md D10 脚本层）。

与 test_reconcile_selfcheck.py 同一条理由：selfcheck 自己带着承重断言，
但**没有 runner 跑它就等于不存在**——改坏了也没人知道。这里按文件系统事实
现算清单（不写死名单，新增 selfcheck 自动被收进来），逐个真起进程跑，退出码必须 0。

全部离线：selfcheck 约定本身就是「零框架 assert、不联网、不需要密钥」。
"""
from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / "skills"


def discover_selfchecks() -> "list[Path]":
    """`skills/*/scripts/*.selfcheck.mjs` 是本仓的既定后缀约定（draft-limits.selfcheck.mjs
    开的头）。注意 selfcheck-remote-theme.mjs 是**前缀**命名、会联网，天然不在此列。"""
    return sorted(SKILLS.glob("*/scripts/*.selfcheck.mjs"))


class SkillSelfcheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("这台机器上没有 node，跑不了 *.selfcheck.mjs")

    def test_清单不许退化成空集(self) -> None:
        """🔴 元断言：glob 打错/目录改名时下面那条会零迭代全绿。当前至少有
        dby-publish 的 draft-limits / archived-config-hint / validate-theme /
        render-wechat-html / preprocess-and-publish 五个。"""
        self.assertGreaterEqual(len(discover_selfchecks()), 5,
                                f"selfcheck 清单只剩 {discover_selfchecks()}")

    def test_每个selfcheck真起进程跑且全绿(self) -> None:
        for sc in discover_selfchecks():
            with self.subTest(selfcheck=sc.relative_to(ROOT).as_posix()):
                result = subprocess.run(
                    ["node", str(sc)], capture_output=True, text=True, timeout=120,
                    cwd=str(sc.parent),  # selfcheck 内的相对 import 以 scripts/ 为基准
                )
                self.assertEqual(
                    result.returncode, 0,
                    f"{sc} 没过：\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}")


if __name__ == "__main__":
    unittest.main()
