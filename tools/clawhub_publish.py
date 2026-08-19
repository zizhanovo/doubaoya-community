#!/usr/bin/env python3
"""把 skills/ 下的每个 Skill 发到 ClawHub（clawhub.ai）。

为什么不是一句 `clawhub sync`：
  - `sync` 不接受 `--name`，displayName 会由 slug 机械 title-case（`wechat-cover` -> `Wechat Cover`），
    商店卡片上就是一串没人搜得到的英文；本仓的 Skill 名是中文的，必须逐个 `--name` 显式给。
  - ClawHub **不读** SKILL.md 的 frontmatter（displayName 只来自 `--name`，version 只来自
    `--version` 或自动递补），所以元数据必须外置——就是 tools/clawhub.json 这份清单。
  - 裸 slug 是全局先到先得，本仓有一批 slug 已被别的发布者占用；带 `--owner` 发布走
    `/<owner>/skills/<slug>` 命名空间，能绕开占用。

单一事实源：`tools/clawhub.json`。每个 `skills/<slug>/` 目录在清单里有且只有一条，
两边对不上就直接失败（这个仓库的清单已经漂移过两次，见 validate_community 里的同类校验）。

发布闸：SKILL.md 的 frontmatter description 正文以 `⛔ 已下架` 开头的，一律**不发**——
连打印出来的命令里都不会有它（不然那行命令会被人复制到终端里跑掉）。挂牌写在 SKILL.md 里，
所以能力重新上架时删掉标记就自动放行，不用改这个脚本，也不用维护第二份下架名单。

跑法（仓库根目录）：
    python3 tools/clawhub_publish.py                 # 只打印将要执行的命令，不联网
    python3 tools/clawhub_publish.py --dry-run       # 交给 clawhub 自己做 --dry-run 预检（联网、只读）
    python3 tools/clawhub_publish.py --execute       # 真发布（需要先 clawhub login）
    python3 tools/clawhub_publish.py --self-check    # 不碰网络的自检
    python3 tools/clawhub_publish.py --only wechat-cover --only doubaoya   # 只发指定几个

前置（人工，一次性）：
    clawhub login                    # 设备流，浏览器里用 GitHub 账号授权
    clawhub publisher create doubaoya    # 建发布者组织，handle 要与 clawhub.json 的 owner 一致
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "tools" / "clawhub.json"
SOURCE_REPO = "https://github.com/zizhanovo/doubaoya-community"

# 下架标记：SKILL.md frontmatter 的 description **正文开头**写 `⛔ 已下架`。
# 位置锚定 + 固定记号，不是关键词模糊匹配——正文里随便提到「下架」「不可用」都不会误伤，
# 只有作者在 description 头部主动挂牌才算数。能力修好把这行标记删掉，闸自动放行，不需要改代码，
# 也不需要第二份名单（名单必然漂移，本仓的清单已经漂移过两次）。
RETIRED_MARKER = re.compile(r"^⛔\s*已下架")


class ManifestError(RuntimeError):
    pass


def load_manifest(path: Path = MANIFEST) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1:
        raise ManifestError(f"unsupported clawhub manifest schema: {manifest.get('schema_version')}")
    owner = manifest.get("owner")
    if not isinstance(owner, str) or not owner:
        raise ManifestError("clawhub manifest needs a non-empty owner handle")
    skills = manifest.get("skills")
    if not isinstance(skills, dict) or not skills:
        raise ManifestError("clawhub manifest needs a non-empty skills map")
    for slug, entry in skills.items():
        if not isinstance(entry, dict):
            raise ManifestError(f"clawhub manifest entry must be an object: {slug}")
        name = entry.get("displayName")
        if not isinstance(name, str) or not name.strip():
            raise ManifestError(f"clawhub manifest entry needs a displayName: {slug}")
        topics = entry.get("topics", [])
        if not isinstance(topics, list) or not all(isinstance(t, str) and t.strip() for t in topics):
            raise ManifestError(f"clawhub manifest topics must be non-empty strings: {slug}")
    return manifest


def discover_slugs(root: Path = ROOT) -> list[str]:
    skills = root / "skills"
    return sorted(p.name for p in skills.iterdir() if p.is_dir() and (p / "SKILL.md").is_file())


def check_coverage(manifest: dict, slugs: list[str]) -> None:
    """清单与 skills/ 目录必须一一对应——多一个少一个都算漂移。"""
    listed = set(manifest["skills"])
    actual = set(slugs)
    if listed != actual:
        raise ManifestError(
            "clawhub manifest drifted from skills/: "
            f"missing={sorted(actual - listed)}, extra={sorted(listed - actual)}"
        )


def frontmatter_description(path: Path) -> str:
    """SKILL.md frontmatter 里 description 的正文首行。

    本仓的 description 常写成 YAML 折叠块（``description: >-`` 后面跟缩进正文），
    所以不能只取冒号后面那半行——那样拿到的是 ``>-``，挂牌永远读不出来。
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "---":
        return ""
    try:
        end = lines.index("---", 1)
    except ValueError:
        return ""
    for index in range(1, end):
        if not lines[index].startswith("description:"):
            continue
        inline = lines[index].split(":", 1)[1].strip()
        if inline and inline[0] not in "|>":  # 普通单行 description
            return inline
        for follow in lines[index + 1 : end]:  # 折叠/字面块：取第一行有字的正文
            if follow.strip():
                return follow.strip()
        return ""
    return ""


