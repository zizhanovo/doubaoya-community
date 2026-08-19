#!/usr/bin/env python3
"""把「我们发布过的每一版 skill」聚成一份闭集，写进仓库根 known-hashes.json。

    {"generatedAt": ..., "skills": {"<slug>": ["<hash>", ...]}}

哈希口径与 tools/stamp_versions.py 完全一致（sha256 覆盖 skills/<slug>/ 下除 .version
与点开头路径外的全部「文件名+内容」，取前 12 位），只不过这里的输入不是工作区，而是
**git 历史里每一个 commit 的 skills/ 目录**。

为什么必须走 git 历史、而不是 versions.json 的历史版本：
  versions.json 首次生成于 2026-07-28，而平台垂类是在 2026-07-14 的 19ee331
  「剪向公众号」里砍掉的——**砍在前、盖戳在后**。已下架的 slug 因此从来没进过任何一版
  versions.json，拿它当闭集会让所有陈旧包都判成「不认识」。而 skills/ 的 git 历史里
  它们完整躺着。实测 douyin-daily-hot / zhihu-rewrite / xiaohongshu-comment /
  video-downloader 在 19ee331^ 的哈希，与老用户机器上装着的那份逐位相同。

这份闭集是对账器判「这包是不是我们发的」的唯一依据（见 skills/dby-update/scripts/
reconcile.mjs）。**它必须随仓库发布**——用户机器上没有 git 历史，只能靠这个文件。

跑法（本仓库根目录）：python3 tools/build_known_hashes.py
ponytail: 与 stamp_versions.py 一样暂无 CI 钩子；升级路径 = push 前 CI 一起跑。
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "skills/"


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout


def _is_hashed(rel: str) -> bool:
    """与 stamp_versions._list_files 同一套排除规则。"""
    parts = rel.split("/")
    return not (
        rel == ".version"
        or "__pycache__" in parts
        or any(p.startswith(".") for p in parts)
    )


def collect_filesets() -> tuple[
    dict[str, set[tuple[tuple[str, str], ...]]], dict[str, str]
]:
    """扫全部 ref 的全部 commit，收集每个 slug 出现过的「文件集」（去重后再算哈希）。

    同一份 skills/<slug>/ 内容会在成百个 commit 里重复出现，先按 (相对路径, blob sha)
    的元组去重，能把上千次哈希计算压到几百次。

    顺带记下每个 slug **最后一版** SKILL.md 的 blob——已下架的包要靠它回答「这包当年调的是
    哪条能力」，那是 validate_community 那道「删包前能力必须仍可发现」闸的输入。
    `git rev-list` 默认按时间倒序，所以头一个见到的就是最后一版。
    """
    filesets: dict[str, set[tuple[tuple[str, str], ...]]] = {}
    latest_skill_md: dict[str, str] = {}
    for commit in _git("rev-list", "--all").split():
        listing = _git(
            "ls-tree", "-r", "--full-name", "--format=%(objectname) %(path)", commit, "--", PREFIX
        )
        per_slug: dict[str, list[tuple[str, str]]] = {}
        for line in listing.splitlines():
            if not line.strip():
                continue
            obj, path = line.split(" ", 1)
            tail = path[len(PREFIX):]
            slug, _, rel = tail.partition("/")
            if not rel or not _is_hashed(rel):
                continue
            if rel == "SKILL.md":
                latest_skill_md.setdefault(slug, obj)
            per_slug.setdefault(slug, []).append((rel, obj))
        for slug, files in per_slug.items():
            filesets.setdefault(slug, set()).add(tuple(sorted(files)))
    return filesets, latest_skill_md


def read_blobs(shas: set[str]) -> dict[str, bytes]:
    """一次 `git cat-file --batch` 把需要的 blob 全读出来（按 sha 天然去重）。"""
    if not shas:
        return {}
    ordered = sorted(shas)
    proc = subprocess.run(
        ["git", "cat-file", "--batch"],
        cwd=ROOT,
        input="\n".join(ordered).encode(),
        capture_output=True,
        check=True,
    )
    out, pos, blobs = proc.stdout, 0, {}
    for sha in ordered:
        nl = out.index(b"\n", pos)
        _, _, size = out[pos:nl].decode().split(" ")
        start = nl + 1
        blobs[sha] = out[start : start + int(size)]
        pos = start + int(size) + 1  # 内容后跟一个换行
    return blobs


# 已下架包当年引用的能力端点。取详情形态（去掉尾巴的 /call 与 /invoke），好和
# capability-index.md 里那一列直接比。
ENDPOINT = re.compile(r"/api/(?:skills/[A-Za-z0-9._~-]+|apis/[A-Za-z0-9._~-]+/[A-Za-z0-9._~-]+)")

# 已下架包当年声明的**触发词**。删包会顺手删掉一整片话术面，而 description 是 agent 选
# skill 那一刻唯一在场的东西——词没了，能力还在架也没人够得着。差集闸要拿它当 T_old。
#
# 🔴 只解析**显式结构**（`触发词：A、B、C` / `Trigger words: A / B / C`），**不做中文分词**。
#    分词不可靠，靠它取材等于让闸的判据自己漂——解析不到就当「该包没声明过触发词」，
#    由校验器报黄，而不是猜一个出来当真值。
# 🔴 标记有四种写法（`触发词` / `触发方式` / `Trigger words:` / 光秃秃的 `Trigger:`），
#    而且 description 是折叠式 YAML，列表会**跨行**——只认一种写法、或按行匹配，都会让
#    T_old 静默少收词，闸看着绿其实没看全。这正是本轮反复栽的形状，所以在**拼好的整段
#    description** 上匹配，并认全四种标记。
TRIGGER_LINE = re.compile(r"(?:触发词|触发方式|Trigger\s+words?|Trigger)\s*[:：]\s*(.+?)(?:。|\.\s*$|$)", re.S)
TRIGGER_SPLIT = re.compile(r"[、,，/]")


def _description(skill_md: str) -> str:
    """SKILL.md frontmatter 里 description 的完整正文（折叠块也拼回一行）。"""
    lines = skill_md.split("\n")
    if not lines or lines[0].strip() != "---":
        return ""
    try:
        end = lines.index("---", 1)
    except ValueError:
        return ""
    body, inside = [], False
    for line in lines[1:end]:
        if line.startswith("description:"):
            inside = True
            head = line.split(":", 1)[1].strip()
            if head not in ("", ">", ">-", "|", "|-"):
                body.append(head)
            continue
        if inside:
            if line[:1] not in (" ", "\t"):
                break
            body.append(line.strip())
    return " ".join(body)


def trigger_words(skill_md: str) -> list[str]:
    """从一份 SKILL.md 的 description 里取显式声明的触发词。"""
    found: set[str] = set()
    for match in TRIGGER_LINE.finditer(_description(skill_md)):
        for token in TRIGGER_SPLIT.split(match.group(1)):
            word = token.strip().strip("「」\"'").rstrip("。.").strip()
            # 一个触发词不会长过 20 字，也不会是整句英文说明
            if word and len(word) <= 20 and not word.startswith("http") and word.count(" ") <= 3:
                found.add(word)
    return sorted(found)


def build() -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, list[str]]]:
    filesets, latest_skill_md = collect_filesets()
    wanted = {sha for sets in filesets.values() for fs in sets for _, sha in fs}
    blobs = read_blobs(wanted | set(latest_skill_md.values()))

    known: dict[str, list[str]] = {}
    for slug, sets in filesets.items():
        hashes = set()
        for fs in sets:
            digest = hashlib.sha256()
            for rel, sha in fs:
                digest.update(rel.encode("utf-8"))
                digest.update(blobs[sha])
            hashes.add(digest.hexdigest()[:12])
        known[slug] = sorted(hashes)

    current = {p.name for p in (ROOT / "skills").iterdir() if (p / "SKILL.md").is_file()}
    endpoints = {
        slug: sorted(set(ENDPOINT.findall(blobs[latest_skill_md[slug]].decode("utf-8", "replace"))))
        for slug in sorted(set(known) - current)
        if slug in latest_skill_md
    }
    triggers = {
        slug: words
        for slug in sorted(set(known) - current)
        if slug in latest_skill_md
        and (words := trigger_words(blobs[latest_skill_md[slug]].decode("utf-8", "replace")))
    }
    return dict(sorted(known.items())), endpoints, triggers


def main() -> int:
    known, endpoints, triggers = build()
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "skills": known,
        "retiredEndpoints": endpoints,
        "retiredTriggerWords": triggers,
    }
    (ROOT / "known-hashes.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    pairs = sum(len(v) for v in known.values())
    current = {p.name for p in (ROOT / "skills").iterdir() if (p / "SKILL.md").is_file()}
    print(
        f"known-hashes.json: {len(known)} 个 slug（其中 {len(set(known) - current)} 个已下架）, "
        f"{pairs} 个历史版本"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
