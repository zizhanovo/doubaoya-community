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


# 🔴 必须用 -z。git 默认开着 core.quotePath：路径里只要有一个非 ASCII 字符，
# ls-tree 就把整条路径**加引号并转义成八进制**（`"skills/x/references/B\347\253\231.md"`）。
# 那个前导引号会让下面 `path[len(PREFIX):]` 整体错位一格，切出一个**空 slug**——
# 而且这个包的文件集会**少掉所有中文名文件**，于是它的哈希算错。
# 后果不是报错，是**静默认不出包**：known-hashes.json 是用户机对账认领旧包的闭集，
# 当前版哈希不在闭集里，reconcile 就当它是陌生包。
# 实测：加 references/公众号.md 这类文件之后，dby-rewrite（历史名字已改名）的当前哈希直接不在闭集里。
# 🔑 关掉引号要的是 `-c core.quotePath=false`，**`-z` 单独不够**——它只换了记录分隔符，
# `%(path)` 照样转义（试过，当场被下面那条断言拦住）。`-z` 仍然留着，它挡的是
# 路径含换行那种病态情况。下面那条断言是这套解析唯一的活口：路径形状再变，它当场喊。
def tree_listing(commit: str) -> str:
    """列出某个 commit 下 skills/ 的全部 (blob, 路径)，NUL 分隔、**不转义**。"""
    return _git(
        "-c", "core.quotePath=false",
        "ls-tree", "-r", "-z", "--full-name", "--format=%(objectname) %(path)", commit, "--", PREFIX
    )