def retirement_reason(slug: str, root: Path = ROOT) -> str | None:
    """这个 Skill 挂了下架牌吗？挂了就返回一句人话原因，没挂返回 None。"""
    description = frontmatter_description(root / "skills" / slug / "SKILL.md")
    if not RETIRED_MARKER.match(description):
        return None
    excerpt = description if len(description) <= 48 else description[:48] + "…"
    return f"SKILL.md 的 description 开头挂着「⛔ 已下架」牌：{excerpt}"


def partition_publishable(slugs: list[str], root: Path = ROOT) -> tuple[list[str], list[tuple[str, str]]]:
    """把待发清单劈成「可发」与「被闸拒掉」两半。

    一条坏的不该阻断全部：被拒的单独列出来，其余照发。
    """
    publishable: list[str] = []
    refused: list[tuple[str, str]] = []
    for slug in slugs:
        reason = retirement_reason(slug, root=root)
        if reason is None:
            publishable.append(slug)
        else:
            refused.append((slug, reason))
    return publishable, refused


def report_refusals(refused: list[tuple[str, str]]) -> None:
    if not refused:
        return
    print(f"\n# 发布闸拒绝了 {len(refused)} 个已下架的 Skill（其余不受影响）：", file=sys.stderr)
    for slug, reason in refused:
        print(f"#   ⛔ {slug}：{reason}", file=sys.stderr)
    print("#   能力重新上架后，删掉 SKILL.md description 里的下架标记即可自动放行。", file=sys.stderr)


def git_commit(root: Path = ROOT) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
        text=True,
    )
    return result.stdout.strip() or None if result.returncode == 0 else None


def build_command(
    manifest: dict,
    slug: str,
    *,
    root: Path = ROOT,
    clawhub: str = "clawhub",
    commit: str | None = None,
    dry_run: bool = False,
) -> list[str]:
    entry = manifest["skills"][slug]
    command = [
        clawhub, "skill", "publish", str(root / "skills" / slug),
        "--owner", manifest["owner"],
        "--slug", slug,
        "--name", entry["displayName"],
        "--source-repo", SOURCE_REPO,
        "--source-ref", "main",
        "--source-path", f"skills/{slug}",
    ]
    if entry.get("topics"):
        command += ["--topics", ",".join(entry["topics"])]
    if commit:
        command += ["--source-commit", commit]
    if dry_run:
        command.append("--dry-run")
    return command


