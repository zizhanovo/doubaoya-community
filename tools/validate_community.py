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
#
# 详情端点（`GET`，免鉴权免费）同样点名 slug，同样会因为 slug 漂移而静默 404。网关 Skill 的
# 选路索引整整 94 行给的**全是详情端点**（给调用路径会让人照着拼，而专用路由根本拼不出来），
# 所以这两条不纳入校验，那份索引就等于完全没人看着。末尾的 `(?![\w/-])` 保证只匹配"到此为止"
# 的详情形态，不会把 `…/call`、`…/invoke` 重复算一遍。
SKILL_DETAIL_PATH = re.compile(r"/api/skills/([A-Za-z0-9][A-Za-z0-9._~-]*)(?![\w/-])")
API_DETAIL_PATH = re.compile(r"/api/apis/([A-Za-z0-9][A-Za-z0-9._~-]*)/([A-Za-z0-9][A-Za-z0-9._~-]*)(?![\w/-])")
# `/api/skills/` 下这几条不是能力详情，是集合级端点，天然不在 catalog 的 slug 集合里。
SKILL_COLLECTION_ENDPOINTS = frozenset({"search", "recommend", "installs"})

# 主仓 catalog 的单一事实源。**不能写死绝对路径**——本文件自己会被 validate_artifacts 的
# 「开发者路径」正则扫描。默认按兄弟目录找，可用环境变量覆盖；找不到就跳过并 warn
# （社区仓要能在没有主仓的机器上独立通过校验）。
CATALOG_ENV = "DOUBAOYA_CATALOG"
CATALOG_SIBLING = PurePosixPath("doubaoyahub/packages/catalog/src/index.ts")
CATALOG_MARKERS = (
    ("const skillDefinitions: SkillDefinition[] = [", "export const skills: Skill[] ="),
    ("const apiEndpointDefinitions: ApiEndpointDefinition[] = [", "export const apiEndpoints: ApiEndpoint[] ="),
)

# ── 网关 Skill：「不许把契约烤进分发物」闸 ───────────────────────────────────────
# 网关 Skill 的整个存在理由是：**协议内联、契约现拉**。它只许携带三样东西——调用协议、
# 一份仅供选路的能力索引（operationKey + 一行用途 + 详情端点）、跨能力的选路知识。
# 一旦有人图省事把某条能力的入参字段抄进来，它就退化成又一份「看起来很确定、其实在骗人」的
# 快照契约——正是本轮要根治的病。本闸就是钉死这件事。
GATEWAY_SKILL = "doubaoya-gateway"

# 协议词汇表：**信封 + 发现/详情 DTO + 入参契约 DTO** 的键，外加 JSON Schema 自己的元关键字。
# 🔴 往这份表里加一个**能力入参字段名**（keyword / limit / thumbMediaId / publishTimeStart …），
# 就等于亲手把契约烤进了分发物 —— 那是本闸唯一要拦的事，别这么干。这里只该出现
# 「所有能力共用的协议层键」，判据很简单：换一条能力它还叫这个名字吗？不是就别加。
GATEWAY_PROTOCOL_VOCAB = frozenset({
    # 统一信封
    "success", "requestId", "data", "error", "code", "message", "details",
    "notice", "detailUrl", "noResult",
    # 发现 / 详情 DTO
    "items", "total", "platform", "slug", "operationKey",
    "execution", "mode", "sideEffect", "target", "method", "path",
    "availability", "note", "status",
    # 入参契约 DTO（inputContract）与它指向的两个退路字段
    "inputContract", "kind", "jsonSchema", "route",
    "inputUiSchema", "requestSchema", "inputSchema",
    # JSON Schema 元关键字（描述规格的语言本身，不是任何一条能力的字段）
    "$schema", "type", "properties", "required", "additionalProperties",
})

