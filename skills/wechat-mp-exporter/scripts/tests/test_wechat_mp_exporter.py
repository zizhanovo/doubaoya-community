from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "wechat_mp_exporter.py"
SPEC = importlib.util.spec_from_file_location("wechat_mp_exporter", SCRIPT)
assert SPEC and SPEC.loader
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


class ValidationTests(unittest.TestCase):
    def test_api_base_is_loopback_only(self):
        self.assertEqual(exporter.validate_api_base("http://127.0.0.1:3000"), "http://127.0.0.1:3000")
        self.assertEqual(exporter.validate_api_base("http://localhost:3000/"), "http://localhost:3000")
        self.assertEqual(exporter.validate_api_base("http://[::1]:3000"), "http://[::1]:3000")
        for value in (
            "https://127.0.0.1:3000",
            "http://example.com:3000",
            "http://127.0.0.1:3000/api",
            "http://user:pass@127.0.0.1:3000",
        ):
            with self.subTest(value=value), self.assertRaises(exporter.ExporterError):
                exporter.validate_api_base(value)

    def test_article_url_rejects_non_wechat_and_authority_tricks(self):
        valid = exporter.validate_article_url("https://mp.weixin.qq.com/s/abc?x=1#fragment")
        self.assertEqual(valid, "https://mp.weixin.qq.com/s/abc?x=1")
        for value in (
            "http://mp.weixin.qq.com/s/a",
            "https://evil.example/s/a",
            "https://mp.weixin.qq.com.evil.example/s/a",
            "https://evil@mp.weixin.qq.com/s/a",
            "https://mp.weixin.qq.com:444/s/a",
        ):
            with self.subTest(value=value), self.assertRaises(exporter.ExporterError):
                exporter.validate_article_url(value)

    def test_redaction_covers_plain_and_encoded_secret(self):
        secret = "abcdefghijklmnop/secret"
        value = exporter.redact(f"plain={secret} encoded=abcdefghijklmnop%2Fsecret", [secret])
        self.assertNotIn(secret, value)
        self.assertNotIn("%2Fsecret", value)
        self.assertEqual(value.count("[REDACTED]"), 2)

    def test_safe_formats_and_immutable_image_id(self):
        with self.assertRaises(exporter.ExporterError):
            exporter.fetch_content("http://127.0.0.1:3000", "https://mp.weixin.qq.com/s/a", "json", 1)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(exporter.ExporterError):
                exporter.compose_environment(Path(directory), 3000, "repo:latest")

    def test_secret_file_permissions_are_enforced(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            os.chmod(parent, 0o700)
            secret = parent / "key"
            secret.write_text("a" * 32, encoding="utf-8")
            os.chmod(secret, 0o600)
            self.assertEqual(exporter.read_checked_secret_file(secret), "a" * 32)
            os.chmod(secret, 0o644)
            with self.assertRaises(exporter.ExporterError):
                exporter.read_checked_secret_file(secret)


class ApiAndPaginationTests(unittest.TestCase):
    def test_http_200_error_envelope_is_an_error_and_secret_is_redacted(self):
        key = "s" * 32
        body = json.dumps({"base_resp": {"ret": -1, "err_msg": f"bad {key}"}}).encode()
        with mock.patch.object(exporter, "open_local", return_value=(body, "application/json")):
            with self.assertRaises(exporter.ExporterError) as caught:
                exporter.api_json("http://127.0.0.1:3000", "/api/public/v1/account", {}, key, 1)
        self.assertNotIn(key, str(caught.exception))
        self.assertIn("[REDACTED]", str(caught.exception))

    def test_flatten_group_envelope_preserves_all_items(self):
        payload = {
            "publish_page": json.dumps(
                {
                    "publish_list": [
                        {"publish_info": json.dumps({"appmsgex": [{"aid": "1"}, {"aid": "2"}]})},
                        {"publish_info": json.dumps({"appmsgex": [{"aid": "3"}]})},
                    ]
                }
            )
        }
        self.assertEqual([item["aid"] for item in exporter.flatten_article_payload(payload)], ["1", "2", "3"])

    def test_fetch_content_accepts_only_the_requested_textual_mime_with_charset(self):
        cases = (
            ("html", b"<article>ok</article>", " Text/HTML ; charset=UTF-8"),
            ("markdown", b"# ok\n", "text/markdown;charset=utf-8"),
            ("text", b"ok\n", "TEXT/PLAIN; charset=us-ascii"),
        )
        for format_name, body, content_type in cases:
            with self.subTest(format=format_name), mock.patch.object(
                exporter, "open_local", return_value=(body, content_type)
            ):
                self.assertEqual(
                    exporter.fetch_content(
                        "http://127.0.0.1:3000", "https://mp.weixin.qq.com/s/article", format_name, 1
                    ),
                    body,
                )

    def test_fetch_content_rejects_binary_missing_and_mismatched_mime(self):
        cases = (
            ("html", "application/octet-stream"),
            ("html", ""),
            ("html", "text/plain; charset=utf-8"),
            ("markdown", "text/html"),
            ("text", "text/markdown"),
        )
        for format_name, content_type in cases:
            with self.subTest(format=format_name, content_type=content_type), mock.patch.object(
                exporter, "open_local", return_value=(b"not safe to write", content_type)
            ), self.assertRaises(exporter.ExporterError):
                exporter.fetch_content(
                    "http://127.0.0.1:3000", "https://mp.weixin.qq.com/s/article", format_name, 1
                )

    def test_fetch_content_preserves_application_error_envelope_parsing(self):
        body = json.dumps({"base_resp": {"ret": -1, "err_msg": "download denied"}}).encode()
        for content_type in ("application/json; charset=utf-8", "text/html"):
            with self.subTest(content_type=content_type), mock.patch.object(
                exporter, "open_local", return_value=(body, content_type)
            ), self.assertRaisesRegex(exporter.ExporterError, "download denied"):
                exporter.fetch_content(
                    "http://127.0.0.1:3000", "https://mp.weixin.qq.com/s/article", "html", 1
                )

    def test_pagination_advances_by_group_size_and_deduplicates(self):
        calls = []

        def fake_api(base, path, params, key, timeout):
            calls.append(params["begin"])
            if params["begin"] == 0:
                return {"articles": [{"aid": "1", "link": "https://mp.weixin.qq.com/s/a"}]}
            if params["begin"] == 20:
                return {
                    "articles": [
                        {"aid": "1", "link": "https://mp.weixin.qq.com/s/a"},
                        {"aid": "2", "link": "https://mp.weixin.qq.com/s/b"},
                    ]
                }
            return {"articles": []}

        with mock.patch.object(exporter, "api_json", side_effect=fake_api):
            articles, used, exhausted = exporter.article_pages(
                "http://127.0.0.1:3000", "k" * 32, "MzA==", 0, 20, 10, 1
            )
        self.assertEqual(calls, [0, 20, 40])
        self.assertEqual([item["aid"] for item in articles], ["1", "2"])
        self.assertEqual(used, 3)
        self.assertTrue(exhausted)


class ArchiveTests(unittest.TestCase):
    def archive_args(self, state: Path, output: Path) -> argparse.Namespace:
        return argparse.Namespace(
            state_dir=str(state),
            api_base="http://127.0.0.1:3000",
            timeout=1.0,
            fakeid="MzA==",
            format="markdown",
            output=str(output),
            begin=0,
            size=20,
            max_pages=3,
        )

    def test_archive_resumes_deduplicates_and_uses_atomic_content_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            output = root / "archive"
            exporter.ensure_secure_dir(state)
            exporter.ensure_secure_dir(state / "secrets")
            key_file = state / "secrets" / "auth-key"
            exporter.atomic_write_bytes(key_file, ("k" * 32 + "\n").encode())
            article = {
                "aid": "224_1",
                "title": "../../hostile\nname",
                "link": "https://mp.weixin.qq.com/s/article-one",
                "author_name": "author",
            }

            def fake_api(base, path, params, key, timeout):
                if path.endswith("accountbyurl"):
                    return {"list": [{"fakeid": "MzA==", "nickname": "Account"}]}
                return {"articles": [article]} if params["begin"] == 0 else {"articles": []}

            args = self.archive_args(state, output)
            with mock.patch.object(exporter, "api_json", side_effect=fake_api), mock.patch.object(
                exporter, "fetch_content", return_value=b"# content\n"
            ) as fetch:
                self.assertEqual(exporter.cmd_archive(args), 0)
                self.assertEqual(fetch.call_count, 1)

            stable = "MzA==:224_1"
            content = output / "content" / f"{stable}.md"
            self.assertEqual(content.read_bytes(), b"# content\n")
            self.assertFalse((root / "hostile").exists())
            records = exporter.load_ndjson(output / "articles.ndjson")
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["raw"], article)
            self.assertEqual(json.loads((output / "manifest.json").read_text())["completed"], True)
            self.assertTrue((output / "account.json").is_file())

            with mock.patch.object(exporter, "api_json", side_effect=fake_api), mock.patch.object(
                exporter, "fetch_content", side_effect=AssertionError("resume fetched existing content")
            ) as fetch:
                self.assertEqual(exporter.cmd_archive(args), 0)
                self.assertEqual(fetch.call_count, 0)
            self.assertEqual(len(exporter.load_ndjson(output / "articles.ndjson")), 1)

    def test_failed_fetch_writes_failure_not_placeholder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            output = root / "archive"
            exporter.ensure_secure_dir(state)
            exporter.ensure_secure_dir(state / "secrets")
            exporter.atomic_write_bytes(state / "secrets" / "auth-key", ("k" * 32 + "\n").encode())
            article = {"aid": "1", "title": "title", "link": "https://mp.weixin.qq.com/s/fail"}

            def fake_api(base, path, params, key, timeout):
                if path.endswith("accountbyurl"):
                    return {"list": []}
                return {"articles": [article]} if params["begin"] == 0 else {"articles": []}

            with mock.patch.object(exporter, "api_json", side_effect=fake_api), mock.patch.object(
                exporter, "fetch_content", side_effect=exporter.ExporterError("fetch failed")
            ):
                self.assertEqual(exporter.cmd_archive(self.archive_args(state, output)), 1)
            self.assertFalse(any((output / "content").iterdir()))
            failures = exporter.load_ndjson(output / "failures.ndjson")
            self.assertEqual(failures[0]["scope"], "content")

    def test_binary_download_mime_becomes_archive_failure_without_placeholder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            output = root / "archive"
            exporter.ensure_secure_dir(state)
            exporter.ensure_secure_dir(state / "secrets")
            exporter.atomic_write_bytes(state / "secrets" / "auth-key", ("k" * 32 + "\n").encode())
            article = {"aid": "1", "title": "title", "link": "https://mp.weixin.qq.com/s/binary"}

            def fake_api(base, path, params, key, timeout):
                if path.endswith("accountbyurl"):
                    return {"list": []}
                return {"articles": [article]} if params["begin"] == 0 else {"articles": []}

            with mock.patch.object(exporter, "api_json", side_effect=fake_api), mock.patch.object(
                exporter, "open_local", return_value=(b"\x00\x01binary", "application/octet-stream")
            ):
                self.assertEqual(exporter.cmd_archive(self.archive_args(state, output)), 1)
            self.assertFalse(any((output / "content").iterdir()))
            failures = exporter.load_ndjson(output / "failures.ndjson")
            self.assertEqual(len(failures), 1)
            self.assertEqual(failures[0]["scope"], "content")
            self.assertIn("unexpected Content-Type", failures[0]["error"])
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertFalse(manifest["completed"])
            self.assertEqual(manifest["failure_count"], 1)

    def test_max_pages_marks_archive_truncated_and_returns_nonzero(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            output = root / "archive"
            exporter.ensure_secure_dir(state)
            exporter.ensure_secure_dir(state / "secrets")
            exporter.atomic_write_bytes(state / "secrets" / "auth-key", ("k" * 32 + "\n").encode())
            article = {"aid": "1", "title": "title", "link": "https://mp.weixin.qq.com/s/one"}

            def fake_api(base, path, params, key, timeout):
                if path.endswith("accountbyurl"):
                    return {"list": [{"fakeid": "MzA=="}]}
                return {"articles": [article]}

            args = self.archive_args(state, output)
            args.max_pages = 1
            with mock.patch.object(exporter, "api_json", side_effect=fake_api), mock.patch.object(
                exporter, "fetch_content", return_value=b"content"
            ):
                self.assertEqual(exporter.cmd_archive(args), 1)
            manifest = json.loads((output / "manifest.json").read_text())
            self.assertFalse(manifest["completed"])
            self.assertTrue(manifest["truncated"])
            self.assertEqual(manifest["stop_reason"], "max-pages")
            self.assertEqual(manifest["failure_count"], 0)

    def test_identity_manifest_exists_before_first_metadata_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            output = root / "archive"
            exporter.ensure_secure_dir(state)
            exporter.ensure_secure_dir(state / "secrets")
            exporter.atomic_write_bytes(state / "secrets" / "auth-key", ("k" * 32 + "\n").encode())

            def failing_api(base, path, params, key, timeout):
                manifest = json.loads((output / "manifest.json").read_text())
                self.assertEqual(manifest["fakeid"], "MzA==")
                self.assertEqual(manifest["format"], "markdown")
                self.assertFalse(manifest["completed"])
                self.assertEqual(manifest["stop_reason"], "in-progress")
                raise exporter.ExporterError("interrupted")

            with mock.patch.object(exporter, "api_json", side_effect=failing_api):
                self.assertEqual(exporter.cmd_archive(self.archive_args(state, output)), 1)

    def test_manifestless_partial_rejects_cross_account_record(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            output = root / "archive"
            exporter.ensure_secure_dir(state)
            exporter.ensure_secure_dir(state / "secrets")
            exporter.ensure_secure_dir(output)
            exporter.atomic_write_bytes(state / "secrets" / "auth-key", ("k" * 32 + "\n").encode())
            exporter.atomic_write_ndjson(
                output / "articles.ndjson",
                [
                    {
                        "stable_key": "Other==:1",
                        "fakeid": "Other==",
                        "url": "https://mp.weixin.qq.com/s/other",
                        "raw": {},
                    }
                ],
            )
            with mock.patch.object(exporter, "api_json") as api:
                with self.assertRaises(exporter.ExporterError):
                    exporter.cmd_archive(self.archive_args(state, output))
                api.assert_not_called()
            self.assertFalse((output / "manifest.json").exists())

    def test_account_metadata_failure_recovers_on_second_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            output = root / "archive"
            exporter.ensure_secure_dir(state)
            exporter.ensure_secure_dir(state / "secrets")
            exporter.atomic_write_bytes(state / "secrets" / "auth-key", ("k" * 32 + "\n").encode())
            article = {"aid": "1", "title": "title", "link": "https://mp.weixin.qq.com/s/recover"}

            def first_api(base, path, params, key, timeout):
                if path.endswith("accountbyurl"):
                    raise exporter.ExporterError("account lookup unavailable")
                return {"articles": [article]} if params["begin"] == 0 else {"articles": []}

            args = self.archive_args(state, output)
            with mock.patch.object(exporter, "api_json", side_effect=first_api), mock.patch.object(
                exporter, "fetch_content", return_value=b"content"
            ):
                self.assertEqual(exporter.cmd_archive(args), 1)
            self.assertFalse((output / "account.json").exists())
            self.assertIn("account", {exporter.failure_id(item) for item in exporter.load_ndjson(output / "failures.ndjson")})

            def second_api(base, path, params, key, timeout):
                if path.endswith("accountbyurl"):
                    return {"list": [{"fakeid": "MzA==", "nickname": "Recovered"}]}
                return {"articles": [article]} if params["begin"] == 0 else {"articles": []}

            with mock.patch.object(exporter, "api_json", side_effect=second_api), mock.patch.object(
                exporter, "fetch_content", side_effect=AssertionError("existing content should be skipped")
            ) as fetch:
                self.assertEqual(exporter.cmd_archive(args), 0)
                fetch.assert_not_called()
            self.assertEqual(json.loads((output / "account.json").read_text())["raw"]["nickname"], "Recovered")
            self.assertNotIn("account", {exporter.failure_id(item) for item in exporter.load_ndjson(output / "failures.ndjson")})

    def test_atomic_write_replaces_file_and_leaves_no_temporary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "value.json"
            exporter.atomic_write_bytes(target, b"old")
            exporter.atomic_write_bytes(target, b"new")
            self.assertEqual(target.read_bytes(), b"new")
            self.assertEqual([path.name for path in target.parent.iterdir()], ["value.json"])
            self.assertEqual(exporter.mode_bits(target), 0o600)

    def test_output_rejects_symlink_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real = root / "real"
            real.mkdir()
            link = root / "link"
            link.symlink_to(real, target_is_directory=True)
            with self.assertRaises(exporter.ExporterError):
                exporter.safe_output_file(str(link))
            with self.assertRaises(exporter.ExporterError):
                exporter.safe_output_file(str(link / "article.md"))
            state = root / "state"
            exporter.ensure_secure_dir(state)
            with self.assertRaises(exporter.ExporterError):
                exporter.safe_output_directory(str(link / "archive"), state)

    def test_resume_rejects_hostile_stable_key(self):
        with tempfile.TemporaryDirectory() as directory:
            content = Path(directory) / "content"
            content.mkdir()
            with self.assertRaises(exporter.ExporterError):
                exporter.content_file(content, "../../escape", "md")

    def test_archive_output_rejects_resolved_state_alias_descendant(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real_state = root / "real-state"
            real_state.mkdir()
            alias = root / "state-alias"
            alias.symlink_to(real_state, target_is_directory=True)
            canonical = exporter.state_root_from(str(alias))
            self.assertEqual(canonical, real_state.resolve())
            with self.assertRaises(exporter.ExporterError):
                exporter.safe_output_directory(str(alias / "archive"), canonical)


class IntegrityAndDoctorTests(unittest.TestCase):
    def test_patch_asset_contract_and_corruption_detection(self):
        exporter.validate_patch_asset()
        with tempfile.TemporaryDirectory() as directory:
            broken = Path(directory) / "broken.patch"
            text = exporter.PATCH_PATH.read_text(encoding="utf-8").replace(
                "export const PUBLIC_PROXY_LIST: string[] = [];", "export const PUBLIC_PROXY_LIST: string[] = ['bad'];"
            )
            broken.write_text(text, encoding="utf-8")
            with mock.patch.object(exporter, "PATCH_PATH", broken), self.assertRaises(exporter.ExporterError):
                exporter.validate_patch_asset()

    def test_exact_patch_verification_against_fixture_checkout(self):
        source = os.environ.get("WECHAT_EXPORTER_TEST_SOURCE")
        if not source:
            self.skipTest("WECHAT_EXPORTER_TEST_SOURCE not provided")
        exporter.verify_patched_source(Path(source))

    def test_doctor_exit_code_reflects_report(self):
        with mock.patch.object(exporter, "doctor_report", return_value={"ok": False, "checks": []}), mock.patch(
            "sys.stdout", new_callable=io.StringIO
        ):
            args = argparse.Namespace(json=True)
            self.assertEqual(exporter.cmd_doctor(args), 1)
        with mock.patch.object(exporter, "doctor_report", return_value={"ok": True, "checks": []}), mock.patch(
            "sys.stdout", new_callable=io.StringIO
        ):
            self.assertEqual(exporter.cmd_doctor(args), 0)

    def test_status_json_is_valid_for_missing_state(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch("sys.stdout", new_callable=io.StringIO) as stdout, mock.patch(
            "sys.stderr", new_callable=io.StringIO
        ) as stderr:
            missing = Path(directory) / "missing"
            code = exporter.main(["--state-dir", str(missing), "status", "--json"])
            self.assertEqual(code, 1)
            value = json.loads(stdout.getvalue())
            self.assertFalse(value["ok"])
            self.assertFalse(value["setup"])
            self.assertFalse(value["running"])
            self.assertEqual(stderr.getvalue(), "")

    def test_fresh_lite_doctor_emits_not_ready_json_without_auto_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            exporter.ensure_secure_dir(state)
            self.assertEqual(list(state.iterdir()), [])
            with mock.patch.object(exporter.shutil, "which", return_value=None), mock.patch.object(
                exporter.Path, "home", return_value=root / "absent-home"
            ), mock.patch.object(exporter.lite_backend, "detect_browsers", return_value={}), mock.patch.object(
                exporter.lite_backend,
                "dependency_probe",
                return_value={"installed": False, "python": "not installed"},
            ), mock.patch("sys.stdout", new_callable=io.StringIO) as stdout, mock.patch(
                "sys.stderr", new_callable=io.StringIO
            ) as stderr:
                code = exporter.main(
                    ["--state-dir", str(state), "doctor", "--mode", "lite", "--json"]
                )
            self.assertEqual(code, 1)
            self.assertEqual(stderr.getvalue(), "")
            value = json.loads(stdout.getvalue())
            self.assertFalse(value["ok"])
            self.assertEqual(value["mode"], "lite")
            checks = {item["name"]: item for item in value["checks"]}
            self.assertFalse(checks["python3.12"]["ok"])
            self.assertFalse(checks["browser"]["ok"])
            self.assertFalse(checks["lite-dependencies"]["ok"])
            self.assertNotIn("error", value)
            self.assertEqual(list(state.iterdir()), [])

    def test_compose_contract_and_render_when_available(self):
        text = exporter.COMPOSE_PATH.read_text(encoding="utf-8")
        self.assertIn('"127.0.0.1:${WECHAT_MP_EXPORTER_PORT:', text)
        self.assertIn("no-new-privileges:true", text)
        self.assertIn("cap_drop:", text)
        self.assertNotIn("NODE_TLS_REJECT_UNAUTHORIZED", text)
        docker = shutil.which("docker")
        if not docker or subprocess.run([docker, "compose", "version"], capture_output=True).returncode != 0:
            self.skipTest("Docker Compose is unavailable")
        with tempfile.TemporaryDirectory() as directory:
            env = {
                **os.environ,
                "WECHAT_MP_EXPORTER_IMAGE": "sha256:" + "0" * 64,
                "WECHAT_MP_EXPORTER_UID": str(os.getuid()),
                "WECHAT_MP_EXPORTER_GID": str(os.getgid()),
                "WECHAT_MP_EXPORTER_PORT": "43123",
                "WECHAT_MP_EXPORTER_DATA_DIR": directory,
            }
            rendered = subprocess.run(
                [docker, "compose", "-f", str(exporter.COMPOSE_PATH), "config"],
                env=env,
                text=True,
                capture_output=True,
            )
            self.assertEqual(rendered.returncode, 0, rendered.stderr)
            self.assertIn("host_ip: 127.0.0.1", rendered.stdout)
            self.assertIn('published: "43123"', rendered.stdout)
            self.assertNotIn("NODE_TLS_REJECT_UNAUTHORIZED", rendered.stdout)


if __name__ == "__main__":
    unittest.main()
