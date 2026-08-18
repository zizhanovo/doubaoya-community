#!/usr/bin/env python3
"""Validate the publishable doubaoya-community Skill collection."""

from __future__ import annotations

import hashlib
import json
import os
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

# 公众号写作链：从"写正文"到"存进草稿箱"的每一跳。链上每个 Skill 都必须在自己的 SKILL.md 里
# 声明前向指针（一节 `## 下一步`，点名下游的真实 Skill）。没有它，agent 写完正文就宣布交付完成，
# 用户手上仍然只有一段 Markdown——这条链断过一次，本闸就是防它再静默断掉。
AUTHORING_CHAIN = (
    "wechat-hot-write",
    "wechat-banned-words",
    "wechat-title",
    "wechat-cover",
    "wechat-theme-studio",
    "wechat-article-pipeline",
)
NEXT_STEP_HEADING = "## 下一步"
# 一个 Skill 名长这样：小写、带连字符。反引号里符合这个形状的 token 必须真的是 skills/ 下的一个
# 目录——`wechat-render` 那类"听起来很像但不存在"的引用就是这么混进文档的。
#
# ponytail: 这个形状会误伤 CSS 属性与文件名，所以只扫「下一步」那一节（外加整篇 dby）,不扫全文。
# 天花板：链上 skill 的正文里若出现死链，本闸看不见。升级路径是加白名单——但那份白名单自己会漂移，
# 所以先不加。实测若改成扫全文，wechat-theme-studio 会被 `line-height`/`border-left`/`benya-clean`
# 打红，wechat-article-pipeline 会被 `font-size`/`letter-spacing`/`design-config` 打红，全是误报。
SKILL_TOKEN = re.compile(r"`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`")

# ── 调用路由闸 ────────────────────────────────────────────────────────────────
# 平台有**两个不相交的能力集合**，各走一条路由，彼此不回落：
#   产品化 Skill  → POST /api/skills/<slug>/invoke          （catalog 的 skillDefinitions）
#   平台数据能力  → POST /api/apis/<platform>/<slug>/call    （catalog 的 apiEndpointDefinitions）
# 拿错集合的 slug 去打另一条，返回 404，且**没有任何回落**。本仓文档一度把技能包的**目录名**
# （trending-hub / content-parse / douyin-search）当成调用 slug 写进 /api/skills/<slug>/invoke，
# 于是那几条示例注定 404——而 §「404 就回去查发现接口」的指引又永远查不到它们，agent 原地死循环。
# 本闸就是钉死这件事：文档/脚本里出现的每一条调用路径，都必须真的在主仓目录里。
SKILL_INVOKE_PATH = re.compile(r"/api/skills/([A-Za-z0-9][A-Za-z0-9._~-]*)/invoke")
API_CALL_PATH = re.compile(r"/api/apis/([A-Za-z0-9][A-Za-z0-9._~-]*)/([A-Za-z0-9][A-Za-z0-9._~-]*)/call")
# 占位符写法（`<slug>` / `${slug}` / `%s`）不含上面字符类里的字符，天然不参与匹配。

# 主仓 catalog 的单一事实源。**不能写死绝对路径**——本文件自己会被 validate_artifacts 的
# 「开发者路径」正则扫描。默认按兄弟目录找，可用环境变量覆盖；找不到就跳过并 warn
# （社区仓要能在没有主仓的机器上独立通过校验）。
CATALOG_ENV = "DOUBAOYA_CATALOG"
CATALOG_SIBLING = PurePosixPath("doubaoyahub/packages/catalog/src/index.ts")
CATALOG_MARKERS = (
    ("const skillDefinitions: SkillDefinition[] = [", "export const skills: Skill[] ="),
    ("const apiEndpointDefinitions: ApiEndpointDefinition[] = [", "export const apiEndpoints: ApiEndpoint[] ="),
)

# 还没上线的后端路由：契约先行，skill 端已按契约实现并自带 404 降级。
# 见 skills/celebrity-slice/references/asr-api.md。这是一张**会自动清账的**豁免表——
# 一旦路由真的上线（出现在 catalog 里），下面的断言会反过来要求把它从这里删掉，
# 免得豁免留成一个永久的洞。
PENDING_UPSTREAM_ROUTES = {("media", "asr")}


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


