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

--check 查两件事，顺序有讲究：
  ① **版本表声明的 ref 在远端有没有 tag** —— 没有就是 dby-update 全线 clone 失败，
     所有用户更新不了。这条最致命，所以排在最前面。
  ② 已有的 tag 是否都有对应的 Release。

依赖 `gh` CLI 且需已登录。只动 GitHub；Gitee 只作镜像，不建发行版（`dby-update` 回退
镜像时读的是 tag，不读 Release）。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.json"

# 标题里出现这些包名时，把它当作"这一版的主角"——它们是用户直接使用的入口，
# 而不是被别的包带着一起 bump 的。主角决定标题怎么写。
# 「入口包」——用户直接使用的那些。只有它们的 major 才顶整体主版本号。
# dby-update / dby-gateway 是基础设施：它们的破坏性变更（改安装机制、改协议措辞）
# 用户是无感的，顶主版本号只会制造"这东西又大改了"的错觉。
# 实测差别：按"任何包 major"算，五天从 v1 跑到 v5；按入口包算是 v1→v3，
# 两次 major 都是 dby-publish 真的删了东西（主题副本、出图栈），用户确实会被影响。
ENTRY_PACKAGES = frozenset({
    "dby", "dby-write", "dby-publish", "dby-feedback",
    "dby-rewrite", "dby-charter", "dby-banned-words", "dby-theme", "dby-image",
})

HEADLINE_PRIORITY = (
    "dby-feedback", "dby-write", "dby-publish", "dby-image", "dby-rewrite",
    "dby-banned-words", "dby-charter", "dby-theme", "dby", "dby-api", "dby-update", "dby-gateway",
)  # 覆盖全部 12 个包（dby-image 2026-09 随服务端生图能力恢复而重建）——漏一个就会退化成「更新 1 个 skill」这种没信息量的标题


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


def build_title(index: dict, ref: str, rows: list[tuple[str, dict]], suite: str = "") -> str:
    """标题规则（唯一实现，别在别处再写一份）：

    1. 有新包 → 「新增 <包名>：<它的 changelog 第一句>」——新包是这版最值得说的事
    2. 否则挑一个主角包 → 「<displayName>——<changelog 第一句>」
    3. 都没有 → 「更新 N 个 skill」

    🔴 主角句里**不写包自己的 semver**。前缀 `suite` 已经是整体版本号（v4.2.0），
    再跟一个包版本就成了「v4.2.0：都爆鸭 · 新媒体数据总入口 4.5.0——…」——
    一个标题里两个号，读的人要先分辨哪个才是这一版。包版本在正文每段标题里有。
    """
    new_pkgs = [s for s, _ in rows if is_new_package(index, s, ref)]
    # 🔴 只有"这一版里少数几个是新包"才配说「新增 X」。首发批（所有包都是第一次发）
    #    说「新增 dby」是误导——那一版是整套一起出生，不是给已有的一套添了个 dby。
    if new_pkgs and len(new_pkgs) < len(rows):
        slug = new_pkgs[0]
        entry = dict(rows)[slug]
        return f"{suite}：新增 {slug}——{first_clause(entry.get('changelog', ''))}"
    if new_pkgs and len(new_pkgs) == len(rows):
        return f"{suite}：首发 {len(rows)} 个都爆鸭 skill"

    for want in HEADLINE_PRIORITY:
        for slug, entry in rows:
            if slug == want:
                name = index["skills"][slug].get("displayName") or slug
                return f"{suite}：{name}——{first_clause(entry.get('changelog', ''))}"

    return f"{suite}：更新 {len(rows)} 个 skill"


