from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "wechat_mp_exporter.py"
SPEC = importlib.util.spec_from_file_location("wechat_mp_exporter_product", SCRIPT)
assert SPEC and SPEC.loader
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)
lite = exporter.lite_backend


class FakeBackend:
    mode = "lite"

    def __init__(self, *, accounts=None, pages=None):
        self.accounts = list(accounts or [])
        self.pages = dict(pages or {})
        self.article_calls: list[tuple[str, int, int]] = []
        self.fetch_calls: list[str] = []

    def search_page(self, keyword, begin, size):
        return {"list": self.accounts if begin == 0 else []}

    def article_page(self, fakeid, keyword, begin, size):
        self.article_calls.append((fakeid, begin, size))
        return {"articles": self.pages.get(begin, [])}

    def account_metadata(self, url, fakeid):
        return {"fakeid": fakeid, "raw": {"fakeid": fakeid, "nickname": "Account"}}

    def fetch_content(self, url, format_name):
        self.fetch_calls.append(url)
        return f"{format_name}:{url}\n".encode()

    def redact_error(self, value):
        return value


def command_args(state: Path, **values):
    defaults = {
        "state_dir": str(state),
        "timeout": 1.0,
        "resolved_mode": "lite",
        "resolved_ui": "terminal",
        "backend_rules": exporter.load_backend_rules(),
        "workflow_rules": exporter.load_workflow_rules(),
        "browser": "auto",
        "driver_path": None,
        "mode": "lite",
        "api_base": None,
    }
    defaults.update(values)
    return argparse.Namespace(**defaults)