def frontmatter_description(path: Path) -> str:
    """frontmatter 里 ``description`` 的**完整**正文；折叠式（``>-`` 后跟缩进块）也一并取回。

    只取 description、绝不含正文——中文话术闸只该管选路层那一两句，理由见
    :func:`validate_banned_word_fields`。
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    require(bool(lines) and lines[0] == "---", f"missing frontmatter: {display_path(path)}")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValidationError(f"unclosed frontmatter: {display_path(path)}") from exc
    for index in range(1, end):
        if not lines[index].startswith("description:"):
            continue
        head = lines[index].split(":", 1)[1].strip()
        # ``>-`` / ``|`` 这类块标量记号本身不是正文，正文在后面的缩进行里。
        body = [] if head in ("", ">", ">-", "|", "|-") else [head]
        for follow in lines[index + 1 : end]:
            if follow[:1] not in (" ", "\t"):  # 回到顶层键 ⇒ description 到此为止
                break
            body.append(follow.strip())
        return " ".join(body)
    raise ValidationError(f"invalid description frontmatter: {display_path(path)}")


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
            "doubaoya-authoring-delivery": {"id", "priority", "terminal_skill", "candidate_skills", "use_when", "target_state_gates", "auth"},
            "doubaoya-cloud-public-data": {"id", "priority", "candidate_skills", "use_when", "auth"},
        }
        require(route_id in expected_keys, f"unknown route ID: {route_id}")
        require_exact_keys(route, expected_keys[route_id], f"route {route_id}")
        require(type(priority) is int, f"route priority must be an integer: {route_id}")
        route_ids.add(route_id)
        priorities.append(priority)
        primary = route.get("primary_skill") or route.get("terminal_skill")
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
    require(
        route_ids == {"mp-ark-local-archive", "doubaoya-authoring-delivery", "doubaoya-cloud-public-data"},
        "required WeChat routes are missing",
    )
    for skill_name in sorted(referenced_skills):
        require((root / "skills" / skill_name / "SKILL.md").is_file(), f"routing references missing Skill: {skill_name}")

    route_by_id = {route["id"]: route for route in routes}
    local = route_by_id["mp-ark-local-archive"]
    authoring = route_by_id["doubaoya-authoring-delivery"]
    cloud = route_by_id["doubaoya-cloud-public-data"]
    metrics = {"read_count", "like_count", "recommend_count", "comment_count"}
    require(local["priority"] > cloud["priority"], "local archive route must precede the general cloud route")
    # 写侧必须压过泛化的云端搜索路由：否则「帮我写一篇公众号文章」又会被导进只管搜索的那条路。
    require(authoring["priority"] > cloud["priority"], "authoring route must precede the general cloud route")
    require(authoring["terminal_skill"] == "wechat-article-pipeline", "authoring route must terminate at wechat-article-pipeline")
    require(
        set(AUTHORING_CHAIN) <= set(authoring["candidate_skills"]),
        f"authoring route is missing chain Skills: {sorted(set(AUTHORING_CHAIN) - set(authoring['candidate_skills']))}",
    )
    require(authoring["auth"]["requires_doubaoya_api_key"] is True, "authoring route must declare the API key requirement")
    authoring_intents = " ".join(authoring["use_when"]).lower()
    for intent in ("complete official account article", "layout", "draft box", "next"):
        require(intent in authoring_intents, f"authoring route is missing intent: {intent}")
    # 这条链走多远由用户要的终态决定，不是无条件一路推到底：终点会写进用户自己的公众号后台。
    gates = authoring.get("target_state_gates")
    require(isinstance(gates, list) and gates and all(isinstance(item, str) and item for item in gates), "authoring route needs target-state gates")
    gate_text = " ".join(gates).lower()
    for contract in ("target state", "ask when it is unstated", "draft only, never mass send"):
        require(contract in gate_text, f"authoring target-state gates are missing contract: {contract}")
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
    authoring_signals = " ".join(forbidden_by_route["doubaoya-authoring-delivery"]["request_signals"]).lower()
    for signal in ("drafted article text", "banned-word check", "markdown only"):
        require(signal in authoring_signals, f"authoring forbidden-misroute signals are missing: {signal}")
    cloud_signals = " ".join(forbidden_by_route["doubaoya-cloud-public-data"]["request_signals"]).lower()
    for signal in ("local qr login", "local session", "resumable archive", "article body export"):
        require(signal in cloud_signals, f"cloud forbidden-misroute signals are missing: {signal}")

    doubaoya_text = (root / "skills" / "doubaoya" / "SKILL.md").read_text(encoding="utf-8")
    require("references/wechat-routing.json" in doubaoya_text, "doubaoya SKILL.md does not load the routing source")
    require("MP Ark" in doubaoya_text and "互动指标" in doubaoya_text, "doubaoya SKILL.md does not state the WeChat capability split")


def next_step_section(text: str) -> str | None:
    """取 SKILL.md 里 ``## 下一步`` 那一节的正文（到下一个同级标题或文末为止）。"""
    start = text.find(NEXT_STEP_HEADING)
    if start == -1:
        return None
    body = text[start:]
    end = body.find("\n## ", len(NEXT_STEP_HEADING))
    return body if end == -1 else body[:end]