# 一条 operationKey 长这样：`api.trend.hotTopics` / `skill.wechat.draftPublish` /
# `tool.contentSafety.checkWords`。它的末段天生是驼峰，而索引表里必须逐条列出它们，
# 所以扫驼峰之前先把整条 operationKey 摘掉 —— 否则索引表自己就会把本闸打红。
OPERATION_KEY = re.compile(r"\b(?:api|skill|tool)\.[A-Za-z0-9]+\.[A-Za-z0-9]+\b")
# 驼峰标识符：58 个真实入参字段名里有 37 个长这样（thumbMediaId / publishTimeStart /
# sortType / accountId …），而且它在中文正文里几乎不可能是别的东西。
CAMEL_CASE = re.compile(r"\b[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b")
# 围栏代码块（```lang … ```）。入参最可能被抄进来的地方就是这里的请求体示例。
FENCED_BLOCK = re.compile(r"^```[^\n]*\n(.*?)^```", re.MULTILINE | re.DOTALL)
# JSON 键。剩下 21 个小写单词字段名（keyword / limit / page / cursor …）在正文里跟普通英文
# 撞车，扫全文必然误报；但它们一旦被当成**入参**抄进来，一定是以 JSON 键的形态出现。
JSON_KEY = re.compile(r'"(\$?[A-Za-z_][A-Za-z0-9_-]*)"\s*:')
# 索引表的一行：正好三列（operationKey / 用途 / 详情端点）。多出一列，装的多半就是入参。
INDEX_ROW = re.compile(r"\| `([^`|]+)` \| ([^|]*) \| ([^|]*) \|")
# 一行是不是索引行，看首列是不是一条 operationKey——不能只看「以 `| `` ` 开头」，文档里还有
# 别的表格首列也是行内代码。
INDEX_ROW_HEAD = re.compile(r"^\| `([^`|]+)` \|")

# 从没上线的后端路由。这是一张**会自动清账的**豁免表——一旦路由真的上线（出现在 catalog
# 里），下面的断言会反过来要求把它从这里删掉，免得豁免留成一个永久的洞。
# ("media","asr") 当初是给 celebrity-slice 的契约先行路由；2026-08-18 那个包已下架，
# 现在唯一还提它的是 docs/superpowers/ 下那两份**当时的设计文档**——历史记录，不是给
# agent 看的指引，所以留着豁免、不删文档。路由本身仍然没上线，判据没变。
PENDING_UPSTREAM_ROUTES = {("media", "asr")}

