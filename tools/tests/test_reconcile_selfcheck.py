from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path


RECONCILE = Path(__file__).resolve().parents[2] / "skills" / "dby-update" / "scripts" / "reconcile.mjs"


class ReconcileSelfCheckTest(unittest.TestCase):
    """🔴 把 reconcile.mjs 自带的离线自检接进本仓的测试套。

    它自己早就带着一整套承重断言（受 git 跟踪的包不许被归档、git 探测失败要 fail-closed、
    收敛态必须零动作、只有刷新也要过确认门、--json 的 stdout 必须是纯 JSON），
    但**没有任何 runner 会跑它**——于是那些断言等于不存在，改坏了也没人知道。
    这一条就是把它接上：判据只有一个，真起进程跑一遍，退出码必须是 0。

    自检本身完全离线（DBY_RAW_BASE 指向临时 fixture、npx 是 PATH 上的桩），
    所以这条测试不联网、也碰不到本机任何真实安装目录。
    """

    def test_selfcheck_passes(self) -> None:
        node = shutil.which("node")
        if node is None:
            self.skipTest("这台机器上没有 node，跑不了 reconcile.mjs 的自检")
        self.assertTrue(RECONCILE.is_file(), f"找不到 {RECONCILE}")
        result = subprocess.run(
            [node, str(RECONCILE), "--self-check"],
            capture_output=True,
            text=True,
            timeout=180,
        )
        self.assertEqual(
            result.returncode,
            0,
            "reconcile.mjs --self-check 没过：\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
