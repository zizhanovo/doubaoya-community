"""dby-publish 入口脚本的脚本层判据（design.md D10 第一层，tasks 3b.4）。

这里钉的是**CLI 级**的确定性行为——纯函数级的判据在包内 `*.selfcheck.mjs`
（由 test_skill_selfchecks.py 统一跑）。此前这批判据都压在执行层 agent 用例上
（publish-title-over-limit / publish-digest-over-limit / publish-local-image-scan-dry），
拿 3 轮沙箱 agent 会话测确定性脚本，贵且抖（D10 的账），下沉后 agent 层不再重复。

全部离线：--dry-run 与参数校验都发生在联网/密钥之前（脚本注释明写「渲染/传图之前就拦」）。
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skills" / "dby-publish" / "scripts"


def _run(script: str, args: "list[str]", cwd: "str | None" = None):
    return subprocess.run(
        ["node", str(SCRIPTS / script), *args],
        capture_output=True, text=True, timeout=60,
        env={**os.environ, "DOUBAOYA_API_KEY": "", "NO_COLOR": "1"},
        cwd=cwd or str(ROOT),
    )


class PipelineLimitTests(unittest.TestCase):
    """字段上限必须在读正文/联网**之前**拦（pipeline.mjs 注释原话：「渲染 / 传图之前就拦」）。
    判据：--md 指向不存在的文件也能报出上限错误——说明拦截先于读文件。"""

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("没有 node")

    def test_标题超64字_在读正文之前拦下(self) -> None:
        title = "鸭" * 65
        p = _run("pipeline.mjs", ["--md", "/nonexistent/never.md", "--title", title])
        self.assertNotEqual(p.returncode, 0)
        combined = p.stdout + p.stderr
        self.assertIn("64", combined, f"报错没点名 64 字上限：{combined}")
        # 拦在读文件之前：报错里不该是「文件不存在」
        self.assertNotIn("ENOENT", combined)

    def test_摘要超120字_在读正文之前拦下(self) -> None:
        digest = "摘" * 121
        p = _run("pipeline.mjs", ["--md", "/nonexistent/never.md",
                                  "--title", "正常标题", "--digest", digest])
        self.assertNotEqual(p.returncode, 0)
        combined = p.stdout + p.stderr
        self.assertIn("120", combined, f"报错没点名 120 字上限：{combined}")
        self.assertNotIn("ENOENT", combined)

    def test_合规标题摘要_不被上限拦(self) -> None:
        """破坏演练：证明上面两条不是「随便什么输入都报错」的恒真断言。
        合规标题 + 不存在的 md ⇒ 走到读文件那步才失败，报错不再是上限。"""
        p = _run("pipeline.mjs", ["--md", "/nonexistent/never.md", "--title", "正常标题"])
        self.assertNotEqual(p.returncode, 0)  # md 不存在，最终仍失败
        combined = p.stdout + p.stderr
        self.assertNotIn("64", combined)
        self.assertNotIn("120", combined)


class PreprocessDryRunTests(unittest.TestCase):
    """--dry-run 只扫描本地图、不上传/不发布/不需要密钥（脚本注释明写）。"""

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("没有 node")

    def test_dry_run_区分本地与外链并给出预上传计数(self) -> None:
        with tempfile.TemporaryDirectory(prefix="publish_dry_") as td:
            html = Path(td) / "article.html"
            html.write_text(
                '<h1>今日推荐</h1><p>正文内容。</p>'
                '<img src="https://cdn.example.com/remote.jpg" />'
                '<img src="/opt/demo/local-photo.png" />',
                encoding="utf-8")
            p = _run("preprocess-and-publish.mjs",
                     ["--html", str(html), "--title", "今日推荐", "--dry-run"], cwd=td)
            self.assertEqual(p.returncode, 0, p.stderr)
            # 逐张标注：外链原样保留、本地需预上传，并有总数统计
            self.assertIn("外链→原样保留", p.stdout)
            self.assertIn("https://cdn.example.com/remote.jpg", p.stdout)
            self.assertIn("本地→需预上传", p.stdout)
            self.assertIn("/opt/demo/local-photo.png", p.stdout)
            self.assertIn("本地 1 张", p.stdout)


if __name__ == "__main__":
    unittest.main()