# 已下架包的能力**也**一起下架了的，列在这儿豁免「删包前能力必须仍可发现」那道闸。
# 判据不是「我们不想要了」，而是**发现接口里也确实没有了**：2026-08-18 实拉
# GET /api/skills（17 条）与 GET /api/apis（77 条），下面三条都不在其中，所以删包不会
# 让任何还活着的能力失联。反例留个对照——douyin-similar-account 的包同样删了，但那条能力
# 还在发现接口里、也还在能力索引里，所以它不需要豁免，闸对它天然是绿的。
# 同样是**会自动清账的**豁免表：哪天它们又出现在能力索引里，下面的断言会反过来要求把
# 这里删掉，免得豁免留成永久的洞。
RETIRED_WITH_CAPABILITY = {
    "seedance-video-gen",
    "video-downloader",
    "xiaohongshu-similar-account",  # 只剩 douyin / gongzhonghao 两个同类，小红书这条没了
    # mera 是**整个平台**退役，不是我们不想要：mera.doubaoya.com 的 DNS 记录已移除
    # （dig 返回 NXDOMAIN），六条 api.mera.* 在发现接口里被 hidden 过滤，
    # GET /api/apis/mera/<slug> 与「压根不存在」同为 404。判据与失效条件写在
    # skills/doubaoya/references/mera-routing.json 的 retired 块里。
    # 2026-08-18 删掉它的壳，能力侧本就没有可发现的东西可留。
    "mera",
}


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
        route_ids == {"doubaoya-authoring-delivery", "doubaoya-cloud-public-data"},
        "required WeChat routes are missing",
    )
    for skill_name in sorted(referenced_skills):
        require((root / "skills" / skill_name / "SKILL.md").is_file(), f"routing references missing Skill: {skill_name}")

    route_by_id = {route["id"]: route for route in routes}
    authoring = route_by_id["doubaoya-authoring-delivery"]
    cloud = route_by_id["doubaoya-cloud-public-data"]
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
    require(cloud["auth"] == {"type": "doubaoya-api-key", "requires_doubaoya_api_key": True}, "invalid cloud auth boundary")

    cloud_intents = " ".join(cloud["use_when"]).lower()
    for intent in ("public article", "without qr", "reading", "comment", "analysis"):
        require(intent in cloud_intents, f"cloud route is missing intent: {intent}")

    precedence = routing.get("precedence")
    require(isinstance(precedence, list) and all(isinstance(item, str) and item for item in precedence), "invalid precedence rules")
    precedence_text = " ".join(precedence).lower()
    for contract in ("highest-priority", "interaction-metric"):
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
    authoring_signals = " ".join(forbidden_by_route["doubaoya-authoring-delivery"]["request_signals"]).lower()
    for signal in ("drafted article text", "banned-word check", "markdown only"):
        require(signal in authoring_signals, f"authoring forbidden-misroute signals are missing: {signal}")
    cloud_signals = " ".join(forbidden_by_route["doubaoya-cloud-public-data"]["request_signals"]).lower()
    for signal in ("local qr login", "local session", "resumable archive", "article body export"):
        require(signal in cloud_signals, f"cloud forbidden-misroute signals are missing: {signal}")

    doubaoya_text = (root / "skills" / "doubaoya" / "SKILL.md").read_text(encoding="utf-8")
    require("references/wechat-routing.json" in doubaoya_text, "doubaoya SKILL.md does not load the routing source")
    require("互动指标" in doubaoya_text, "doubaoya SKILL.md does not state the WeChat capability split")


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
        # known-hashes.json 记的是**已下架包当年调过什么**，是历史账本不是调用点。里面的
        # 端点本来就该是死的（能力跟着包一起下架了），扫它等于要求历史永远不许下架。
        # 「这些死端点有没有让还活着的能力失联」由 validate_retired_discoverability 管。
        if relative == "known-hashes.json":
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

        for slug in sorted(set(SKILL_DETAIL_PATH.findall(text))):
            if slug in SKILL_COLLECTION_ENDPOINTS:
                continue
            require(
                slug in skill_slugs,
                f"{relative} 指向详情端点 /api/skills/{slug}，但「{slug}」不在主仓 catalog 的 skills 集合里"
                + (
                    f"——它其实是 apis 集合里的能力，详情端点是 /api/apis/<platform>/{slug}"
                    if any(slug == api_slug for _, api_slug in api_refs)
                    else "，这条路径必然 404"
                ),
            )

        for platform, slug in sorted(set(API_DETAIL_PATH.findall(text))):
            if (platform, slug) in PENDING_UPSTREAM_ROUTES:
                continue
            require(
                (platform, slug) in api_refs,
                f"{relative} 指向详情端点 /api/apis/{platform}/{slug}，但主仓 catalog 的 apis 集合里没有这条"
                + (
                    f"——「{slug}」是 skills 集合里的能力，详情端点是 /api/skills/{slug}"
                    if slug in skill_slugs
                    else "，这条路径必然 404"
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


def validate_gateway_contract_freedom(root: Path = ROOT) -> None:
    """网关 Skill 的正文里不许出现**任何一条能力的入参字段**。

    判据分三条，每条盯一种「把参数抄进来」的真实形态：

    1. **驼峰标识符**（全文，含代码块）必须属于协议词汇表。真实入参字段名里 37/58 是驼峰
       （``thumbMediaId`` / ``publishTimeStart`` / ``sortType`` …），无论它被抄成 JSON 键、
       JS 属性、表格单元格还是一句中文里的行内代码，这一条都拦得住。索引表里逐条列出的
       ``operationKey`` 是唯一的合法驼峰来源，扫描前整条摘掉。
    2. **围栏代码块里的 JSON 键**必须属于协议词汇表。剩下 21 个字段名是小写单词
       （``keyword`` / ``limit`` / ``page`` / ``cursor`` …），扫全文会跟普通英文撞车而误报；
       但把参数抄进来时它们必然以请求体的 JSON 键出现，所以只在代码块里扫，零误报面。
    3. **索引表的「用途」列**只许是中文说明，不许出现 ASCII 标识符 —— 索引就该只回答
       「有哪些能力、详情端点在哪」，给它加一列参数说明是最省事也最典型的复发路径。

    ponytail: 天花板 = 有人用**流水中文散文**逐条描述小写单字段名（「这条能力的入参是
    keyword，选填 limit」）能穿过第 1、3 条。不扫全文里的小写单词是有意的——``limit``
    / ``type`` / ``content`` 在文档里有大量正当用法，扫它必然把闸变成噪音，而噪音闸等于
    没有闸。升级路径 = 从主仓 catalog 现导一份真实字段名全集，只对**那 58 个词**扫全文；
    但那要求本闸依赖主仓在场（validate_call_routes 那样可跳过），先不加。
    """
    skill_dir = root / "skills" / GATEWAY_SKILL
    skill_md = skill_dir / "SKILL.md"
    require(skill_md.is_file(), f"网关 Skill 不见了：skills/{GATEWAY_SKILL}/SKILL.md")

    # 🔴 扫描面是**整个技能包**，不只是 SKILL.md。参数被抄进来时最舒服的落点恰恰是
    # references/ —— 官方的 claude-api 技能就是把参数细节烤进 references 的，那对一个
    # 变得慢、还有版本号的 API 成立，对一周就变一次的目录不成立。只扫 SKILL.md 等于把闸
    # 建在没人会走的那道门上。
    documents = sorted(path for path in skill_dir.rglob("*.md") if path.is_file())
    require(bool(documents), f"skills/{GATEWAY_SKILL}/ 下没有任何 Markdown 文档")

    rows: list[tuple[Path, str]] = []
    for path in documents:
        label = f"{GATEWAY_SKILL}/{path.relative_to(skill_dir).as_posix()}"
        text = path.read_text(encoding="utf-8")

        stray = sorted(set(CAMEL_CASE.findall(OPERATION_KEY.sub(" ", text))) - GATEWAY_PROTOCOL_VOCAB)
        require(
            not stray,
            f"{label} 里出现了不属于调用协议的驼峰标识符：{stray}。"
            "网关只许携带协议、选路索引和选路知识——逐能力的入参字段一律不许写进来，"
            "调用方必须从详情端点现拉（这正是本 Skill 存在的理由）。",
        )

        for block in FENCED_BLOCK.findall(text):
            keys = sorted(set(JSON_KEY.findall(block)) - GATEWAY_PROTOCOL_VOCAB)
            require(
                not keys,
                f"{label} 的代码块里出现了非协议 JSON 键：{keys}。"
                "请求体示例一旦带上真实入参字段，本 Skill 就退化成又一份会漂的快照契约。",
            )

        # 索引行的判据 = 首列是一条 operationKey。别用「以 `| \`` 开头」认行——文档里还有别的
        # 表格首列也是行内代码（「绝不能抄进业务 Skill」那张就是），会被误判成索引。
        rows.extend(
            (path, line)
            for line in text.splitlines()
            if (leading := INDEX_ROW_HEAD.match(line)) and OPERATION_KEY.fullmatch(leading.group(1))
        )

    require(bool(rows), f"skills/{GATEWAY_SKILL}/ 下找不到能力索引表")
    for path, line in rows:
        label = f"{GATEWAY_SKILL}/{path.relative_to(skill_dir).as_posix()}"
        matched = INDEX_ROW.fullmatch(line)
        require(
            matched is not None,
            f"{label} 索引表这一行不是「operationKey | 用途 | 详情端点」三列：{line!r}。"
            "索引只回答「有哪些能力、详情端点在哪」——多出来的一列，装的多半就是入参。",
        )
        operation_key, purpose, endpoint = matched.groups()
        require(
            "`" not in purpose,
            f"{label} 索引表「{operation_key}」的用途列里有行内代码：{purpose.strip()!r}。"
            "用途是一句中文说明；字段名、枚举值这类东西一律去详情端点现拉。",
        )
        require(
            endpoint.strip().startswith("`/api/") and endpoint.strip().endswith("`"),
            f"{label} 索引表「{operation_key}」的第三列不是详情端点：{endpoint.strip()!r}",
        )

    # references/ 里躺着一份 SKILL.md 从不点名的文档 = 没有 agent 会去加载它。按需加载的前提
    # 是有人告诉你「什么时候去读哪一份」，孤儿文件只会腐烂在包里，还照样被分发出去。
    entry = skill_md.read_text(encoding="utf-8")
    for path in documents:
        if path == skill_md:
            continue
        pointer = path.relative_to(skill_dir).as_posix()
        require(
            pointer in entry,
            f"{GATEWAY_SKILL}/SKILL.md 从没点名 {pointer}：按需加载的前提是入口说清什么时候读哪份，"
            "没有指针的 references 文件不会被任何 agent 加载。",
        )


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


TEXT_SUFFIXES = {".md", ".py", ".yaml", ".yml", ".json", ".html", ".lock", ".patch", ".txt", ".mjs"}


def in_publish_scan_scope(relative: Path) -> bool:
    """🔴 扫描面 = 全部 ``skills/`` + 全部 ``tools/`` + 仓库根 README，**从目录现算**。

    单一事实源：密钥闸、开发者路径闸共用这一个判据。从前 :func:`validate_artifacts` 里
    是一张点名到具体文件的白名单，于是每新建一个 Skill，它天生就在扫描面之外——闸看着
    是绿的，只是没看那个目录。这种"漏检长得跟通过一模一样"的洞，恰恰是新增内容最需要
    闸的时候。**新增闸一律复用本函数，别再手写名单。**
    """
    return relative == Path("README.md") or relative.parts[:1] in {("skills",), ("tools",)}


def scanned_text_files(root: Path = ROOT) -> list[tuple[Path, str]]:
    """扫描面内的每一个文本文件 → ``(相对路径, 正文)``。``scripts/`` 也在里面，不只是 SKILL.md。"""
    out: list[tuple[Path, str]] = []
    for path in publishable_files(root):
        relative = path.relative_to(root)
        if not in_publish_scan_scope(relative) or not path.is_file() or path.is_symlink():
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {"LICENSE", ".gitignore"}:
            continue
        out.append((relative, path.read_text(encoding="utf-8")))
    return out


# ── 密钥红线闸 ───────────────────────────────────────────────────────────────
# 🔴 **一个字符的密钥内容都不许进日志。** 这些脚本的输出会被用户原样贴进 issue、贴进群里、
# 转述给 agent；"只打前 8 位"看着人畜无害，可那 8 位就是密钥本身的一部分。主仓早有一条
# selfcheck 钉死 `dyh_` 不许出现在日志里，社区仓一直没有——于是同一个毛病在三处各长了一遍
# （reconcile.mjs 的自检行、doubaoya.mjs 的 401 报错、account-verify.mjs 的 keyRef）。
#
# 判据两条，都只认**真会出事的形态**：
#   1. 仓库里出现真钥匙字面量：dyh_ 后面跟一长串带数字的字母数字串。文档里的占位符是
#      dyh_… / dyh_... / dyh_xxxxxxxx / dyh_test，纯点或纯字母，天然不命中，不需要白名单。
#   2. 把名字里带 key/token/secret 的变量按**字面数字**截断——这个写法只有一个用途：打印前缀。
#      （`key.slice(0, eq)` 那种第二个参数是变量的，是 `--flag=value` 的解析，不是截断展示。）
#
# ponytail: 天花板 = 换个变量名（`k.slice(0,8)`）、或先把前缀存进中间变量再打印，本闸看不见。
# 升级路径是接一条真正的数据流分析 / eslint 规则，而不是往这里继续堆正则。
KEY_LITERAL = re.compile(r"\bdyh_(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{12,}\b")
SECRET_TRUNCATION = re.compile(
    # 前后缀都可空：**裸的 `key` 本身就是最常见的那个变量名**（三处泄露里有两处就叫 key）。
    r"\b[A-Za-z0-9_]*(?:key|token|secret)[A-Za-z0-9_]*\s*"
    r"(?:\.\s*(?:slice|substring|substr)\s*\(\s*-?\d+\s*(?:,\s*-?\d+\s*)?\)"
    r"|\[\s*-?\d*\s*:\s*-?\d+\s*\])",
    re.IGNORECASE,
)


def validate_no_key_material(root: Path = ROOT) -> None:
    """🔴 密钥内容不许进仓库、更不许进日志。判据与理由见上面那段注释。"""
    for relative, text in scanned_text_files(root):
        match = KEY_LITERAL.search(text)
        require(
            match is None,
            f"疑似真实 API key 字面量：{relative.as_posix()} 里出现 "
            f"{match.group(0)[:4] + '…' if match else ''}——密钥一个字符都不许进仓库",
        )
        match = SECRET_TRUNCATION.search(text)
        require(
            match is None,
            f"密钥被截断展示：{relative.as_posix()} 里的 `{match.group(0) if match else ''}` "
            "——前缀也是密钥内容，只许报「已设置 / 没设置」",
        )


def validate_artifacts(root: Path = ROOT) -> None:
    banned_parts ={"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".venv", "venv", "node_modules", "state", "runtime", "secrets", "profile", "mp-ark-archives"}
    banned_names = {".DS_Store", ".env", ".env.local", "session.json", "cookies.json", "auth-key", "runtime.json", "lock.json"}
    secret_patterns = (
        re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
        re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
        re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
        re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b"),
        re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{16,}\b"),
    )
    # 泄露的开发者路径 = 家目录后面跟着一个**真实用户名**。而文档里教人认路径形态时用的是
    # 省略号占位（形如 Users 后面直接跟 `...` 再跟文件名），那一段纯由点组成——它不可能是
    # 真实用户名，放它过去不放宽任何真实判据。所以这里收窄判据（排除纯点段），
    # 而不是登记豁免：豁免要按路径记账、还得定期清，而"占位符不是泄露"本就是这条规则的定义。
    # ⚠️ 下面的正则用字符串拼接写，是为了让本文件自己不被自己的判据命中——已经踩过一次。
    developer_paths = (
        re.compile("/" + r"Users/(?!\.+/)[^/\s]+/"),
        re.compile("/" + r"home/(?!\.+/)[^/\s]+/"),
        re.compile(r"[A-Za-z]:[\\/]" + r"Users[\\/](?!\.+[\\/])[^\\/:\s]+[\\/]"),
    )
    for path in publishable_files(root):
        relative = path.relative_to(root)
        # 扫描面是共用的单一事实源，见 in_publish_scan_scope。
        if not in_publish_scan_scope(relative):
            continue
        require(not path.is_symlink(), f"symlink is not publishable: {relative}")
        require(not (set(relative.parts) & banned_parts), f"runtime/cache artifact found: {relative}")
        require(path.is_file(), f"publishable path is not a file: {relative}")
        require(path.name not in banned_names and not path.name.startswith(".env."), f"secret/runtime artifact found: {relative}")
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {"LICENSE", ".gitignore"}:
            continue
        text = path.read_text(encoding="utf-8")
        for pattern in secret_patterns:
            require(not pattern.search(text), f"possible secret found: {relative}")
        for pattern in developer_paths:
            require(not pattern.search(text), f"developer path found: {relative}")


def validate_retired_discoverability(root: Path = ROOT) -> None:
    """删包前必须过的闸：已下架包的能力，得在网关的能力索引里仍然找得到。

    删掉的是**壳**，能力的发现面必须先在新家站好；否则「删掉然后同步」会退化成
    「删掉然后失联」——老用户的包被对账器归档了，而新用户在索引里也找不到这条能力，
    这条能力就等于从产品上消失了，且没有任何地方会报错。

    输入是 known-hashes.json 里的 retiredEndpoints（由 tools/build_known_hashes.py 从
    git 历史扒出来），所以这道闸不依赖 git、离线可跑。
    """
    known_path = root / "known-hashes.json"
    require(known_path.is_file(), "known-hashes.json 不见了：先跑 tools/build_known_hashes.py")
    known = load_json(known_path)
    require(isinstance(known, dict), "known-hashes.json 顶层不是对象")
    retired_endpoints = known.get("retiredEndpoints")
    require(isinstance(retired_endpoints, dict), "known-hashes.json 缺 retiredEndpoints")

    index_path = root / "skills" / GATEWAY_SKILL / "references" / "capability-index.md"
    require(index_path.is_file(), f"能力索引不见了：{display_path(index_path)}")
    index_text = index_path.read_text(encoding="utf-8")

    stale_exemptions = RETIRED_WITH_CAPABILITY - set(retired_endpoints)
    require(
        not stale_exemptions,
        f"RETIRED_WITH_CAPABILITY 里有已经不是「已下架包」的条目：{sorted(stale_exemptions)}，"
        "请删掉——豁免表不该留孤儿",
    )

    for slug in sorted(retired_endpoints):
        endpoints = retired_endpoints[slug]
        missing = [e for e in endpoints if e not in index_text]
        if slug in RETIRED_WITH_CAPABILITY:
            require(
                bool(missing),
                f"{slug} 的能力已经回到能力索引里了（{endpoints}），"
                "请把它从 RETIRED_WITH_CAPABILITY 删掉——豁免表要自动清账",
            )
            continue
        require(
            not missing,
            f"删包会让能力失联：已下架的 {slug} 当年调的 {missing} 在 "
            f"{GATEWAY_SKILL}/references/capability-index.md 里找不到。"
            "删的是壳，能力的发现面必须先在新家站好——要么把这条能力补进索引，"
            "要么确认它在发现接口里也已下架后加进 RETIRED_WITH_CAPABILITY",
        )


def validate_repository(root: Path = ROOT) -> None:
    validate_skill_inventory(root)
    validate_readme(root)
    validate_clawhub_manifest(root)
    validate_routing(root)
    validate_authoring_chain(root)
    validate_banned_word_fields(root)
    validate_gateway_contract_freedom(root)
    validate_call_routes(root)
    validate_retired_discoverability(root)
    validate_no_key_material(root)
    validate_artifacts(root)


def main() -> int:
    validate_repository()
    print(
        f"validated doubaoya-community: {len(discover_skill_dirs())} Skills, "
        f"ClawHub manifest, WeChat routing and the {len(AUTHORING_CHAIN)}-hop authoring chain"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as exc:
        print(f"validation error: {exc}", file=sys.stderr)
        raise SystemExit(1)