def validate_banned_word_fields(root: Path = ROOT) -> None:
    """违禁词检测的 Skill 不许再教 agent 去读上游从来没回过的字段。

    上游 ``cozeSkill/sensitiveWordSearch`` 只回 ``source / content / originalContent /
    prohibitedWordsType / raw``。文档一度写着 ``riskLevel / matchedWords / suggestions``，
    于是 agent 走进「``matchedWords`` 为空 ⇒ 未检测到违禁词，文案合规 ✅」这条分支——
    一个恒真的判据把**每一段**文案都放行了。漏报违禁词是安全缺陷，本闸就是防它复发。

    ``riskLevel`` / ``matchedWords`` 全仓没有第二个合法出处，任何 SKILL.md 里出现都判红；
    ``suggestions`` 在别的能力上是真字段（``skill.search.doubaoWeb`` 的 ``result.suggestions``），
    所以只在**碰违禁词检测的** SKILL.md 里禁。

    第二道（中文话术层，**只扫 frontmatter 的 description**）：上面那三个禁的是英文字面量，
    于是同一个谎换成中文说就整个穿过去了——头部话术一度承诺「标好风险等级，再给出每个词的
    合规替换」，而同一份文件的红线明写着接口不返回这些。为什么只扫 description、不扫正文：

    * description 是**选路层**，agent 就靠这一行决定用不用本 Skill，说错影响面最大；
    * 它只有一两句推销语，**正当的否定句只出现在讲解正文里**（正文现存 8 处「接口不返回…」
      都是对的），扫正文必然误伤，扫 description 则没有误伤面。

    禁的是「听起来像接口返回的结构」这类名词。**「风险等级」这个概念压根不存在**——接口不回，
    本鸭也不许自创（见 multi-banned-words「不要自创风险等级」）。「替换建议」「命中词清单」
    本鸭确实会产出，但在 description 这种没有主语的推销语里，它们读起来就是字段承诺；
    要在 description 里讲这个交付物，请改说交付物本身（「合规替换」「标注版正文」），
    别用听着像字段的名词。
    """
    ghosts = ("riskLevel", "matchedWords", "suggestions")
    ghost_phrases_cn = ("风险等级", "风险级别", "风险分级", "替换建议", "命中词清单")
    safety_markers = ("check-banned-words", "content-safety-check", "wechat-prohibited-word")
    for directory in discover_skill_dirs(root):
        skill_md = directory / "SKILL.md"
        text = skill_md.read_text(encoding="utf-8")
        # 分域判定看**整个技能包**，不只是 SKILL.md：wechat-banned-words 的端点写在
        # scripts/check_words.py 的 API_URL 里、SKILL.md 一次都没出现过 check-banned-words，
        # 只读 SKILL.md 会把**最该管的那个 Skill** 判成域外（本闸建起来时就漏了它）。
        touches_safety = any(
            marker in candidate.read_text(encoding="utf-8", errors="ignore")
            for candidate in sorted(directory.rglob("*"))
            if candidate.is_file()
            for marker in safety_markers
        )
        for ghost in ghosts:
            if ghost == "suggestions" and not touches_safety:
                continue
            require(
                ghost not in text,
                f"{directory.name}/SKILL.md still names `{ghost}`: the banned-word API never returns it, "
                "and reading it makes the agent report every text as compliant",
            )
        if not touches_safety:
            continue
        description = frontmatter_description(skill_md)
        for phrase in ghost_phrases_cn:
            require(
                phrase not in description,
                f"{directory.name}/SKILL.md 的 description 里写着「{phrase}」——违禁词接口不返回它，"
                "而 description 是选路层，agent 就照这一行判断本 Skill 交付什么。"
                "改成说真实交付物（标注版正文 / 风险类别 / 合规替换），别用听着像接口字段的名词。",
            )