def self_check() -> None:
    """无网络自检：清单结构、漂移检测、命令拼装各验一次。"""
    manifest = load_manifest()
    check_coverage(manifest, discover_slugs())

    fake = {"schema_version": 1, "owner": "acme", "skills": {"a": {"displayName": "甲", "topics": ["x"]}}}
    try:
        check_coverage(fake, ["a", "b"])
    except ManifestError as exc:
        assert "missing=['b']" in str(exc), exc
    else:  # pragma: no cover - 只有 check_coverage 坏掉才会走到
        raise AssertionError("check_coverage 没能发现缺失的 Skill")

    command = build_command(fake, "a", root=Path("/tmp/repo"), commit="deadbeef", dry_run=True)
    assert command[:3] == ["clawhub", "skill", "publish"], command
    assert "--owner" in command and command[command.index("--owner") + 1] == "acme", command
    assert command[command.index("--name") + 1] == "甲", command
    assert command[command.index("--topics") + 1] == "x", command
    assert command[command.index("--source-commit") + 1] == "deadbeef", command
    assert command[-1] == "--dry-run", command

    no_topics = {"schema_version": 1, "owner": "acme", "skills": {"a": {"displayName": "甲"}}}
    assert "--topics" not in build_command(no_topics, "a"), "没有 topics 时不该传空 --topics"

    # 发布闸：真仓库里挂了下架牌的都得被拦下，其余照发。
    publishable, refused = partition_publishable(discover_slugs())
    assert publishable, "发布闸把所有 Skill 都拦下了，这不对"
    for slug, reason in refused:
        assert "已下架" in reason, (slug, reason)
    print(f"发布闸：{len(publishable)} 个可发，{len(refused)} 个已下架被拒 {[slug for slug, _ in refused]}")

    print("self-check ok")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--execute", action="store_true", help="真的执行发布（默认只打印命令）")
    parser.add_argument("--dry-run", action="store_true", help="执行 clawhub 自带的 --dry-run 预检（联网只读）")
    parser.add_argument("--only", action="append", default=[], metavar="SLUG", help="只处理指定 Skill（可重复）")
    parser.add_argument("--clawhub", default="clawhub", help="clawhub 可执行文件（默认 clawhub）")
    parser.add_argument("--self-check", action="store_true", help="跑离线自检后退出")
    args = parser.parse_args()

    if args.self_check:
        self_check()
        return 0

    manifest = load_manifest()
    slugs = discover_slugs()
    check_coverage(manifest, slugs)

    if args.only:
        unknown = sorted(set(args.only) - set(slugs))
        if unknown:
            raise ManifestError(f"unknown Skill slugs: {unknown}")
        slugs = [slug for slug in slugs if slug in set(args.only)]

    # 发布闸排在拼命令之前：已下架的 Skill 连打印出来的命令都不该有，
    # 否则那行命令会被人直接复制到终端里跑掉。
    slugs, refused = partition_publishable(slugs)

    commit = git_commit()
    commands = [
        build_command(manifest, slug, clawhub=args.clawhub, commit=commit, dry_run=args.dry_run)
        for slug in slugs
    ]

    # 点名要发一个被拒的 Skill，却什么都没发生——退 0 等于骗人。
    refused_by_name = sorted({slug for slug, _ in refused} & set(args.only))

    if not (args.execute or args.dry_run):
        for command in commands:
            print(" ".join(f"'{part}'" if " " in part else part for part in command))
        print(f"\n# {len(commands)} 条命令（未执行）。加 --dry-run 联网预检，加 --execute 真发布。", file=sys.stderr)
        report_refusals(refused)
        return 1 if refused_by_name else 0

    failed: list[str] = []
    for slug, command in zip(slugs, commands):
        print(f"==> {slug}", flush=True)
        if subprocess.run(command, check=False).returncode != 0:
            failed.append(slug)
    print(f"\ndone: {len(slugs) - len(failed)} ok, {len(failed)} failed, {len(refused)} refused")
    report_refusals(refused)
    if failed:
        print(f"failed: {failed}", file=sys.stderr)
        return 1
    return 1 if refused_by_name else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ManifestError as exc:
        print(f"clawhub manifest error: {exc}", file=sys.stderr)
        raise SystemExit(1)