def first_clause(text: str, limit: int = 40) -> str:
    """取 changelog 里第一个**有信息量**的短句做标题尾巴。

    标题要短，正文才展开——一条一百多字的技术腔标题会把 Releases 页整行撑爆。

    🔴 三个坑都踩过：
    - 切出来的片段太短（「首版」两个字）不能直接采用，也不能因此回退到"截断整串"——
      要**跳过它继续往后找**下一段。实测 dby-feedback 的 changelog 是「首版——三类反馈…」，
      不跳过就会得到「新增 dby-feedback——首版——三类反馈…」这种双破折号标题。
    - 片段**太长**则相反：只能截断它自己，**不能**跳到后面的碎片。后面的碎片是细节，
      脱离上下文就没意义。实测 dby-api 4.5.0：主线「只能走代理出网的机器…不用改环境就能用」
      42 字、刚过 limit，被跳过后取到了第三段「只认 http(s)」——一个协议校验细节冒充了标题。
    - 片段首尾可能挂着断点符号，拼接前要剥掉，否则和外层的连接符撞在一起。
    - 切分和截断都可能把「（」和它的「）」劈开，留下「…（三档」这种半拉括号。
      闭合的括号（`http(s)`）要原样留着，只剥末尾那个没合上的。
    """
    text = (text or "").strip()
    if not text:
        return ""
    # 按所有断点切碎，取第一个**有信息量**的段：太短的（如「首版」）跳过继续找，
    # 太长的就地截断——它已经是主线，越往后越碎。
    parts = re.split(r"——|—|；|;|。|，|：|,", text)
    for part in parts:
        part = part.strip().strip("—-：: ")
        if len(part) < 6:
            continue
        if len(part) <= limit:
            return _drop_dangling_paren(part)
        # 放不下时先扔掉括号里的举例（正文完整保留），扔完往往就够了——
        # 实测 dby-api 4.5.0 的主线 42 字里，「（受管企业网、CI 容器、agent 沙箱）」
        # 一个人就占 22 字；剥掉是 20 字的完整句，比硬切在「就…」强。
        short = re.sub(r"[（(][^）)]*[）)]", "", part).strip()
        if 6 <= len(short) <= limit:
            return short
        return _drop_dangling_paren(part[:limit].strip().strip("—-：: ")) + "…"
    # 全是太短的碎片才截断整串——这是最后手段，不是首选。
    tail = "…" if len(text) > limit else ""
    return _drop_dangling_paren(text[:limit].strip().strip("—-：: ")) + tail


def _drop_dangling_paren(s: str) -> str:
    """剥掉末尾那个没合上的左括号及其后面的残句；闭合的括号一个不动。"""
    for lp, rp in (("（", "）"), ("(", ")")):
        i = s.rfind(lp)
        if i != -1 and s.find(rp, i) == -1:
            s = s[:i]
    return s.strip().strip("—-、，,：: ")


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


def bump_kind(prev: str | None, cur: str) -> str:
    """这个包这一版是什么档。prev 为 None = 首次发布。"""
    if prev is None:
        return "new"
    p = [int(x) for x in prev.split(".")]
    c = [int(x) for x in cur.split(".")]
    if c[0] > p[0]:
        return "major"
    if c[1] > p[1]:
        return "minor"
    return "patch"


