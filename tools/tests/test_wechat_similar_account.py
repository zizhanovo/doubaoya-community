"""wechat-similar-account · 可选预同步降级的可运行自检。

钉死一条契约：`--sync` 的预同步是**尽力而为**——它失败（同步能力维护中的
503 CAPABILITY_UNAVAILABLE、网络不通等）只降级成 warning，主查询照跑；
而**主查询自身失败仍必须非零退出**，不能被降级逻辑吞成静默成功。

用一个 127.0.0.1 上的 stub HTTP server 走完整 urllib 链路（不打生产接口），
顺带记录被访问的路径，用来证明「主查询确实发出去了」。

跑法：python3 tools/tests/test_wechat_similar_account.py  （或 pytest tools/tests）
"""

from __future__ import annotations

import importlib.util
import io
import json
import socket
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "skills" / "wechat-similar-account" / "scripts" / "fetch_similar.py"
SPEC = importlib.util.spec_from_file_location("wsa_fetch_similar", MODULE_PATH)
assert SPEC and SPEC.loader
fs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fs)

SIMILAR_OK = {
    "success": True,
    "requestId": "r1",
    "data": {"items": [{"accountName": "对标号", "avgReadCount": 50000, "similarity": 0.92}]},
    "error": None,
}


def envelope(code: str, message: str) -> bytes:
    return json.dumps(
        {"success": False, "requestId": "r0", "data": None,
         "error": {"code": code, "message": message}}
    ).encode("utf-8")


class Stub:
    """按路径给响应的 stub server；routes[path] -> (status, body_bytes)。"""

    def __init__(self, routes):
        self.routes = routes
        self.seen = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                outer.seen.append(self.path)
                length = int(self.headers.get("Content-Length") or 0)
                self.rfile.read(length)
                status, body = outer.routes[self.path]
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]

    def __enter__(self):
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


def dead_port() -> int:
    """占一个端口再立刻放掉，拿到一个大概率没人监听的号，用来造连接失败。"""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def run_main(argv, sync_url, similar_url):
    """跑一次 main()，返回 (退出码, stdout, stderr)。"""
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.dict(fs.os.environ, {"DOUBAOYA_API_KEY": "dyh_test"}), \
         mock.patch.object(fs, "SYNC_ENDPOINT", sync_url), \
         mock.patch.object(fs, "SIMILAR_ENDPOINT", similar_url), \
         mock.patch.object(fs.sys, "argv", ["fetch_similar.py"] + argv), \
         mock.patch.object(fs.sys, "stdout", out), \
         mock.patch.object(fs.sys, "stderr", err):
        code = fs.main()
    return code, out.getvalue(), err.getvalue()


class SyncDegradesTests(unittest.TestCase):
    def test_sync_503_still_runs_main_query_and_exits_0(self):
        """维护期（503 CAPABILITY_UNAVAILABLE）：warn 一句，主查询照跑，退出码 0。"""
        routes = {
            "/sync": (503, envelope("CAPABILITY_UNAVAILABLE", "上游接口维护中（404）")),
            "/similar": (200, json.dumps(SIMILAR_OK).encode("utf-8")),
        }
        with Stub(routes) as stub:
            code, out, err = run_main(
                ["某某公众号", "--sync", "--wechat-id", "gh_x"],
                stub.base + "/sync", stub.base + "/similar",
            )
        self.assertEqual(code, 0)
        self.assertEqual(stub.seen, ["/sync", "/similar"])  # 主查询确实发出去了
        self.assertIn("对标号", out)                        # 结果照常落 stdout
        self.assertIn("[warn]", err)                        # 降级没有被静默吞掉
        self.assertIn("CAPABILITY_UNAVAILABLE", err)
        self.assertNotIn("[error]", err)

    def test_sync_network_error_still_runs_main_query(self):
        """同步端口根本连不上：同样只降级，不阻断主查询。"""
        routes = {"/similar": (200, json.dumps(SIMILAR_OK).encode("utf-8"))}
        with Stub(routes) as stub:
            code, out, err = run_main(
                ["某某公众号", "--sync", "--wechat-id", "gh_x"],
                "http://127.0.0.1:%d/sync" % dead_port(), stub.base + "/similar",
            )
        self.assertEqual(code, 0)
        self.assertEqual(stub.seen, ["/similar"])
        self.assertIn("对标号", out)
        self.assertIn("[warn]", err)

    def test_sync_success_keeps_info_line(self):
        routes = {
            "/sync": (200, json.dumps({"success": True, "requestId": "r2",
                                       "data": {"status": "syncing"}, "error": None}).encode("utf-8")),
            "/similar": (200, json.dumps(SIMILAR_OK).encode("utf-8")),
        }
        with Stub(routes) as stub:
            code, _, err = run_main(
                ["某某公众号", "--sync", "--wechat-id", "gh_x"],
                stub.base + "/sync", stub.base + "/similar",
            )
        self.assertEqual(code, 0)
        self.assertIn("[info]", err)
        self.assertNotIn("[warn]", err)


class MainQueryStillFailsTests(unittest.TestCase):
    """红线：降级只针对可选预同步，主查询失败必须如实非零退出。"""

    def test_main_query_failure_exits_nonzero_even_after_sync_degraded(self):
        routes = {
            "/sync": (503, envelope("CAPABILITY_UNAVAILABLE", "上游接口维护中（404）")),
            "/similar": (502, envelope("PROVIDER_FAILED", "上游临时故障")),
        }
        with Stub(routes) as stub:
            code, out, err = run_main(
                ["某某公众号", "--sync", "--wechat-id", "gh_x"],
                stub.base + "/sync", stub.base + "/similar",
            )
        self.assertNotEqual(code, 0)
        self.assertIn("[error]", err)
        self.assertIn("PROVIDER_FAILED", err)
        self.assertEqual(out, "")  # 查不到绝不伪装成成功输出

    def test_main_query_failure_without_sync_exits_nonzero(self):
        routes = {"/similar": (404, envelope("NOT_FOUND", "账号未收录"))}
        with Stub(routes) as stub:
            code, out, err = run_main(
                ["某某公众号"], stub.base + "/sync", stub.base + "/similar",
            )
        self.assertNotEqual(code, 0)
        self.assertIn("NOT_FOUND", err)
        self.assertEqual(out, "")

    def test_sync_without_wechat_id_still_validation_error(self):
        code, _, err = run_main(["某某公众号", "--sync"], "http://127.0.0.1:1/sync",
                                "http://127.0.0.1:1/similar")
        self.assertEqual(code, 1)
        self.assertIn("VALIDATION_ERROR", err)


if __name__ == "__main__":
    unittest.main()