def validate_authoring_chain(root: Path = ROOT) -> None:
    """公众号写作链上的每一跳都必须有指向下游 Skill 的前向指针，且引用的 Skill 真实存在。"""
    installed = {path.name for path in discover_skill_dirs(root)}
    for name in AUTHORING_CHAIN:
        skill_md = root / "skills" / name / "SKILL.md"
        require(skill_md.is_file(), f"authoring chain Skill is missing: {name}")
        section = next_step_section(skill_md.read_text(encoding="utf-8"))
        require(
            section is not None,
            f"{name}/SKILL.md has no `{NEXT_STEP_HEADING}` section: a chain Skill that names no downstream "
            "Skill lets the agent stop here and call the job done",
        )
        referenced = set(SKILL_TOKEN.findall(section))
        dead = sorted(referenced - installed)
        require(not dead, f"{name}/SKILL.md 下一步 references Skills that do not exist: {dead}")
        forward = referenced - {name}
        require(forward, f"{name}/SKILL.md 下一步 names no downstream Skill")

    # dby 是任务后导航的单一事实源——它的路由表里出现死链，等于把用户导进空气。
    dby_text = (root / "skills" / "dby" / "SKILL.md").read_text(encoding="utf-8")
    dead_in_dby = sorted(set(SKILL_TOKEN.findall(dby_text)) - installed)
    require(not dead_in_dby, f"dby/SKILL.md routes to Skills that do not exist: {dead_in_dby}")

    # 总入口必须知道这条链存在（否则"帮我写一篇公众号文章"又只会命中单个搜索类能力），
    # 至少要点名起点、合规环与终点这三跳。
    doubaoya_text = (root / "skills" / "doubaoya" / "SKILL.md").read_text(encoding="utf-8")
    must_route = ("wechat-hot-write", "wechat-banned-words", "wechat-article-pipeline", "dby")
    missing = sorted(name for name in must_route if f"`{name}`" not in doubaoya_text)
    require(not missing, f"doubaoya SKILL.md does not route to the authoring chain: {missing}")


def locate_catalog(root: Path = ROOT) -> Path | None:
    """主仓 catalog 的路径：环境变量优先，否则找兄弟目录。找不到返回 None（调用方跳过并 warn）。"""
    override = os.environ.get(CATALOG_ENV)
    if override:
        return Path(override)
    candidate = root.parent / CATALOG_SIBLING
    return candidate if candidate.is_file() else None


def parse_catalog(path: Path) -> tuple[set[str], set[tuple[str, str]]]:
    """从主仓 catalog 里抠出两个集合的成员。

    正经做法是引 TypeScript 跑一次导出，但那要给一个纯 Python 的校验器装上 node 工具链。
    这里退而求其次做文本切片：两个定义数组各有明确的首尾标记，缺任何一个就说明主仓的结构
    变了——**那时直接打红**，因为一个悄悄退化成「什么都不检查」的闸比没有闸更糟。
    """
    source = path.read_text(encoding="utf-8")
    regions = []
    for start, end in CATALOG_MARKERS:
        head = source.find(start)
        require(head != -1, f"catalog 结构已变，找不到标记 {start!r}（请更新 parse_catalog 或改 {CATALOG_ENV}）")
        tail = source.find(end, head)
        require(tail != -1, f"catalog 结构已变，找不到标记 {end!r}（请更新 parse_catalog 或改 {CATALOG_ENV}）")
        regions.append(source[head:tail])

    skill_slugs = set(re.findall(r'^\s{4}slug: "([^"]+)",$', regions[0], re.MULTILINE))
    api_refs = set(re.findall(r'^\s{4}platform: "([^"]+)",\n\s{4}slug: "([^"]+)",$', regions[1], re.MULTILINE))
    require(bool(skill_slugs), "catalog 里没解析出任何 skill slug（解析规则已失效）")
    require(bool(api_refs), "catalog 里没解析出任何 api endpoint（解析规则已失效）")
    return skill_slugs, api_refs


