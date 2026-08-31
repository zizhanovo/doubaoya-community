#!/usr/bin/env python3
"""把 GitHub Releases 与 tag 对齐——**内容从 index.json 生成，不手写**。

## 为什么要有这个

tag 和 Release 是两码事：`git push` 只推 tag，Release 是 GitHub 自己的一层，要单独建。
于是很容易出现"tag 推了、Release 忘了建"，Releases 页比 tag 列表少一截。

而**手写 Release notes 必然漂**：本仓实测过四种标题风格混在一起——
「新增 dby-feedback：遇到问题可以直接报给作者了」（人话）、
「v1.0.1：更新 3 个 skill：…」（带 v 号）、「更新 2 个 skill：…」（机械）、
以及一条一百多字的技术腔。同一个 Releases 页四种口径，用户读起来像四个人在写。

🔴 根治办法不是"下次注意"，是**不给手写的机会**：每个包每版的 `changelog` 已经是人写的、
存在 `index.json` 里、且被 `dby-update` 用来念给用户听——Release notes 直接从它生成，
风格由这个脚本唯一决定。要改文案就去改 changelog，那里改了 dby-update 的提示也跟着对。

## 用法

    python3 tools/sync_releases.py --check          # 只报差异，不动远端（CI / 提交前用）
    python3 tools/sync_releases.py --tag <ref>      # 补建某一个
    python3 tools/sync_releases.py --all            # 补齐所有缺的
    python3 tools/sync_releases.py --tag <ref> --overwrite   # 重建已存在的（修文案用）

退出码：0 = 无差异或已补齐；1 = 有缺失（--check 模式下）；2 = 环境问题（无 gh / 未登录）。

依赖 `gh` CLI 且需已登录。只动 GitHub；Gitee 只作镜像，不建发行版（`dby-update` 回退
镜像时读的是 tag，不读 Release）。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.json"

# 标题里出现这些包名时，把它当作"这一版的主角"——它们是用户直接使用的入口，
# 而不是被别的包带着一起 bump 的。主角决定标题怎么写。
HEADLINE_PRIORITY = (
    "dby-feedback", "dby-write", "dby-publish", "dby-image", "dby-rewrite",
    "dby-banned-words", "dby-charter", "dby-theme", "dby", "dby-api", "dby-update", "dby-gateway",
)  # 覆盖全部 12 个包——漏一个就会退化成「更新 1 个 skill」这种没信息量的标题


def sh(*args: str, check: bool = True) -> str:
    r = subprocess.run(args, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit(f"命令失败：{' '.join(args)}\n{r.stderr.strip()}")
    return r.stdout


def load_index() -> dict:
    return json.loads(INDEX.read_text(encoding="utf-8"))


def packages_of(index: dict, ref: str) -> list[tuple[str, dict]]:
    """这个 ref 发布了哪些包（按 slug 排序）。

    🔴 要遍历**全部历史版本**，不能只看 versions[0]。versions[0] 是该包的当前版，
    补建老 tag 的 Release 时它早被后续版本顶掉了——只查 [0] 会让所有老 tag 都"查不到包"。
    """
    out = []
    for slug, meta in index["skills"].items():
        for entry in meta.get("versions") or []:
            if entry.get("ref") == ref:
                out.append((slug, entry))
                break
    return sorted(out)


def is_new_package(index: dict, slug: str, ref: str) -> bool:
    """这个 ref 是不是该包的**首次**发布——首发要在标题里说「新增」。"""
    versions = index["skills"][slug].get("versions") or []
    # 最老的那条（数组尾部）就是首发。不能用 len==1 判断——包发过第二版之后就永远不成立了。
    return bool(versions) and versions[-1].get("ref") == ref


def build_title(index: dict, ref: str, rows: list[tuple[str, dict]]) -> str:
    """标题规则（唯一实现，别在别处再写一份）：

    1. 有新包 → 「新增 <包名>：<它的 changelog 第一句>」——新包是这版最值得说的事
    2. 否则挑一个主角包 → 「<displayName> <版本>：<changelog 第一句>」
    3. 都没有 → 「更新 N 个 skill」

    刻意不带 `v1.0.1` 这种整体版本号：本仓没有"仓库版本"这个概念，
    每个包各有各的 semver，硬造一个整体号会让用户以为包之间要对齐。
    """
    new_pkgs = [s for s, _ in rows if is_new_package(index, s, ref)]
    # 🔴 只有"这一版里少数几个是新包"才配说「新增 X」。首发批（所有包都是第一次发）
    #    说「新增 dby」是误导——那一版是整套一起出生，不是给已有的一套添了个 dby。
    if new_pkgs and len(new_pkgs) < len(rows):
        slug = new_pkgs[0]
        entry = dict(rows)[slug]
        return f"新增 {slug}：{first_clause(entry.get('changelog', ''))}"
    if new_pkgs and len(new_pkgs) == len(rows):
        return f"首发：{len(rows)} 个都爆鸭 skill"

    for want in HEADLINE_PRIORITY:
        for slug, entry in rows:
            if slug == want:
                name = index["skills"][slug].get("displayName") or slug
                return f"{name} {entry['version']}：{first_clause(entry.get('changelog', ''))}"

    return f"更新 {len(rows)} 个 skill"


def first_clause(text: str, limit: int = 40) -> str:
    """取 changelog 的第一个短句做标题尾巴。

    标题要短，正文才展开——一条一百多字的技术腔标题在 Releases 页会把整行撑爆。
    """
    text = (text or "").strip()
    # 从最"硬"的断点往下试：破折号 > 分号 > 句号 > 逗号。取第一个落在长度区间里的。
    for sep in ("——", "—", "；", ";", "。", "，", "：", ","):
        if sep in text:
            head = text.split(sep)[0].strip()
            if 4 <= len(head) <= limit:
                return head
    return text[:limit] + ("…" if len(text) > limit else "")


def build_notes(index: dict, ref: str, rows: list[tuple[str, dict]]) -> str:
    """正文：新包单独成段（用户最需要知道多了什么），其余按包列 changelog。"""
    lines: list[str] = []

    new_pkgs = [(s, e) for s, e in rows if is_new_package(index, s, ref)]
    updated = [(s, e) for s, e in rows if not is_new_package(index, s, ref)]

    for slug, entry in new_pkgs:
        name = index["skills"][slug].get("displayName") or slug
        lines.append(f"## 新增 {slug} {entry['version']}\n")
        lines.append(f"{name}\n")
        lines.append(f"{entry.get('changelog', '').strip()}\n")

    if updated:
        lines.append("## 更新\n")
        for slug, entry in updated:
            log = (entry.get("changelog") or "").strip()
            lines.append(f"- **{slug}** {entry['version']} —— {log}")
        lines.append("")

    lines.append("## 怎么更新\n")
    lines.append("```")
    lines.append("/dby-update")
    lines.append("```")
    return "\n".join(lines) + "\n"


def existing_releases() -> set[str]:
    out = sh("gh", "release", "list", "--limit", "200", "--json", "tagName", check=False)
    if not out.strip():
        return set()
    return {r["tagName"] for r in json.loads(out)}


def remote_tags() -> list[str]:
    out = sh("git", "ls-remote", "--tags", "origin")
    tags = set()
    for line in out.splitlines():
        if "refs/tags/release-" not in line:
            continue
        name = line.split("refs/tags/")[-1].removesuffix("^{}")
        tags.add(name)
    return sorted(tags)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只报差异，不动远端")
    ap.add_argument("--all", action="store_true", help="补齐所有缺的")
    ap.add_argument("--tag", help="只处理这一个 tag")
    ap.add_argument("--overwrite", action="store_true", help="已存在也重建（改文案用）")
    args = ap.parse_args()

    if not sh("which", "gh", check=False).strip():
        print("🔴 找不到 gh CLI。装了才能同步 Release：https://cli.github.com", file=sys.stderr)
        return 2

    index = load_index()
    have = existing_releases()
    tags = remote_tags()
    missing = [t for t in tags if t not in have]

    if args.check:
        if missing:
            print(f"🔴 {len(missing)} 个 tag 没有对应的 Release：")
            for t in missing:
                print(f"   {t}")
            print("\n   补齐：python3 tools/sync_releases.py --all")
            return 1
        print(f"✅ {len(tags)} 个 tag 都有对应的 Release。")
        return 0

    targets = [args.tag] if args.tag else (missing if args.all else [])
    if not targets:
        print("没指定要做什么。用 --check 看差异、--all 补齐、--tag <ref> 处理单个。")
        return 0

    for ref in targets:
        rows = packages_of(index, ref)
        if not rows:
            # 索引里查不到这个 ref —— 多半是很早以前、盖戳机制上线前的 tag。
            # 不凭空编一个 Release notes，如实跳过并说明。
            print(f"⏭  {ref}：index.json 里没有挂在这个 ref 上的包，跳过（早于盖戳机制的 tag）")
            continue

        title = build_title(index, ref, rows)
        notes = build_notes(index, ref, rows)

        if ref in have:
            if not args.overwrite:
                print(f"⏭  {ref}：已存在（要改文案加 --overwrite）")
                continue
            sh("gh", "release", "edit", ref, "--title", title, "--notes", notes)
            print(f"♻️  {ref}：已重建 —— {title}")
        else:
            sh("gh", "release", "create", ref, "--title", title, "--notes", notes)
            print(f"✅ {ref}：已创建 —— {title}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
