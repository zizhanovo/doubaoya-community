#!/usr/bin/env python3
"""MP Ark: secure local-first WeChat Official Account archiving."""

from __future__ import annotations

import argparse
from contextlib import nullcontext, redirect_stdout
import datetime as dt
import getpass
import hashlib
import ipaddress
import io
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any, Iterable, Protocol
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lite_backend


UPSTREAM_URL = "https://github.com/wechat-article/wechat-article-exporter.git"
UPSTREAM_COMMIT = "6b67dfe64f6f359be604239e98f74c1021fc9d5f"
IMAGE_TAG = f"wechat-mp-exporter-local:{UPSTREAM_COMMIT}"
SKILL_DIR = Path(__file__).resolve().parent.parent
PATCH_PATH = SKILL_DIR / "assets" / "upstream-privacy.patch"
COMPOSE_PATH = SKILL_DIR / "assets" / "compose.yaml"
BACKENDS_PATH = SKILL_DIR / "assets" / "backends.json"
WORKFLOWS_PATH = SKILL_DIR / "assets" / "workflows.json"
LITE_STATUS_PATH = SKILL_DIR / "assets" / "lite-status.html"
LITE_LOCK_PATH = SKILL_DIR / "assets" / "lite-requirements.lock"
SAFE_FORMATS = ("html", "markdown", "text")
FORMAT_EXTENSIONS = {"html": "html", "markdown": "md", "text": "txt"}
EXPECTED_CONTENT_TYPES = {"html": "text/html", "markdown": "text/markdown", "text": "text/plain"}
MAX_JSON_BYTES = 20 * 1024 * 1024
MAX_CONTENT_BYTES = 100 * 1024 * 1024
AUTH_RE = re.compile(r"^[A-Za-z0-9._~-]{16,256}$")
KEY_PART_RE = re.compile(r"^[A-Za-z0-9_.=-]{1,180}$")
STABLE_KEY_RE = re.compile(r"^[A-Za-z0-9_.=:-]{1,256}$")


class ExporterError(RuntimeError):
    """Expected, user-facing failure."""


class AccountAmbiguity(ExporterError):
    def __init__(self, candidates: list[dict[str, Any]]):
        super().__init__("account selection is ambiguous")
        self.candidates = candidates


class Backend(Protocol):
    mode: str

    def search_page(self, keyword: str, begin: int, size: int) -> dict[str, Any]: ...
    def article_page(self, fakeid: str, keyword: str, begin: int, size: int) -> dict[str, Any]: ...
    def account_metadata(self, url: str, fakeid: str) -> dict[str, Any] | None: ...
    def fetch_content(self, url: str, format_name: str) -> bytes: ...
    def redact_error(self, value: str) -> str: ...


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise ExporterError(f"refused HTTP redirect to {newurl}")


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def state_root_from(value: str | None) -> Path:
    if value:
        root = Path(value).expanduser()
    else:
        data_home = os.environ.get("XDG_DATA_HOME")
        root = (Path(data_home).expanduser() if data_home else Path.home() / ".local" / "share")
        root = root / "wechat-mp-exporter"
    root = root.absolute().resolve(strict=False)
    if root == Path(root.anchor) or root == Path.home().resolve():
        raise ExporterError("state directory cannot be the filesystem root or home directory")
    return root


def reject_lite_state_alias(value: str | None) -> None:
    if value:
        candidate = Path(value).expanduser().absolute()
    else:
        data_home = os.environ.get("XDG_DATA_HOME")
        candidate = (Path(data_home).expanduser() if data_home else Path.home() / ".local" / "share")
        candidate = candidate / "wechat-mp-exporter"
    if os.path.lexists(candidate) and stat.S_ISLNK(os.lstat(candidate).st_mode):
        raise ExporterError("Lite state directory must not be a symlink")


