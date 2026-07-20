from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "wechat_mp_exporter.py"
SPEC = importlib.util.spec_from_file_location("wechat_mp_exporter_dual", SCRIPT)
assert SPEC and SPEC.loader
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)
lite = exporter.lite_backend


class RulesAndResolutionTests(unittest.TestCase):
    def test_rules_are_strict_and_paths_are_safe(self):
        rules = exporter.load_backend_rules()
        self.assertEqual(rules["auto_order"], ["lite", "docker"])
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "rules.json"
            broken = dict(rules)
            broken["unknown"] = True
            target.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaises(exporter.ExporterError):
                exporter.load_backend_rules(target)
            broken = json.loads(exporter.BACKENDS_PATH.read_text(encoding="utf-8"))
            broken["state_paths"]["lite_root"] = "../escape"
            target.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaises(exporter.ExporterError):
                exporter.load_backend_rules(target)

    def test_rules_reject_non_integer_schema_and_unsafe_browser_candidates(self):
        rules = json.loads(exporter.BACKENDS_PATH.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "rules.json"
            for schema in (True, 1.0, "1"):
                broken = json.loads(json.dumps(rules))
                broken["schema_version"] = schema
                target.write_text(json.dumps(broken), encoding="utf-8")
                with self.subTest(schema=schema), self.assertRaises(exporter.ExporterError):
                    exporter.load_backend_rules(target)
            for candidate in ("../malware", "folder/program", "./program", "bad//program", "bad\x00program", "bad\nprogram"):
                broken = json.loads(json.dumps(rules))
                broken["browsers"]["candidates"]["linux"]["chrome"] = [candidate]
                target.write_text(json.dumps(broken), encoding="utf-8")
                with self.subTest(candidate=repr(candidate)), self.assertRaises(exporter.ExporterError):
                    exporter.load_backend_rules(target)

    def test_browser_candidate_accepts_canonical_absolute_and_bare_names(self):
        valid = (
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "google-chrome-stable",
            "firefox.exe",
        )
        self.assertEqual([exporter.validate_browser_candidate(value) for value in valid], list(valid))

    def test_global_flags_work_before_or_after_subcommand(self):
        parser = exporter.build_parser()
        first = parser.parse_args(exporter.normalize_global_options(["--mode", "lite", "status", "--json"]))
        second = parser.parse_args(exporter.normalize_global_options(["status", "--json", "--mode=lite"]))
        self.assertEqual((first.mode, first.command, first.json), (second.mode, second.command, second.json))

    def test_resolution_precedence_and_no_silent_fallback(self):
        rules = exporter.load_backend_rules()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            args = argparse.Namespace(mode="auto", api_base=None)
            with mock.patch.object(exporter, "service_status", return_value={"running": True, "setup": True}), mock.patch.object(
                lite, "lite_ready", return_value=True
            ):
                self.assertEqual(exporter.resolve_mode(args, state, rules, command="archive"), "docker")
            with mock.patch.object(exporter, "service_status", return_value={"running": False, "setup": False}), mock.patch.object(
                lite, "lite_ready", return_value=True
            ):
                self.assertEqual(exporter.resolve_mode(args, state, rules, command="archive"), "lite")
            explicit = argparse.Namespace(mode="lite", api_base=None)
            with mock.patch.object(exporter, "service_status", side_effect=AssertionError("Docker touched")):
                self.assertEqual(exporter.resolve_mode(explicit, state, rules), "lite")
            conflict = argparse.Namespace(mode="lite", api_base="http://127.0.0.1:3000")
            with self.assertRaises(exporter.ExporterError):
                exporter.resolve_mode(conflict, state, rules)

    def test_preference_is_mode_0600_and_precedes_running_docker(self):
        rules = exporter.load_backend_rules()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            prefs = {"schema_version": 1, "mode": "lite", "ui": "terminal", "browser": "chrome", "driver_path": None}
            exporter.save_preferences(state, rules, prefs)
            self.assertEqual(stat.S_IMODE(exporter.preferences_path(state, rules).stat().st_mode), 0o600)
            with mock.patch.object(exporter, "service_status", side_effect=AssertionError("running Docker should not override preference")):
                self.assertEqual(exporter.resolve_mode(argparse.Namespace(mode="auto", api_base=None), state, rules), "lite")

    def test_ui_matrix_fails_closed(self):
        rules = exporter.load_backend_rules()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            with self.assertRaises(exporter.ExporterError):
                exporter.resolve_ui(argparse.Namespace(ui="full"), state, rules, "lite")
            with self.assertRaises(exporter.ExporterError):
                exporter.resolve_ui(argparse.Namespace(ui="html"), state, rules, "docker")
            self.assertEqual(exporter.resolve_ui(argparse.Namespace(ui="terminal"), state, rules, "lite"), "terminal")


class BrowserAndSessionTests(unittest.TestCase):
    def _rules_with_browser(self, root: Path, name: str) -> dict:
        rules = json.loads(exporter.BACKENDS_PATH.read_text(encoding="utf-8"))
        binary = root / name
        binary.write_text("#!/bin/sh\n", encoding="utf-8")
        binary.chmod(0o700)
        system = lite._platform_key()
        for browser in rules["browsers"]["priority"]:
            rules["browsers"]["candidates"][system][browser] = [str(binary)] if browser == name else []
        return rules

    def test_browser_detection_support_and_unavailable_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rules = self._rules_with_browser(root, "chrome")
            detected = lite.detect_browsers(rules)
            self.assertTrue(detected["chrome"]["available"])
            self.assertEqual(detected["chrome"]["support"], "tier1")
            with self.assertRaises(lite.LiteError):
                lite.select_browser("edge", rules)
            safari_rules = self._rules_with_browser(root, "safari")
            with self.assertRaisesRegex(lite.LiteError, "progress only"):
                lite.select_browser("safari", safari_rules)

    def test_login_url_validation_and_off_domain(self):
        self.assertEqual(lite.validate_login_result("https://mp.weixin.qq.com/cgi-bin/home?token=123456&t=x"), "123456")
        for value in ("https://evil.example/?token=123456", "http://mp.weixin.qq.com/?token=123456", "https://mp.weixin.qq.com/"):
            with self.subTest(value=value), self.assertRaises(lite.LiteError):
                lite.validate_login_result(value)

    def test_session_permissions_symlink_and_auth_isolation(self):
        rules = exporter.load_backend_rules()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            docker = state / rules["state_paths"]["docker_auth"]
            session = state / rules["state_paths"]["lite_session"]
            lite.ensure_state_root(state)
            lite.ensure_private_child(state, session.parent)
            exporter.atomic_write_bytes(docker, b"d" * 32)
            lite.atomic_json(session, {"schema_version": 1, "token": "123456", "user_agent": "UA", "cookies": [{"name": "x", "value": "y"}], "browser": "chrome"}, state)
            self.assertEqual(exporter.load_auth_key(state), "d" * 32)
            self.assertEqual(lite.load_session(state, rules["state_paths"])["token"], "123456")
            self.assertEqual(stat.S_IMODE(session.stat().st_mode), 0o600)
            session.unlink()
            session.symlink_to(docker)
            with self.assertRaises(lite.LiteError):
                lite.load_session(state, rules["state_paths"])

    def test_profile_lock_is_exclusive_and_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "lite" / "login.lock"
            with lite.process_lock(lock):
                self.assertTrue(lock.is_file())
                with self.assertRaises(lite.LiteError):
                    with lite.process_lock(lock):
                        pass
            self.assertFalse(lock.exists())

    def test_partial_venv_is_not_ready(self):
        rules = exporter.load_backend_rules()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            python = state / "lite" / "venv" / "bin" / "python"
            lite.ensure_state_root(state)
            lite.ensure_private_child(state, state / "lite")
            python.parent.mkdir(parents=True)
            python.write_text("", encoding="utf-8")
            with mock.patch.object(lite, "dependency_probe", return_value={"installed": False, "python": str(python)}):
                self.assertFalse(lite.lite_ready(state, rules["state_paths"], rules))

    def test_lite_state_rejects_external_symlink_and_open_parent(self):
        rules = exporter.load_backend_rules()
        paths = rules["state_paths"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            external = root / "external"
            lite.ensure_state_root(state)
            external.mkdir(mode=0o700)
            (state / "secrets").symlink_to(external, target_is_directory=True)
            with self.assertRaisesRegex(lite.LiteError, "non-symlink"):
                lite.load_session(state, paths)

        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            state.mkdir(mode=0o755)
            os.chmod(state, 0o755)
            with self.assertRaisesRegex(lite.LiteError, "0700"):
                lite.validate_lite_layout(state, paths)


class LiteTransportTests(unittest.TestCase):
    def session(self):
        return {"token": "123456", "user_agent": "Test UA", "cookies": [{"name": "session", "value": "secret", "domain": ".mp.weixin.qq.com", "path": "/", "secure": True}]}

    def test_search_is_encoded_and_token_redaction(self):
        client = lite.LiteClient(self.session(), 1, sleep=lambda _: None)
        url = client._url("/cgi-bin/searchbiz", {"query": "甲 & 乙", "begin": 0, "count": 5})
        parsed = urllib.parse.urlsplit(url)
        query = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(query["query"], ["甲 & 乙"])
        self.assertEqual(query["token"], ["123456"])
        redacted = lite._redact_error(f"bad {url}", "123456")
        self.assertNotIn("123456", redacted)

    def test_api_error_and_429_bounded_retry(self):
        client = lite.LiteClient(self.session(), 1, sleep=lambda _: None)
        body = json.dumps({"base_resp": {"ret": -1, "err_msg": "expired 123456"}}).encode()
        with mock.patch.object(client, "_read", return_value=(body, "application/json")):
            with self.assertRaises(lite.LiteError) as caught:
                client.api("/cgi-bin/searchbiz", {})
        self.assertNotIn("123456", str(caught.exception))

        error = urllib.error.HTTPError("https://mp.weixin.qq.com/x", 429, "rate", {}, None)
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.geturl.return_value = "https://mp.weixin.qq.com/x"
        response.read.return_value = b"{}"
        response.headers.get.return_value = "application/json"
        client.opener.open = mock.Mock(side_effect=[error, response])
        self.assertEqual(client._read(urllib.request.Request("https://mp.weixin.qq.com/x"), 100)[0], b"{}")
        self.assertEqual(client.opener.open.call_count, 2)

    def test_publish_info_string_and_object_forms(self):
        for info in (json.dumps({"appmsgex": [{"aid": "1"}]}), {"appmsgex": [{"aid": "1"}]}):
            payload = {"publish_page": {"publish_list": [{"publish_info": info}]}}
            self.assertEqual(exporter.flatten_article_payload(payload)[0]["aid"], "1")

    def test_ambiguous_search_results_are_retained(self):
        class Backend:
            def search_page(self, keyword, begin, size):
                return {"list": [{"fakeid": "a", "nickname": "same"}, {"fakeid": "b", "nickname": "same"}] if begin == 0 else []}
        accounts, _, = exporter.search_pages("", "", "same", 0, 5, 2, 1, Backend())
        self.assertEqual([item["fakeid"] for item in accounts], ["a", "b"])

    def test_redirect_and_abnormal_content_fail_closed(self):
        handler = lite._SameOriginRedirect()
        with self.assertRaises(lite.LiteError):
            handler.redirect_request(None, None, 302, "", {}, "https://evil.example/x")
        client = lite.LiteClient(self.session(), 1, sleep=lambda _: None)
        with mock.patch.object(client, "_read", return_value=("环境异常".encode(), "text/html")):
            with self.assertRaises(lite.LiteError):
                client.content_html("https://mp.weixin.qq.com/s/a")

    def test_visible_fallback_is_attempted_only_once(self):
        backend = object.__new__(lite.LiteBackend)
        backend.client = mock.Mock()
        backend.client.content_html.side_effect = lite.LiteError("blocked")
        backend._fallback_used = False
        backend._content_cache = {}
        backend._visible_fallback = mock.Mock(side_effect=lite.LiteError("fallback failed"))
        with self.assertRaises(lite.LiteError):
            backend.fetch_content("https://mp.weixin.qq.com/s/a", "text")
        with self.assertRaises(lite.LiteError):
            backend.fetch_content("https://mp.weixin.qq.com/s/b", "text")
        self.assertEqual(backend._visible_fallback.call_count, 1)

    def test_off_host_never_reaches_visible_fallback_or_selenium(self):
        backend = object.__new__(lite.LiteBackend)
        backend._content_cache = {}
        with mock.patch.object(backend, "_visible_fallback") as fallback, mock.patch.object(lite, "_create_driver") as create_driver:
            with self.assertRaises(lite.LiteError):
                backend.fetch_content("https://evil.example/s/a", "text")
            fallback.assert_not_called()
        with mock.patch.object(lite, "_create_driver") as create_driver:
            with self.assertRaises(lite.LiteError):
                lite.LiteBackend._visible_fallback(backend, "https://evil.example/s/a", "text")
            create_driver.assert_not_called()

    def test_lite_adapter_converts_all_operation_errors(self):
        delegate = mock.Mock()
        delegate.redact_error.side_effect = lambda value: value.replace("123456", "[REDACTED]")
        adapter = exporter.LiteBackendAdapter(delegate)
        operations = (
            ("search_page", ("name", 0, 5)),
            ("article_page", ("fakeid", "", 0, 20)),
            ("account_metadata", ("https://mp.weixin.qq.com/s/a", "fakeid")),
            ("fetch_content", ("https://mp.weixin.qq.com/s/a", "text")),
        )
        for method, arguments in operations:
            getattr(delegate, method).side_effect = lite.LiteError("failed 123456")
            with self.subTest(method=method), self.assertRaises(exporter.ExporterError) as caught:
                getattr(adapter, method)(*arguments)
            self.assertNotIn("123456", str(caught.exception))
            getattr(delegate, method).reset_mock(side_effect=True)
        delegate.search_page.side_effect = ValueError("unexpected internal detail")
        with self.assertRaisesRegex(exporter.ExporterError, "without exposing"):
            adapter.search_page("name", 0, 5)


class StatusAndAdapterTests(unittest.TestCase):
    def test_status_server_is_loopback_nonce_secure_and_tears_down(self):
        opened = []
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "runtime" / "lite.json"
            with lite.StatusServer(exporter.LITE_STATUS_PATH, runtime, opener=lambda url, **_: opened.append(url)) as status:
                status.update("archive", "working", 1, 2)
                self.assertRegex(opened[0], r"^http://127\.0\.0\.1:\d+/[A-Za-z0-9_-]{20,}/$")
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(opened[0] + "status") as response:
                    value = json.loads(response.read())
                    self.assertEqual(value["state"], "archive")
                    self.assertEqual(response.headers["Cache-Control"], "no-store, max-age=0")
                    self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
                    self.assertIn("default-src 'none'", response.headers["Content-Security-Policy"])
                runtime_value = json.loads(runtime.read_text())
                self.assertEqual(runtime_value["url"], opened[0])
                self.assertNotIn("cookie", exporter.LITE_STATUS_PATH.read_text(encoding="utf-8").lower())
            self.assertFalse(runtime.exists())

    def test_terminal_context_opens_no_listener(self):
        args = argparse.Namespace(resolved_ui="terminal", backend_rules=exporter.load_backend_rules())
        with tempfile.TemporaryDirectory() as directory:
            context = exporter._lite_status_context(args, Path(directory))
            with context as value:
                self.assertIsNone(value)

    def test_status_server_signal_path_tears_down(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "runtime" / "lite.json"
            with self.assertRaises(KeyboardInterrupt):
                with lite.StatusServer(exporter.LITE_STATUS_PATH, runtime, opener=lambda *_args, **_kwargs: None) as status:
                    status._interrupt(15, None)
            self.assertFalse(runtime.exists())

    def test_archive_resumes_across_backend_switch(self):
        article = {"aid": "1", "link": "https://mp.weixin.qq.com/s/a", "title": "A"}

        class FakeBackend:
            mode = "lite"
            def __init__(self, fail_fetch=False): self.calls = 0; self.fail_fetch = fail_fetch
            def article_page(self, fakeid, keyword, begin, size): return {"articles": [article]} if begin == 0 else {"articles": []}
            def account_metadata(self, url, fakeid): return None
            def fetch_content(self, url, format_name): self.calls += 1; return b"content\n"

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, output = root / "state", root / "out"
            exporter.ensure_secure_dir(state)
            args = argparse.Namespace(state_dir=str(state), api_base=None, timeout=1.0, fakeid="MzA==", format="text", output=str(output), begin=0, size=20, max_pages=3)
            first = FakeBackend()
            with mock.patch.object(exporter, "backend_from_args", return_value=first):
                self.assertEqual(exporter.cmd_archive(args), 0)
            second = FakeBackend()
            second.mode = "docker"
            with mock.patch.object(exporter, "backend_from_args", return_value=second):
                self.assertEqual(exporter.cmd_archive(args), 0)
            self.assertEqual(first.calls, 1)
            self.assertEqual(second.calls, 0)
            self.assertNotIn("mode", json.loads((output / "manifest.json").read_text()))

    def test_archive_rejects_all_symlinked_resume_artifacts_before_rescan(self):
        rules = exporter.load_backend_rules()
        names = ("manifest.json", "account.json", "articles.ndjson", "failures.ndjson", "content/evil.txt")
        for name in names:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                state, output = root / "state", root / "archive"
                exporter.ensure_secure_dir(state)
                exporter.ensure_secure_dir(output)
                exporter.ensure_secure_dir(output / "content")
                external = root / "external"
                external.write_text("{}\n", encoding="utf-8")
                target = output / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(external)
                args = argparse.Namespace(state_dir=str(state), api_base=None, timeout=1.0, fakeid="MzA==", format="text", output=str(output), begin=0, size=20, max_pages=1)
                backend = mock.Mock()
                with mock.patch.object(exporter, "backend_from_args", return_value=backend), self.assertRaises(exporter.ExporterError):
                    exporter.cmd_archive(args)
                backend.article_page.assert_not_called()

    def test_lite_account_failure_recovers_on_next_archive_run(self):
        article = {"aid": "1", "link": "https://mp.weixin.qq.com/s/a", "title": "A"}

        def delegate(account_result):
            value = mock.Mock()
            value.redact_error.side_effect = lambda text: text.replace("123456", "[REDACTED]")
            value.article_page.side_effect = lambda fakeid, keyword, begin, size: {"articles": [article]} if begin == 0 else {"articles": []}
            if isinstance(account_result, Exception):
                value.account_metadata.side_effect = account_result
            else:
                value.account_metadata.return_value = account_result
            value.fetch_content.return_value = b"content\n"
            return value

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, output = root / "state", root / "archive"
            exporter.ensure_secure_dir(state)
            args = argparse.Namespace(state_dir=str(state), api_base=None, timeout=1.0, fakeid="MzA==", format="text", output=str(output), begin=0, size=20, max_pages=3)
            first = delegate(lite.LiteError("temporary 123456"))
            with mock.patch.object(exporter, "backend_from_args", return_value=exporter.LiteBackendAdapter(first)):
                self.assertEqual(exporter.cmd_archive(args), 1)
            failures = exporter.load_ndjson(output / "failures.ndjson")
            self.assertEqual({item["failure_key"] for item in failures}, {"account"})
            self.assertNotIn("123456", failures[0]["error"])

            second = delegate({"fakeid": "MzA==", "raw": {"fakeid": "MzA==", "nickname": "Recovered"}})
            with mock.patch.object(exporter, "backend_from_args", return_value=exporter.LiteBackendAdapter(second)):
                self.assertEqual(exporter.cmd_archive(args), 0)
            self.assertEqual(exporter.load_ndjson(output / "failures.ndjson"), [])
            self.assertEqual(json.loads((output / "account.json").read_text())["raw"]["nickname"], "Recovered")
            second.fetch_content.assert_not_called()

    def test_every_subcommand_help_discloses_global_option_placement(self):
        commands = (
            ["setup", "--help"], ["doctor", "--help"], ["start", "--help"], ["stop", "--help"],
            ["status", "--help"], ["open", "--help"], ["login", "--help"], ["config", "--help"],
            ["search", "--help"], ["articles", "--help"], ["fetch", "--help"], ["archive", "--help"],
            ["auth", "--help"], ["auth", "save", "--help"], ["auth", "status", "--help"], ["auth", "clear", "--help"],
        )
        for argv in commands:
            with self.subTest(argv=argv), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout, self.assertRaises(SystemExit) as caught:
                exporter.build_parser().parse_args(exporter.normalize_global_options(argv))
            self.assertEqual(caught.exception.code, 0)
            help_text = stdout.getvalue()
            self.assertIn("Global --mode, --ui, --browser", help_text)
            self.assertIn("before or after", help_text)

    def test_explicit_docker_path_does_not_import_selenium(self):
        before = set(sys.modules)
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(exporter, "service_status", side_effect=AssertionError("not called")):
            mode = exporter.resolve_mode(argparse.Namespace(mode="docker", api_base=None), Path(directory), exporter.load_backend_rules())
        self.assertEqual(mode, "docker")
        self.assertFalse(any(name == "selenium" or name.startswith("selenium.") for name in set(sys.modules) - before))


if __name__ == "__main__":
    unittest.main()
