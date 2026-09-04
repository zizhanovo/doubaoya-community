#!/usr/bin/env python3
"""从两个 release tag 的 index.json 差异生成 GitHub Release 的标题与正文。

用法：
    python3 tools/release_notes.py <tag> [<prev-tag>]   # prev 省略 = 按 tag 名排序取上一个
输出：第一行标题，空行，之后是 Markdown 正文。
退出码：0 成功；2 用法错；3 该 tag 早于索引机制（无 index.json，正常跳过）；
        其余非零 = 真失败。3 必须与 1/2 区分开——调用方（.github/workflows/release.yml）
        只吞 3；若与 traceback 的 1 混用，任何崩溃都会被当成「tag 太老」而静默绿灯。
为什么读 index.json 而不读 commit log：索引里每个 skill 的 versions[] 本来就带
人写的 changelog（谁、从几到几、改了什么），commit log 是给维护者看的。
"""
from __future__ import annotations

import json
import subprocess
import sys

REPO_URL = "https://github.com/zizhanovo/doubaoya-community"


def _git_show(ref: str, path: str) -> dict | None:
    res = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
    if res.returncode != 0:
        return None
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError:
        return None


def _versions(index: dict | None, slug: str) -> list[dict]:
    entry = ((index or {}).get("skills") or {}).get(slug) or {}
    return [v for v in entry.get("versions") or [] if isinstance(v, dict)]


def build_notes(cur: dict, prev: dict | None) -> tuple[str, str]:
    """返回 (title, body)。cur/prev 是两个 tag 上的 index.json（prev 可为 None = 首个 tag）。"""
    skills = cur.get("skills") or {}
    changed: list[tuple[str, str, list[dict]]] = []  # (slug, displayName, 新增的版本条目 新→旧)
    for slug, entry in sorted(skills.items()):
        if entry.get("status") != "active":
            continue
        prev_hashes = {v.get("hash") for v in _versions(prev, slug)}
        fresh = [v for v in _versions(cur, slug) if v.get("hash") not in prev_hashes]
        if fresh:
            changed.append((slug, entry.get("displayName") or slug, fresh))
    retired = sorted(
        slug for slug, e in skills.items()
        if e.get("status") != "active"
        and prev is not None and (((prev.get("skills") or {}).get(slug) or {}).get("status") == "active")
    )

    if prev is None:
        title = "首次盖戳发布：全集 %d 个 skill" % sum(1 for e in skills.values() if e.get("status") == "active")
    elif len(changed) == 1:
        slug, name, fresh = changed[0]
        title = f"{name}（{slug}）{fresh[0].get('version', '?')}：{fresh[0].get('changelog', '')}"
    elif changed:
        title = "更新 %d 个 skill：%s" % (len(changed), "、".join(s for s, _, _ in changed))
    elif retired:
        title = "下架归档 %d 个：%s" % (len(retired), "、".join(retired))
    else:
        title = "元数据维护（无 skill 内容变更）"

    lines: list[str] = []
    for slug, name, fresh in changed:
        old = _versions(prev, slug)
        frm = old[0].get("version") if old else None
        to = fresh[0].get("version", "?")
        head = f"- **{name}（`{slug}`）** {frm + ' → ' if frm else ''}{to}"
        lines.append(head)
        for v in fresh:
            tag = "（占位文案）" if v.get("changelogSource") == "auto" else ""
            lines.append(f"  - {v.get('version', '?')}：{v.get('changelog', '（无变更说明）')}{tag}")
    if retired:
        lines.append("- 下架归档：" + "、".join(f"`{s}`" for s in retired))
    if not lines:
        lines.append("- 版本表 / 元数据维护，skill 内容无变更。")
    body = "\n".join(lines)
    return title, body


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    tag = sys.argv[1]
    prev_tag = sys.argv[2] if len(sys.argv) > 2 else None
    if prev_tag is None:
        tags = sorted(subprocess.run(["git", "tag", "-l", "release-*"], capture_output=True, text=True, check=True).stdout.split())
        earlier = [t for t in tags if t < tag]
        prev_tag = earlier[-1] if earlier else None
    cur = _git_show(tag, "index.json")
    if cur is None:
        print(f"{tag} 上没有 index.json（早于索引机制的 tag），不生成", file=sys.stderr)
        return 3  # 专用码：只有这一种情况允许调用方当成「跳过」而非失败
    prev = _git_show(prev_tag, "index.json") if prev_tag else None
    title, body = build_notes(cur, prev)
    pv = cur.get("productVersion")
    if isinstance(pv, str) and pv:
        title = f"v{pv}：{title}"
    if prev_tag:
        body += f"\n\n**Full Changelog**: {REPO_URL}/compare/{prev_tag}...{tag}"
    print(title)
    print()
    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