def mode_bits(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def ensure_secure_dir(path: Path) -> None:
    if path.is_symlink():
        raise ExporterError(f"refusing symlink directory: {path}")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir():
        raise ExporterError(f"not a directory: {path}")
    os.chmod(path, 0o700)


def require_mode(path: Path, expected: int, label: str) -> None:
    if path.is_symlink():
        raise ExporterError(f"{label} must not be a symlink")
    actual = mode_bits(path)
    if actual != expected:
        raise ExporterError(f"{label} must have mode {expected:04o}, found {actual:04o}")


def atomic_write_bytes(path: Path, data: bytes, mode: int = 0o600) -> None:
    ensure_secure_dir(path.parent)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp = Path(temp_name)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        os.chmod(path, mode)
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except Exception:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def atomic_write_json(path: Path, value: Any) -> None:
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    atomic_write_bytes(path, payload)


def atomic_write_ndjson(path: Path, values: Iterable[dict[str, Any]]) -> None:
    lines = [json.dumps(value, ensure_ascii=False, sort_keys=True) for value in values]
    payload = (("\n".join(lines) + "\n") if lines else "").encode("utf-8")
    atomic_write_bytes(path, payload)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ExporterError(f"cannot read valid JSON from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ExporterError(f"expected a JSON object in {path}")
    return value


def _exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise ExporterError(f"{label} has unknown or missing keys")


def validate_browser_candidate(value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise ExporterError("browser candidate must be a non-empty string")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ExporterError("browser candidate contains a control character")
    posix = PurePosixPath(value)
    windows = PureWindowsPath(value)
    raw_parts = re.split(r"[/\\]", value)
    checked_parts = raw_parts[1:] if posix.is_absolute() and value.startswith("/") else raw_parts
    if any(part in ("", ".", "..") for part in checked_parts):
        raise ExporterError("browser candidate contains an empty, dot, or traversal component")
    if posix.is_absolute():
        if posix.as_posix() != value:
            raise ExporterError("browser candidate is not a canonical absolute path")
        return value
    if windows.is_absolute():
        if windows.as_posix() != value:
            raise ExporterError("browser candidate is not a canonical absolute path")
        return value
    if "/" in value or "\\" in value or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]*", value):
        raise ExporterError("browser candidate must be an absolute path or safe bare command name")
    return value


def load_backend_rules(path: Path = BACKENDS_PATH) -> dict[str, Any]:
    rules = load_json(path)
    _exact_keys(rules, {"schema_version", "default_mode", "auto_order", "ui", "browsers", "state_paths", "prerequisites"}, "backend rules")
    if type(rules["schema_version"]) is not int or rules["schema_version"] != 1 or rules["default_mode"] != "auto":
        raise ExporterError("unsupported backend rules schema or default")
    if rules["auto_order"] != ["lite", "docker"]:
        raise ExporterError("backend auto order must fail closed to lite then docker")
    ui = rules["ui"]
    if not isinstance(ui, dict):
        raise ExporterError("backend UI rules must be an object")
    _exact_keys(ui, {"defaults", "matrix"}, "backend UI rules")
    if ui["defaults"] != {"lite": "html", "docker": "full"} or ui["matrix"] != {
        "lite": ["html", "terminal"], "docker": ["full", "terminal"]
    }:
        raise ExporterError("backend UI matrix is unsupported")
    browser_names = ["chrome", "edge", "brave", "firefox", "safari"]
    browsers = rules["browsers"]
    if not isinstance(browsers, dict):
        raise ExporterError("browser rules must be an object")
    _exact_keys(browsers, {"priority", "support", "candidates"}, "browser rules")
    if browsers["priority"] != browser_names:
        raise ExporterError("browser priority is unsupported")
    if browsers["support"] != {
        "chrome": "tier1", "edge": "compatible", "brave": "experimental",
        "firefox": "compatible", "safari": "progress-only",
    }:
        raise ExporterError("browser support matrix is unsupported")
    candidates = browsers["candidates"]
    if not isinstance(candidates, dict) or set(candidates) != {"darwin", "linux", "windows"}:
        raise ExporterError("browser candidates are incomplete")
    for system, values in candidates.items():
        if not isinstance(values, dict) or set(values) != set(browser_names):
            raise ExporterError(f"browser candidates are invalid for {system}")
        for items in values.values():
            if not isinstance(items, list):
                raise ExporterError(f"browser candidate entries are invalid for {system}")
            for item in items:
                validate_browser_candidate(item)
    paths = rules["state_paths"]
    expected_paths = {"preferences", "docker_auth", "lite_session", "lite_root", "lite_runtime"}
    if not isinstance(paths, dict):
        raise ExporterError("state path rules must be an object")
    _exact_keys(paths, expected_paths, "state path rules")
    for label, value in paths.items():
        if not isinstance(value, str) or not value or Path(value).is_absolute() or ".." in Path(value).parts:
            raise ExporterError(f"unsafe relative state path: {label}")
        if Path(value).as_posix() != value or value.startswith("."):
            raise ExporterError(f"non-canonical relative state path: {label}")
    if paths != {
        "preferences": "preferences.json", "docker_auth": "secrets/auth-key",
        "lite_session": "secrets/lite/session.json", "lite_root": "lite", "lite_runtime": "runtime/lite.json",
    }:
        raise ExporterError("state path rules cannot alter established storage semantics")
    prerequisites = rules["prerequisites"]
    if prerequisites != {"docker": ["docker", "git"], "lite": ["python3.12", "browser"]}:
        raise ExporterError("backend prerequisite rules are unsupported")
    return rules


def load_workflow_rules(path: Path = WORKFLOWS_PATH) -> dict[str, Any]:
    rules = load_json(path)
    _exact_keys(rules, {"schema_version", "defaults", "limits", "capabilities", "login_recovery"}, "workflow rules")
    if type(rules["schema_version"]) is not int or rules["schema_version"] != 1:
        raise ExporterError("unsupported workflow rules schema")
    defaults = rules["defaults"]
    _exact_keys(defaults, {"search_limit", "latest_limit", "today_max_pages", "articles_groups", "archive_max_pages", "page_size", "account_candidates", "terminal_hold_seconds"}, "workflow defaults")
    expected_defaults = {
        "search_limit": 5, "latest_limit": 5, "today_max_pages": 25, "articles_groups": 20,
        "archive_max_pages": 500, "page_size": 20, "account_candidates": 5, "terminal_hold_seconds": 2,
    }
    if defaults != expected_defaults or any(type(value) is not int for value in defaults.values()):
        raise ExporterError("workflow defaults are unsupported")
    limits = rules["limits"]
    _exact_keys(limits, {"latest", "archive_limit", "pick", "today_max_pages"}, "workflow limits")
    if limits != {"latest": [1, 20], "archive_limit": [1, 20], "pick": [1, 5], "today_max_pages": [1, 500]}:
        raise ExporterError("workflow limits are unsupported")
    capabilities = rules["capabilities"]
    _exact_keys(capabilities, {"supported", "unsupported_metrics"}, "workflow capabilities")
    if capabilities != {
        "supported": ["account_search", "article_title", "publish_time", "article_link", "article_content", "archive"],
        "unsupported_metrics": ["read_count", "like_count", "recommend_count", "comment_count"],
    }:
        raise ExporterError("workflow capability boundary is unsupported")
    recovery = rules["login_recovery"]
    _exact_keys(recovery, {"retry_browsers", "retry_codes", "max_retries", "safe_mode_flags", "linux_shm_flag", "forbidden_flags"}, "login recovery rules")
    if recovery != {
        "retry_browsers": ["chrome", "edge", "brave"],
        "retry_codes": ["tab_crashed", "startup_failure", "devtools_disconnected", "profile_in_use"],
        "max_retries": 1,
        "safe_mode_flags": ["--disable-extensions"],
        "linux_shm_flag": "--disable-dev-shm-usage",
        "forbidden_flags": ["--no-sandbox", "--disable-gpu", "--remote-debugging-port"],
    }:
        raise ExporterError("login recovery rules are unsupported")
    return rules


def preferences_path(state: Path, rules: dict[str, Any]) -> Path:
    return state / rules["state_paths"]["preferences"]


def load_preferences(state: Path, rules: dict[str, Any]) -> dict[str, Any]:
    path = preferences_path(state, rules)
    if not path.exists():
        return {"schema_version": 1, "mode": "auto", "ui": "auto", "browser": "auto", "driver_path": None}
    require_mode(path, 0o600, "preferences file")
    value = load_json(path)
    _exact_keys(value, {"schema_version", "mode", "ui", "browser", "driver_path"}, "preferences")
    if value["schema_version"] != 1 or value["mode"] not in ("auto", "lite", "docker"):
        raise ExporterError("preferences contain an unsupported mode")
    if value["ui"] not in ("auto", "html", "terminal", "full"):
        raise ExporterError("preferences contain an unsupported UI")
    if value["browser"] not in ("auto", "chrome", "edge", "brave", "firefox", "safari"):
        raise ExporterError("preferences contain an unsupported browser")
    if value["driver_path"] is not None and not isinstance(value["driver_path"], str):
        raise ExporterError("preferences contain an invalid driver path")
    return value


def save_preferences(state: Path, rules: dict[str, Any], value: dict[str, Any]) -> None:
    ensure_secure_dir(state)
    atomic_write_json(preferences_path(state, rules), value)


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    result: list[dict[str, Any]] = []
    line_number = 0
    try:
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError("record is not an object")
            result.append(value)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ExporterError(f"invalid NDJSON in {path} at line {line_number}: {exc}") from exc
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def redact(text: str, secrets: Iterable[str]) -> str:
    result = text
    for secret in sorted({item for item in secrets if item}, key=len, reverse=True):
        result = result.replace(secret, "[REDACTED]")
        encoded = urllib.parse.quote(secret, safe="")
        if encoded != secret:
            result = result.replace(encoded, "[REDACTED]")
    return result


def run_command(
    command: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except OSError as exc:
        raise ExporterError(f"failed to run {command[0]}: {exc}") from exc
    if check and completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise ExporterError(f"{command[0]} failed ({completed.returncode}): {detail or 'no output'}")
    return completed


def validate_api_base(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ExporterError(f"invalid API base: {exc}") from exc
    if parsed.scheme != "http":
        raise ExporterError("API base must use HTTP on loopback")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ExporterError("API base must not contain credentials, query, or fragment")
    if parsed.path not in ("", "/"):
        raise ExporterError("API base must not contain a path")
    hostname = (parsed.hostname or "").lower()
    is_loopback = hostname == "localhost"
    if not is_loopback:
        try:
            is_loopback = ipaddress.ip_address(hostname).is_loopback
        except ValueError:
            is_loopback = False
    if not is_loopback:
        raise ExporterError("API base hostname must be loopback-only")
    if port is not None and not 1 <= port <= 65535:
        raise ExporterError("API base port is out of range")
    netloc = parsed.netloc.lower()
    return urllib.parse.urlunsplit(("http", netloc, "", "", "")).rstrip("/")


def validate_article_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value.strip())
        port = parsed.port
    except ValueError as exc:
        raise ExporterError(f"invalid article URL: {exc}") from exc
    if parsed.scheme != "https" or (parsed.hostname or "").lower() != "mp.weixin.qq.com":
        raise ExporterError("article URL must use https://mp.weixin.qq.com")
    if parsed.username or parsed.password or (port is not None and port != 443):
        raise ExporterError("article URL contains prohibited authority components")
    if not parsed.path.startswith("/") or parsed.path == "/":
        raise ExporterError("article URL must contain an article path")
    return urllib.parse.urlunsplit(("https", "mp.weixin.qq.com", parsed.path, parsed.query, ""))


def validate_port(port: int) -> int:
    if not 1024 <= port <= 65535:
        raise ExporterError("port must be between 1024 and 65535")
    return port


def validate_patch_asset() -> None:
    try:
        patch = PATCH_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        raise ExporterError(f"cannot read privacy patch: {exc}") from exc
    required = (
        "export const PUBLIC_PROXY_LIST: string[] = [];",
        "!['html', 'markdown', 'text'].includes(format)",
        "Server-side JSON parsing is disabled in this local build",
        "-      console.log('token', token);",
        "enabled: false",
    )
    missing = [marker for marker in required if marker not in patch]
    prohibited_additions = (
        "+      console.log('token', token);",
        "+    const data = await fetch(`${EXTERNAL_API_SERVICE}",
        "+  if (!['html', 'markdown', 'text', 'json'].includes(format))",
    )
    if missing or any(marker in patch for marker in prohibited_additions):
        raise ExporterError("privacy patch does not satisfy the fail-closed contract")


def verify_patched_source(source: Path) -> None:
    if not (source / ".git").is_dir():
        raise ExporterError("managed upstream source is not a Git checkout")
    head = run_command(["git", "rev-parse", "HEAD"], cwd=source).stdout.strip()
    if head != UPSTREAM_COMMIT:
        raise ExporterError(f"managed source commit mismatch: expected {UPSTREAM_COMMIT}, found {head}")
    staged = run_command(["git", "diff", "--cached", "--quiet"], cwd=source, check=False)
    if staged.returncode != 0:
        raise ExporterError("managed source has staged changes")
    status = run_command(["git", "status", "--porcelain", "--untracked-files=all"], cwd=source).stdout
    if any(line and not line.startswith(" M ") for line in status.splitlines()):
        raise ExporterError("managed source has untracked, staged, or unexpected status entries")
    actual = run_command(["git", "diff", "--no-ext-diff", "--binary", "HEAD", "--"], cwd=source).stdout
    expected = PATCH_PATH.read_text(encoding="utf-8")
    if actual != expected:
        raise ExporterError("managed source differs from the exact bundled privacy patch")
    reverse = run_command(["git", "apply", "--check", "--reverse", str(PATCH_PATH)], cwd=source, check=False)
    if reverse.returncode != 0:
        raise ExporterError("privacy patch application could not be verified")


def clone_and_patch(source: Path, state: Path) -> None:
    temp = Path(tempfile.mkdtemp(prefix="source.tmp-", dir=state))
    try:
        run_command(["git", "init", "--quiet"], cwd=temp)
        run_command(["git", "remote", "add", "origin", UPSTREAM_URL], cwd=temp)
        run_command(["git", "fetch", "--depth", "1", "origin", UPSTREAM_COMMIT], cwd=temp)
        run_command(["git", "checkout", "--detach", "FETCH_HEAD"], cwd=temp)
        head = run_command(["git", "rev-parse", "HEAD"], cwd=temp).stdout.strip()
        if head != UPSTREAM_COMMIT:
            raise ExporterError("fetched upstream commit does not match the pinned commit")
        run_command(["git", "apply", "--check", str(PATCH_PATH)], cwd=temp)
        run_command(["git", "apply", str(PATCH_PATH)], cwd=temp)
        verify_patched_source(temp)
        if source.exists():
            raise ExporterError("managed source appeared during setup")
        os.replace(temp, source)
    finally:
        if temp.exists():
            shutil.rmtree(temp)


def inspect_image(reference: str) -> dict[str, Any] | None:
    completed = run_command(["docker", "image", "inspect", reference], check=False)
    if completed.returncode != 0:
        return None
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ExporterError("docker returned invalid image inspection JSON") from exc
    if not isinstance(value, list) or not value or not isinstance(value[0], dict):
        raise ExporterError("docker returned an unexpected image inspection result")
    return value[0]


def verify_lock(lock: dict[str, Any], patch_sha: str) -> None:
    if lock.get("upstream_url") != UPSTREAM_URL or lock.get("upstream_commit") != UPSTREAM_COMMIT:
        raise ExporterError("runtime lock points at an unexpected upstream source")
    if lock.get("patch_sha256") != patch_sha or lock.get("image_tag") != IMAGE_TAG:
        raise ExporterError("runtime lock does not match this skill's patch/image contract")
    image_id = lock.get("image_id")
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise ExporterError("runtime lock lacks an immutable Docker image ID")


def setup_paths(state: Path) -> tuple[Path, Path, Path, Path]:
    return state / "source", state / "data", state / "secrets", state / "lock.json"


def cmd_setup(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    ensure_secure_dir(state)
    source, data, secrets, lock_path = setup_paths(state)
    ensure_secure_dir(data)
    ensure_secure_dir(data / "kv")
    ensure_secure_dir(secrets)
    validate_patch_asset()
    patch_sha = sha256_file(PATCH_PATH)
    if source.exists():
        verify_patched_source(source)
    else:
        clone_and_patch(source, state)

    existing_lock = load_json(lock_path) if lock_path.exists() else None
    if existing_lock:
        verify_lock(existing_lock, patch_sha)
    image = inspect_image(IMAGE_TAG)
    if image is not None and existing_lock:
        if image.get("Id") != existing_lock["image_id"]:
            raise ExporterError("local image tag changed since setup; refusing to trust or overwrite it")
        print(f"setup already complete for {UPSTREAM_COMMIT}")
        return 0
    if image is not None and not existing_lock:
        raise ExporterError("local image tag already exists without a matching skill lock")

    run_command(
        [
            "docker",
            "build",
            "--label",
            f"org.opencontainers.image.revision={UPSTREAM_COMMIT}",
            "--label",
            f"io.codex.wechat-mp-exporter.patch-sha256={patch_sha}",
            "--tag",
            IMAGE_TAG,
            ".",
        ],
        cwd=source,
    )
    image = inspect_image(IMAGE_TAG)
    if image is None:
        raise ExporterError("Docker build completed but the derived image is missing")
    image_id = image.get("Id")
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise ExporterError("derived image does not expose an immutable image ID")
    labels = ((image.get("Config") or {}).get("Labels") or {})
    if labels.get("org.opencontainers.image.revision") != UPSTREAM_COMMIT:
        raise ExporterError("derived image revision label mismatch")
    if labels.get("io.codex.wechat-mp-exporter.patch-sha256") != patch_sha:
        raise ExporterError("derived image patch label mismatch")
    atomic_write_json(
        lock_path,
        {
            "schema_version": 1,
            "upstream_url": UPSTREAM_URL,
            "upstream_commit": UPSTREAM_COMMIT,
            "patch_sha256": patch_sha,
            "image_tag": IMAGE_TAG,
            "image_id": image_id,
            "built_at": now_utc(),
        },
    )
    print(f"built {IMAGE_TAG} from {UPSTREAM_COMMIT}")
    return 0


def compose_environment(state: Path, port: int, image_id: str) -> dict[str, str]:
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise ExporterError("Compose requires an immutable image ID")
    _, data, _, _ = setup_paths(state)
    return {
        **os.environ,
        "WECHAT_MP_EXPORTER_IMAGE": image_id,
        "WECHAT_MP_EXPORTER_UID": str(os.getuid()),
        "WECHAT_MP_EXPORTER_GID": str(os.getgid()),
        "WECHAT_MP_EXPORTER_PORT": str(validate_port(port)),
        "WECHAT_MP_EXPORTER_DATA_DIR": str(data),
    }


def runtime_path(state: Path) -> Path:
    return state / "runtime.json"


def project_name(port: int) -> str:
    return f"wechat-mp-exporter-{port}"


def require_setup(state: Path) -> tuple[dict[str, Any], Path]:
    source, data, secrets, lock_path = setup_paths(state)
    require_mode(state, 0o700, "state directory")
    require_mode(data, 0o700, "data directory")
    require_mode(secrets, 0o700, "secrets directory")
    validate_patch_asset()
    verify_patched_source(source)
    lock = load_json(lock_path)
    verify_lock(lock, sha256_file(PATCH_PATH))
    image = inspect_image(lock["image_id"])
    if image is None or image.get("Id") != lock["image_id"]:
        raise ExporterError("locked Docker image is not available")
    return lock, source


def cmd_start(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    lock, _ = require_setup(state)
    port = validate_port(args.port)
    environment = compose_environment(state, port, lock["image_id"])
    run_command(
        ["docker", "compose", "-f", str(COMPOSE_PATH), "-p", project_name(port), "up", "-d", "--remove-orphans"],
        env=environment,
    )
    atomic_write_json(
        runtime_path(state),
        {
            "schema_version": 1,
            "port": port,
            "api_base": f"http://127.0.0.1:{port}",
            "project": project_name(port),
            "image_id": lock["image_id"],
            "updated_at": now_utc(),
        },
    )
    print(f"started at http://127.0.0.1:{port}")
    return 0


def read_runtime(state: Path) -> dict[str, Any] | None:
    path = runtime_path(state)
    return load_json(path) if path.exists() else None


def runtime_port(state: Path, fallback: int = 3000) -> int:
    runtime = read_runtime(state)
    if runtime and isinstance(runtime.get("port"), int):
        return validate_port(runtime["port"])
    return validate_port(fallback)


def cmd_stop(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    lock, _ = require_setup(state)
    runtime = read_runtime(state)
    port = validate_port(args.port if args.port is not None else runtime_port(state))
    environment = compose_environment(state, port, lock["image_id"])
    run_command(
        ["docker", "compose", "-f", str(COMPOSE_PATH), "-p", project_name(port), "down", "--remove-orphans"],
        env=environment,
    )
    print(f"stopped local exporter on port {port}")
    return 0


def service_status(state: Path) -> dict[str, Any]:
    try:
        lock, _ = require_setup(state)
        runtime = read_runtime(state)
        port = runtime_port(state)
        environment = compose_environment(state, port, lock["image_id"])
        completed = run_command(
            [
                "docker",
                "compose",
                "-f",
                str(COMPOSE_PATH),
                "-p",
                project_name(port),
                "ps",
                "--status",
                "running",
                "--quiet",
            ],
            env=environment,
            check=False,
        )
        running = completed.returncode == 0 and bool(completed.stdout.strip())
        return {
            "ok": running,
            "setup": True,
            "running": running,
            "api_base": f"http://127.0.0.1:{port}",
            "image_id": lock["image_id"],
            "runtime": runtime,
        }
    except (ExporterError, OSError) as exc:
        return {"ok": False, "setup": False, "running": False, "error": str(exc)}


def _python312_available() -> bool:
    return bool(shutil.which("python3.12") or (Path.home() / ".local/bin/python3.12").is_file())


def lite_setup_capable(rules: dict[str, Any]) -> bool:
    try:
        lite_backend.select_browser("auto", rules, automated=True)
    except lite_backend.LiteError:
        return False
    return _python312_available()


def resolve_mode(args: argparse.Namespace, state: Path, rules: dict[str, Any], *, command: str | None = None) -> str:
    requested = getattr(args, "mode", "auto") or "auto"
    docker_forced = bool(getattr(args, "api_base", None) or os.environ.get("WECHAT_MP_EXPORTER_AUTH_KEY"))
    if requested == "lite" and docker_forced:
        raise ExporterError("--api-base and WECHAT_MP_EXPORTER_AUTH_KEY are Docker-only and conflict with --mode lite")
    if requested in ("lite", "docker"):
        return requested
    if requested != "auto":
        raise ExporterError("mode must be auto, lite, or docker")
    if docker_forced:
        return "docker"
    preferences = load_preferences(state, rules)
    if preferences["mode"] in ("lite", "docker"):
        return str(preferences["mode"])
    docker_status = service_status(state)
    if docker_status.get("running"):
        return "docker"
    for candidate in rules["auto_order"]:
        if candidate == "lite":
            if command in ("setup", "doctor", "config") and lite_setup_capable(rules):
                return "lite"
            if lite_backend.lite_ready(state, rules["state_paths"], rules, require_session=command in ("search", "articles", "fetch", "archive", "latest", "today")):
                return "lite"
        elif candidate == "docker" and docker_status.get("setup"):
            return "docker"
    if lite_setup_capable(rules):
        return "lite"
    raise ExporterError("no backend is ready; install Python 3.12 plus a supported browser, or select Docker explicitly")


def resolve_ui(args: argparse.Namespace, state: Path, rules: dict[str, Any], mode: str) -> str:
    requested = getattr(args, "ui", "auto") or "auto"
    if requested == "auto":
        preferred = load_preferences(state, rules)["ui"]
        requested = preferred if preferred != "auto" else rules["ui"]["defaults"][mode]
    if requested not in rules["ui"]["matrix"][mode]:
        raise ExporterError(f"UI {requested!r} is not supported by {mode} mode")
    return str(requested)


def effective_browser(args: argparse.Namespace, state: Path, rules: dict[str, Any]) -> tuple[str, str | None]:
    preferences = load_preferences(state, rules)
    browser = getattr(args, "browser", "auto") or "auto"
    if browser == "auto" and preferences["browser"] != "auto":
        browser = preferences["browser"]
    driver = getattr(args, "driver_path", None) or preferences["driver_path"]
    try:
        driver = lite_backend.validate_driver_path(driver)
    except lite_backend.LiteError as exc:
        raise ExporterError(str(exc)) from exc
    return str(browser), driver


def maybe_reexec_lite(args: argparse.Namespace, state: Path, rules: dict[str, Any], argv: list[str]) -> None:
    if args.resolved_mode != "lite" or args.command not in ("login", "start", "open", "search", "articles", "fetch", "archive", "latest", "today", "onboard", "init"):
        return
    lite_root = state / rules["state_paths"]["lite_root"]
    vpython = lite_root / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not vpython.is_file():
        if args.command in ("onboard", "init"):
            return
        raise ExporterError("Lite runtime is not installed; run setup --mode lite")
    if Path(sys.executable).resolve() == vpython.resolve() or os.environ.get("WECHAT_MP_EXPORTER_LITE_REEXEC") == "1":
        return
    environment = {**os.environ, "WECHAT_MP_EXPORTER_LITE_REEXEC": "1"}
    os.execve(vpython, [str(vpython), str(Path(__file__).resolve()), *argv], environment)


def cmd_status(args: argparse.Namespace) -> int:
    try:
        status_value = service_status(state_root_from(args.state_dir))
    except (ExporterError, OSError, ValueError) as exc:
        status_value = {"ok": False, "setup": False, "running": False, "error": str(exc)}
    if args.json:
        print(json.dumps(status_value, ensure_ascii=False, sort_keys=True))
    elif status_value["running"]:
        print(f"running at {status_value['api_base']}")
    else:
        print(f"not running: {status_value.get('error', 'no running container')}")
    return 0 if status_value["running"] else 1


def effective_api_base(args: argparse.Namespace, state: Path) -> str:
    if args.api_base:
        return validate_api_base(args.api_base)
    runtime = read_runtime(state)
    if runtime and isinstance(runtime.get("api_base"), str):
        return validate_api_base(runtime["api_base"])
    return "http://127.0.0.1:3000"


def cmd_open(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    base = effective_api_base(args, state)
    if not webbrowser.open(base + "/", new=2):
        raise ExporterError(f"could not open the local browser; visit {base}/")
    print(f"opened {base}/; the user must complete QR login")
    return 0


def validate_auth_key(value: str) -> str:
    value = value.strip()
    if not AUTH_RE.fullmatch(value):
        raise ExporterError("auth key has an invalid shape")
    return value


def auth_path(state: Path) -> Path:
    return state / "secrets" / "auth-key"


def read_checked_secret_file(path: Path, *, require_parent_0700: bool = True) -> str:
    if not path.is_file():
        raise ExporterError("auth source is not a regular file")
    require_mode(path, 0o600, "auth file")
    if require_parent_0700:
        require_mode(path.parent, 0o700, "auth file directory")
    try:
        return validate_auth_key(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ExporterError(f"could not read auth file: {exc}") from exc


def load_auth_key(state: Path) -> str:
    from_env = os.environ.get("WECHAT_MP_EXPORTER_AUTH_KEY")
    if from_env:
        return validate_auth_key(from_env)
    return read_checked_secret_file(auth_path(state))


def read_auth_input(args: argparse.Namespace) -> str:
    if args.from_file:
        return read_checked_secret_file(Path(args.from_file).expanduser().absolute())
    from_env = os.environ.get("WECHAT_MP_EXPORTER_AUTH_KEY")
    if from_env:
        return validate_auth_key(from_env)
    if sys.stdin.isatty():
        return validate_auth_key(getpass.getpass("Auth key: "))
    return validate_auth_key(sys.stdin.read())


def response_error(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    base_resp = value.get("base_resp")
    if isinstance(base_resp, dict):
        ret = base_resp.get("ret")
        if ret not in (None, 0, "0"):
            return str(base_resp.get("err_msg") or base_resp.get("errmsg") or f"ret={ret}")
    for key in ("code", "ret"):
        if key in value and value[key] not in (None, 0, "0"):
            return str(value.get("msg") or value.get("errmsg") or value.get("err_msg") or f"{key}={value[key]}")
    if value.get("err"):
        return str(value["err"])
    return None


def api_url(base: str, path: str, params: dict[str, Any] | None = None) -> str:
    base = validate_api_base(base)
    if not path.startswith("/api/") or "?" in path or "#" in path:
        raise ExporterError("invalid API path")
    query = urllib.parse.urlencode(params or {}, doseq=True)
    return f"{base}{path}" + (f"?{query}" if query else "")


def open_local(request: urllib.request.Request, timeout: float, limit: int) -> tuple[bytes, str]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=timeout) as response:
            final = response.geturl()
            parsed_final = urllib.parse.urlsplit(final)
            validate_api_base(urllib.parse.urlunsplit((parsed_final.scheme, parsed_final.netloc, "", "", "")))
            body = response.read(limit + 1)
            if len(body) > limit:
                raise ExporterError("local API response exceeds the configured safety limit")
            return body, response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as exc:
        body = exc.read(64 * 1024).decode("utf-8", errors="replace")
        raise ExporterError(f"local API HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise ExporterError(f"local API connection failed: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ExporterError("local API request timed out") from exc


def api_json(
    base: str,
    path: str,
    params: dict[str, Any] | None,
    auth_key: str | None,
    timeout: float,
) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if auth_key:
        headers["X-Auth-Key"] = auth_key
    request = urllib.request.Request(api_url(base, path, params), headers=headers, method="GET")
    try:
        body, _ = open_local(request, timeout, MAX_JSON_BYTES)
    except ExporterError as exc:
        raise ExporterError(redact(str(exc), [auth_key or ""])) from exc
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ExporterError("local API returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise ExporterError("local API returned a non-object JSON value")
    error = response_error(value)
    if error:
        raise ExporterError(redact(f"local API error: {error}", [auth_key or ""]))
    return value


def normalize_content_type(value: str) -> str:
    media_type = value.split(";", 1)[0].strip().lower()
    if not re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", media_type):
        raise ExporterError("local API returned a missing or invalid Content-Type")
    return media_type


def fetch_content(base: str, article_url: str, format_name: str, timeout: float) -> bytes:
    if format_name not in SAFE_FORMATS:
        raise ExporterError("content format must be html, markdown, or text")
    canonical = validate_article_url(article_url)
    expected_content_type = EXPECTED_CONTENT_TYPES[format_name]
    request = urllib.request.Request(
        api_url(base, "/api/public/v1/download", {"url": canonical, "format": format_name}),
        headers={"Accept": f"{expected_content_type},application/json"},
        method="GET",
    )
    body, content_type = open_local(request, timeout, MAX_CONTENT_BYTES)
    if "json" in content_type.lower() or body.lstrip().startswith(b"{"):
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            value = None
        error = response_error(value)
        if error:
            raise ExporterError(f"local API error: {error}")
    if not body:
        raise ExporterError("local API returned empty article content")
    actual_content_type = normalize_content_type(content_type)
    if actual_content_type != expected_content_type:
        raise ExporterError(
            f"local API returned unexpected Content-Type for {format_name}: {actual_content_type}"
        )
    return body


def cmd_auth_save(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    ensure_secure_dir(state)
    ensure_secure_dir(state / "secrets")
    key = read_auth_input(args)
    base = effective_api_base(args, state)
    api_json(base, "/api/public/v1/authkey", None, key, args.timeout)
    atomic_write_bytes(auth_path(state), (key + "\n").encode("utf-8"), 0o600)
    print("auth key verified and saved")
    return 0


def cmd_auth_status(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    try:
        key = load_auth_key(state)
        base = effective_api_base(args, state)
        api_json(base, "/api/public/v1/authkey", None, key, args.timeout)
        value = {"saved": auth_path(state).exists(), "valid": True}
        code = 0
    except ExporterError as exc:
        value = {"saved": auth_path(state).exists(), "valid": False, "error": redact(str(exc), [])}
        code = 3
    if args.json:
        print(json.dumps(value, ensure_ascii=False, sort_keys=True))
    else:
        print("auth key is valid" if value["valid"] else f"auth key is not valid: {value['error']}")
    return code


def cmd_auth_clear(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    path = auth_path(state)
    if path.exists():
        if path.is_symlink() or not path.is_file():
            raise ExporterError("refusing to remove an unsafe auth path")
        path.unlink()
    print("saved auth key cleared")
    return 0


def search_pages(
    base: str,
    key: str,
    keyword: str,
    begin: int,
    size: int,
    pages: int,
    timeout: float,
    backend: Backend | None = None,
) -> tuple[list[dict[str, Any]], int]:
    accounts: list[dict[str, Any]] = []
    seen: set[str] = set()
    current = begin
    used = 0
    for _ in range(pages):
        payload = (
            backend.search_page(keyword, current, size)
            if backend
            else api_json(base, "/api/public/v1/account", {"keyword": keyword, "begin": current, "size": size}, key, timeout)
        )
        page = payload.get("list")
        if not isinstance(page, list):
            raise ExporterError("account API response lacks a list")
        used += 1
        if not page:
            break
        for account in page:
            if not isinstance(account, dict):
                continue
            identity = str(account.get("fakeid") or json.dumps(account, sort_keys=True, ensure_ascii=False))
            if identity not in seen:
                seen.add(identity)
                accounts.append(account)
        current += size
    return accounts, used


def parse_json_object(value: Any, label: str) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ExporterError(f"invalid JSON in {label}") from exc
    if not isinstance(value, dict):
        raise ExporterError(f"expected an object in {label}")
    return value


def flatten_article_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    direct = payload.get("articles")
    if isinstance(direct, list):
        return [item for item in direct if isinstance(item, dict)]
    publish_page_value = payload.get("publish_page")
    if publish_page_value is None and isinstance(payload.get("data"), dict):
        publish_page_value = payload["data"].get("publish_page")
    if publish_page_value is None:
        raise ExporterError("article API response lacks articles or publish_page")
    publish_page = parse_json_object(publish_page_value, "publish_page")
    groups = publish_page.get("publish_list")
    if not isinstance(groups, list):
        raise ExporterError("publish_page lacks publish_list")
    articles: list[dict[str, Any]] = []
    for group_index, group in enumerate(groups):
        if not isinstance(group, dict) or not group.get("publish_info"):
            continue
        info = parse_json_object(group["publish_info"], f"publish_info[{group_index}]")
        items = info.get("appmsgex")
        if not isinstance(items, list):
            raise ExporterError(f"publish_info[{group_index}] lacks appmsgex")
        articles.extend(item for item in items if isinstance(item, dict))
    return articles


def article_pages(
    base: str,
    key: str,
    fakeid: str,
    begin: int,
    size: int,
    pages: int,
    timeout: float,
    keyword: str = "",
    backend: Backend | None = None,
) -> tuple[list[dict[str, Any]], int, bool]:
    all_articles: list[dict[str, Any]] = []
    seen: set[str] = set()
    current = begin
    used = 0
    exhausted = False
    for _ in range(pages):
        payload = (
            backend.article_page(fakeid, keyword, current, size)
            if backend
            else api_json(base, "/api/public/v1/article", {"fakeid": fakeid, "begin": current, "size": size, "keyword": keyword}, key, timeout)
        )
        page = flatten_article_payload(payload)
        used += 1
        if not page:
            exhausted = True
            break
        for article in page:
            identity = stable_key(article, fakeid)
            if identity not in seen:
                seen.add(identity)
                all_articles.append(article)
        current += size
    return all_articles, used, exhausted


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def nonnegative_int(value: str) -> int:
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError("must be non-negative")
    return number


def requested_pages(args: argparse.Namespace) -> int:
    return args.max_pages if args.all else args.pages


def _first_text(value: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        item = value.get(key)
        if item is not None and str(item).strip():
            return str(item).strip()
    return ""


def account_summary(account: dict[str, Any], *, include_id: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": _first_text(account, ("nickname", "name")),
        "wechat_id": _first_text(account, ("alias", "username", "wechat_id")),
        "verified": _first_text(account, ("verify_status", "verify_info", "service_type")),
        "description": _first_text(account, ("signature", "introduction", "description", "desc")),
    }
    if include_id:
        result["fakeid"] = str(account.get("fakeid") or "")
    return result


def exact_match_kind(account: dict[str, Any], query: str) -> str | None:
    needle = query.strip().casefold()
    summary = account_summary(account)
    if summary["name"].casefold() == needle:
        return "name"
    if summary["wechat_id"].casefold() == needle:
        return "wechat_id"
    return None


def resolve_account(
    backend: Backend,
    query: str,
    *,
    account_id: str | None,
    pick: int | None,
    candidate_limit: int,
    timeout: float,
) -> dict[str, Any]:
    if account_id:
        return {"fakeid": account_id, "nickname": query}
    accounts, _ = search_pages("", "", query, 0, candidate_limit, 1, timeout, backend)
    candidates = accounts[:candidate_limit]
    if pick is not None:
        if pick < 1 or pick > len(candidates):
            raise AccountAmbiguity(candidates)
        return candidates[pick - 1]
    exact_names = [item for item in candidates if exact_match_kind(item, query) == "name"]
    if len(exact_names) == 1:
        return exact_names[0]
    exact_ids = [item for item in candidates if exact_match_kind(item, query) == "wechat_id"]
    if len(exact_ids) == 1:
        return exact_ids[0]
    if len(candidates) == 1:
        return candidates[0]
    raise AccountAmbiguity(candidates)


def timezone_from(value: str) -> dt.tzinfo:
    if value == "local":
        return dt.datetime.now().astimezone().tzinfo or dt.timezone.utc
    try:
        return ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ExporterError(f"unknown timezone: {value}") from exc


def local_day_window(zone: dt.tzinfo, now: dt.datetime | None = None) -> tuple[str, float, float]:
    current = now.astimezone(zone) if now is not None else dt.datetime.now(zone)
    start = current.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + dt.timedelta(days=1)
    return current.date().isoformat(), start.timestamp(), end.timestamp()


def article_timestamp(article: dict[str, Any]) -> float | None:
    value = article.get("create_time")
    if value in (None, ""):
        value = article.get("update_time")
    if value in (None, ""):
        value = article.get("publish_time")
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if number > 10_000_000_000:
        number /= 1000.0
    return number if number >= 0 else None


def compact_article(article: dict[str, Any], zone: dt.tzinfo) -> dict[str, Any]:
    timestamp = article_timestamp(article)
    published = dt.datetime.fromtimestamp(timestamp, zone).isoformat() if timestamp is not None else "unknown"
    return {
        "title": str(article.get("title") or "(untitled)"),
        "published_at": published,
        "url": validate_article_url(str(article.get("link") or article.get("url") or "")),
    }


def capability_note(workflows: dict[str, Any]) -> str:
    unsupported = ", ".join(workflows["capabilities"]["unsupported_metrics"])
    return f"Supports search, title/time/link, content and archives. Unsupported metrics: {unsupported}."


def print_account_candidates(candidates: list[dict[str, Any]]) -> None:
    print("Multiple accounts matched. Re-run with --pick N:", file=sys.stderr)
    for index, account in enumerate(candidates[:5], 1):
        summary = account_summary(account)
        print(f"  {index}. {summary['name'] or '(unnamed)'} | {summary['wechat_id'] or '-'} | {summary['description'] or '-'}", file=sys.stderr)


def cmd_search(args: argparse.Namespace) -> int:
    if args.all and not args.json:
        print("error: human search --all is disabled; add --json or narrow the query", file=sys.stderr)
        return 2
    state = state_root_from(args.state_dir)
    backend = backend_from_args(args, state)
    accounts, used = search_pages(
        "", "", args.keyword, args.begin, args.size, requested_pages(args), args.timeout, backend
    )
    envelope = {"begin": args.begin, "size": args.size, "pages": used, "accounts": accounts}
    if args.json:
        print(json.dumps(envelope, ensure_ascii=False))
        return 0
    exacts = [item for item in accounts if exact_match_kind(item, args.keyword)]
    unique_exact = exacts[0] if len(exacts) == 1 else None
    for index, account in enumerate(accounts[: args.workflow_rules["defaults"]["search_limit"]], 1):
        summary = account_summary(account)
        marker = " [exact]" if account is unique_exact else ""
        print(f"{index}. {summary['name'] or '(unnamed)'}{marker}")
        print(f"   WeChat ID: {summary['wechat_id'] or '-'} | Verified: {summary['verified'] or '-'}")
        print(f"   {summary['description'] or '-'}")
    print(capability_note(args.workflow_rules))
    return 0


def cmd_articles(args: argparse.Namespace) -> int:
    if args.all:
        print("error: articles --all is disabled; use archive for historical aggregation", file=sys.stderr)
        return 2
    state = state_root_from(args.state_dir)
    backend = backend_from_args(args, state)
    articles, used, exhausted = article_pages(
        "",
        "",
        args.fakeid,
        args.begin,
        args.size,
        requested_pages(args),
        args.timeout,
        args.keyword,
        backend,
    )
    envelope = {"fakeid": args.fakeid, "begin": args.begin, "size": args.size, "pages": used, "exhausted": exhausted, "articles": articles}
    if args.json:
        print(json.dumps(envelope, ensure_ascii=False))
        return 0
    zone = timezone_from("local")
    for index, article in enumerate(articles, 1):
        view = compact_article(article, zone)
        print(f"{index}. {view['title']}\n   {view['published_at']}\n   {view['url']}")
    print(capability_note(args.workflow_rules))
    return 0


def _resolved_account_or_output(args: argparse.Namespace, backend: Backend) -> tuple[dict[str, Any] | None, int]:
    try:
        account = resolve_account(
            backend,
            args.account,
            account_id=args.account_id,
            pick=args.pick,
            candidate_limit=args.workflow_rules["defaults"]["account_candidates"],
            timeout=args.timeout,
        )
        return account, 0
    except AccountAmbiguity as exc:
        candidates = [account_summary(item, include_id=True) for item in exc.candidates[:5]]
        if args.json:
            print(json.dumps({"ok": False, "code": "account_ambiguous", "candidates": candidates, "unsupported_metrics": args.workflow_rules["capabilities"]["unsupported_metrics"]}, ensure_ascii=False))
        else:
            print_account_candidates(exc.candidates)
        return None, 4


def cmd_latest(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    backend = backend_from_args(args, state)
    account, code = _resolved_account_or_output(args, backend)
    if account is None:
        return code
    fakeid = str(account.get("fakeid") or "")
    payload = backend.article_page(fakeid, "", 0, args.workflow_rules["defaults"]["page_size"])
    articles = flatten_article_payload(payload)[: args.limit]
    zone = timezone_from("local")
    compact = [compact_article(item, zone) for item in articles]
    if args.json:
        print(json.dumps({"account": account_summary(account, include_id=True), "articles": compact, "unsupported_metrics": args.workflow_rules["capabilities"]["unsupported_metrics"]}, ensure_ascii=False))
    else:
        print(f"Latest from {account_summary(account)['name'] or args.account}:")
        for index, item in enumerate(compact, 1):
            print(f"{index}. {item['title']}\n   {item['published_at']}\n   {item['url']}")
        print(capability_note(args.workflow_rules))
    return 0


def cmd_today(args: argparse.Namespace) -> int:
    zone = timezone_from(args.timezone)
    state = state_root_from(args.state_dir)
    backend = backend_from_args(args, state)
    account, code = _resolved_account_or_output(args, backend)
    if account is None:
        return code
    fakeid = str(account.get("fakeid") or "")
    date_value, start, end = local_day_window(zone)
    current = 0
    pages = 0
    exhausted = False
    boundary = False
    seen: set[str] = set()
    selected: list[dict[str, Any]] = []
    size = args.workflow_rules["defaults"]["page_size"]
    for _ in range(args.max_pages):
        page = flatten_article_payload(backend.article_page(fakeid, "", current, size))
        pages += 1
        if not page:
            exhausted = True
            break
        for article in page:
            timestamp = article_timestamp(article)
            if timestamp is None:
                continue
            if timestamp < start:
                boundary = True
                break
            if start <= timestamp < end:
                identity = stable_key(article, fakeid)
                if identity not in seen:
                    seen.add(identity)
                    selected.append(article)
        if boundary:
            break
        current += size
    truncated = not exhausted and not boundary and pages >= args.max_pages
    compact = [compact_article(item, zone) for item in selected]
    result = {"account": account_summary(account, include_id=True), "date": date_value, "timezone": args.timezone, "pages": pages, "truncated": truncated, "articles": compact, "unsupported_metrics": args.workflow_rules["capabilities"]["unsupported_metrics"]}
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f"Today from {account_summary(account)['name'] or args.account} ({result['date']} {args.timezone}):")
        for index, item in enumerate(compact, 1):
            print(f"{index}. {item['title']}\n   {item['published_at']}\n   {item['url']}")
        if truncated:
            print("Result truncated at --max-pages; increase the limit and retry.", file=sys.stderr)
        print(capability_note(args.workflow_rules))
    return 1 if truncated else 0


def path_has_symlink(path: Path) -> bool:
    candidate = path.absolute()
    while True:
        if candidate.is_symlink():
            return True
        if candidate == candidate.parent:
            return False
        candidate = candidate.parent


def path_has_untrusted_symlink(path: Path) -> bool:
    candidate = path.absolute()
    while True:
        if candidate.is_symlink():
            try:
                link_stat = os.lstat(candidate)
                parent_stat = candidate.parent.stat()
            except OSError:
                return True
            system_alias = os.name != "nt" and link_stat.st_uid == 0 and not (stat.S_IMODE(parent_stat.st_mode) & 0o022)
            if not system_alias:
                return True
        if candidate == candidate.parent:
            return False
        candidate = candidate.parent


def safe_output_file(value: str) -> Path:
    requested = Path(value).expanduser().absolute()
    if requested.name in ("", ".", "..") or path_has_untrusted_symlink(requested):
        raise ExporterError("unsafe output file path")
    path = requested.resolve(strict=False)
    if path.exists() and not path.is_file():
        raise ExporterError("output path is not a regular file")
    return path


def safe_output_directory(value: str, state: Path) -> Path:
    requested = Path(value).expanduser().absolute()
    if path_has_untrusted_symlink(requested):
        raise ExporterError("unsafe archive output directory")
    path = requested.resolve(strict=False)
    if path == Path(path.anchor) or path == Path.home().resolve():
        raise ExporterError("unsafe archive output directory")
    canonical_state = state.resolve(strict=False)
    if path == canonical_state or canonical_state in path.parents:
        raise ExporterError("archive output cannot be the managed state directory or any of its descendants")
    if path.exists() and not path.is_dir():
        raise ExporterError("archive output is not a directory")
    ensure_secure_dir(path)
    return path


def cmd_fetch(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    backend = backend_from_args(args, state)
    content = backend.fetch_content(args.url, args.format)
    if args.output:
        output = safe_output_file(args.output)
        atomic_write_bytes(output, content)
        print(str(output))
    else:
        sys.stdout.buffer.write(content)
    return 0


def stable_key(article: dict[str, Any], fakeid: str) -> str:
    aid = article.get("aid")
    if isinstance(aid, (str, int)):
        aid_text = str(aid)
        if KEY_PART_RE.fullmatch(fakeid) and KEY_PART_RE.fullmatch(aid_text) and len(fakeid) + len(aid_text) <= 220:
            return f"{fakeid}:{aid_text}"
    url = article.get("link") or article.get("url")
    canonical = validate_article_url(str(url))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_stable_key(value: Any) -> str:
    if not isinstance(value, str) or value in (".", "..") or not STABLE_KEY_RE.fullmatch(value):
        raise ExporterError("article record contains an unsafe stable_key")
    return value


def content_file(content_dir: Path, stable: Any, extension: str) -> Path:
    stable_text = validate_stable_key(stable)
    if extension not in FORMAT_EXTENSIONS.values():
        raise ExporterError("unsafe content extension")
    return content_dir / f"{stable_text}.{extension}"


def require_regular_archive_file(path: Path, label: str) -> None:
    if path.is_symlink():
        raise ExporterError(f"{label} must not be a symlink")
    if path.exists() and not path.is_file():
        raise ExporterError(f"{label} must be a regular file")


def validate_content_entries(content_dir: Path) -> None:
    for entry in content_dir.iterdir():
        if entry.is_symlink() or not entry.is_file():
            raise ExporterError(f"archive content entry must be a regular non-symlink file: {entry.name}")


def validated_content_count(
    content_dir: Path,
    article_records: dict[str, dict[str, Any]],
    extension: str,
) -> int:
    validate_content_entries(content_dir)
    count = 0
    for stable in article_records:
        path = content_file(content_dir, stable, extension)
        require_regular_archive_file(path, "article content")
        if path.exists() and path.stat().st_size > 0:
            count += 1
    return count


def normalize_article(article: dict[str, Any], fakeid: str) -> dict[str, Any]:
    url = validate_article_url(str(article.get("link") or article.get("url") or ""))
    return {
        "stable_key": stable_key(article, fakeid),
        "fakeid": fakeid,
        "aid": article.get("aid"),
        "title": article.get("title"),
        "url": url,
        "author_name": article.get("author_name"),
        "digest": article.get("digest"),
        "create_time": article.get("create_time"),
        "update_time": article.get("update_time"),
        "raw": article,
    }


def account_from_article(base: str, key: str, url: str, timeout: float, fakeid: str) -> dict[str, Any] | None:
    payload = api_json(base, "/api/public/v1/accountbyurl", {"url": url}, key, timeout)
    accounts = payload.get("list")
    if not isinstance(accounts, list):
        return None
    selected = next(
        (item for item in accounts if isinstance(item, dict) and str(item.get("fakeid")) == fakeid),
        None,
    )
    return {"fakeid": fakeid, "raw": selected} if selected else None


class DockerBackend:
    mode = "docker"

    def __init__(self, state: Path, args: argparse.Namespace):
        self.state = state
        self.base = effective_api_base(args, state)
        self.key = load_auth_key(state)
        self.timeout = args.timeout

    def search_page(self, keyword: str, begin: int, size: int) -> dict[str, Any]:
        return api_json(self.base, "/api/public/v1/account", {"keyword": keyword, "begin": begin, "size": size}, self.key, self.timeout)

    def article_page(self, fakeid: str, keyword: str, begin: int, size: int) -> dict[str, Any]:
        return api_json(
            self.base, "/api/public/v1/article",
            {"fakeid": fakeid, "begin": begin, "size": size, "keyword": keyword},
            self.key, self.timeout,
        )

    def account_metadata(self, url: str, fakeid: str) -> dict[str, Any] | None:
        return account_from_article(self.base, self.key, url, self.timeout, fakeid)

    def fetch_content(self, url: str, format_name: str) -> bytes:
        return fetch_content(self.base, url, format_name, self.timeout)

    def redact_error(self, value: str) -> str:
        return redact(value, [self.key])


class LiteBackendAdapter:
    mode = "lite"

    def __init__(self, delegate: lite_backend.LiteBackend):
        self.delegate = delegate

    def _call(self, method: str, *args: Any) -> Any:
        try:
            return getattr(self.delegate, method)(*args)
        except lite_backend.LiteError as exc:
            raise ExporterError(self.delegate.redact_error(str(exc))) from exc
        except Exception as exc:
            raise ExporterError(f"Lite backend {method} failed without exposing operation details") from exc

    def search_page(self, keyword: str, begin: int, size: int) -> dict[str, Any]:
        return self._call("search_page", keyword, begin, size)

    def article_page(self, fakeid: str, keyword: str, begin: int, size: int) -> dict[str, Any]:
        return self._call("article_page", fakeid, keyword, begin, size)

    def account_metadata(self, url: str, fakeid: str) -> dict[str, Any] | None:
        return self._call("account_metadata", url, fakeid)

    def fetch_content(self, url: str, format_name: str) -> bytes:
        return self._call("fetch_content", url, format_name)

    def redact_error(self, value: str) -> str:
        return self.delegate.redact_error(value)


def backend_from_args(args: argparse.Namespace, state: Path) -> Backend:
    mode = getattr(args, "resolved_mode", "docker")
    if mode == "docker":
        return DockerBackend(state, args)
    if mode != "lite":
        raise ExporterError("backend mode was not resolved")
    rules = getattr(args, "backend_rules", None) or load_backend_rules()
    browser, driver = effective_browser(args, state, rules)
    try:
        return LiteBackendAdapter(
            lite_backend.LiteBackend(state, rules["state_paths"], args.timeout, rules, browser, driver)
        )
    except lite_backend.LiteError as exc:
        raise ExporterError(str(exc)) from exc


def failure_id(record: dict[str, Any]) -> str:
    return str(record.get("stable_key") or record.get("failure_key") or hashlib.sha256(json.dumps(record, sort_keys=True).encode()).hexdigest())


def archive_manifest(
    *,
    fakeid: str,
    format_name: str,
    begin: int,
    size: int,
    max_pages: int,
    article_count: int,
    content_count: int,
    failure_count: int,
    completed: bool,
    truncated: bool,
    stop_reason: str,
    started_at: str,
    selection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    value = {
        "schema_version": 1,
        "upstream_commit": UPSTREAM_COMMIT,
        "fakeid": fakeid,
        "format": format_name,
        "begin": begin,
        "page_size": size,
        "max_pages": max_pages,
        "article_count": article_count,
        "content_count": content_count,
        "failure_count": failure_count,
        "completed": completed,
        "truncated": truncated,
        "stop_reason": stop_reason,
        "started_at": started_at,
        "updated_at": now_utc(),
    }
    if selection is not None:
        value["selection"] = selection
    return value


def record_matches_selection(record: dict[str, Any], selection: dict[str, Any] | None) -> bool:
    if selection is None or selection["type"] == "limit":
        return True
    timestamp = article_timestamp(record.get("raw") if isinstance(record.get("raw"), dict) else record)
    return timestamp is not None and selection["start"] <= timestamp < selection["end"]


def cmd_archive(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    backend = getattr(args, "_backend", None) or backend_from_args(args, state)
    selection = getattr(args, "selection", None)
    output = safe_output_directory(args.output, state)
    content_dir = output / "content"
    ensure_secure_dir(content_dir)
    manifest_path = output / "manifest.json"
    account_path = output / "account.json"
    articles_path = output / "articles.ndjson"
    failures_path = output / "failures.ndjson"
    for path, label in (
        (manifest_path, "archive manifest"),
        (account_path, "account metadata"),
        (articles_path, "article index"),
        (failures_path, "failure index"),
    ):
        require_regular_archive_file(path, label)
    validate_content_entries(content_dir)
    existing_manifest = load_json(manifest_path) if manifest_path.exists() else None
    if existing_manifest and (
        existing_manifest.get("fakeid") != args.fakeid
        or existing_manifest.get("format") != args.format
        or existing_manifest.get("selection") != selection
    ):
        raise ExporterError("existing archive manifest has a different fakeid, format, or selection")
    started_at = str(existing_manifest.get("started_at")) if existing_manifest else now_utc()

    article_records: dict[str, dict[str, Any]] = {}
    for record in load_ndjson(articles_path):
        stable = validate_stable_key(record.get("stable_key"))
        if record.get("fakeid") != args.fakeid:
            raise ExporterError("existing archive contains an article record for a different fakeid")
        if not record_matches_selection(record, selection):
            raise ExporterError("existing archive contains an article outside the selected window")
        article_records[stable] = record
    if selection and selection["type"] == "limit" and len(article_records) > selection["limit"]:
        raise ExporterError("existing archive exceeds the selected article limit")
    failure_records = {failure_id(record): record for record in load_ndjson(failures_path)}
    if account_path.exists():
        existing_account = load_json(account_path)
        if existing_account.get("fakeid") != args.fakeid:
            raise ExporterError("existing account metadata belongs to a different fakeid")
        raw_account = existing_account.get("raw")
        if isinstance(raw_account, dict) and raw_account.get("fakeid") not in (None, args.fakeid):
            raise ExporterError("existing raw account metadata belongs to a different fakeid")
    has_content = any(content_dir.iterdir())
    if not existing_manifest and not article_records and not account_path.exists() and (failure_records or has_content):
        raise ExporterError("manifestless partial archive has no verifiable account identity")

    discovered: set[str] = set()
    discovery_order: list[str] = []
    account_written = account_path.exists()
    account_lookup_attempted = False
    current = args.begin
    exhausted = False
    pagination_failed = False
    pages_fetched = 0
    selection_complete = False
    selection_seen = 0
    extension = FORMAT_EXTENSIONS[args.format]

    initial_content_count = validated_content_count(content_dir, article_records, extension)
    atomic_write_json(
        manifest_path,
        archive_manifest(
            fakeid=args.fakeid,
            format_name=args.format,
            begin=args.begin,
            size=args.size,
            max_pages=args.max_pages,
            article_count=len(article_records),
            content_count=initial_content_count,
            failure_count=len(failure_records),
            completed=False,
            truncated=False,
            stop_reason="in-progress",
            started_at=started_at,
            selection=selection,
        ),
    )

    def try_account_lookup(url: str) -> None:
        nonlocal account_written, account_lookup_attempted
        if account_written or account_lookup_attempted:
            return
        account_lookup_attempted = True
        try:
            account = backend.account_metadata(url, args.fakeid)
            if account:
                atomic_write_json(account_path, account)
                account_written = True
                failure_records.pop("account", None)
        except ExporterError as exc:
            failure_records["account"] = {
                "failure_key": "account",
                "scope": "account-metadata",
                "error": backend.redact_error(str(exc)),
                "attempted_at": now_utc(),
            }

    if not account_written and article_records:
        first_existing = next(iter(article_records.values()))
        try_account_lookup(validate_article_url(str(first_existing.get("url") or "")))

    for _ in range(args.max_pages):
        try:
            payload = backend.article_page(args.fakeid, "", current, args.size)
            page = flatten_article_payload(payload)
            pages_fetched += 1
        except ExporterError as exc:
            pagination_failed = True
            record = {
                "failure_key": f"page:{current}",
                "scope": "metadata-page",
                "begin": current,
                "error": backend.redact_error(str(exc)),
                "attempted_at": now_utc(),
            }
            failure_records[record["failure_key"]] = record
            break
        if not page:
            exhausted = True
            failure_records.pop(f"page:{current}", None)
            break

        for raw in page:
            try:
                record = normalize_article(raw, args.fakeid)
            except ExporterError as exc:
                raw_hash = hashlib.sha256(json.dumps(raw, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
                failure = {
                    "failure_key": f"metadata:{raw_hash}",
                    "scope": "article-metadata",
                    "error": backend.redact_error(str(exc)),
                    "raw": raw,
                    "attempted_at": now_utc(),
                }
                failure_records[failure["failure_key"]] = failure
                continue
            if selection and selection["type"] == "today":
                timestamp = article_timestamp(raw)
                if timestamp is not None and timestamp < selection["start"]:
                    selection_complete = True
                    break
                if timestamp is None or not selection["start"] <= timestamp < selection["end"]:
                    continue
            stable = record["stable_key"]
            if stable in discovered:
                continue
            if selection and selection["type"] == "limit":
                if selection_seen >= selection["limit"]:
                    selection_complete = True
                    break
                selection_seen += 1
            discovered.add(stable)
            discovery_order.append(stable)
            article_records[stable] = record
            try_account_lookup(record["url"])
            content_path = content_file(content_dir, stable, extension)
            if path_has_symlink(content_path):
                raise ExporterError("unsafe content path encountered")
            require_regular_archive_file(content_path, "article content")
            if content_path.is_file() and content_path.stat().st_size > 0:
                failure_records.pop(stable, None)
                continue
            try:
                content = backend.fetch_content(record["url"], args.format)
                atomic_write_bytes(content_path, content)
                failure_records.pop(stable, None)
            except ExporterError as exc:
                failure_records[stable] = {
                    "stable_key": stable,
                    "scope": "content",
                    "url": record["url"],
                    "error": backend.redact_error(str(exc)),
                    "attempted_at": now_utc(),
                }
            atomic_write_ndjson(articles_path, article_records.values())
            atomic_write_ndjson(failures_path, failure_records.values())
        if selection and selection["type"] == "limit" and selection_seen >= selection["limit"]:
            selection_complete = True
        failure_records.pop(f"page:{current}", None)
        if selection_complete:
            break
        current += args.size
        progress = getattr(args, "_progress", None)
        if progress:
            progress.update(
                "archive",
                f"已读取 {pages_fetched} 页，发现 {len(article_records)} 篇文章。",
                pages_fetched,
                args.max_pages,
            )

    atomic_write_ndjson(articles_path, article_records.values())
    atomic_write_ndjson(failures_path, failure_records.values())
    if selection and selection["type"] == "limit" and not pagination_failed and (selection_complete or exhausted):
        stale = set(article_records) - discovered
        for stable in stale:
            stale_path = content_file(content_dir, stable, extension)
            require_regular_archive_file(stale_path, "article content")
            if stale_path.exists():
                stale_path.unlink()
            article_records.pop(stable, None)
            failure_records.pop(stable, None)
        article_records = {stable: article_records[stable] for stable in discovery_order}
        atomic_write_ndjson(articles_path, article_records.values())
        atomic_write_ndjson(failures_path, failure_records.values())
    for path, label in (
        (manifest_path, "archive manifest"),
        (account_path, "account metadata"),
        (articles_path, "article index"),
        (failures_path, "failure index"),
    ):
        require_regular_archive_file(path, label)
    content_count = validated_content_count(content_dir, article_records, extension)
    truncated = not exhausted and not selection_complete and not pagination_failed and pages_fetched >= args.max_pages
    completed = (exhausted or selection_complete) and not failure_records
    if completed and selection and selection["type"] == "limit":
        stop_reason = "selection-limit"
    elif completed and selection and selection["type"] == "today":
        stop_reason = "selection-day-boundary" if selection_complete else "terminal-empty-page"
    elif completed:
        stop_reason = "terminal-empty-page"
    elif truncated:
        stop_reason = "max-pages"
    elif pagination_failed:
        stop_reason = "metadata-page-failure"
    else:
        stop_reason = "record-failure"
    manifest = archive_manifest(
        fakeid=args.fakeid,
        format_name=args.format,
        begin=args.begin,
        size=args.size,
        max_pages=args.max_pages,
        article_count=len(article_records),
        content_count=content_count,
        failure_count=len(failure_records),
        completed=completed,
        truncated=truncated,
        stop_reason=stop_reason,
        started_at=started_at,
        selection=selection,
    )
    atomic_write_json(manifest_path, manifest)
    print(json.dumps({"output": str(output), **manifest}, ensure_ascii=False))
    return 0 if completed else 1


def add_check(checks: list[dict[str, Any]], name: str, ok: bool, detail: str) -> None:
    checks.append({"name": name, "ok": ok, "detail": detail})


def doctor_report(args: argparse.Namespace) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    state = state_root_from(args.state_dir)
    try:
        validate_api_base(args.api_base or "http://127.0.0.1:3000")
        add_check(checks, "api-base", True, "loopback-only")
    except ExporterError as exc:
        add_check(checks, "api-base", False, str(exc))
    for executable in ("git", "docker"):
        location = shutil.which(executable)
        add_check(checks, executable, bool(location), location or "not found")
    compose = run_command(["docker", "compose", "version"], check=False) if shutil.which("docker") else None
    add_check(
        checks,
        "docker-compose",
        bool(compose and compose.returncode == 0),
        (compose.stdout or compose.stderr).strip() if compose else "docker not found",
    )
    try:
        validate_patch_asset()
        compose_text = COMPOSE_PATH.read_text(encoding="utf-8")
        if "127.0.0.1:" not in compose_text or "NODE_TLS_REJECT_UNAUTHORIZED" in compose_text:
            raise ExporterError("Compose binding/TLS contract failed")
        for marker in ("no-new-privileges:true", "cap_drop:", 'NUXT_PUBLIC_MEMBERSHIP_ENABLED: "false"'):
            if marker not in compose_text:
                raise ExporterError(f"Compose is missing {marker}")
        add_check(checks, "bundled-assets", True, f"patch sha256={sha256_file(PATCH_PATH)}")
    except (ExporterError, OSError) as exc:
        add_check(checks, "bundled-assets", False, str(exc))
    if state.exists():
        secure = state.is_dir() and not state.is_symlink() and mode_bits(state) == 0o700
        add_check(checks, "state-directory", secure, f"{state} mode={mode_bits(state):04o}" if state.is_dir() else str(state))
    else:
        add_check(checks, "state-directory", False, f"not initialized: {state}")
    source, _, _, lock_path = setup_paths(state)
    try:
        verify_patched_source(source)
        add_check(checks, "pinned-source", True, UPSTREAM_COMMIT)
    except ExporterError as exc:
        add_check(checks, "pinned-source", False, str(exc))
    try:
        lock = load_json(lock_path)
        verify_lock(lock, sha256_file(PATCH_PATH))
        image = inspect_image(lock["image_id"])
        if image is None or image.get("Id") != lock["image_id"]:
            raise ExporterError("locked image is unavailable")
        add_check(checks, "derived-image", True, lock["image_id"])
    except ExporterError as exc:
        add_check(checks, "derived-image", False, str(exc))
    return {"ok": all(item["ok"] for item in checks), "checks": checks}


def cmd_doctor(args: argparse.Namespace) -> int:
    report = doctor_report(args)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        for check in report["checks"]:
            print(f"{'ok' if check['ok'] else 'fail'} {check['name']}: {check['detail']}")
    return 0 if report["ok"] else 1


def lite_doctor_report(args: argparse.Namespace) -> dict[str, Any]:
    rules = args.backend_rules
    state = state_root_from(args.state_dir)
    checks: list[dict[str, Any]] = []
    try:
        load_backend_rules()
        add_check(checks, "backend-rules", True, "schema version 1")
    except ExporterError as exc:
        add_check(checks, "backend-rules", False, str(exc))
    python = shutil.which("python3.12") or str(Path.home() / ".local/bin/python3.12")
    add_check(checks, "python3.12", Path(python).is_file(), python if Path(python).is_file() else "not found")
    detected = lite_backend.detect_browsers(rules)
    for value in detected.values():
        value["version"] = lite_backend.executable_version(value["path"]) if value.get("path") else None
    supported = [name for name, value in detected.items() if value["available"] and value["support"] != "progress-only"]
    add_check(checks, "browser", bool(supported), ", ".join(supported) if supported else "no automation-capable browser found")
    requested, driver = effective_browser(args, state, rules)
    selected: str | None = None
    browser_version: str | None = None
    try:
        selected, binary = lite_backend.select_browser(requested, rules, automated=True)
        browser_version = lite_backend.executable_version(binary)
        add_check(checks, "selected-browser", True, f"{selected}: {browser_version or 'version unavailable'}")
    except lite_backend.LiteError as exc:
        add_check(checks, "selected-browser", False, str(exc))
    probe = lite_backend.dependency_probe(state, rules["state_paths"])
    add_check(checks, "lite-dependencies", bool(probe["installed"]), probe["python"])
    selenium_version = str(probe.get("selenium_version") or "")
    add_check(checks, "selenium", bool(selenium_version), selenium_version or "not installed")
    manager_path = probe.get("selenium_manager_path")
    manager_version = lite_backend.executable_version(str(manager_path)) if manager_path else None
    add_check(checks, "selenium-manager", bool(manager_version), manager_version or "not locally available")
    if driver:
        driver_version = lite_backend.executable_version(driver)
        browser_major = lite_backend.version_major(browser_version)
        driver_major = lite_backend.version_major(driver_version)
        driver_ok = bool(driver_version) and (
            browser_major is None or driver_major is None or browser_major == driver_major
        )
        detail = f"explicit: {driver_version or 'version unavailable'}"
        if browser_major is not None and driver_major is not None and browser_major != driver_major:
            detail += f"; major mismatch with browser {browser_major}"
        add_check(checks, "driver", driver_ok, detail)
    else:
        add_check(checks, "driver", bool(manager_version), f"Selenium Manager: {manager_version or 'not locally available'}")
    browser_major = lite_backend.version_major(browser_version)
    selenium_parts = tuple(int(item) for item in re.findall(r"\d+", selenium_version)[:2]) if selenium_version else ()
    compatibility = not (selected == "chrome" and browser_major is not None and browser_major >= 150 and selenium_parts < (4, 46))
    detail = "compatible local versions"
    if not compatibility:
        detail = "warning: Chrome 150+ with Selenium below 4.46; this is not asserted as the cause of a failure"
    add_check(checks, "selenium-compatibility", True, detail)
    session_path = state / rules["state_paths"]["lite_session"]
    if session_path.exists():
        try:
            session = lite_backend.load_session(state, rules["state_paths"])
            add_check(checks, "lite-session", True, f"saved for {session.get('browser', 'unknown browser')}")
        except lite_backend.LiteError as exc:
            add_check(checks, "lite-session", False, str(exc))
    else:
        add_check(checks, "lite-session", True, "not logged in; run login --mode lite")
    return {"ok": all(item["ok"] for item in checks), "mode": "lite", "browsers": detected, "checks": checks}


def cmd_setup_dispatch(args: argparse.Namespace) -> int:
    if args.resolved_mode == "docker":
        return cmd_setup(args)
    try:
        result = lite_backend.setup_lite(state_root_from(args.state_dir), args.backend_rules["state_paths"], LITE_LOCK_PATH)
    except lite_backend.LiteError as exc:
        raise ExporterError(str(exc)) from exc
    if not getattr(args, "json", False):
        print(f"Lite runtime ready at {result['venv']} ({result['installer']})")
    return 0


def cmd_doctor_dispatch(args: argparse.Namespace) -> int:
    if args.resolved_mode == "docker":
        return cmd_doctor(args)
    report = lite_doctor_report(args)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        for check in report["checks"]:
            print(f"{'ok' if check['ok'] else 'fail'} {check['name']}: {check['detail']}")
    return 0 if report["ok"] else 1


def _lite_status_context(args: argparse.Namespace, state: Path):
    if args.resolved_ui != "html":
        return nullcontext(None)
    runtime = state / args.backend_rules["state_paths"]["lite_runtime"]
    try:
        return lite_backend.StatusServer(LITE_STATUS_PATH, runtime)
    except lite_backend.LiteError as exc:
        raise ExporterError(str(exc)) from exc


def cmd_login(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    if args.resolved_mode == "docker":
        base = effective_api_base(args, state)
        if args.resolved_ui == "full":
            return cmd_open(args)
        print(f"visit {base}/ and complete QR login")
        return 0
    browser, driver = effective_browser(args, state, args.backend_rules)
    try:
        with _lite_status_context(args, state) as status:
            try:
                lite_backend.login(
                    state,
                    args.backend_rules["state_paths"],
                    args.backend_rules,
                    browser,
                    driver,
                    status,
                    args.workflow_rules,
                )
            except lite_backend.LiteError:
                if status:
                    time.sleep(min(2, max(0, args.workflow_rules["defaults"]["terminal_hold_seconds"])))
                raise
            if status:
                status.update(
                    "success",
                    "登录会话已安全保存。",
                    phase="ready",
                    code="login_verified",
                    next_action="run search, latest, or archive",
                    next_actions=[
                        'search "公众号名称"',
                        'latest "公众号名称"',
                        'archive "公众号名称" --limit 5 --format markdown',
                    ],
                    terminal=True,
                )
                time.sleep(min(2, max(0, args.workflow_rules["defaults"]["terminal_hold_seconds"])))
        print("Lite login verified and saved")
        return 0
    except lite_backend.LoginError:
        raise
    except lite_backend.LiteError as exc:
        raise ExporterError(str(exc)) from exc


def onboard_payload(
    *,
    ok: bool,
    phase: str,
    code: str,
    next_action: str,
    terminal: bool,
    error: str | None = None,
) -> dict[str, Any]:
    value: dict[str, Any] = {"ok": ok, "phase": phase, "code": code, "next_action": next_action, "terminal": terminal}
    if error:
        value["error"] = error[:500]
    if ok:
        value["examples"] = [
            'search "公众号名称"',
            'latest "公众号名称"',
            'archive "公众号名称" --limit 5 --format markdown',
        ]
    return value


def emit_onboard(args: argparse.Namespace, value: dict[str, Any]) -> None:
    if args.json:
        print(json.dumps(value, ensure_ascii=False, sort_keys=True))
        return
    if value["ok"]:
        print("MP Ark is ready.")
        print("Next:")
        for example in value["examples"]:
            print(f"  {example}")
    else:
        print(f"MP Ark {value['phase']}: {value.get('error') or value['code']}")
        print(f"Next action: {value['next_action']}")


def cmd_onboard(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)

    def run_internal(command) -> int:
        if not args.json:
            return int(command(args))
        with redirect_stdout(io.StringIO()):
            return int(command(args))

    if args.resolved_mode == "docker":
        status = service_status(state)
        explicit = args.mode == "docker"
        if not explicit and not status.get("running"):
            value = onboard_payload(ok=False, phase="setup", code="docker_requires_explicit_mode", next_action="rerun onboard --mode docker", terminal=True)
            emit_onboard(args, value)
            return 2
        if explicit and not status.get("setup"):
            run_internal(cmd_setup)
            status = service_status(state)
        if explicit and not status.get("running"):
            run_internal(cmd_start)
        run_internal(cmd_login)
        value = onboard_payload(ok=False, phase="login", code="qr_pending", next_action="complete QR login in the Docker UI, then run auth save and status", terminal=False)
        emit_onboard(args, value)
        return 3

    probe = lite_backend.dependency_probe(state, args.backend_rules["state_paths"])
    if not probe.get("installed"):
        try:
            run_internal(cmd_setup_dispatch)
            maybe_reexec_lite(args, state, args.backend_rules, args._normalized_argv)
        except (ExporterError, lite_backend.LiteError, OSError) as exc:
            value = onboard_payload(
                ok=False,
                phase="setup",
                code="setup_failed",
                next_action="install Python 3.12 and run doctor --mode lite --json, then retry onboard",
                terminal=True,
                error=lite_backend.sanitize_error_summary(exc),
            )
            emit_onboard(args, value)
            return 1
    session_path = state / args.backend_rules["state_paths"]["lite_session"]
    if args.force_login and session_path.exists():
        run_internal(cmd_auth_clear_dispatch)
    if not args.force_login:
        try:
            lite_backend.load_session(state, args.backend_rules["state_paths"])
            value = onboard_payload(ok=True, phase="ready", code="session_reused", next_action="run search, latest, or archive", terminal=True)
            emit_onboard(args, value)
            return 0
        except lite_backend.LiteError:
            pass
    try:
        run_internal(cmd_login)
        lite_backend.load_session(state, args.backend_rules["state_paths"])
    except (ExporterError, lite_backend.LiteError) as exc:
        summary = lite_backend.sanitize_error_summary(exc)
        code = exc.code if isinstance(exc, lite_backend.LoginError) else "login_failed"
        phase = exc.phase if isinstance(exc, lite_backend.LoginError) else "login"
        value = onboard_payload(ok=False, phase=phase, code=code, next_action="run doctor --mode lite --json, then retry onboard", terminal=True, error=summary)
        emit_onboard(args, value)
        return 1
    value = onboard_payload(ok=True, phase="ready", code="login_verified", next_action="run search, latest, or archive", terminal=True)
    emit_onboard(args, value)
    return 0


def cmd_start_dispatch(args: argparse.Namespace) -> int:
    return cmd_start(args) if args.resolved_mode == "docker" else cmd_login(args)


def cmd_open_dispatch(args: argparse.Namespace) -> int:
    return cmd_open(args) if args.resolved_mode == "docker" else cmd_login(args)


def cmd_stop_dispatch(args: argparse.Namespace) -> int:
    if args.resolved_mode == "docker":
        return cmd_stop(args)
    print("Lite mode has no persistent service")
    return 0


def cmd_status_dispatch(args: argparse.Namespace) -> int:
    if args.resolved_mode == "docker":
        return cmd_status(args)
    state = state_root_from(args.state_dir)
    try:
        session = lite_backend.load_session(state, args.backend_rules["state_paths"])
        value = {
            "ok": True,
            "mode": "lite",
            "setup": lite_backend.lite_ready(state, args.backend_rules["state_paths"], args.backend_rules),
            "running": False,
            "session_saved": True,
            "session_validated_locally": True,
            "online_verified": False,
            "browser": session.get("browser"),
        }
        code = 0
    except lite_backend.LiteError as exc:
        value = {
            "ok": False,
            "mode": "lite",
            "setup": lite_backend.lite_ready(state, args.backend_rules["state_paths"], args.backend_rules),
            "running": False,
            "session_saved": False,
            "session_validated_locally": False,
            "online_verified": False,
            "error": str(exc),
        }
        code = 1
    if args.json:
        print(json.dumps(value, ensure_ascii=False, sort_keys=True))
    else:
        print("Lite session is saved (not checked online)" if value["ok"] else f"Lite session is not ready: {value['error']}")
    return code


def cmd_auth_save_dispatch(args: argparse.Namespace) -> int:
    if args.resolved_mode != "docker":
        raise ExporterError("Lite auth is created only by the universal login command")
    return cmd_auth_save(args)


def cmd_auth_status_dispatch(args: argparse.Namespace) -> int:
    if args.resolved_mode == "docker":
        return cmd_auth_status(args)
    return cmd_status_dispatch(args)


def cmd_auth_clear_dispatch(args: argparse.Namespace) -> int:
    if args.resolved_mode == "docker":
        return cmd_auth_clear(args)
    state = state_root_from(args.state_dir)
    path = state / args.backend_rules["state_paths"]["lite_session"]
    try:
        lite_backend.validate_lite_layout(state, args.backend_rules["state_paths"])
        if path.exists():
            lite_backend.require_file(path)
            path.unlink()
    except lite_backend.LiteError as exc:
        raise ExporterError(str(exc)) from exc
    print("saved Lite session cleared")
    return 0


def cmd_config(args: argparse.Namespace) -> int:
    state = state_root_from(args.state_dir)
    current = load_preferences(state, args.backend_rules)
    changed = False
    for source, target in (("default_mode", "mode"), ("default_ui", "ui"), ("default_browser", "browser")):
        value = getattr(args, source)
        if value is not None:
            current[target] = value
            changed = True
    if args.clear_driver:
        current["driver_path"] = None
        changed = True
    elif args.config_driver_path:
        try:
            current["driver_path"] = lite_backend.validate_driver_path(args.config_driver_path)
        except lite_backend.LiteError as exc:
            raise ExporterError(str(exc)) from exc
        changed = True
    mode, ui = current["mode"], current["ui"]
    if mode in ("lite", "docker") and ui != "auto" and ui not in args.backend_rules["ui"]["matrix"][mode]:
        raise ExporterError(f"UI {ui!r} cannot be the saved default for {mode} mode")
    if changed:
        save_preferences(state, args.backend_rules, current)
    print(json.dumps(current, ensure_ascii=False, sort_keys=True))
    return 0


class TerminalProgress:
    def update(self, state: str, detail: str = "", current: int = 0, total: int = 0, **_: Any) -> None:
        print(f"[{state}] {detail} ({current}/{total})", file=sys.stderr)


def default_archive_output(fakeid: str, format_name: str) -> str:
    digest = hashlib.sha256(fakeid.encode("utf-8")).hexdigest()[:16]
    return str(Path.cwd() / "mp-ark-archives" / f"{digest}-{format_name}")


def prepare_archive_selection(args: argparse.Namespace) -> int:
    workflows = args.workflow_rules
    args.max_pages = args.max_pages or (
        workflows["defaults"]["today_max_pages"] if args.today else workflows["defaults"]["archive_max_pages"]
    )
    args.selection = None
    if args.today or args.limit is not None:
        zone = timezone_from(args.timezone) if args.today else None
        state = state_root_from(args.state_dir)
        backend = backend_from_args(args, state)
        args.account = args.fakeid
        account, code = _resolved_account_or_output(args, backend)
        if account is None:
            return code
        args.fakeid = str(account.get("fakeid") or "")
        args._backend = backend
        if args.today:
            assert zone is not None
            date_value, start, end = local_day_window(zone)
            args.selection = {"type": "today", "date": date_value, "timezone": args.timezone, "start": start, "end": end}
        else:
            args.selection = {"type": "limit", "limit": args.limit}
        if args.resolved_ui == "terminal":
            args._progress = TerminalProgress()
    elif args.account_id or args.pick:
        raise ExporterError("--account-id and --pick require --today or --limit")
    if not args.output:
        args.output = default_archive_output(args.fakeid, args.format)
    return 0


def cmd_archive_dispatch(args: argparse.Namespace) -> int:
    prepared = prepare_archive_selection(args)
    if prepared:
        return prepared
    if args.resolved_mode != "lite" or args.resolved_ui != "html":
        return cmd_archive(args)
    state = state_root_from(args.state_dir)
    try:
        with _lite_status_context(args, state) as status:
            status.update("archive", "正在读取文章列表并归档正文。")
            args._progress = status
            code = cmd_archive(args)
            if code == 0:
                status.update(
                    "success",
                    "归档完成。",
                    1,
                    1,
                    phase="ready",
                    code="archive_complete",
                    next_action="open the archive manifest or run another query",
                    terminal=True,
                )
            else:
                status.update(
                    "failure",
                    "归档未完整完成，请查看终端中的失败清单。",
                    phase="archive",
                    code="archive_incomplete",
                    next_action="review failures.ndjson and rerun the same archive command",
                    terminal=True,
                )
            time.sleep(min(2, max(0, args.workflow_rules["defaults"]["terminal_hold_seconds"])))
            return code
    except lite_backend.LiteError as exc:
        raise ExporterError(str(exc)) from exc


def build_parser() -> argparse.ArgumentParser:
    workflow_rules = load_workflow_rules()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", help="override the skill-managed state directory")
    parser.add_argument("--api-base", help="loopback-only local API base")
    parser.add_argument("--timeout", type=float, default=30.0, help="local API timeout in seconds")
    parser.add_argument("--mode", choices=("auto", "lite", "docker"), default="auto")
    parser.add_argument("--ui", choices=("auto", "html", "terminal", "full"), default="auto")
    parser.add_argument("--browser", choices=("auto", "chrome", "edge", "brave", "firefox", "safari"), default="auto")
    parser.add_argument("--driver-path", help="explicit local Selenium driver executable")
    subparsers = parser.add_subparsers(dest="command", required=True)

    global_help = "Global --mode, --ui, --browser, --driver-path, --state-dir, --api-base, and --timeout options may appear before or after this subcommand."

    setup_parser = subparsers.add_parser(
        "setup", help="prepare the selected backend",
        description="Prepare the Lite Python environment or the explicitly selected pinned Docker build.",
        epilog=global_help,
    )
    setup_parser.set_defaults(func=cmd_setup_dispatch)

    doctor_parser = subparsers.add_parser("doctor", help="check dependencies and runtime integrity")
    doctor_parser.add_argument("--json", action="store_true")
    doctor_parser.set_defaults(func=cmd_doctor_dispatch)

    start_parser = subparsers.add_parser("start", help="start Docker or bootstrap Lite login")
    start_parser.add_argument("--port", type=int, default=3000)
    start_parser.set_defaults(func=cmd_start_dispatch)

    stop_parser = subparsers.add_parser("stop", help="stop Docker or clear transient Lite runtime state")
    stop_parser.add_argument("--port", type=int)
    stop_parser.set_defaults(func=cmd_stop_dispatch)

    status_parser = subparsers.add_parser("status", help="show selected backend status")
    status_parser.add_argument("--json", action="store_true")
    status_parser.set_defaults(func=cmd_status_dispatch)

    open_parser = subparsers.add_parser("open", help="open or bootstrap the selected login UI")
    open_parser.set_defaults(func=cmd_open_dispatch)

    login_parser = subparsers.add_parser(
        "login", help="perform user-approved QR login for the selected backend",
        description="Open the real WeChat QR login with Lite's managed browser or Docker's retained local UI.",
        epilog=global_help,
    )
    login_parser.set_defaults(func=cmd_login)

    def add_onboard(name: str):
        target = subparsers.add_parser(name, help="prepare MP Ark and guide QR login")
        target.add_argument("--force-login", action="store_true", help="discard a saved Lite session and require QR login")
        target.add_argument("--json", action="store_true")
        target.add_argument("--port", type=int, default=3000, help=argparse.SUPPRESS)
        target.set_defaults(func=cmd_onboard)
        return target

    onboard_parser = add_onboard("onboard")
    init_parser = add_onboard("init")

    auth_parser = subparsers.add_parser("auth", help="manage the local auth key")
    auth_subparsers = auth_parser.add_subparsers(dest="auth_command", required=True)
    auth_save = auth_subparsers.add_parser("save", help="verify and save auth from hidden input, stdin, env, or file")
    auth_save.add_argument("--from-file", help="read from a mode-0600 file in a mode-0700 directory")
    auth_save.set_defaults(func=cmd_auth_save_dispatch)
    auth_status = auth_subparsers.add_parser("status", help="verify the saved auth key")
    auth_status.add_argument("--json", action="store_true")
    auth_status.set_defaults(func=cmd_auth_status_dispatch)
    auth_clear = auth_subparsers.add_parser("clear", help="remove the saved auth key")
    auth_clear.set_defaults(func=cmd_auth_clear_dispatch)

    config_parser = subparsers.add_parser("config", help="show or save non-secret backend preferences")
    config_parser.add_argument("--default-mode", choices=("auto", "lite", "docker"))
    config_parser.add_argument("--default-ui", choices=("auto", "html", "terminal", "full"))
    config_parser.add_argument("--default-browser", choices=("auto", "chrome", "edge", "brave", "firefox", "safari"))
    config_parser.add_argument("--config-driver-path", help="persist an explicit local driver executable")
    config_parser.add_argument("--clear-driver", action="store_true")
    config_parser.set_defaults(func=cmd_config)

    def add_paging(target: argparse.ArgumentParser, default_size: int) -> None:
        target.add_argument("--begin", type=nonnegative_int, default=0)
        target.add_argument("--size", type=positive_int, choices=range(1, 21), default=default_size)
        target.add_argument("--pages", type=positive_int, default=1)
        target.add_argument("--all", action="store_true")
        target.add_argument("--max-pages", type=positive_int, default=500)

    search_parser = subparsers.add_parser("search", help="search WeChat Official Accounts")
    search_parser.add_argument("keyword")
    search_parser.add_argument("--json", action="store_true", help="emit the legacy complete JSON envelope")
    add_paging(search_parser, 5)
    search_parser.set_defaults(func=cmd_search)

    articles_parser = subparsers.add_parser("articles", help="page article metadata for an account")
    articles_parser.add_argument("fakeid")
    articles_parser.add_argument("--keyword", default="")
    articles_parser.add_argument("--json", action="store_true", help="emit the legacy complete JSON envelope")
    add_paging(articles_parser, 20)
    articles_parser.set_defaults(func=cmd_articles)

    fetch_parser = subparsers.add_parser("fetch", help="fetch one safe article representation")
    fetch_parser.add_argument("url")
    fetch_parser.add_argument("--format", choices=SAFE_FORMATS, default="html")
    fetch_parser.add_argument("--output")
    fetch_parser.set_defaults(func=cmd_fetch)

    def add_account_selection(target: argparse.ArgumentParser) -> None:
        target.add_argument("--pick", type=positive_int, choices=range(1, workflow_rules["limits"]["pick"][1] + 1))
        target.add_argument("--account-id", help="use an exact fakeid without account search")
        target.add_argument("--json", action="store_true")

    latest_parser = subparsers.add_parser("latest", help="show the latest compact article list")
    latest_parser.add_argument("account")
    latest_parser.add_argument("--limit", type=positive_int, choices=range(1, workflow_rules["limits"]["latest"][1] + 1), default=workflow_rules["defaults"]["latest_limit"])
    add_account_selection(latest_parser)
    latest_parser.set_defaults(func=cmd_latest)

    today_parser = subparsers.add_parser("today", help="show articles published today")
    today_parser.add_argument("account")
    today_parser.add_argument("--timezone", default="local")
    today_parser.add_argument("--max-pages", type=positive_int, choices=range(1, workflow_rules["limits"]["today_max_pages"][1] + 1), default=workflow_rules["defaults"]["today_max_pages"])
    add_account_selection(today_parser)
    today_parser.set_defaults(func=cmd_today)

    archive_parser = subparsers.add_parser("archive", help="rescan and extend a deduplicated account archive")
    archive_parser.add_argument("fakeid")
    archive_parser.add_argument("--format", choices=SAFE_FORMATS, default="html")
    archive_parser.add_argument("--output")
    archive_parser.add_argument("--begin", type=nonnegative_int, default=0)
    archive_parser.add_argument("--size", type=positive_int, choices=range(1, 21), default=20)
    archive_parser.add_argument("--max-pages", type=positive_int)
    selection_group = archive_parser.add_mutually_exclusive_group()
    selection_group.add_argument("--today", action="store_true")
    selection_group.add_argument("--limit", type=positive_int, choices=range(1, workflow_rules["limits"]["archive_limit"][1] + 1))
    archive_parser.add_argument("--timezone", default="local")
    archive_parser.add_argument("--pick", type=positive_int, choices=range(1, workflow_rules["limits"]["pick"][1] + 1))
    archive_parser.add_argument("--account-id")
    archive_parser.add_argument("--json", action="store_true", help=argparse.SUPPRESS)
    archive_parser.set_defaults(func=cmd_archive_dispatch)
    for command_parser in (
        setup_parser,
        doctor_parser,
        start_parser,
        stop_parser,
        status_parser,
        open_parser,
        login_parser,
        onboard_parser,
        init_parser,
        auth_parser,
        auth_save,
        auth_status,
        auth_clear,
        config_parser,
        search_parser,
        articles_parser,
        fetch_parser,
        latest_parser,
        today_parser,
        archive_parser,
    ):
        command_parser.epilog = global_help
    return parser


def normalize_global_options(argv: list[str]) -> list[str]:
    names = {"--state-dir", "--api-base", "--timeout", "--mode", "--ui", "--browser", "--driver-path"}
    prefix: list[str] = []
    remaining: list[str] = []
    index = 0
    while index < len(argv):
        item = argv[index]
        matched = next((name for name in names if item.startswith(name + "=")), None)
        if matched:
            prefix.append(item)
            index += 1
            continue
        if item in names:
            if index + 1 >= len(argv):
                remaining.append(item)
                index += 1
                continue
            prefix.extend((item, argv[index + 1]))
            index += 2
            continue
        remaining.append(item)
        index += 1
    return prefix + remaining


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    normalized_argv = normalize_global_options(raw_argv)
    args = parser.parse_args(normalized_argv)
    args._normalized_argv = normalized_argv
    if args.command == "search" and args.all and not args.json:
        print("error: human search --all is disabled; add --json or narrow the query", file=sys.stderr)
        return 2
    if args.command == "articles" and args.all:
        print("error: articles --all is disabled; use archive for historical aggregation", file=sys.stderr)
        return 2
    secrets: list[str] = []
    env_secret = os.environ.get("WECHAT_MP_EXPORTER_AUTH_KEY")
    if env_secret:
        secrets.append(env_secret.strip())
    try:
        rules = load_backend_rules()
        workflows = load_workflow_rules()
        args.backend_rules = rules
        args.workflow_rules = workflows
        state = state_root_from(args.state_dir)
        args.resolved_mode = resolve_mode(args, state, rules, command=args.command)
        if args.resolved_mode == "lite":
            reject_lite_state_alias(args.state_dir)
        args.resolved_ui = resolve_ui(args, state, rules, args.resolved_mode)
        if args.timeout <= 0 or args.timeout > 300:
            raise ExporterError("timeout must be greater than 0 and at most 300 seconds")
        maybe_reexec_lite(args, state, rules, normalized_argv)
        return int(args.func(args))
    except lite_backend.LiteError as exc:
        print(f"error: {redact(str(exc), secrets)}", file=sys.stderr)
        return 1
    except ExporterError as exc:
        print(f"error: {redact(str(exc), secrets)}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("error: interrupted", file=sys.stderr)
        return 130
    except Exception as exc:  # Fail closed without leaking a traceback or secret.
        print(f"error: unexpected failure: {redact(str(exc), secrets)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