class QueryWorkflowTests(unittest.TestCase):
    def test_ft01_search_human_json_and_all_preflight(self):
        backend = FakeBackend(accounts=[
            {"fakeid": "a", "nickname": "Alpha", "alias": "alpha", "signature": "First"},
            {"fakeid": "b", "nickname": "Beta", "alias": "beta", "signature": "Second"},
        ])
        with tempfile.TemporaryDirectory() as directory:
            args = command_args(Path(directory), keyword="Alpha", begin=0, size=5, pages=1, all=False, max_pages=500, json=False)
            with mock.patch.object(exporter, "backend_from_args", return_value=backend), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_search(args), 0)
            human = stdout.getvalue()
            self.assertIn("Alpha [exact]", human)
            self.assertIn("Unsupported metrics: read_count", human)
            self.assertNotIn('"accounts"', human)

            args.json = True
            with mock.patch.object(exporter, "backend_from_args", return_value=backend), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_search(args), 0)
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["accounts"][0]["fakeid"], "a")

            args.json = False
            args.all = True
            with mock.patch.object(exporter, "backend_from_args", side_effect=AssertionError("backend touched")), mock.patch("sys.stderr", new_callable=io.StringIO):
                self.assertEqual(exporter.cmd_search(args), 2)

        with mock.patch.object(exporter, "load_backend_rules", side_effect=AssertionError("backend resolution touched")), mock.patch(
            "sys.stderr", new_callable=io.StringIO
        ) as stderr:
            self.assertEqual(exporter.main(["search", "Alpha", "--all", "--mode", "lite"]), 2)
        self.assertIn("add --json", stderr.getvalue())

    def test_ft02_latest_resolution_precedence_ambiguity_pick_and_account_id(self):
        accounts = [
            {"fakeid": "name", "nickname": "Target", "alias": "other"},
            {"fakeid": "id", "nickname": "Other", "alias": "Target"},
        ]
        backend = FakeBackend(accounts=accounts, pages={0: [{"aid": "1", "title": "Newest", "link": "https://mp.weixin.qq.com/s/a", "create_time": "1700000000"}]})
        with tempfile.TemporaryDirectory() as directory:
            args = command_args(Path(directory), account="Target", account_id=None, pick=None, limit=1, json=True)
            with mock.patch.object(exporter, "backend_from_args", return_value=backend), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_latest(args), 0)
            self.assertEqual(json.loads(stdout.getvalue())["account"]["fakeid"], "name")
            self.assertEqual(backend.article_calls[-1][0], "name")

            ambiguous = FakeBackend(accounts=[
                {"fakeid": "a", "nickname": "Same"},
                {"fakeid": "b", "nickname": "Same"},
            ])
            with mock.patch.object(exporter, "backend_from_args", return_value=ambiguous), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_latest(args), 4)
            self.assertEqual(json.loads(stdout.getvalue())["code"], "account_ambiguous")

            args.pick = 2
            with mock.patch.object(exporter, "backend_from_args", return_value=ambiguous), mock.patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(exporter.cmd_latest(args), 0)
            self.assertEqual(ambiguous.article_calls[-1][0], "b")

            args.pick = None
            args.account_id = "direct"
            with mock.patch.object(exporter, "backend_from_args", return_value=backend), mock.patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(exporter.cmd_latest(args), 0)
            self.assertEqual(backend.article_calls[-1][0], "direct")

    def test_ft03_today_seconds_milliseconds_boundary_and_truncation(self):
        now = dt.datetime.now(dt.timezone.utc)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        today = [
            {"aid": "1", "title": "seconds", "link": "https://mp.weixin.qq.com/s/1", "create_time": str(int(start + 10))},
            {"aid": "2", "title": "milliseconds", "link": "https://mp.weixin.qq.com/s/2", "create_time": str(int((start + 20) * 1000))},
            {"aid": "old", "title": "old", "link": "https://mp.weixin.qq.com/s/old", "create_time": start - 1},
        ]
        backend = FakeBackend(accounts=[{"fakeid": "a", "nickname": "Account"}], pages={0: today})
        with tempfile.TemporaryDirectory() as directory:
            args = command_args(Path(directory), account="Account", account_id=None, pick=None, timezone="UTC", max_pages=1, json=True)
            with mock.patch.object(exporter, "backend_from_args", return_value=backend), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_today(args), 0)
            result = json.loads(stdout.getvalue())
            self.assertEqual([item["title"] for item in result["articles"]], ["seconds", "milliseconds"])
            self.assertFalse(result["truncated"])

            truncated = FakeBackend(accounts=backend.accounts, pages={0: today[:2]})
            with mock.patch.object(exporter, "backend_from_args", return_value=truncated), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_today(args), 1)
            self.assertTrue(json.loads(stdout.getvalue())["truncated"])

    def test_today_rejects_invalid_timezone_before_backend_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            args = command_args(
                Path(directory), account="Account", account_id=None, pick=None,
                timezone="Not/A_Real_Zone", max_pages=1, json=True,
            )
            with mock.patch.object(exporter, "backend_from_args", side_effect=AssertionError("backend touched")):
                with self.assertRaisesRegex(exporter.ExporterError, "unknown timezone"):
                    exporter.cmd_today(args)

    def test_today_window_uses_adjacent_local_midnights_across_dst(self):
        zone = exporter.timezone_from("America/Los_Angeles")
        spring = dt.datetime(2026, 3, 8, 12, tzinfo=zone)
        fall = dt.datetime(2026, 11, 1, 12, tzinfo=zone)
        _, spring_start, spring_end = exporter.local_day_window(zone, spring)
        _, fall_start, fall_end = exporter.local_day_window(zone, fall)
        self.assertEqual(spring_end - spring_start, 23 * 60 * 60)
        self.assertEqual(fall_end - fall_start, 25 * 60 * 60)

    def test_ft04_articles_human_json_and_all_preflight(self):
        backend = FakeBackend(pages={0: [{"aid": "1", "title": "One", "link": "https://mp.weixin.qq.com/s/1", "create_time": 1700000000}]})
        with tempfile.TemporaryDirectory() as directory:
            args = command_args(Path(directory), fakeid="a", keyword="", begin=0, size=20, pages=1, all=False, max_pages=500, json=False)
            with mock.patch.object(exporter, "backend_from_args", return_value=backend), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_articles(args), 0)
            self.assertIn("One", stdout.getvalue())
            args.json = True
            with mock.patch.object(exporter, "backend_from_args", return_value=backend), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_articles(args), 0)
            self.assertEqual(json.loads(stdout.getvalue())["articles"][0]["aid"], "1")
            args.all = True
            with mock.patch.object(exporter, "backend_from_args", side_effect=AssertionError("backend touched")), mock.patch("sys.stderr", new_callable=io.StringIO):
                self.assertEqual(exporter.cmd_articles(args), 2)

        with mock.patch.object(exporter, "load_backend_rules", side_effect=AssertionError("backend resolution touched")), mock.patch(
            "sys.stderr", new_callable=io.StringIO
        ) as stderr:
            self.assertEqual(exporter.main(["articles", "fakeid", "--all", "--mode", "lite"]), 2)
        self.assertIn("use archive", stderr.getvalue())


