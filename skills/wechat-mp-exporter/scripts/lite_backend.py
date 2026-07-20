#!/usr/bin/env python3
"""On-demand browser login and direct WeChat API adapter for Lite mode."""

from __future__ import annotations

from contextlib import contextmanager
import datetime as dt
import hashlib
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.cookiejar
import json
import os
from pathlib import Path, PureWindowsPath
import platform
import re
import secrets
import signal
import shutil
import stat
import subprocess
import sys
import threading
import time
from typing import Any, Callable, Iterator
import urllib.error
import urllib.parse
import urllib.request
import webbrowser


LOGIN_URL = "https://mp.weixin.qq.com/"
MP_ORIGIN = "https://mp.weixin.qq.com"
MAX_API_BYTES = 20 * 1024 * 1024
MAX_CONTENT_BYTES = 100 * 1024 * 1024
ABNORMAL_MARKERS = (
    "环境异常",
    "访问过于频繁",
    "该内容已被发布者删除",
    "请在微信客户端打开链接",
    "verify your identity",
    "unusual traffic",
)


class LiteError(RuntimeError):
    pass


class LoginError(LiteError):
    def __init__(self, code: str, summary: str, phase: str):
        super().__init__(summary)
        self.code = code
        self.summary = summary
        self.phase = phase


def sanitize_error_summary(error: BaseException | str, secrets_to_redact: list[str] | None = None) -> str:
    value = str(error)
    for secret in secrets_to_redact or []:
        if secret:
            value = value.replace(secret, "[REDACTED]")
    value = re.sub(r"(?i)(token|cookie|pass_ticket|auth(?:orization)?)[=:][^\s&,;]+", r"\1=[REDACTED]", value)
    value = re.sub(r"(?i)(--user-data-dir(?:=|\s+))[^\s]+", r"\1[PATH REDACTED]", value)
    value = re.sub(r"(?<![A-Za-z0-9_.-])/(?:Users|home)/[^\s:]+", "[PATH REDACTED]", value)
    value = re.sub(r"(?i)[A-Z]:\\Users\\[^\s:]+", "[PATH REDACTED]", value)
    value = re.sub(r"https?://[^\s]+", "[URL REDACTED]", value)
    value = " ".join(value.split())
    return (value or "browser operation failed")[:500]


def classify_login_error(error: BaseException, phase: str) -> LoginError:
    summary = sanitize_error_summary(error)
    lowered = summary.casefold()
    patterns = (
        ("version_mismatch", ("only supports chrome version", "this version of chromedriver", "version mismatch")),
        ("driver_missing", ("unable to obtain driver", "no such driver", "driver executable")),
        ("driver_blocked", ("permission denied", "cannot be opened", "blocked by")),
        ("profile_in_use", ("user data directory is already in use", "profile appears to be in use", "singletonlock")),
        ("tab_crashed", ("tab crashed", "page crash")),
        ("devtools_disconnected", ("not connected to devtools", "disconnected from devtools", "unable to receive message")),
        ("browser_closed", ("no such window", "target window already closed", "browser has closed")),
        ("startup_failure", ("session not created", "failed to start", "browser driver could not start")),
        ("qr_timeout", ("qr login timed out",)),
    )
    for code, needles in patterns:
        if any(needle in lowered for needle in needles):
            return LoginError(code, summary, phase)
    return LoginError("unknown", summary, phase)


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def ensure_dir(path: Path) -> None:
    if path.is_symlink():
        raise LiteError(f"refusing symlink directory: {path}")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir():
        raise LiteError(f"not a directory: {path}")
    os.chmod(path, 0o700)


def _lexists(path: Path) -> bool:
    return os.path.lexists(str(path))


