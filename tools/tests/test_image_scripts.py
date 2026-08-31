"""dby-image 脚本的脚本层判据（design.md D10 第一层，tasks 3b.4）。

此前这批判据全压在执行层 agent 用例上（image-ref-limit-exceeded / image-bad-mime-ref-rejected /
image-empty-ref-file-rejected / image-402-guidance-account-page / image-plan-figures-deterministic）
——拿 3 轮沙箱 agent 会话测确定性脚本，贵且抖（D10 的账：第二轮真跑 5/5 全抖）。
下沉后 agent 层只留「不注入画风」与 costly 的真出图两条，其余不再重复。

全部离线不花钱：
  · gen.mjs 的参考图校验在联网出图**之前**执行（脚本源码顺序如此），报错即退出；
  · 402 分支用**本机回环地址**的罐头 HTTP 服务复现（DOUBAOYA_BASE_URL 指过去），
    不触达真实服务端、不产生费用、不调模型；
  · plan-figures.mjs 本身就是确定性规则、零联网。
"""
from __future__ import annotations

import http.server
import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skills" / "dby-image" / "scripts"


def _run(script: str, args: "list[str]", cwd: str, extra_env: "dict | None" = None):
    env = {**os.environ, "DOUBAOYA_API_KEY": "test-fake-key", "NO_COLOR": "1"}
    env.update(extra_env or {})
    return subprocess.run(["node", str(SCRIPTS / script), *args],
                          capture_output=True, text=True, timeout=60, env=env, cwd=cwd)


class GenValidationTests(unittest.TestCase):
    """gen.mjs 在**联网之前**的参数校验——这正是老 agent 用例反复强调「不会花钱」的那段。"""

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("没有 node")

    def test_参考图超过3张_直接报错不出图(self) -> None:
        with tempfile.TemporaryDirectory(prefix="img_") as td:
            p = _run("gen.mjs", ["合成一张四人合影", "--ref", "r1.png", "--ref", "r2.png",
                                 "--ref", "r3.png", "--ref", "r4.png", "--out", "t.png"], td)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn("超过上限 3", p.stderr)
            self.assertIn("让用户自己挑", p.stderr)  # 服务端会静默丢弃，必须让用户选
            self.assertFalse((Path(td) / "t.png").exists())

    def test_假图片参考图_按字节签名拒绝(self) -> None:
        with tempfile.TemporaryDirectory(prefix="img_") as td:
            (Path(td) / "fake-ref.jpg").write_text("这不是一张真的图片", encoding="utf-8")
            p = _run("gen.mjs", ["把背景换成蓝色", "--ref", "fake-ref.jpg", "--out", "t.png"], td)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn("png/jpeg/webp", p.stderr)
            self.assertIn("改扩展名没用", p.stderr)  # 判的是字节签名，不是扩展名
            self.assertFalse((Path(td) / "t.png").exists())

    def test_空文件参考图_直接报错(self) -> None:
        with tempfile.TemporaryDirectory(prefix="img_") as td:
            (Path(td) / "empty-ref.png").write_bytes(b"")
            p = _run("gen.mjs", ["把背景换成蓝色", "--ref", "empty-ref.png", "--out", "t.png"], td)
            self.assertNotEqual(p.returncode, 0)
            self.assertIn("空文件", p.stderr)
            self.assertFalse((Path(td) / "t.png").exists())

    def test_点数不足_指引账户页且明确不要重试(self) -> None:
        """402/INSUFFICIENT_CREDITS 的提示文案：指引「账户页」而非「去充值」
        （2026-08 dby-image 1.6.1 修过：gen.mjs 漏改仍写「去充值」——这条钉住不许回潮），
        且必须写明「不要重试」（重试=为同一张图付两次钱）。
        用本机回环罐头服务复现，不触达真实服务端、零费用。"""
        payload = json.dumps({"success": False, "error": {
            "code": "INSUFFICIENT_CREDITS", "message": "点数不足"}}).encode("utf-8")

        class Stub(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                self.send_response(402)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory(prefix="img_") as td:
                p = _run("gen.mjs", ["一只鸭子", "--out", "t.png"], td,
                         extra_env={"DOUBAOYA_BASE_URL": f"http://127.0.0.1:{srv.server_port}"})
                self.assertNotEqual(p.returncode, 0)
                self.assertIn("INSUFFICIENT_CREDITS", p.stderr)
                self.assertIn("账户页", p.stderr)
                self.assertIn("不要重试", p.stderr)
                self.assertNotIn("充值", p.stderr)  # 1.6.1 修掉的旧文案不许回潮
                self.assertFalse((Path(td) / "t.png").exists())
        finally:
            srv.shutdown()


class PlanFiguresTests(unittest.TestCase):
    """plan-figures.mjs 是确定性规则（脚本自述「零依赖、不接 LLM」），判据全脚本层。"""

    FIXTURE_MD = (
        "# 秋日饮品全攻略\n\n"
        "## 选豆子有讲究\n\n"
        + ("挑选咖啡豆要看烘焙度、产地与新鲜度，浅烘豆酸香明亮，中烘豆均衡顺口，"
           "深烘豆则厚重带焦香，冲泡前建议现磨现煮，水温控制在九十度左右，"
           "闷蒸三十秒能让风味充分释放，搭配合适的滤纸与研磨度，"
           "才能稳定复刻同一杯好咖啡的味道。") * 2
        + "\n\n## 温馨提示\n\n这段很短，用来测试。\n"
    )

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("没有 node")

    def test_布局方案确定性_小节资格与上限(self) -> None:
        with tempfile.TemporaryDirectory(prefix="plan_") as td:
            md = Path(td) / "article.md"
            md.write_text(self.FIXTURE_MD, encoding="utf-8")
            p = _run("plan-figures.mjs", ["--md", str(md), "--json"], td)
            self.assertEqual(p.returncode, 0, p.stderr)
            plan = json.loads(p.stdout)
            # 与老 agent 用例 image-plan-figures-deterministic 相同的判据，原样下沉：
            self.assertEqual(plan["meta"]["sectionCount"], 2)    # 两个 h2 小节
            self.assertEqual(plan["meta"]["eligibleCount"], 1)   # 只有长节过 160 字阈值
            self.assertEqual(plan["meta"]["maxFigures"], 3)      # <1800 字 → 上限 3
            self.assertEqual(len(plan["figures"]), 1)
            self.assertEqual(plan["figures"][0]["anchor"]["value"], "选豆子有讲究")

    def test_同一输入两次运行结果逐字一致(self) -> None:
        """「确定性」不能只是自述——同输入两跑，JSON 必须逐字节相同。"""
        with tempfile.TemporaryDirectory(prefix="plan_") as td:
            md = Path(td) / "article.md"
            md.write_text(self.FIXTURE_MD, encoding="utf-8")
            a = _run("plan-figures.mjs", ["--md", str(md), "--json"], td)
            b = _run("plan-figures.mjs", ["--md", str(md), "--json"], td)
            self.assertEqual(a.stdout, b.stdout)


if __name__ == "__main__":
    unittest.main()