class ArchiveAndOnboardTests(unittest.TestCase):
    def test_ft05_archive_limit_manifest_default_output_and_resume(self):
        articles = [
            {"aid": "1", "title": "One", "link": "https://mp.weixin.qq.com/s/1", "create_time": 3},
            {"aid": "1", "title": "One duplicate", "link": "https://mp.weixin.qq.com/s/1", "create_time": 3},
            {"aid": "2", "title": "Two", "link": "https://mp.weixin.qq.com/s/2", "create_time": 2},
            {"aid": "3", "title": "Three", "link": "https://mp.weixin.qq.com/s/3", "create_time": 1},
        ]
        backend = FakeBackend(accounts=[{"fakeid": "resolved", "nickname": "Account"}], pages={0: articles})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            state.mkdir(mode=0o700)
            args = command_args(
                state,
                fakeid="Account",
                format="markdown",
                output=None,
                begin=0,
                size=20,
                max_pages=None,
                today=False,
                limit=2,
                timezone="UTC",
                pick=None,
                account_id=None,
                json=False,
            )
            with mock.patch.object(exporter, "backend_from_args", return_value=backend), mock.patch.object(exporter.Path, "cwd", return_value=root), mock.patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(exporter.cmd_archive_dispatch(args), 0)
            output = Path(args.output)
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertEqual(manifest["selection"], {"type": "limit", "limit": 2})
            self.assertEqual(manifest["article_count"], 2)
            self.assertEqual(manifest["stop_reason"], "selection-limit")
            self.assertEqual(len(backend.fetch_calls), 2)
            self.assertRegex(output.name, r"^[0-9a-f]{16}-markdown$")

            resumed = FakeBackend(accounts=backend.accounts, pages={0: articles})
            resumed.fetch_content = mock.Mock(side_effect=AssertionError("existing content fetched"))
            args._backend = resumed
            with mock.patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(exporter.cmd_archive(args), 0)
            resumed.fetch_content.assert_not_called()

            refreshed_articles = [
                {"aid": "new", "title": "New", "link": "https://mp.weixin.qq.com/s/new", "create_time": 4},
                *articles,
            ]
            refreshed = FakeBackend(accounts=backend.accounts, pages={0: refreshed_articles})
            args._backend = refreshed
            with mock.patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(exporter.cmd_archive(args), 0)
            records = exporter.load_ndjson(output / "articles.ndjson")
            self.assertEqual([record["aid"] for record in records], ["new", "1"])
            self.assertEqual(json.loads((output / "manifest.json").read_text())["article_count"], 2)
            self.assertFalse((output / "content" / "resolved:2.md").exists())

    def test_ft06_onboard_reuse_force_setup_and_docker_pending(self):
        rules = exporter.load_backend_rules()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            lite.ensure_state_root(state)
            session = state / rules["state_paths"]["lite_session"]
            lite.atomic_json(session, {"schema_version": 1, "token": "123456", "cookies": [{"name": "x", "value": "y"}], "user_agent": "UA", "browser": "chrome"}, state)
            args = command_args(state, force_login=False, json=True, _normalized_argv=["onboard", "--mode", "lite"], port=3000)
            with mock.patch.object(lite, "dependency_probe", return_value={"installed": True}), mock.patch.object(exporter, "cmd_login", side_effect=AssertionError("login touched")), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_onboard(args), 0)
            self.assertEqual(json.loads(stdout.getvalue())["code"], "session_reused")

            args.force_login = True
            with mock.patch.object(lite, "dependency_probe", return_value={"installed": True}), mock.patch.object(exporter, "cmd_auth_clear_dispatch", wraps=exporter.cmd_auth_clear_dispatch) as clear, mock.patch.object(exporter, "cmd_login", return_value=0), mock.patch.object(lite, "load_session", return_value={"browser": "chrome"}), mock.patch("sys.stdout", new_callable=io.StringIO):
                self.assertEqual(exporter.cmd_onboard(args), 0)
            clear.assert_called_once()

            args.force_login = False
            session.unlink(missing_ok=True)
            with mock.patch.object(lite, "dependency_probe", return_value={"installed": False}), mock.patch.object(exporter, "cmd_setup_dispatch", return_value=0) as setup_lite, mock.patch.object(exporter, "maybe_reexec_lite") as reexec, mock.patch.object(exporter, "cmd_login", return_value=0), mock.patch.object(lite, "load_session", side_effect=[lite.LiteError("missing"), {"browser": "chrome"}]), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_onboard(args), 0)
            setup_lite.assert_called_once()
            reexec.assert_called_once()
            self.assertEqual(json.loads(stdout.getvalue())["code"], "login_verified")

            with mock.patch.object(lite, "dependency_probe", return_value={"installed": False}), mock.patch.object(
                exporter, "cmd_setup_dispatch", side_effect=exporter.ExporterError("setup token=private failed")
            ), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_onboard(args), 1)
            setup_failure = json.loads(stdout.getvalue())
            self.assertEqual((setup_failure["phase"], setup_failure["code"], setup_failure["terminal"]), ("setup", "setup_failed", True))
            self.assertNotIn("private", setup_failure["error"])

            docker = command_args(state, resolved_mode="docker", mode="auto", force_login=False, json=True, port=3000)
            with mock.patch.object(exporter, "service_status", return_value={"setup": False, "running": False}), mock.patch.object(exporter, "cmd_setup", side_effect=AssertionError("Docker setup touched")), mock.patch.object(exporter, "cmd_start", side_effect=AssertionError("Docker start touched")), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_onboard(docker), 2)
            self.assertEqual(json.loads(stdout.getvalue())["code"], "docker_requires_explicit_mode")

            docker.mode = "docker"
            with mock.patch.object(exporter, "service_status", side_effect=[{"setup": False, "running": False}, {"setup": True, "running": False}]), mock.patch.object(exporter, "cmd_setup", return_value=0) as setup, mock.patch.object(exporter, "cmd_start", return_value=0) as start, mock.patch.object(exporter, "cmd_login", return_value=0), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout:
                self.assertEqual(exporter.cmd_onboard(docker), 3)
            setup.assert_called_once()
            start.assert_called_once()
            self.assertEqual(json.loads(stdout.getvalue())["code"], "qr_pending")

    def test_archive_today_rejects_invalid_timezone_before_backend_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            args = command_args(
                Path(directory), fakeid="Account", format="markdown", output=None,
                begin=0, size=20, max_pages=None, today=True, limit=None,
                timezone="Not/A_Real_Zone", pick=None, account_id=None, json=False,
            )
            with mock.patch.object(exporter, "backend_from_args", side_effect=AssertionError("backend touched")):
                with self.assertRaisesRegex(exporter.ExporterError, "unknown timezone"):
                    exporter.prepare_archive_selection(args)