def _require_private_dir(path: Path, label: str) -> None:
    try:
        info = os.lstat(path)
    except FileNotFoundError as exc:
        raise LiteError(f"missing {label}: {path}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise LiteError(f"{label} must be a non-symlink directory")
    actual = stat.S_IMODE(info.st_mode)
    if actual != 0o700:
        raise LiteError(f"{label} must have mode 0700, found {actual:04o}")


def ensure_state_root(state: Path) -> None:
    if _lexists(state):
        _require_private_dir(state, "Lite state directory")
        return
    if not state.parent.is_dir():
        raise LiteError("Lite state parent must already exist")
    os.mkdir(state, 0o700)
    _require_private_dir(state, "Lite state directory")


def ensure_private_child(state: Path, path: Path) -> None:
    ensure_state_root(state)
    try:
        relative = path.relative_to(state)
    except ValueError as exc:
        raise LiteError("Lite path escaped the trusted state root") from exc
    current = state
    for part in relative.parts:
        current = current / part
        if _lexists(current):
            _require_private_dir(current, f"Lite directory {current.name}")
        else:
            os.mkdir(current, 0o700)
            _require_private_dir(current, f"Lite directory {current.name}")


def validate_lite_layout(state: Path, paths: dict[str, str], *, require_session: bool = False) -> None:
    _require_private_dir(state, "Lite state directory")
    session_path, lite_root, runtime_path, profile = session_paths(state, paths)
    trusted_dirs = (lite_root, state / "secrets", session_path.parent, runtime_path.parent, profile)
    for directory in trusted_dirs:
        if _lexists(directory):
            _require_private_dir(directory, f"Lite directory {directory.name}")
    if _lexists(session_path):
        require_file(session_path)
    elif require_session:
        raise LiteError("Lite session is not saved; run login --mode lite")


def require_file(path: Path, mode: int = 0o600) -> None:
    if path.is_symlink() or not path.is_file():
        raise LiteError(f"unsafe file: {path}")
    actual = stat.S_IMODE(path.stat().st_mode)
    if actual != mode:
        raise LiteError(f"{path.name} must have mode {mode:04o}, found {actual:04o}")


def atomic_json(path: Path, value: Any, trusted_root: Path | None = None) -> None:
    if trusted_root is not None:
        ensure_private_child(trusted_root, path.parent)
        if _lexists(path):
            require_file(path)
    else:
        ensure_dir(path.parent)
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    temp = path.parent / f".{path.name}.{secrets.token_hex(8)}"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(temp, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        os.chmod(path, 0o600)
    finally:
        temp.unlink(missing_ok=True)


def _platform_key() -> str:
    value = platform.system().lower()
    return {"darwin": "darwin", "linux": "linux", "windows": "windows"}.get(value, value)


def _windows_candidate(value: str) -> list[Path]:
    if PureWindowsPath(value).is_absolute():
        return [Path(value)]
    roots = [os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")]
    return [Path(root) / value for root in roots if root]


def detect_browsers(rules: dict[str, Any]) -> dict[str, dict[str, Any]]:
    key = _platform_key()
    candidates = rules["browsers"]["candidates"].get(key, {})
    support = rules["browsers"]["support"]
    result: dict[str, dict[str, Any]] = {}
    for name in rules["browsers"]["priority"]:
        found: str | None = None
        for candidate in candidates.get(name, []):
            possible = _windows_candidate(candidate) if key == "windows" else [Path(candidate)]
            for path in possible:
                if path.is_absolute() and path.is_file() and os.access(path, os.X_OK):
                    found = str(path)
                    break
                located = shutil.which(candidate)
                if located:
                    found = located
                    break
            if found:
                break
        result[name] = {"available": bool(found), "path": found, "support": support[name]}
    return result


def select_browser(requested: str, rules: dict[str, Any], *, automated: bool = True) -> tuple[str, str]:
    detected = detect_browsers(rules)
    choices = rules["browsers"]["priority"] if requested == "auto" else [requested]
    for name in choices:
        item = detected.get(name, {"available": False, "path": None, "support": rules["browsers"]["support"].get(name)})
        if not item["available"]:
            if requested != "auto":
                raise LiteError(f"requested browser is not installed: {name}")
            continue
        if automated and item["support"] == "progress-only":
            if requested != "auto":
                raise LiteError("Safari can display progress only; automated WeChat login is not supported")
            continue
        return name, str(item["path"])
    raise LiteError("no supported installed browser was found; install Chrome, Edge, Brave, or Firefox")


def executable_version(path: str) -> str | None:
    try:
        completed = subprocess.run([path, "--version"], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    text = (completed.stdout or completed.stderr).strip()
    return text[:200] if completed.returncode == 0 and text else None


def version_major(value: str | None) -> int | None:
    match = re.search(r"\b(\d{2,4})(?:\.\d+)+", value or "")
    return int(match.group(1)) if match else None


def linux_shm_restricted() -> bool:
    if platform.system().lower() != "linux":
        return False
    try:
        stats = os.statvfs("/dev/shm")
    except OSError:
        return True
    return stats.f_bavail * stats.f_frsize < 128 * 1024 * 1024


def chromium_flags(workflow_rules: dict[str, Any] | None, *, safe_mode: bool, platform_name: str | None = None, shm_restricted: bool | None = None) -> list[str]:
    flags = ["--no-first-run", "--disable-sync"]
    recovery = (workflow_rules or {}).get("login_recovery", {})
    if safe_mode:
        flags.extend(recovery.get("safe_mode_flags", ["--disable-extensions"]))
    system = (platform_name or platform.system()).lower()
    restricted = linux_shm_restricted() if shm_restricted is None else shm_restricted
    if system == "linux" and restricted:
        flags.append(recovery.get("linux_shm_flag", "--disable-dev-shm-usage"))
    forbidden = recovery.get("forbidden_flags", ["--no-sandbox", "--disable-gpu", "--remote-debugging-port"])
    if any(any(flag == item or flag.startswith(item + "=") for item in forbidden) for flag in flags):
        raise LiteError("unsafe browser flag was generated")
    return flags


def validate_driver_path(value: str | None) -> str | None:
    if not value:
        return None
    path = Path(value).expanduser().absolute()
    if path.is_symlink() or not path.is_file() or not os.access(path, os.X_OK):
        raise LiteError("driver path must be a non-symlink executable file")
    return str(path)


def validate_login_result(url: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError as exc:
        raise LiteError("login returned an invalid URL") from exc
    if parsed.scheme != "https" or (parsed.hostname or "").lower() != "mp.weixin.qq.com":
        raise LiteError("login did not finish on the exact mp.weixin.qq.com host")
    values = urllib.parse.parse_qs(parsed.query)
    token = (values.get("token") or [""])[0]
    if not re.fullmatch(r"[0-9]{4,32}", token):
        raise LiteError("login did not yield a valid WeChat token")
    return token


def validate_article_url(url: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(url.strip())
        port = parsed.port
    except ValueError as exc:
        raise LiteError("article URL is invalid") from exc
    if (
        parsed.scheme != "https"
        or (parsed.hostname or "").lower() != "mp.weixin.qq.com"
        or parsed.username
        or parsed.password
        or port not in (None, 443)
        or not parsed.path.startswith("/")
        or parsed.path == "/"
    ):
        raise LiteError("article URL must use the exact https://mp.weixin.qq.com host")
    return urllib.parse.urlunsplit(("https", "mp.weixin.qq.com", parsed.path, parsed.query, ""))


def session_paths(state: Path, paths: dict[str, str]) -> tuple[Path, Path, Path, Path]:
    return (
        state / paths["lite_session"],
        state / paths["lite_root"],
        state / paths["lite_runtime"],
        state / paths["lite_root"] / "profile",
    )


def load_session(state: Path, paths: dict[str, str]) -> dict[str, Any]:
    session_path, _, _, _ = session_paths(state, paths)
    validate_lite_layout(state, paths, require_session=True)
    try:
        value = json.loads(session_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LiteError("Lite session is unreadable or invalid") from exc
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        raise LiteError("Lite session schema is invalid")
    token = value.get("token")
    ua = value.get("user_agent")
    cookies = value.get("cookies")
    if not isinstance(token, str) or not re.fullmatch(r"[0-9]{4,32}", token):
        raise LiteError("Lite session token is invalid; log in again")
    if not isinstance(ua, str) or not ua or len(ua) > 1024:
        raise LiteError("Lite session user agent is invalid; log in again")
    if not isinstance(cookies, list) or not cookies or any(not isinstance(item, dict) for item in cookies):
        raise LiteError("Lite session cookies are invalid; log in again")
    if value.get("browser") not in ("chrome", "edge", "brave", "firefox"):
        raise LiteError("Lite session browser is invalid; log in again")
    return value


@contextmanager
def process_lock(path: Path, trusted_root: Path | None = None) -> Iterator[None]:
    if trusted_root is not None:
        ensure_private_child(trusted_root, path.parent)
    else:
        ensure_dir(path.parent)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise LiteError("another Lite browser operation is already running") from exc
    try:
        os.write(fd, f"{os.getpid()}\n".encode("ascii"))
        os.close(fd)
        yield
    finally:
        try:
            if path.is_symlink():
                raise LiteError("Lite lock path became a symlink")
            path.unlink(missing_ok=True)
        except OSError:
            pass


class _SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != "https" or (parsed.hostname or "").lower() != "mp.weixin.qq.com" or parsed.port not in (None, 443):
            raise LiteError("refused an off-origin WeChat redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _cookie_jar(items: list[dict[str, Any]]) -> http.cookiejar.CookieJar:
    jar = http.cookiejar.CookieJar()
    for item in items:
        name, value = item.get("name"), item.get("value")
        if not isinstance(name, str) or not isinstance(value, str):
            raise LiteError("Lite session contains a malformed cookie")
        domain = str(item.get("domain") or ".mp.weixin.qq.com").lower()
        if domain.lstrip(".") != "mp.weixin.qq.com" and not domain.endswith(".mp.weixin.qq.com"):
            continue
        path = str(item.get("path") or "/")
        jar.set_cookie(
            http.cookiejar.Cookie(
                version=0, name=name, value=value, port=None, port_specified=False,
                domain=domain, domain_specified=True, domain_initial_dot=domain.startswith("."),
                path=path, path_specified=True, secure=bool(item.get("secure", True)),
                expires=int(item["expiry"]) if isinstance(item.get("expiry"), (int, float)) else None,
                discard="expiry" not in item, comment=None, comment_url=None, rest={"HttpOnly": item.get("httpOnly")},
                rfc2109=False,
            )
        )
    return jar


def _response_error(value: Any) -> str | None:
    if not isinstance(value, dict):
        return "non-object response"
    base = value.get("base_resp")
    if isinstance(base, dict) and base.get("ret") not in (None, 0, "0"):
        return str(base.get("err_msg") or base.get("errmsg") or f"ret={base.get('ret')}")
    for key in ("ret", "code", "errcode"):
        if key in value and value[key] not in (None, 0, "0"):
            return str(value.get("errmsg") or value.get("msg") or f"{key}={value[key]}")
    return None


def _redact_error(value: str, token: str) -> str:
    text = value.replace(token, "[REDACTED]")
    return re.sub(r"([?&]token=)[^&\s]+", r"\1[REDACTED]", text, flags=re.IGNORECASE)


class LiteClient:
    def __init__(self, session: dict[str, Any], timeout: float, *, sleep: Callable[[float], None] = time.sleep):
        self.token = session["token"]
        self.timeout = timeout
        self.user_agent = session["user_agent"]
        self.sleep = sleep
        self._last_api_request = 0.0
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(_cookie_jar(session["cookies"])),
            _SameOriginRedirect(),
        )

    def _url(self, path: str, params: dict[str, Any]) -> str:
        if not path.startswith("/cgi-bin/") or "?" in path or "#" in path:
            raise LiteError("unsafe WeChat API path")
        all_params = {**params, "token": self.token, "lang": "zh_CN", "f": "json", "ajax": "1"}
        return MP_ORIGIN + path + "?" + urllib.parse.urlencode(all_params, doseq=True)

    def _read(self, request: urllib.request.Request, limit: int, *, attempts: int = 3) -> tuple[bytes, str]:
        for attempt in range(attempts):
            try:
                with self.opener.open(request, timeout=self.timeout) as response:
                    final = urllib.parse.urlsplit(response.geturl())
                    if final.scheme != "https" or (final.hostname or "").lower() != "mp.weixin.qq.com":
                        raise LiteError("WeChat request left the exact HTTPS origin")
                    body = response.read(limit + 1)
                    if len(body) > limit:
                        raise LiteError("WeChat response exceeds the safety limit")
                    return body, response.headers.get("Content-Type", "")
            except urllib.error.HTTPError as exc:
                if exc.code == HTTPStatus.TOO_MANY_REQUESTS or 500 <= exc.code <= 599:
                    if attempt + 1 < attempts:
                        self.sleep(1.0 * (2 ** attempt))
                        continue
                raise LiteError(f"WeChat HTTP {exc.code}") from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                if attempt + 1 < attempts:
                    self.sleep(1.0 * (2 ** attempt))
                    continue
                raise LiteError("WeChat request failed or timed out") from exc
        raise LiteError("WeChat request exhausted retries")

    def api(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        elapsed = time.monotonic() - self._last_api_request
        if self._last_api_request and elapsed < 0.5:
            self.sleep(0.5 - elapsed)
        url = self._url(path, params)
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": self.user_agent}, method="GET")
        try:
            body, _ = self._read(request, MAX_API_BYTES)
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LiteError("WeChat API returned invalid JSON") from exc
        except LiteError as exc:
            raise LiteError(_redact_error(str(exc), self.token)) from exc
        error = _response_error(value)
        if error:
            raise LiteError(_redact_error(f"WeChat API error: {error}", self.token))
        self._last_api_request = time.monotonic()
        return value

    def search_page(self, keyword: str, begin: int, size: int) -> dict[str, Any]:
        return self.api("/cgi-bin/searchbiz", {"action": "search_biz", "query": keyword, "begin": begin, "count": size})

    def article_page(self, fakeid: str, keyword: str, begin: int, size: int) -> dict[str, Any]:
        return self.api(
            "/cgi-bin/appmsgpublish",
            {"sub": "list", "sub_action": "list_ex", "search_field": "null", "begin": begin, "count": size,
             "query": keyword, "fakeid": fakeid, "type": "101_1", "free_publish_type": "1"},
        )

    def content_html(self, article_url: str) -> bytes:
        canonical = validate_article_url(article_url)
        request = urllib.request.Request(canonical, headers={"Accept": "text/html", "User-Agent": self.user_agent}, method="GET")
        body, _ = self._read(request, MAX_CONTENT_BYTES)
        lowered = body.decode("utf-8", errors="ignore").lower()
        if not body.strip() or any(marker.lower() in lowered for marker in ABNORMAL_MARKERS):
            raise LiteError("WeChat returned an empty, blocked, or abnormal article page")
        return body


def extract_content(document: bytes, format_name: str) -> bytes:
    try:
        from bs4 import BeautifulSoup
        from markdownify import markdownify
    except ImportError as exc:
        raise LiteError("Lite dependencies are not installed; run setup --mode lite") from exc
    soup = BeautifulSoup(document, "html.parser")
    content = soup.select_one("#js_content")
    if content is None or not content.get_text(" ", strip=True):
        raise LiteError("article page does not contain a usable #js_content element")
    if format_name == "html":
        result = str(content)
    elif format_name == "text":
        result = content.get_text("\n", strip=True)
    elif format_name == "markdown":
        result = markdownify(str(content), heading_style="ATX").strip()
    else:
        raise LiteError("content format must be html, markdown, or text")
    return (result.rstrip() + "\n").encode("utf-8")


def extract_account_metadata(document: bytes, fakeid: str) -> dict[str, Any]:
    try:
        from bs4 import BeautifulSoup
    except ImportError as exc:
        raise LiteError("Lite dependencies are not installed; run setup --mode lite") from exc
    soup = BeautifulSoup(document, "html.parser")
    nickname = ""
    for selector in ("#js_name", ".profile_nickname", "meta[property='og:article:author']"):
        element = soup.select_one(selector)
        if element:
            nickname = str(element.get("content") or element.get_text(" ", strip=True)).strip()
            if nickname:
                break
    raw: dict[str, Any] = {"fakeid": fakeid}
    if nickname:
        raw["nickname"] = nickname
    return {"fakeid": fakeid, "raw": raw}


class StatusServer:
    def __init__(self, template: Path, runtime: Path, opener: Callable[..., Any] = webbrowser.open):
        self.template = template
        self.runtime = runtime
        self.opener = opener
        self.nonce = secrets.token_urlsafe(24)
        self.state: dict[str, Any] = {
            "state": "waiting",
            "phase": "waiting",
            "code": "waiting",
            "detail": "",
            "next_action": "",
            "next_actions": [],
            "terminal": False,
            "current": 0,
            "total": 0,
            "progress": 0,
            "updated": now_utc(),
        }
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None
        self.url: str | None = None
        self._signal_handlers: dict[int, Any] = {}

    def _interrupt(self, signum, frame):  # noqa: ANN001
        raise KeyboardInterrupt

    def __enter__(self) -> "StatusServer":
        template_bytes = self.template.read_bytes()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):  # noqa: A002, ANN001
                return

            def _headers(self, content_type: str) -> None:
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")

            def do_GET(self):  # noqa: N802
                if self.path == f"/{owner.nonce}/":
                    body, kind = template_bytes, "text/html; charset=utf-8"
                elif self.path == f"/{owner.nonce}/status":
                    body = json.dumps(owner.state, ensure_ascii=False).encode("utf-8")
                    kind = "application/json; charset=utf-8"
                else:
                    self.send_response(HTTPStatus.NOT_FOUND)
                    self._headers("text/plain; charset=utf-8")
                    self.end_headers()
                    return
                self.send_response(HTTPStatus.OK)
                self._headers(kind)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = int(self.server.server_address[1])
        self.url = f"http://127.0.0.1:{port}/{self.nonce}/"
        state = self.runtime.parent.parent
        atomic_json(
            self.runtime,
            {"schema_version": 1, "url": self.url, "pid": os.getpid()},
            state,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, name="wechat-mp-lite-status", daemon=True)
        self.thread.start()
        if threading.current_thread() is threading.main_thread():
            for signum in (signal.SIGINT, signal.SIGTERM):
                self._signal_handlers[signum] = signal.getsignal(signum)
                signal.signal(signum, self._interrupt)
        if self.opener(self.url, new=2) is False:
            print(f"Open the temporary MP Ark status page in any browser: {self.url}", file=sys.stderr)
        return self

    def update(
        self,
        state: str,
        detail: str = "",
        current: int = 0,
        total: int = 0,
        *,
        phase: str | None = None,
        code: str = "",
        next_action: str = "",
        next_actions: list[str] | None = None,
        terminal: bool = False,
    ) -> None:
        progress = round((current / total) * 100, 1) if total else (100 if state == "success" else 0)
        actions = [str(item)[:200] for item in (next_actions or [])[:3] if str(item).strip()]
        self.state = {
            "state": state,
            "phase": (phase or state)[:80],
            "code": code[:80],
            "detail": detail[:500],
            "next_action": next_action[:200],
            "next_actions": actions,
            "terminal": bool(terminal),
            "current": current,
            "total": total,
            "progress": progress,
            "updated": now_utc(),
        }

    def __exit__(self, exc_type, exc, traceback) -> None:  # noqa: ANN001
        for signum, handler in self._signal_handlers.items():
            signal.signal(signum, handler)
        self._signal_handlers.clear()
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.thread:
            self.thread.join(timeout=2)
        if self.runtime.exists() and not self.runtime.is_symlink():
            self.runtime.unlink(missing_ok=True)


def _create_driver(
    name: str,
    binary: str,
    profile: Path,
    driver_path: str | None,
    workflow_rules: dict[str, Any] | None = None,
    *,
    safe_mode: bool = False,
):
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service as ChromeService
        from selenium.webdriver.edge.service import Service as EdgeService
        from selenium.webdriver.firefox.service import Service as FirefoxService
    except ImportError as exc:
        raise LiteError("Selenium is unavailable; run setup --mode lite") from exc
    _require_private_dir(profile, "Lite browser profile")
    driver_path = validate_driver_path(driver_path)
    if name in ("chrome", "brave"):
        options = webdriver.ChromeOptions()
        options.binary_location = binary
        options.add_argument(f"--user-data-dir={profile}")
        for flag in chromium_flags(workflow_rules, safe_mode=safe_mode):
            options.add_argument(flag)
        return webdriver.Chrome(options=options, service=ChromeService(executable_path=driver_path) if driver_path else None)
    if name == "edge":
        options = webdriver.EdgeOptions()
        options.binary_location = binary
        options.add_argument(f"--user-data-dir={profile}")
        for flag in chromium_flags(workflow_rules, safe_mode=safe_mode):
            options.add_argument(flag)
        return webdriver.Edge(options=options, service=EdgeService(executable_path=driver_path) if driver_path else None)
    if name == "firefox":
        options = webdriver.FirefoxOptions()
        options.binary_location = binary
        options.add_argument("-profile")
        options.add_argument(str(profile))
        return webdriver.Firefox(options=options, service=FirefoxService(executable_path=driver_path) if driver_path else None)
    raise LiteError("selected browser cannot perform automated login")


def _remove_recovery_profile(path: Path, state: Path) -> None:
    try:
        path.relative_to(state)
    except ValueError as exc:
        raise LiteError("recovery profile escaped the trusted state root") from exc
    if path.is_symlink():
        raise LiteError("recovery profile must not be a symlink")
    if path.exists():
        _require_private_dir(path, "recovery profile")
        shutil.rmtree(path)


def replace_profile(primary: Path, recovery: Path, state: Path) -> None:
    backup = primary.parent / "profile-backup"
    if any(path.is_symlink() for path in (primary, recovery, backup)):
        raise LiteError("profile replacement refused a symlink")
    _require_private_dir(recovery, "recovery profile")
    if backup.exists():
        raise LiteError("profile replacement found a preserved backup; inspect it before retrying")
    moved_primary = False
    installed_recovery = False
    try:
        if primary.exists():
            _require_private_dir(primary, "Lite browser profile")
            os.replace(primary, backup)
            moved_primary = True
        os.replace(recovery, primary)
        installed_recovery = True
        _require_private_dir(primary, "Lite browser profile")
    except Exception as exc:
        try:
            if installed_recovery and primary.exists():
                _remove_recovery_profile(primary, state)
            if moved_primary and backup.exists():
                os.replace(backup, primary)
        except Exception as rollback_exc:
            raise LiteError("could not safely replace or restore the browser profile") from rollback_exc
        raise LiteError("could not safely replace the browser profile") from exc
    if backup.exists():
        _remove_recovery_profile(backup, state)


def login(
    state: Path,
    paths: dict[str, str],
    rules: dict[str, Any],
    browser: str,
    driver_path: str | None,
    status: Any = None,
    workflow_rules: dict[str, Any] | None = None,
) -> None:
    session_path, lite_root, _, profile = session_paths(state, paths)
    ensure_state_root(state)
    ensure_private_child(state, session_path.parent)
    ensure_private_child(state, lite_root)
    ensure_private_child(state, profile)
    validate_lite_layout(state, paths)
    selected, binary = select_browser(browser, rules, automated=True)
    with process_lock(lite_root / "login.lock", state):
        if status:
            status.update(
                "login",
                "请在打开的微信公众平台页面扫码并确认。",
                phase="qr",
                code="qr_required",
                next_action="scan and approve the QR code",
                terminal=False,
            )
        recovery_rules = (workflow_rules or {}).get("login_recovery", {})
        eligible = selected in recovery_rules.get("retry_browsers", [])
        max_retries = recovery_rules.get("max_retries", 0) if eligible else 0
        recovery_profile = lite_root / "recovery-profile"
        last_error: LoginError | None = None
        for attempt in range(max_retries + 1):
            attempt_profile = profile if attempt == 0 else recovery_profile
            if attempt > 0:
                _remove_recovery_profile(recovery_profile, state)
                ensure_private_child(state, recovery_profile)
            driver = None
            phase = "startup"
            try:
                driver = _create_driver(selected, binary, attempt_profile, driver_path, workflow_rules, safe_mode=attempt > 0)
                phase = "navigation"
                driver.get(LOGIN_URL)
                phase = "qr"
                deadline = time.monotonic() + 300
                token = ""
                while time.monotonic() < deadline:
                    try:
                        token = validate_login_result(driver.current_url)
                        break
                    except LiteError:
                        time.sleep(1)
                if not token:
                    raise LiteError("QR login timed out after 5 minutes")
                cookies = driver.get_cookies()
                user_agent = str(driver.execute_script("return navigator.userAgent"))
                if not cookies or not user_agent:
                    raise LiteError("browser login did not yield complete session data")
                if driver:
                    driver.quit()
                    driver = None
                if attempt > 0:
                    replace_profile(profile, recovery_profile, state)
                atomic_json(session_path, {"schema_version": 1, "token": token, "cookies": cookies, "user_agent": user_agent, "browser": selected, "saved_at": now_utc()}, state)
                return
            except BaseException as exc:
                if isinstance(exc, KeyboardInterrupt):
                    raise
                last_error = exc if isinstance(exc, LoginError) else classify_login_error(exc, phase)
            finally:
                if driver:
                    try:
                        driver.quit()
                    except Exception:
                        pass
            retryable = phase in ("startup", "navigation") and last_error.code in recovery_rules.get("retry_codes", [])
            if attempt >= max_retries or not retryable:
                _remove_recovery_profile(recovery_profile, state)
                if status:
                    status.update(
                        "failure",
                        last_error.summary,
                        phase=last_error.phase,
                        code=last_error.code,
                        next_action="run doctor --mode lite --json",
                        terminal=True,
                    )
                raise last_error
        raise last_error or LoginError("unknown", "browser login failed", "startup")


class LiteBackend:
    mode = "lite"

    def __init__(self, state: Path, paths: dict[str, str], timeout: float, rules: dict[str, Any], browser: str, driver_path: str | None):
        self.state = state
        self.paths = paths
        self.timeout = timeout
        self.rules = rules
        self.browser = browser
        self.driver_path = driver_path
        self.session = load_session(state, paths)
        self.client = LiteClient(self.session, timeout)
        self._fallback_used = False
        self._content_cache: dict[str, bytes] = {}

    def search_page(self, keyword: str, begin: int, size: int) -> dict[str, Any]:
        return self.client.search_page(keyword, begin, size)

    def article_page(self, fakeid: str, keyword: str, begin: int, size: int) -> dict[str, Any]:
        return self.client.article_page(fakeid, keyword, begin, size)

    def account_metadata(self, url: str, fakeid: str) -> dict[str, Any] | None:
        canonical = validate_article_url(url)
        document = self.client.content_html(canonical)
        self._content_cache[url] = document
        return extract_account_metadata(document, fakeid)

    def fetch_content(self, url: str, format_name: str) -> bytes:
        canonical = validate_article_url(url)
        try:
            document = self._content_cache.pop(url, None)
            return extract_content(document if document is not None else self.client.content_html(canonical), format_name)
        except LiteError as first:
            if self._fallback_used:
                raise first
            self._fallback_used = True
            return self._visible_fallback(canonical, format_name)

    def _visible_fallback(self, url: str, format_name: str) -> bytes:
        canonical = validate_article_url(url)
        validate_lite_layout(self.state, self.paths, require_session=True)
        _, lite_root, _, profile = session_paths(self.state, self.paths)
        selected = str(self.session.get("browser") or self.browser)
        selected, binary = select_browser(selected, self.rules, automated=True)
        with process_lock(lite_root / "browser.lock", self.state):
            try:
                driver = _create_driver(selected, binary, profile, self.driver_path)
            except LiteError:
                raise
            except Exception:
                raise LiteError("visible article fallback could not start") from None
            try:
                try:
                    driver.get(canonical)
                    deadline = time.monotonic() + min(self.timeout, 30)
                    source = b""
                    while time.monotonic() < deadline:
                        source = driver.page_source.encode("utf-8")
                        if b"js_content" in source:
                            break
                        time.sleep(0.5)
                    return extract_content(source, format_name)
                except LiteError:
                    raise
                except Exception:
                    raise LiteError("visible article fallback failed without logging the article URL") from None
            finally:
                try:
                    driver.quit()
                except Exception:
                    pass

    def auth_status(self) -> dict[str, Any]:
        return {"saved": True, "locally_valid": True, "online_verified": False, "browser": self.session.get("browser")}

    def redact_error(self, value: str) -> str:
        return _redact_error(value, self.session["token"])

    def clear_auth(self) -> None:
        path, _, _, _ = session_paths(self.state, self.paths)
        if path.exists():
            require_file(path)
            path.unlink()


def setup_lite(state: Path, paths: dict[str, str], lock_path: Path, runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run) -> dict[str, Any]:
    _, lite_root, _, profile = session_paths(state, paths)
    ensure_state_root(state)
    ensure_private_child(state, lite_root)
    ensure_private_child(state, profile)
    validate_lite_layout(state, paths)
    venv = lite_root / "venv"
    python312 = shutil.which("python3.12") or (str(Path.home() / ".local/bin/python3.12") if (Path.home() / ".local/bin/python3.12").is_file() else None)
    if not python312:
        raise LiteError("Python 3.12 is required for Lite setup")
    uv = shutil.which("uv") or (str(Path.home() / ".local/bin/uv") if (Path.home() / ".local/bin/uv").is_file() else None)
    if not (venv / "pyvenv.cfg").exists():
        command = [uv, "venv", "--python", python312, str(venv)] if uv else [python312, "-m", "venv", str(venv)]
        completed = runner(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if completed.returncode:
            raise LiteError("could not create the Lite virtual environment")
    vpython = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if uv:
        command = [uv, "pip", "install", "--python", str(vpython), "--require-hashes", "-r", str(lock_path)]
    else:
        command = [str(vpython), "-m", "pip", "install", "--require-hashes", "-r", str(lock_path)]
    completed = runner(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if completed.returncode:
        raise LiteError("could not install the hash-locked Lite dependencies")
    return {"python": str(vpython), "venv": str(venv), "installer": "uv" if uv else "venv/pip"}


def lite_ready(state: Path, paths: dict[str, str], rules: dict[str, Any], *, require_session: bool = False) -> bool:
    try:
        validate_lite_layout(state, paths, require_session=require_session)
        _, lite_root, _, _ = session_paths(state, paths)
        vpython = lite_root / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if not vpython.is_file():
            return False
        if not dependency_probe(state, paths)["installed"]:
            return False
        select_browser("auto", rules, automated=True)
    except LiteError:
        return False
    return True


def dependency_probe(state: Path, paths: dict[str, str]) -> dict[str, Any]:
    try:
        validate_lite_layout(state, paths)
    except LiteError:
        return {"installed": False, "python": "untrusted Lite state"}
    _, lite_root, _, _ = session_paths(state, paths)
    vpython = lite_root / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not vpython.is_file():
        return {"installed": False, "python": str(vpython)}
    script = (
        "import json,selenium,bs4,markdownify\n"
        "value={'selenium_version':selenium.__version__}\n"
        "try:\n"
        " from selenium.webdriver.common.selenium_manager import SeleniumManager\n"
        " value['selenium_manager_path']=str(SeleniumManager().get_binary())\n"
        "except Exception:\n"
        " value['selenium_manager_path']=None\n"
        "print(json.dumps(value,sort_keys=True))\n"
    )
    try:
        completed = subprocess.run(
            [str(vpython), "-c", script],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {"installed": False, "python": str(vpython)}
    result: dict[str, Any] = {"installed": completed.returncode == 0, "python": str(vpython)}
    if completed.returncode == 0:
        try:
            value = json.loads(completed.stdout)
        except json.JSONDecodeError:
            result["installed"] = False
        else:
            if isinstance(value, dict):
                result.update(value)
            else:
                result["installed"] = False
    return result