def suite_versions(index: dict) -> dict[str, str]:
    """给每个 ref 算一个整体版本号 `vX.Y.Z`——**推导出来的，不是手填的**。

    规则：
      - 入口包（ENTRY_PACKAGES）有 major ⇒ 整体 major
      - 否则有 minor 或新包        ⇒ 整体 minor
      - 全是 patch                 ⇒ 整体 patch

    为什么要有这个号：每个包各有各的 semver，用户装的却是一整套，
    他需要一个"我现在在哪一版"的说法。而这个号必须**可推导**——
    手填的整体号跟包版本对不上时，没人知道该信哪个。

    🔴 这个函数从完整历史重算，所以是确定性的：同样的 index.json 永远得到同样的序列。
    不落盘存储也不会漂。代价是改规则会让历史号整体位移——真要改规则，
    得同时用 --overwrite 重刷全部 Release，别让新旧两套号混在一页上。
    """
    hist: dict[str, list[tuple[str, str | None, str]]] = {}
    for slug, meta in index["skills"].items():
        versions = meta.get("versions") or []
        for i, entry in enumerate(versions):
            prev = versions[i + 1]["version"] if i + 1 < len(versions) else None
            hist.setdefault(entry["ref"], []).append((slug, prev, entry["version"]))

    out: dict[str, str] = {}
    major, minor, patch = 1, 0, 0
    refs = sorted(hist)
    for i, ref in enumerate(refs):
        rows = [(slug, bump_kind(prev, cur)) for slug, prev, cur in hist[ref]]
        if i == 0:
            pass  # 首发就是 v1.0.0
        elif any(k == "major" and slug in ENTRY_PACKAGES for slug, k in rows):
            major, minor, patch = major + 1, 0, 0
        elif any(k in ("minor", "new") for _, k in rows):
            minor, patch = minor + 1, 0
        else:
            patch += 1
        out[ref] = f"v{major}.{minor}.{patch}"
    return out


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
    ap.add_argument("--all", action="store_true", help="补齐所有缺的；配 --overwrite 则重刷全部")
    ap.add_argument("--tag", help="只处理这一个 tag")
    ap.add_argument("--overwrite", action="store_true", help="已存在也重建（改文案用）")
    args = ap.parse_args()

    if not sh("which", "gh", check=False).strip():
        print("🔴 找不到 gh CLI。装了才能同步 Release：https://cli.github.com", file=sys.stderr)
        return 2

    index = load_index()
    suite_map = suite_versions(index)
    have = existing_releases()
    tags = remote_tags()
    missing = [t for t in tags if t not in have]

    if args.check:
        # 🔴 先查这条：**版本表声明的安装源 ref，远端到底有没有这个 tag。**
        # 它比「tag 有没有 Release」更靠前，也更致命——dby-update 按
        # `owner/repo#<ref>` 固定安装源，ref 不存在就是 clone 失败，**所有用户都更新不了**，
        # 而本命令此前只查「已有的 tag 是否都有 Release」，看不见「声明了但没打的 tag」。
        # 2026-08-31 至 09-10 整整十天就栽在这个盲区里：index.json 写着
        # release-20260831-0756，本地与两个远端都没有这个 tag，期间每一次
        # stamp_versions.py 都打印过「必须 git tag 并推」，每一次推送也都提示过
        # 「别忘了同步 Release」——两句提醒都指着这件事，但没有任何一道闸会红。
        declared = index.get("ref")
        if isinstance(declared, str) and declared.startswith("release-") and declared not in tags:
            print(f"🔴 版本表声明的安装源 ref **在远端没有对应 tag**：{declared}")
            print("   后果不是「Release 页面不好看」，是 dby-update 直接 clone 失败 ⇒ 所有用户都更新不到新版。")
            print(f"   补：git tag {declared} && git push origin {declared} && git push gitee {declared}")
            print("   打完 tag 再跑一次本命令补 Release。")
            return 1

        if missing:
            print(f"🔴 {len(missing)} 个 tag 没有对应的 Release：")
            for t in missing:
                print(f"   {t}")
            print("\n   补齐：python3 tools/sync_releases.py --all")
            return 1
        print(f"✅ 版本表声明的 ref {index.get('ref')} 有 tag；{len(tags)} 个 tag 都有对应的 Release。")
        return 0

    # 🔴 `--all --overwrite` 得是「全部重刷」，不能还只盯 missing。改标题规则之后
    #    必须整页刷一遍，否则新旧两套标题混在同一页上；而 missing 这时恰恰是空的，
    #    命令会静静地什么都不做、再打印「没指定要做什么」，看着像参数打错了。
    if args.tag:
        targets = [args.tag]
    elif args.all:
        targets = tags if args.overwrite else missing
    else:
        targets = []
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

        suite = suite_map.get(ref, "")
        title = build_title(index, ref, rows, suite)
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
