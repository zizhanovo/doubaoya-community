#!/usr/bin/env python3
"""仓库根 `index.json`：每个 skill 元信息的唯一事实源（规格见 openspec/changes/unify-skill-index）。

结构（以 slug 为键）：

    {
      "schemaVersion": 1,
      "generatedAt": "...", "ref": "release-YYYYMMDD-HHMM", "owner": "doubaoya",
      "_legacyReadme": {"renames": [...], "clawhub": [...]},     # 生成旧文件时原样带回去
      "skills": {
        "<slug>": {
          "displayName": "...", "topics": [...],
          "status": "active" | "renamed" | "merged" | "retired",
          "redirectTo": "<slug>",            # renamed / merged 必填
          "userFiles": [...],                # 可选，改名迁移时要搬的用户文件
          "knownHashes": ["<hash12>", ...],  # git 历史闭集，build_known_hashes.py 填
          "versions": [                      # 盖过戳的发布版，头部是当前版，stamp_versions.py 填
            {"version": "1.2.3", "hash": "...", "ref": "release-...", "releasedAt": "...",
             "changelog": "...", "changelogSource": "user" | "auto"}
          ],
          "history": [...],                  # 可选，git 历史里每一版的 {hash, version, date, subject}
          "retiredEndpoints": [...],         # 可选，已下架包当年调的端点
          "retiredTriggerWords": [...]       # 可选，已下架包当年声明的触发词
        }
      }
    }

哪些字段谁写：
  - 人手写：displayName / topics / status / redirectTo / userFiles / owner / _legacyReadme
  - stamp_versions.py 写：versions / generatedAt / ref（新目录出现时会补一条骨架条目，displayName 先等于 slug）
  - build_known_hashes.py 写：knownHashes / history / retiredEndpoints / retiredTriggerWords

过渡期四个旧文件（versions.json / known-hashes.json / renames.json / tools/clawhub.json）
全部由本模块的 derive_views 从索引生成，形状与从前逐字段一致——装在用户机器上的老对账器
还在按 raw URL 读它们。第二趟发布后删掉 derive_views 与那四个文件。

ponytail: frontmatter 仍按行扫描解析（不引 YAML 库），changelog 只支持单行或 `>-` 折叠块，
与 validate_community 的 description 解析同一口径；升级路径 = 三处解析器合并成一个模块。
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

INDEX_NAME = "index.json"
SCHEMA_VERSION = 1
STATUSES = ("active", "renamed", "merged", "retired")
REDIRECT_STATUSES = ("renamed", "merged")
CHANGELOG_SOURCES = ("user", "auto")
REF_PATTERN = re.compile(r"^release-\d{8}-\d{4}$")
HASH_PATTERN = re.compile(r"^[0-9a-f]{12}$")
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")

ENTRY_KEYS = (
    "displayName", "topics", "status", "redirectTo", "userFiles",
    "knownHashes", "versions", "history", "retiredEndpoints", "retiredTriggerWords",
)
ENTRY_REQUIRED = ("displayName", "topics", "status", "knownHashes", "versions")
VERSION_KEYS = ("version", "hash", "ref", "releasedAt", "changelog", "changelogSource")
VIEW_PATHS = ("versions.json", "known-hashes.json", "renames.json", "tools/clawhub.json")

# 旧文件里的 _readme 原样保留在生成物里——老对账器不读它，但人读；索引缺这一段时用这份模板。
LEGACY_README = {
    "renames": [
        "这是 dby-update 对账器（skills/dby-update/scripts/reconcile.mjs）读的改名表：上游把某个 slug 改名（或合并进另一个 slug）之后，靠这张表告诉本机用户机器上的对账器该把老目录搬到哪。",
        "谁读它：只有 reconcile.mjs 会拉这份文件；本仓其余脚本/文档不依赖它。",
        "userFiles 的语义：老目录里属于用户本地数据的相对路径列表（文件或以 / 结尾的目录）。对账器只搬「老目录有、上游新包没有」的那些文件——上游新包自带的默认内容（比如内置主题）不会被老副本覆盖，用户自己留下的东西才会被搬走。",
        "本文件由 tools/skill_index.py 从仓库根 index.json 生成（过渡期兼容视图），别手改——改 index.json 里对应条目的 status/redirectTo/userFiles。",
    ],
    "clawhub": [
        "ClawHub 上架清单：每个 skills/<slug>/ 目录在这里有且只有一条元数据。",
        "为什么需要它：clawhub CLI 不读 SKILL.md 的 frontmatter，displayName 由 slug 机械 title-case 而来",
        "（wechat-cover -> 'Wechat Cover'），必须用 --name 显式覆盖，否则商店卡片上是一串没人搜得到的英文。",
        "owner 是发布者 handle：ClawHub 的 slug 按 owner 分命名空间（canonical URL = /<owner>/skills/<slug>），",
        "带 --owner 发布可以避开已被他人占用的裸 slug。",
        "本文件由 tools/skill_index.py 从仓库根 index.json 生成（过渡期兼容视图），别手改——改 index.json 里对应条目的 displayName/topics。",
    ],
}

# semver 档位 → 占位 changelog。作者没写时用它，并标 changelogSource: auto。
AUTO_CHANGELOG = {
    "major": "契约变更，老用法可能失效（作者未写变更说明，按 major 档位自动生成）",
    "minor": "新增能力或向后兼容的行为变化（作者未写变更说明，按 minor 档位自动生成）",
    "patch": "措辞、修补或补例子，行为不变（作者未写变更说明，按 patch 档位自动生成）",
    "first": "首次盖戳发布（作者未写变更说明，自动生成）",
    "none": "内容有更新但语义版本未递增（作者未写变更说明，自动生成；semver 闸会拦）",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def dumps(obj: object) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


# ── frontmatter ──────────────────────────────────────────────────────────────

def frontmatter_lines(text: str) -> list[str]:
    """`---` 之间的行；没有 frontmatter 时返回空列表。"""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return []
    try:
        end = lines.index("---", 1)
    except ValueError:
        return []
    return lines[1:end]


def frontmatter_field(text: str, key: str) -> str:
    """取 frontmatter 某个键的完整正文：单行值，或 `>-` / `|` 块标量（缩进行拼成一行）。
    与 validate_community.frontmatter_description 同一解析口径。没有该键返回空串。"""
    lines = frontmatter_lines(text)
    prefix = f"{key}:"
    for index, line in enumerate(lines):
        if not line.startswith(prefix):
            continue
        head = line[len(prefix):].strip()
        body = [] if head in ("", ">", ">-", "|", "|-") else [head]
        for follow in lines[index + 1:]:
            if follow[:1] not in (" ", "\t"):
                break
            body.append(follow.strip())
        return " ".join(part for part in body if part)
    return ""


def read_frontmatter(skill_md: Path) -> dict[str, str]:
    text = skill_md.read_text(encoding="utf-8") if skill_md.is_file() else ""
    return {key: frontmatter_field(text, key) for key in ("name", "version", "changelog")}


# ── semver / changelog ───────────────────────────────────────────────────────

def bump_product_version(current: str | None, batch_levels: list[str]) -> str:
    """产品级版本递增：批次含 skill major → 产品 minor+1（patch 归零）；其余变更 → patch+1；
    无变更由调用方保证不调本函数。字段缺失（首次）→ 1.0.0。产品 major 只由维护者手改，这里不动。"""
    if not current or not SEMVER.match(current):
        return "1.0.0"
    major, minor, patch = (int(x) for x in SEMVER.match(current).groups())
    if any(l == "major" for l in batch_levels):
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def bump_level(new: str, previous: str | None) -> str:
    """两个 semver 之间的档位：major / minor / patch / first（无上一版）/ none（没递增或不合法）。"""
    if not previous:
        return "first"
    a, b = SEMVER.match(new or ""), SEMVER.match(previous)
    if not a or not b:
        return "none"
    n, p = [int(x) for x in a.groups()], [int(x) for x in b.groups()]
    if n <= p:
        return "none"
    if n[0] != p[0]:
        return "major"
    if n[1] != p[1]:
        return "minor"
    return "patch"


def auto_changelog(new: str, previous: str | None) -> str:
    return AUTO_CHANGELOG[bump_level(new, previous)]


# ── 索引读写 ──────────────────────────────────────────────────────────────────

def new_entry(slug: str, status: str = "active") -> dict:
    return {"displayName": slug, "topics": [], "status": status, "knownHashes": [], "versions": []}


def empty_index(*, ref: str | None = None, owner: str = "doubaoya") -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": now_iso(),
        "ref": ref or "",
        "owner": owner,
        "_legacyReadme": {key: list(value) for key, value in LEGACY_README.items()},
        "skills": {},
    }


def load_index(path: Path) -> dict | None:
    """读索引；文件不在或不是合法 JSON 对象都返回 None（形状问题由 validate_community 报）。"""
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) and isinstance(parsed.get("skills"), dict) else None


def load_or_bootstrap(path: Path) -> dict:
    """索引在就读它；不在就从四个旧文件一次性迁移出初版（都不在 = 全新仓库，给空索引）。"""
    return load_index(path) or bootstrap_from_legacy(path.parent)


def _ordered_entry(entry: dict) -> dict:
    ordered = {key: entry[key] for key in ENTRY_KEYS if key in entry}
    ordered.update({key: value for key, value in entry.items() if key not in ordered})
    return ordered


def normalize(index: dict) -> dict:
    """键序固定、slug 排序——两个生成器交替写同一份文件，产物才不会来回 churn。"""
    head = {key: index[key] for key in ("schemaVersion", "generatedAt", "ref", "owner", "_legacyReadme") if key in index}
    head.update({key: value for key, value in index.items() if key not in head and key != "skills"})
    head["skills"] = {slug: _ordered_entry(entry) for slug, entry in sorted(index["skills"].items())}
    return head


def save_index(index: dict, path: Path) -> dict:
    ordered = normalize(index)
    path.write_text(dumps(ordered), encoding="utf-8")
    return ordered


# ── 从旧文件一次性迁移 ────────────────────────────────────────────────────────

def _read_json(path: Path) -> dict:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def bootstrap_from_legacy(root: Path) -> dict:
    """从 versions.json / known-hashes.json / renames.json / tools/clawhub.json 生成初版索引。

    ponytail: 只在 index.json 不存在时走一次（回滚 = 删 index.json 再跑一次生成器）；
    第二趟发布删旧文件后本函数只剩「空索引」一条路，届时整段删掉。
    """
    versions = _read_json(root / "versions.json")
    known = _read_json(root / "known-hashes.json")
    renames = _read_json(root / "renames.json")
    clawhub = _read_json(root / "tools" / "clawhub.json")

    index = empty_index(ref=versions.get("ref") or None, owner=clawhub.get("owner") or "doubaoya")
    for key in ("renames", "clawhub"):
        readme = (renames if key == "renames" else clawhub).get("_readme")
        if isinstance(readme, list):
            index["_legacyReadme"][key] = readme
    skills = index["skills"]

    for slug, hashes in (known.get("skills") or {}).items():
        entry = skills.setdefault(slug, new_entry(slug, "retired"))
        entry["knownHashes"] = list(hashes)
    for slug, log in (known.get("versionLog") or {}).items():
        skills.setdefault(slug, new_entry(slug, "retired"))["history"] = log
    for field in ("retiredEndpoints", "retiredTriggerWords"):
        for slug, value in (known.get(field) or {}).items():
            skills.setdefault(slug, new_entry(slug, "retired"))[field] = value

    for slug, meta in (clawhub.get("skills") or {}).items():
        entry = skills.setdefault(slug, new_entry(slug))
        entry["status"] = "active"
        entry["displayName"] = meta.get("displayName") or slug
        entry["topics"] = list(meta.get("topics") or [])

    for old_slug, target in (renames.get("renames") or {}).items():
        entry = skills.setdefault(old_slug, new_entry(old_slug, "renamed"))
        # 同一个新包吸收了多个旧 slug 时，第一个是改名主体，其余是被合并进去的（unify-dby-naming 的口径）。
        siblings = [s for s, t in renames["renames"].items() if t.get("to") == target.get("to")]
        entry["status"] = "renamed" if siblings[0] == old_slug else "merged"
        entry["redirectTo"] = target.get("to", "")
        entry["userFiles"] = list(target.get("userFiles") or [])

    stamped_at = versions.get("generatedAt") or index["generatedAt"]
    for slug, value in (versions.get("skills") or {}).items():
        entry = skills.setdefault(slug, new_entry(slug))
        entry["status"] = "active"
        current_hash = value.rsplit("@", 1)[-1]
        fm = read_frontmatter(root / "skills" / slug / "SKILL.md")
        dated = {h["hash"]: h.get("date", "") for h in entry.get("history", [])}
        entry["versions"] = [{
            "version": fm["version"],
            "hash": current_hash,
            "ref": index["ref"],
            "releasedAt": dated.get(current_hash) or stamped_at,
            "changelog": fm["changelog"] or AUTO_CHANGELOG["first"],
            "changelogSource": "user" if fm["changelog"] else "auto",
        }]
    return normalize(index)


# ── 兼容视图 ──────────────────────────────────────────────────────────────────

def active_entries(index: dict) -> dict[str, dict]:
    return {slug: e for slug, e in sorted(index["skills"].items()) if e.get("status") == "active"}


def derive_views(index: dict) -> dict[str, dict]:
    """四个旧文件的内容，形状与从前逐字段一致。键名即相对仓库根的路径。"""
    skills = dict(sorted(index["skills"].items()))
    readme = index.get("_legacyReadme") or {}
    versions_view = {
        "generatedAt": index.get("generatedAt", ""),
        "ref": index.get("ref", ""),
        "skills": {
            slug: f"doubaoya-skill/{slug}@{entry['versions'][0]['hash']}"
            for slug, entry in skills.items()
            if entry.get("status") == "active" and entry.get("versions")
        },
    }
    known_view = {
        "generatedAt": index.get("generatedAt", ""),
        "skills": {slug: list(e["knownHashes"]) for slug, e in skills.items() if e.get("knownHashes")},
        "retiredEndpoints": {slug: e["retiredEndpoints"] for slug, e in skills.items() if "retiredEndpoints" in e},
        "retiredTriggerWords": {slug: e["retiredTriggerWords"] for slug, e in skills.items() if "retiredTriggerWords" in e},
        "versionLog": {slug: e["history"] for slug, e in skills.items() if e.get("history")},
    }
    renames_view = {
        "schema_version": 1,
        "_readme": list(readme.get("renames") or LEGACY_README["renames"]),
        "renames": {
            slug: {"to": e.get("redirectTo", ""), "userFiles": list(e.get("userFiles") or [])}
            for slug, e in skills.items()
            if e.get("status") in REDIRECT_STATUSES
        },
    }
    clawhub_view = {
        "schema_version": 1,
        "_readme": list(readme.get("clawhub") or LEGACY_README["clawhub"]),
        "owner": index.get("owner", "doubaoya"),
        "skills": {
            slug: {"displayName": e.get("displayName", slug), "topics": list(e.get("topics") or [])}
            for slug, e in skills.items()
            if e.get("status") == "active"
        },
    }
    return {
        "versions.json": versions_view,
        "known-hashes.json": known_view,
        "renames.json": renames_view,
        "tools/clawhub.json": clawhub_view,
    }


def write_views(index: dict, root: Path) -> list[Path]:
    written = []
    for relative, payload in derive_views(index).items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(dumps(payload), encoding="utf-8")
        written.append(path)
    return written


def view_drift(index: dict, root: Path) -> dict[str, list[str]]:
    """每个视图文件与索引派生结果的差异，按「顶层键[.子键]」列出；空 dict = 一致。"""
    drift: dict[str, list[str]] = {}
    for relative, expected in derive_views(index).items():
        actual = _read_json(root / relative)
        diffs = []
        for key in sorted(set(expected) | set(actual)):
            left, right = expected.get(key), actual.get(key)
            if left == right:
                continue
            if isinstance(left, dict) and isinstance(right, dict):
                diffs += [f"{key}.{sub}" for sub in sorted(set(left) | set(right)) if left.get(sub) != right.get(sub)]
            else:
                diffs.append(key)
        if diffs:
            drift[relative] = diffs
    return drift


def self_check() -> None:
    """离线自检：解析器、档位、视图往返各验一次。"""
    text = "---\nname: a\ndescription: >-\n  折叠\n  两行\nversion: 1.2.3\nchangelog: 单行说明\n---\n"
    assert frontmatter_field(text, "description") == "折叠 两行"
    assert frontmatter_field(text, "changelog") == "单行说明"
    assert frontmatter_field(text, "missing") == ""
    folded = "---\nchangelog: >-\n  第一行\n  第二行\n---\n"
    assert frontmatter_field(folded, "changelog") == "第一行 第二行"
    assert bump_level("2.0.0", "1.9.9") == "major"
    assert bump_level("1.10.0", "1.9.0") == "minor"
    assert bump_level("1.0.1", "1.0.0") == "patch"
    assert bump_level("1.0.0", None) == "first"
    assert bump_level("1.0.0", "1.0.0") == "none"
    index = empty_index(ref="release-20000101-0000")
    index["skills"]["a"] = {**new_entry("a"), "knownHashes": ["0" * 12], "versions": [{
        "version": "1.0.0", "hash": "0" * 12, "ref": index["ref"], "releasedAt": "x",
        "changelog": "c", "changelogSource": "user"}]}
    index["skills"]["old"] = {**new_entry("old", "renamed"), "redirectTo": "a", "userFiles": ["cfg.json"]}
    views = derive_views(index)
    assert views["versions.json"]["skills"] == {"a": "doubaoya-skill/a@000000000000"}
    assert views["renames.json"]["renames"] == {"old": {"to": "a", "userFiles": ["cfg.json"]}}
    assert set(views["tools/clawhub.json"]["skills"]) == {"a"}
    assert set(views["known-hashes.json"]) == {"generatedAt", "skills", "retiredEndpoints", "retiredTriggerWords", "versionLog"}
    print("skill_index self-check ok")


if __name__ == "__main__":
    self_check()
