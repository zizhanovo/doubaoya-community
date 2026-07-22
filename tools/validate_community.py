#!/usr/bin/env python3
"""Validate the publishable doubaoya-community Skill collection."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"
MP_ARK = SKILLS / "wechat-mp-exporter"
PROVENANCE = MP_ARK / "assets" / "vendor-provenance.json"
ROUTING = SKILLS / "doubaoya" / "references" / "wechat-routing.json"


class ValidationError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def require_exact_keys(value: dict[str, object], expected: set[str], label: str) -> None:
    actual = set(value)
    require(
        actual == expected,
        f"unexpected {label} keys: missing={sorted(expected - actual)}, extra={sorted(actual - expected)}",
    )


def display_path(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def load_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"invalid JSON: {display_path(path)}: {exc}") from exc


def frontmatter_name(path: Path) -> str:
    lines = path.read_text(encoding="utf-8").splitlines()
    require(bool(lines) and lines[0] == "---", f"missing frontmatter: {display_path(path)}")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValidationError(f"unclosed frontmatter: {display_path(path)}") from exc
    names = [line.split(":", 1)[1].strip() for line in lines[1:end] if line.startswith("name:")]
    require(len(names) == 1 and bool(names[0]), f"invalid name frontmatter: {display_path(path)}")
    descriptions = [line.split(":", 1)[1].strip() for line in lines[1:end] if line.startswith("description:")]
    require(len(descriptions) == 1, f"invalid description frontmatter: {display_path(path)}")
    return names[0]


def discover_skill_dirs(root: Path = ROOT) -> list[Path]:
    """Single source of truth for the Skill inventory: the ``skills/`` directory.

    Every published Skill is a ``skills/<name>/`` folder holding a ``SKILL.md``.
    Both the count and the name set are derived here so no hardcoded tally can
    drift out of sync with reality (it has, twice).
    """
    skills = root / "skills"
    return sorted(path for path in skills.iterdir() if path.is_dir() and (path / "SKILL.md").is_file())


def validate_skill_inventory(root: Path = ROOT) -> None:
    directories = discover_skill_dirs(root)
    require(bool(directories), "no Skills found under skills/")
    names: dict[str, Path] = {}
    for directory in directories:
        name = frontmatter_name(directory / "SKILL.md")
        require(name == directory.name, f"Skill folder/name mismatch: {directory.name} != {name}")
        require(name not in names, f"duplicate Skill frontmatter name: {name}")
        names[name] = directory
    require("wechat-mp-exporter" in names, "wechat-mp-exporter is not discoverable")


def validate_routing(root: Path = ROOT) -> None:
    routing_path = root / "skills" / "doubaoya" / "references" / "wechat-routing.json"
    routing = load_json(routing_path)
    require(isinstance(routing, dict), "wechat-routing.json must be an object")
    require_exact_keys(routing, {"schema_version", "routes", "precedence", "forbidden_misroutes"}, "routing")
    require(type(routing.get("schema_version")) is int and routing["schema_version"] == 1, "unsupported routing schema")
    routes = routing.get("routes")
    require(isinstance(routes, list) and routes, "routing routes must be a non-empty list")

    route_ids: set[str] = set()
    priorities: list[int] = []
    referenced_skills: set[str] = set()
    for route in routes:
        require(isinstance(route, dict), "each route must be an object")
        route_id = route.get("id")
        priority = route.get("priority")
        require(isinstance(route_id, str) and route_id and route_id not in route_ids, "route IDs must be unique strings")
        expected_keys = {
            "mp-ark-local-archive": {"id", "priority", "primary_skill", "use_when", "auth", "unsupported"},
            "doubaoya-cloud-public-data": {"id", "priority", "candidate_skills", "use_when", "auth"},
        }
        require(route_id in expected_keys, f"unknown route ID: {route_id}")
        require_exact_keys(route, expected_keys[route_id], f"route {route_id}")
        require(type(priority) is int, f"route priority must be an integer: {route_id}")
        route_ids.add(route_id)
        priorities.append(priority)
        primary = route.get("primary_skill")
        candidates = route.get("candidate_skills", [])
        require(primary is not None or candidates, f"route has no Skill target: {route_id}")
        if primary is not None:
            require(isinstance(primary, str) and primary, f"invalid primary Skill: {route_id}")
            referenced_skills.add(primary)
        require(isinstance(candidates, list) and all(isinstance(item, str) and item for item in candidates), f"invalid candidates: {route_id}")
        referenced_skills.update(candidates)
        auth = route.get("auth")
        require(isinstance(auth, dict) and type(auth.get("requires_doubaoya_api_key")) is bool, f"invalid auth contract: {route_id}")
        require_exact_keys(auth, {"type", "requires_doubaoya_api_key"}, f"auth contract {route_id}")
        require(isinstance(auth.get("type"), str) and auth["type"], f"invalid auth type: {route_id}")
        require(isinstance(route.get("use_when"), list) and route["use_when"], f"missing use_when: {route_id}")
        require(all(isinstance(item, str) and item for item in route["use_when"]), f"invalid use_when: {route_id}")

    require(priorities == sorted(priorities, reverse=True) and len(priorities) == len(set(priorities)), "routes must have unique descending priorities")
    require(route_ids == {"mp-ark-local-archive", "doubaoya-cloud-public-data"}, "required WeChat routes are missing")
    for skill_name in sorted(referenced_skills):
        require((root / "skills" / skill_name / "SKILL.md").is_file(), f"routing references missing Skill: {skill_name}")

    route_by_id = {route["id"]: route for route in routes}
    local = route_by_id["mp-ark-local-archive"]
    cloud = route_by_id["doubaoya-cloud-public-data"]
    metrics = {"read_count", "like_count", "recommend_count", "comment_count"}
    require(local["priority"] > cloud["priority"], "local archive route must precede the general cloud route")
    require(local["primary_skill"] == "wechat-mp-exporter", "local archive route must select wechat-mp-exporter")
    require(local["auth"] == {"type": "user-approved-wechat-qr", "requires_doubaoya_api_key": False}, "invalid local auth boundary")
    require(set(local["unsupported"]) == metrics and len(local["unsupported"]) == len(metrics), "local unsupported metrics are incomplete")
    require(cloud["auth"] == {"type": "doubaoya-api-key", "requires_doubaoya_api_key": True}, "invalid cloud auth boundary")

    local_intents = " ".join(local["use_when"]).lower()
    for intent in ("qr", "latest", "today", "article body", "archive", "without doubaoya_api_key"):
        require(intent in local_intents, f"local route is missing intent: {intent}")
    cloud_intents = " ".join(cloud["use_when"]).lower()
    for intent in ("public article", "without qr", "reading", "comment", "analysis"):
        require(intent in cloud_intents, f"cloud route is missing intent: {intent}")

    precedence = routing.get("precedence")
    require(isinstance(precedence, list) and all(isinstance(item, str) and item for item in precedence), "invalid precedence rules")
    precedence_text = " ".join(precedence).lower()
    for contract in ("highest-priority", "interaction-metric", "split the work", "capability boundary"):
        require(contract in precedence_text, f"precedence is missing contract: {contract}")

    forbidden = routing.get("forbidden_misroutes")
    require(isinstance(forbidden, list) and forbidden, "forbidden_misroutes must be non-empty")
    forbidden_by_route: dict[str, dict[str, object]] = {}
    for rule in forbidden:
        require(isinstance(rule, dict) and rule.get("from") in route_ids, "forbidden misroute references an unknown route")
        require_exact_keys(rule, {"from", "request_signals", "reason"}, f"forbidden misroute {rule.get('from')}")
        require(rule["from"] not in forbidden_by_route, f"duplicate forbidden misroute: {rule['from']}")
        require(isinstance(rule.get("request_signals"), list) and rule["request_signals"], "forbidden misroute needs signals")
        require(all(isinstance(item, str) and item for item in rule["request_signals"]), "invalid forbidden misroute signals")
        require(isinstance(rule.get("reason"), str) and rule["reason"], "forbidden misroute needs a reason")
        forbidden_by_route[rule["from"]] = rule

    require(set(forbidden_by_route) == route_ids, "each route needs one forbidden-misroute contract")
    local_metric_signals = {signal.replace(" ", "_") for signal in forbidden_by_route["mp-ark-local-archive"]["request_signals"]}
    require(local_metric_signals == metrics, "local forbidden-misroute metrics are incomplete")
    cloud_signals = " ".join(forbidden_by_route["doubaoya-cloud-public-data"]["request_signals"]).lower()
    for signal in ("local qr login", "local session", "resumable archive", "article body export"):
        require(signal in cloud_signals, f"cloud forbidden-misroute signals are missing: {signal}")

    doubaoya_text = (root / "skills" / "doubaoya" / "SKILL.md").read_text(encoding="utf-8")
    require("references/wechat-routing.json" in doubaoya_text, "doubaoya SKILL.md does not load the routing source")
    require("MP Ark" in doubaoya_text and "互动指标" in doubaoya_text, "doubaoya SKILL.md does not state the WeChat capability split")


def safe_vendor_path(value: object) -> str:
    require(isinstance(value, str) and value, "vendor path must be a non-empty string")
    path = PurePosixPath(value)
    require(not path.is_absolute() and ".." not in path.parts and "." not in path.parts, f"unsafe vendor path: {value}")
    require("\\" not in value and "\x00" not in value, f"unsafe vendor path: {value}")
    return value


def validate_vendor(root: Path = ROOT) -> None:
    skill = root / "skills" / "wechat-mp-exporter"
    provenance_path = skill / "assets" / "vendor-provenance.json"
    provenance = load_json(provenance_path)
    require(isinstance(provenance, dict), "vendor provenance must be an object")
    require_exact_keys(provenance, {"schema_version", "source_repository", "source_commit", "source_path", "files"}, "vendor provenance")
    require(type(provenance.get("schema_version")) is int and provenance["schema_version"] == 1, "unsupported provenance schema")
    require(provenance.get("source_repository") == "https://github.com/zizhanovo/mp-ark.git", "unexpected vendor source")
    require(provenance.get("source_commit") == "b80fa95350f22059a0937ff4a52a7aed0212c9db", "unexpected vendor commit")
    require(provenance.get("source_path") == "skills/wechat-mp-exporter", "unexpected vendor source path")
    files = provenance.get("files")
    require(isinstance(files, list) and files, "vendor file manifest must be non-empty")

    expected: dict[str, dict[str, object]] = {}
    for entry in files:
        require(isinstance(entry, dict), "vendor manifest entries must be objects")
        require_exact_keys(entry, {"path", "mode", "sha256"}, "vendor manifest entry")
        relative = safe_vendor_path(entry.get("path"))
        require(relative not in expected, f"duplicate vendor path: {relative}")
        require(entry.get("mode") in {"100644", "100755"}, f"invalid vendor mode: {relative}")
        require(isinstance(entry.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]), f"invalid vendor digest: {relative}")
        expected[relative] = entry

    provenance_relative = provenance_path.relative_to(skill).as_posix()
    require(not provenance_path.is_symlink() and provenance_path.is_file(), "vendor provenance must be a regular file")
    require(stat.S_IMODE(provenance_path.stat().st_mode) == 0o644, "vendor provenance mode mismatch")
    actual_paths: set[str] = set()
    for path in skill.rglob("*"):
        relative = path.relative_to(skill).as_posix()
        require(not path.is_symlink(), f"symlink is not publishable: {relative}")
        if path.is_file() and relative != provenance_relative:
            actual_paths.add(relative)
    require(actual_paths == set(expected), f"vendor file set mismatch: missing={sorted(set(expected) - actual_paths)}, extra={sorted(actual_paths - set(expected))}")

    for relative, entry in expected.items():
        path = skill / relative
        actual_mode = f"100{stat.S_IMODE(path.stat().st_mode):o}"
        require(actual_mode == entry["mode"], f"vendor mode mismatch: {relative}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        require(digest == entry["sha256"], f"vendor SHA-256 mismatch: {relative}")


def validate_readme(root: Path = ROOT) -> None:
    readme = (root / "README.md").read_text(encoding="utf-8")
    skill_dirs = discover_skill_dirs(root)
    count = len(skill_dirs)
    require(f"## 技能清单（共 {count} 个）" in readme, f"README Skill count is stale (expected 共 {count} 个)")
    listed_names = re.findall(r"^\| \*\*([^*]+)\*\*", readme, flags=re.MULTILINE)
    require(len(listed_names) == count, "README Skill inventory contains missing or duplicate rows")
    listed = set(listed_names)
    actual = {path.name for path in skill_dirs}
    require(listed == actual, f"README Skill inventory mismatch: missing={sorted(actual - listed)}, extra={sorted(listed - actual)}")
    install = "npx skills add https://github.com/zizhanovo/doubaoya-community --skill wechat-mp-exporter"
    require(readme.count(install) == 1, "README single-Skill install command is missing or duplicated")
    rows = re.findall(r"^\| \*\*wechat-mp-exporter\*\*.*$", readme, flags=re.MULTILINE)
    require(len(rows) == 1, "README must list wechat-mp-exporter exactly once")
    require("无需 `DOUBAOYA_API_KEY`" in rows[0] and "不支持阅读 / 点赞 / 评论数" in rows[0], "README MP Ark capability boundary is incomplete")


def publishable_files(root: Path = ROOT) -> list[Path]:
    git = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if git.returncode == 0:
        names = [part.decode("utf-8") for part in git.stdout.split(b"\0") if part]
        return sorted(root / name for name in names)
    return sorted(
        path for path in root.rglob("*")
        if ".git" not in path.relative_to(root).parts and (path.is_file() or path.is_symlink())
    )


def validate_artifacts(root: Path = ROOT) -> None:
    banned_parts = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "venv", "node_modules", "state", "runtime", "secrets", "profile", "mp-ark-archives"}
    banned_names = {".DS_Store", ".env", ".env.local", "session.json", "cookies.json", "auth-key", "runtime.json", "lock.json"}
    secret_patterns = (
        re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
        re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
        re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
        re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b"),
        re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b"),
    )
    developer_paths = (
        re.compile("/" + r"Users/[^/\s]+/"),
        re.compile("/" + r"home/[^/\s]+/"),
        re.compile(r"[A-Za-z]:[\\/]" + r"Users[\\/][^\\/:\s]+[\\/]"),
    )
    text_suffixes = {".md", ".py", ".yaml", ".yml", ".json", ".html", ".lock", ".patch", ".txt", ".mjs"}
    exact_scope = {
        Path("README.md"),
        Path("skills/doubaoya/SKILL.md"),
        Path("skills/doubaoya/references/wechat-routing.json"),
    }

    for path in publishable_files(root):
        relative = path.relative_to(root)
        in_scope = relative in exact_scope or relative.parts[:2] == ("skills", "wechat-mp-exporter") or relative.parts[:1] == ("tools",)
        if not in_scope:
            continue
        require(not path.is_symlink(), f"symlink is not publishable: {relative}")
        require(not (set(relative.parts) & banned_parts), f"runtime/cache artifact found: {relative}")
        require(path.is_file(), f"publishable path is not a file: {relative}")
        require(path.name not in banned_names and not path.name.startswith(".env."), f"secret/runtime artifact found: {relative}")
        if path.suffix.lower() not in text_suffixes and path.name not in {"LICENSE", ".gitignore"}:
            continue
        text = path.read_text(encoding="utf-8")
        for pattern in secret_patterns:
            require(not pattern.search(text), f"possible secret found: {relative}")
        for pattern in developer_paths:
            require(not pattern.search(text), f"developer path found: {relative}")


def validate_repository(root: Path = ROOT) -> None:
    validate_skill_inventory(root)
    validate_readme(root)
    validate_routing(root)
    validate_vendor(root)
    validate_artifacts(root)


def main() -> int:
    validate_repository()
    print(f"validated doubaoya-community: {len(discover_skill_dirs())} Skills, MP Ark vendor and WeChat routing")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as exc:
        print(f"validation error: {exc}", file=sys.stderr)
        raise SystemExit(1)