def collect_filesets() -> tuple[
    dict[str, set[tuple[tuple[str, str], ...]]],
    dict[str, str],
    dict[tuple[str, tuple[tuple[str, str], ...]], str],
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
    # (slug, fileset) → 该内容**最早**出现在哪个 commit。
    # rev-list 默认时间倒序，所以一路覆盖下去，留下的自然是最早那个 ——
    # 那才是"这一版是什么时候发布的"，用最后一次会把日期记成它被重复出现的那天。
    first_commit: dict[tuple[str, tuple[tuple[str, str], ...]], str] = {}
    # 🔴 除了已提交历史，还要把**暂存区**当成"下一个 commit"算进来。
    #
    # 缺陷实证（2026-08-22，doubaoyahub-82 发现并复现）：本脚本走 rev-list --all，
    # 只看**已提交**历史 —— 而它在 pre-commit 里跑，那一刻当前改动还没进历史 ⇒
    # **钩子在结构上永远收不进自己这一笔的哈希**。
    # 平时看不出来（下一笔顺手补上），危险的是**发布前的最后一笔**：那一版的哈希永远缺席，
    # 而闭集是随仓库发到用户机器的（用户那儿没有 git 历史，只能靠这个文件）。
    # 后果延迟且静默：等下一版发出去，这一版成了"历史版本"却不在闭集 ⇒
    # 三值裁决判成伪造哈希 ⇒ **停在这一版的用户永远收不到更新提示**。
    #
    # `git write-tree` 把索引物化成一棵真 tree，喂给同一个 tree_listing —— 零口径分叉。
    # 提交后 rev-list 会看到同一棵树，所以重算结果不变（幂等，文件不 churn）。
    revs = _git("rev-list", "--all").split()
    staged = ""
    try:
        staged = _git("write-tree").strip()
        if staged:
            revs = [staged] + revs
    except Exception:  # noqa: BLE001 —— 非 git 环境/无索引时照旧只走历史，不该因此炸
        staged = ""
    for commit in revs:
        listing = tree_listing(commit)
        per_slug: dict[str, list[tuple[str, str]]] = {}
        for line in listing.split("\0"):
            if not line.strip():
                continue
            obj, path = line.split(" ", 1)
            assert path.startswith(PREFIX), f"ls-tree 给了个没头没脑的路径：{path!r}"
            tail = path[len(PREFIX):]
            slug, _, rel = tail.partition("/")
            if not rel or not _is_hashed(rel):
                continue
            if rel == "SKILL.md":
                latest_skill_md.setdefault(slug, obj)
            per_slug.setdefault(slug, []).append((rel, obj))
        for slug, files in per_slug.items():
            key = tuple(sorted(files))
            filesets.setdefault(slug, set()).add(key)
            # 暂存区那棵树**不是 commit**，取不到日期与标题 —— 只让它贡献「哈希进闭集」
            # （承重的那一半），不进 versionLog。否则会写出一条 date/subject 皆空的记录，
            # 空日期还会把它排到最前，产出随之不幂等（实测：skills 相同、versionLog 不同）。
            if commit != staged:
                first_commit[(slug, key)] = commit
    return filesets, latest_skill_md, first_commit


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


def commit_meta(shas: set) -> dict:
    """一次 git log 把需要的 commit 的日期与标题读出来。"""
    if not shas:
        return {}
    out = _git("show", "--no-patch", "--format=%H%x1f%cI%x1f%s", *sorted(shas))
    meta = {}
    for line in out.split("\n"):
        if line.count("\x1f") == 2:
            sha, date, subject = line.split("\x1f")
            meta[sha] = {"date": date[:10], "subject": subject}
    return meta


def semver_of(blob: bytes) -> str:
    """从那一版 SKILL.md 的 frontmatter 里取语义版本；没有就留空。

    🔴 **留空而不是编一个**：早期版本发布时 frontmatter 里根本没有 version，
    追认一个假的会让「1.4.0 → 2.0.0」这类跨度说明凭空多出没发生过的中间版本。
    """
    for line in blob.decode("utf-8", "replace").split("\n")[:40]:
        t = line.lstrip()
        if t.startswith("version:"):
            v = t[len("version:"):].strip()
            return v if re.fullmatch(r"\d+\.\d+\.\d+", v) else ""
        if t == "---" and line is not t:
            break
    return ""


def build() -> tuple[dict, dict, dict, dict]:
    filesets, latest_skill_md, first_commit = collect_filesets()
    wanted = {sha for sets in filesets.values() for fs in sets for _, sha in fs}
    blobs = read_blobs(wanted | set(latest_skill_md.values()))

    known: dict[str, list[str]] = {}
    # 🔴 versionLog 是**兄弟键**，`skills` 的形状一个字节不动。
    #    已安装的 dby-update 做的是 knownHashes[name].includes(hash)（reconcile.mjs:121）——
    #    把数组元素从字符串改成对象，那一行当场失效，所有历史包被判成 foreign，
    #    **每一台已安装的机器对账全错**。所以新信息只能加在旁边，不能改原地。
    version_log: dict[str, list[dict]] = {}
    per_hash_commit: dict[str, dict[str, str]] = {}
    for slug, sets in filesets.items():
        hashes = set()
        for fs in sets:
            digest = hashlib.sha256()
            for rel, sha in fs:
                digest.update(rel.encode("utf-8"))
                digest.update(blobs[sha])
            h = digest.hexdigest()[:12]
            hashes.add(h)
            # 同一份内容可能在多个 commit 出现，取**最早**那个（见 first_commit 的注释）
            c = first_commit.get((slug, fs))
            if c and h not in per_hash_commit.setdefault(slug, {}):
                per_hash_commit[slug][h] = c
            skill_md = dict(fs).get("SKILL.md")
            if skill_md and c:  # c 为空 = 只来自暂存区，见上面的注释
                per_hash_commit.setdefault(slug, {})
                version_log.setdefault(slug, []).append(
                    {"hash": h, "_sha": c or "", "version": semver_of(blobs[skill_md])}
                )
        known[slug] = sorted(hashes)

    meta = commit_meta({e["_sha"] for v in version_log.values() for e in v if e["_sha"]})
    for slug, entries in version_log.items():
        seen, out = set(), []
        for e in entries:
            if e["hash"] in seen:
                continue
            seen.add(e["hash"])
            m = meta.get(e.pop("_sha"), {})
            out.append({**e, "date": m.get("date", ""), "subject": m.get("subject", "")})
        version_log[slug] = sorted(out, key=lambda x: (x["date"], x["hash"]))

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
    return dict(sorted(known.items())), endpoints, triggers, dict(sorted(version_log.items()))


def main() -> int:
    known, endpoints, triggers, version_log = build()
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "skills": known,
        "retiredEndpoints": endpoints,
        "retiredTriggerWords": triggers,
        # 每一版的「什么时候发的、那一笔叫什么、当时的语义版本」。
        # 供更新提示说出「1.4.0 → 2.0.0，这几版改了什么」——哈希答不了这个问题。
        "versionLog": version_log,
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