def validate_call_routes(root: Path = ROOT) -> None:
    """文档与脚本里写死的每一条调用路径，都必须真的存在于主仓目录的对应集合里。

    只查「存在于哪个集合」，不查是否已下架——已下架的能力允许（而且应该）被点名，
    比如 seedream-5-lite/SKILL.md 就得写明 seedream-lite 已经不能用了。
    ponytail: 天花板 = 抓不到「把在架能力写成已下架」这类反向错误；升级路径是把
    availability 一起解析出来，但那需要一份哪些文档「有意提到下架能力」的白名单，会自己漂移。
    """
    catalog = locate_catalog(root)
    if catalog is None or not catalog.is_file():
        print(
            f"warning: 跳过调用路由校验——找不到主仓 catalog（设 {CATALOG_ENV}=<…/packages/catalog/src/index.ts> 可启用）",
            file=sys.stderr,
        )
        return

    skill_slugs, api_refs = parse_catalog(catalog)
    scanned_suffixes = {".md", ".py", ".mjs", ".json", ".txt"}

    for path in publishable_files(root):
        if path.suffix.lower() not in scanned_suffixes or not path.is_file():
            continue
        relative = display_path(path)
        # 测试套件里的坏路径是**变异用例**，不是调用点——扫它等于要求本闸的红测永远为绿。
        if relative.startswith("tools/tests/"):
            continue
        text = path.read_text(encoding="utf-8")

        for slug in sorted(set(SKILL_INVOKE_PATH.findall(text))):
            require(
                slug in skill_slugs,
                f"{relative} 调用了 /api/skills/{slug}/invoke，但「{slug}」不在主仓 catalog 的 skills 集合里"
                + (
                    f"——它其实是 apis 集合里的能力，得走 /api/apis/<platform>/{slug}/call"
                    if any(slug == api_slug for _, api_slug in api_refs)
                    else "——多半把技能包目录名当成了调用 slug，这条路径必然 404"
                ),
            )

        for platform, slug in sorted(set(API_CALL_PATH.findall(text))):
            if (platform, slug) in PENDING_UPSTREAM_ROUTES:
                require(
                    (platform, slug) not in api_refs,
                    f"{platform}/{slug} 已经上线到 catalog，请把它从 PENDING_UPSTREAM_ROUTES 里删掉",
                )
                continue
            require(
                (platform, slug) in api_refs,
                f"{relative} 调用了 /api/apis/{platform}/{slug}/call，但主仓 catalog 的 apis 集合里没有这条"
                + (
                    f"——「{slug}」是 skills 集合里的能力，得走 /api/skills/{slug}/invoke"
                    if slug in skill_slugs
                    else "，这条路径必然 404"
                ),
            )


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
        if path.is_file() and relative != provenance_relative and path.name != ".version":
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


def validate_clawhub_manifest(root: Path = ROOT) -> None:
    """ClawHub 上架清单必须与 skills/ 一一对应（元数据外置，漏一个就少上架一个）。"""
    manifest = load_json(root / "tools" / "clawhub.json")
    require(isinstance(manifest, dict), "clawhub.json must be an object")
    require(manifest.get("schema_version") == 1, "unsupported clawhub manifest schema")
    owner = manifest.get("owner")
    require(isinstance(owner, str) and owner, "clawhub manifest needs an owner handle")
    skills = manifest.get("skills")
    require(isinstance(skills, dict) and skills, "clawhub manifest needs a skills map")
    listed = set(skills)
    actual = {path.name for path in discover_skill_dirs(root)}
    require(
        listed == actual,
        f"clawhub manifest mismatch: missing={sorted(actual - listed)}, extra={sorted(listed - actual)}",
    )
    for slug, entry in sorted(skills.items()):
        require(isinstance(entry, dict), f"clawhub manifest entry must be an object: {slug}")
        require(set(entry) <= {"displayName", "topics"}, f"unexpected clawhub manifest keys: {slug}")
        name = entry.get("displayName")
        require(isinstance(name, str) and name.strip(), f"clawhub manifest needs a displayName: {slug}")
        topics = entry.get("topics", [])
        require(
            isinstance(topics, list) and all(isinstance(item, str) and item.strip() for item in topics),
            f"clawhub manifest topics must be non-empty strings: {slug}",
        )


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
    validate_clawhub_manifest(root)
    validate_routing(root)
    validate_authoring_chain(root)
    validate_banned_word_fields(root)
    validate_call_routes(root)
    validate_vendor(root)
    validate_artifacts(root)


def main() -> int:
    validate_repository()
    print(
        f"validated doubaoya-community: {len(discover_skill_dirs())} Skills, "
        f"ClawHub manifest, MP Ark vendor, WeChat routing and the {len(AUTHORING_CHAIN)}-hop authoring chain"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as exc:
        print(f"validation error: {exc}", file=sys.stderr)
        raise SystemExit(1)