class LoginRecoveryAndStatusTests(unittest.TestCase):
    def _state(self, directory: str):
        state = Path(directory) / "state"
        lite.ensure_state_root(state)
        return state, exporter.load_backend_rules(), exporter.load_workflow_rules()

    def test_chromium_flags_are_platform_bounded(self):
        workflows = exporter.load_workflow_rules()
        self.assertEqual(lite.chromium_flags(workflows, safe_mode=False, platform_name="Darwin", shm_restricted=True), ["--no-first-run", "--disable-sync"])
        self.assertEqual(lite.chromium_flags(workflows, safe_mode=True, platform_name="Linux", shm_restricted=True), ["--no-first-run", "--disable-sync", "--disable-extensions", "--disable-dev-shm-usage"])
        self.assertFalse(any(flag in lite.chromium_flags(workflows, safe_mode=True, platform_name="Linux", shm_restricted=False) for flag in ("--no-sandbox", "--disable-gpu")))

    def test_startup_retries_exactly_once_and_qr_timeout_never_retries(self):
        class Driver:
            current_url = "https://mp.weixin.qq.com/cgi-bin/home?token=123456"
            def get(self, url): return None
            def get_cookies(self): return [{"name": "x", "value": "y"}]
            def execute_script(self, script): return "UA"
            def quit(self): return None

        with tempfile.TemporaryDirectory() as directory:
            state, rules, workflows = self._state(directory)
            with mock.patch.object(lite, "select_browser", return_value=("chrome", "/browser")), mock.patch.object(lite, "_create_driver", side_effect=[RuntimeError("tab crashed"), Driver()]) as create:
                lite.login(state, rules["state_paths"], rules, "auto", None, workflow_rules=workflows)
            self.assertEqual(create.call_count, 2)
            self.assertFalse(create.call_args_list[0].kwargs["safe_mode"])
            self.assertTrue(create.call_args_list[1].kwargs["safe_mode"])
            self.assertTrue((state / rules["state_paths"]["lite_session"]).is_file())

        class WaitingDriver(Driver):
            current_url = "https://mp.weixin.qq.com/"

        with tempfile.TemporaryDirectory() as directory:
            state, rules, workflows = self._state(directory)
            with mock.patch.object(lite, "select_browser", return_value=("chrome", "/browser")), mock.patch.object(lite, "_create_driver", return_value=WaitingDriver()) as create, mock.patch.object(lite.time, "monotonic", side_effect=[0, 301]):
                with self.assertRaisesRegex(lite.LoginError, "timed out") as caught:
                    lite.login(state, rules["state_paths"], rules, "auto", None, workflow_rules=workflows)
            self.assertEqual(caught.exception.code, "qr_timeout")
            self.assertEqual(create.call_count, 1)

    def test_profile_replacement_rolls_back_and_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            lite.ensure_state_root(state)
            primary, recovery = state / "profile", state / "recovery"
            lite.ensure_private_child(state, primary)
            lite.ensure_private_child(state, recovery)
            (primary / "old").write_text("old")
            (recovery / "new").write_text("new")
            original = lite._require_private_dir
            calls = 0
            def fail_after_install(path, label):
                nonlocal calls
                calls += 1
                if calls == 3:
                    raise lite.LiteError("validation failed")
                return original(path, label)
            with mock.patch.object(lite, "_require_private_dir", side_effect=fail_after_install):
                with self.assertRaises(lite.LiteError):
                    lite.replace_profile(primary, recovery, state)
            self.assertEqual((primary / "old").read_text(), "old")
            self.assertFalse((primary / "new").exists())

            recovery.mkdir(mode=0o700)
            outside = state / "outside"
            outside.mkdir(mode=0o700)
            recovery.rmdir()
            recovery.symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(lite.LiteError, "symlink"):
                lite.replace_profile(primary, recovery, state)

    def test_failed_profile_rollback_preserves_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            lite.ensure_state_root(state)
            primary, recovery = state / "profile", state / "recovery"
            lite.ensure_private_child(state, primary)
            lite.ensure_private_child(state, recovery)
            (primary / "old").write_text("old")
            (recovery / "new").write_text("new")
            real_replace = os.replace
            calls = 0
            def fail_install_and_restore(source, target):
                nonlocal calls
                calls += 1
                if calls in (2, 3):
                    raise OSError("simulated replace failure")
                return real_replace(source, target)
            with mock.patch.object(lite.os, "replace", side_effect=fail_install_and_restore):
                with self.assertRaisesRegex(lite.LiteError, "replace or restore"):
                    lite.replace_profile(primary, recovery, state)
            backup = state / "profile-backup"
            self.assertEqual((backup / "old").read_text(), "old")
            self.assertEqual((recovery / "new").read_text(), "new")

    def test_setup_lite_offline_command_smoke(self):
        rules = exporter.load_backend_rules()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            calls: list[list[str]] = []
            def runner(command, **_kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 0, "", "")
            def which(name):
                return {"python3.12": "/offline/python3.12", "uv": "/offline/uv"}.get(name)
            with mock.patch.object(lite.shutil, "which", side_effect=which):
                result = lite.setup_lite(state, rules["state_paths"], exporter.LITE_LOCK_PATH, runner=runner)
            self.assertEqual(result["installer"], "uv")
            self.assertEqual(calls[0][:3], ["/offline/uv", "venv", "--python"])
            self.assertIn("--require-hashes", calls[1])
            self.assertIn(str(exporter.LITE_LOCK_PATH), calls[1])

    def test_error_redaction_status_fields_and_manual_browser_url(self):
        private_path = "/" + "Users" + "/name/private"
        summary = lite.sanitize_error_summary(f"token=secret cookie=value https://example.test/x --user-data-dir={private_path}")
        self.assertNotIn("secret", summary)
        self.assertNotIn("example.test", summary)
        self.assertNotIn(private_path, summary)
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "runtime" / "lite.json"
            with mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
                with lite.StatusServer(exporter.LITE_STATUS_PATH, runtime, opener=lambda *_args, **_kwargs: False) as status:
                    status.update("success", "done", phase="ready", code="ok", next_actions=["one", "two", "three", "four"], terminal=True)
                    self.assertTrue(status.state["terminal"])
                    self.assertEqual(status.state["phase"], "ready")
                    self.assertEqual(status.state["next_actions"], ["one", "two", "three"])
                self.assertIn("http://127.0.0.1:", stderr.getvalue())
        html = exporter.LITE_STATUS_PATH.read_text()
        self.assertIn("if(!terminal)", html)
        self.assertIn("next_actions", html)

    def test_doctor_reports_explicit_driver_major_mismatch_without_download(self):
        rules = exporter.load_backend_rules()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            lite.ensure_state_root(state)
            driver = root / "driver"
            driver.write_text("#!/bin/sh\n")
            driver.chmod(0o700)
            detected = {name: {"available": name == "chrome", "path": "/browser" if name == "chrome" else None, "support": rules["browsers"]["support"][name]} for name in rules["browsers"]["priority"]}
            args = command_args(state, browser="chrome", driver_path=str(driver))
            def version(path):
                return {"/browser": "Google Chrome 150.0.1", str(driver): "ChromeDriver 149.0.1", "/manager": "selenium-manager 0.4.15"}.get(path)
            with mock.patch.object(lite, "detect_browsers", return_value=detected), mock.patch.object(lite, "executable_version", side_effect=version), mock.patch.object(lite, "dependency_probe", return_value={"installed": True, "python": "/venv/python", "selenium_version": "4.46.0", "selenium_manager_path": "/manager"}):
                report = exporter.lite_doctor_report(args)
            checks = {item["name"]: item for item in report["checks"]}
            self.assertFalse(checks["driver"]["ok"])
            self.assertIn("major mismatch", checks["driver"]["detail"])
            self.assertEqual(checks["selenium"]["detail"], "4.46.0")


if __name__ == "__main__":
    unittest.main()
