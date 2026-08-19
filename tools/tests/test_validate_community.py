from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
import unittest.mock


VALIDATOR = Path(__file__).resolve().parents[1] / "validate_community.py"
SPEC = importlib.util.spec_from_file_location("doubaoya_community_validator", VALIDATOR)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


class CommunityValidatorTests(unittest.TestCase):
    def test_repository_is_valid(self):
        validator.validate_repository()

    def test_frontmatter_rejects_duplicate_name(self):
        with tempfile.TemporaryDirectory() as directory:
            skill = Path(directory) / "SKILL.md"
            skill.write_text("---\nname: first\nname: second\ndescription: fixture\n---\n", encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "invalid name frontmatter"):
                validator.frontmatter_name(skill)

    def routing_fixture(self, root: Path) -> Path:
        destination = root / "skills" / "doubaoya"
        (destination / "references").mkdir(parents=True)
        shutil.copy2(validator.ROUTING, destination / "references" / "wechat-routing.json")
        shutil.copy2(validator.SKILLS / "doubaoya" / "SKILL.md", destination / "SKILL.md")
        routing = json.loads(validator.ROUTING.read_text(encoding="utf-8"))
        names = set()
        for route in routing["routes"]:
            if route.get("primary_skill"):
                names.add(route["primary_skill"])
            names.update(route.get("candidate_skills", []))
        for name in names:
            skill = root / "skills" / name
            skill.mkdir(parents=True, exist_ok=True)
            (skill / "SKILL.md").write_text(f"---\nname: {name}\ndescription: fixture\n---\n", encoding="utf-8")
        return destination / "references" / "wechat-routing.json"

    def mutate_json(self, path: Path, mutation) -> None:
        value = json.loads(path.read_text(encoding="utf-8"))
        mutation(value)
        path.write_text(json.dumps(value), encoding="utf-8")

    @staticmethod
    def route(value: dict, route_id: str) -> dict:
        """按 id 取路由：按下标取会在新增一条路由时静默指向别人（已踩过）。"""
        return next(route for route in value["routes"] if route["id"] == route_id)

    def test_routing_rejects_unknown_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)
            self.mutate_json(routing, lambda value: self.route(value, "doubaoya-cloud-public-data").update({"fallback": "local"}))
            with self.assertRaisesRegex(validator.ValidationError, "unexpected route doubaoya-cloud-public-data keys"):
                validator.validate_routing(root)

    def test_routing_rejects_moved_authoring_terminal(self):
        # 原先这条守的是 MP Ark 的「不支持互动指标」边界，那条路由随 wechat-mp-exporter
        # 一起下架了。边界没了不代表这个位置不需要闸：改守写作链的终点——它漂了，
        # 「写完要进草稿箱」就会停在半路，而计划看着完全正常。
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)
            self.mutate_json(
                routing,
                # 换成链上**存在但不是终点**的那一跳：写死一个具体壳名，壳一下架这条测试就跟着烂。
                lambda value: self.route(value, "doubaoya-authoring-delivery").update(
                    {"terminal_skill": validator.AUTHORING_CHAIN[0]}
                ),
            )
            with self.assertRaisesRegex(validator.ValidationError, "authoring route must terminate at wechat-article-pipeline"):
                validator.validate_routing(root)

    # ── 路由指针闸：routing json 里点名 Skill 的字段不许指向不存在的目录 ──────────
    # 判据是**结构性**的（顶层带 routes 数组即算路由表），所以这些 fixture 故意不叫
    # *-routing.json —— 文件名换了闸还得照扫，否则新增第三份路由表就天然在扫描面之外。
    def pointer_fixture(self, root: Path, mutate) -> None:
        for name in ("doubaoya", "wechat-article-pipeline"):
            (root / "skills" / name).mkdir(parents=True)
            (root / "skills" / name / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: x\n---\n", encoding="utf-8"
            )
        references = root / "skills" / "doubaoya" / "references"
        references.mkdir()
        table = {
            "routes": [{
                "id": "r1",
                "primary_skill": "doubaoya",
                "terminal_skill": "wechat-article-pipeline",
                "candidate_skills": ["doubaoya"],
            }]
        }
        mutate(table)
        (references / "some-table.json").write_text(json.dumps(table), encoding="utf-8")

    def assert_pointer_rejected(self, mutate) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.pointer_fixture(root, mutate)
            with self.assertRaisesRegex(validator.ValidationError, "路由指向不存在的 Skill"):
                validator.validate_routing_skill_pointers(root)

    def test_route_pointers_reject_missing_primary_skill(self):
        self.assert_pointer_rejected(lambda t: t["routes"][0].update(primary_skill="ghost-pkg"))

    def test_route_pointers_reject_missing_terminal_skill(self):
        self.assert_pointer_rejected(lambda t: t["routes"][0].update(terminal_skill="ghost-pkg"))

    def test_route_pointers_reject_missing_candidate_skill(self):
        self.assert_pointer_rejected(lambda t: t["routes"][0]["candidate_skills"].append("ghost-pkg"))

    def test_route_pointers_pass_when_every_target_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.pointer_fixture(root, lambda t: None)
            validator.validate_routing_skill_pointers(root)

    def test_route_pointer_gate_fails_loudly_when_it_scans_nothing(self):
        # 🔴 一个路由表都没扫到 = 闸在空转，而空转长得和真通过一模一样。
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "skills" / "doubaoya").mkdir(parents=True)
            (root / "skills" / "doubaoya" / "SKILL.md").write_text(
                "---\nname: doubaoya\ndescription: x\n---\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(validator.ValidationError, "一个 routing 表都没扫到"):
                validator.validate_routing_skill_pointers(root)

    # ── 差集闸 + description 预算闸 ────────────────────────────────────────
    def budget_fixture(self, root: Path, descriptions: dict[str, str], retired: dict | None = None) -> None:
        for name, text in descriptions.items():
            (root / "skills" / name).mkdir(parents=True)
            (root / "skills" / name / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: {text}\n---\n", encoding="utf-8"
            )
        (root / "known-hashes.json").write_text(
            json.dumps({"skills": {}, "retiredEndpoints": {}, "retiredTriggerWords": retired or {}}),
            encoding="utf-8",
        )

    def test_trigger_gate_rejects_rescuing_one_word_and_dropping_the_rest(self):
        # 🔴 这是它唯一要防的形状：同一条能力上抢回一个词、漏掉其余几个。
        # 「全删」那种一眼可见的失败不是重点，「补了一点点所以看着像做过了」才是。
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.budget_fixture(
                root,
                {"doubaoya": "小红书笔记分析数据"},
                {"xiaohongshu-note-analyzer": ["笔记分析", "笔记拆解", "对标分析", "选题拆解", "爆款结构"]},
            )
            with self.assertRaisesRegex(validator.ValidationError, "删包/改词弄丢了话术"):
                validator.validate_trigger_word_coverage(root)

    def test_trigger_gate_passes_when_every_word_survives(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.budget_fixture(
                root,
                {"doubaoya": "小红书 笔记分析 笔记拆解 对标分析"},
                {"xiaohongshu-note-analyzer": ["笔记分析", "笔记拆解", "对标分析"]},
            )
            self.assertEqual(validator.validate_trigger_word_coverage(root), [])

    def test_trigger_gate_ignores_whitespace_differences(self):
        # 「AI 视频号」与「AI视频号」是同一个词，不该因为一个空格判成丢词
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.budget_fixture(root, {"doubaoya": "AI视频号日报"}, {"wechat-channels-ai-feed": ["AI 视频号"]})
            self.assertEqual(validator.validate_trigger_word_coverage(root), [])

    def test_trigger_gate_skips_capabilities_deleted_for_real(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.budget_fixture(root, {"doubaoya": "选题"}, {"celebrity-slice": ["明星切片", "字幕烧制"]})
            self.assertEqual(validator.validate_trigger_word_coverage(root), [])

    def test_description_budget_rejects_blowing_the_shared_pool(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.budget_fixture(root, {f"pkg-{i}": "词" * 500 for i in range(20)})
            with self.assertRaisesRegex(validator.ValidationError, "共享预算"):
                validator.validate_description_budget(root)

    def test_description_budget_rejects_one_oversized_description(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.budget_fixture(root, {"fat": "词" * (validator.SPEC_DESCRIPTION_LIMIT + 1)})
            with self.assertRaisesRegex(validator.ValidationError, "规范上限"):
                validator.validate_description_budget(root)

    def test_description_budget_warns_at_the_legacy_host_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.budget_fixture(root, {"chatty": "词" * (validator.HOST_LEGACY_SOFT_LIMIT + 1)})
            warnings = validator.validate_description_budget(root)
            self.assertTrue(any("旧版宿主" in w for w in warnings))

    def test_routing_rejects_cloud_without_api_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)

            def remove_auth_boundary(value):
                self.route(value, "doubaoya-cloud-public-data")["auth"]["requires_doubaoya_api_key"] = False

            self.mutate_json(routing, remove_auth_boundary)
            with self.assertRaisesRegex(validator.ValidationError, "invalid cloud auth boundary"):
                validator.validate_routing(root)

    def test_routing_rejects_authoring_route_below_cloud(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            routing = self.routing_fixture(root)

            def demote_authoring(value):
                self.route(value, "doubaoya-authoring-delivery")["priority"] = 80
                value["routes"] = sorted(value["routes"], key=lambda route: -route["priority"])

            self.mutate_json(routing, demote_authoring)
            with self.assertRaisesRegex(validator.ValidationError, "authoring route must precede"):
                validator.validate_routing(root)

    def test_authoring_chain_rejects_missing_forward_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            skill = root / "skills" / validator.AUTHORING_CHAIN[0] / "SKILL.md"
            text = skill.read_text(encoding="utf-8")
            skill.write_text(text[: text.index(validator.NEXT_STEP_HEADING)], encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "has no .* section"):
                validator.validate_authoring_chain(root)

    def test_authoring_chain_rejects_section_naming_no_downstream_skill(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            skill = root / "skills" / validator.AUTHORING_CHAIN[1] / "SKILL.md"
            text = skill.read_text(encoding="utf-8")
            start = text.index(validator.NEXT_STEP_HEADING)
            end = text.index("\n## ", start)
            # 有标题、有正文、没点名任何下游——比整节缺失更难肉眼发现的断头方式。
            skill.write_text(
                text[:start] + f"{validator.NEXT_STEP_HEADING}\n\n到此为止。\n" + text[end + 1 :],
                encoding="utf-8",
            )
            with self.assertRaisesRegex(validator.ValidationError, "names no downstream Skill"):
                validator.validate_authoring_chain(root)

    def test_authoring_chain_rejects_dead_skill_link_in_dby(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            # dby 是任务后导航的单一事实源，它整篇都要扫——链上 skill 只扫「下一步」那一节。
            skill = root / "skills" / "dby" / "SKILL.md"
            skill.write_text(skill.read_text(encoding="utf-8") + "\n\n排版走 `wechat-render`。\n", encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "dby/SKILL.md routes to Skills"):
                validator.validate_authoring_chain(root)

    def test_authoring_chain_rejects_pointer_to_a_retired_package(self):
        """doubaoya 点名一个**已下架的技能包** = 把 agent 导向装不上的包，且全程无报错。

        2026-08-19 合并四个孪生壳时，它正文里两处 `wechat-hot-write` / `wechat-title` 就是这么
        活下来的——链上 Skill 的「下一步」有闸、dby 全篇有闸，偏偏分发量最大的这一份没有。
        判据比 dby 那条收窄一档：只报**曾经真的是技能包目录**的名字，所以 doubaoya 正当点名的
        能力 slug（seedream-lite）、端点名片段（ai-feed）不会误报——下面第二个断言钉住这一点。
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            skill = root / "skills" / "doubaoya" / "SKILL.md"
            original = skill.read_text(encoding="utf-8")
            known = json.loads((validator.ROOT / "known-hashes.json").read_text(encoding="utf-8"))
            retired = sorted(set(known["skills"])
                             - {path.name for path in validator.discover_skill_dirs(root)})
            self.assertTrue(retired, "历史闭集里没有已下架包，这条测试就没有素材")
            skill.write_text(original + f"\n\n写正文走 `{retired[0]}`。\n", encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "还在点名已下架的技能包"):
                validator.validate_authoring_chain(root)

            # 反向：能力 slug / 端点名片段长得像 Skill，但从来不是包，不许误报。
            skill.write_text(original + "\n\n日报源在 `GET /api/apis` 里搜 `ai-feed`；`seedream-lite` 已下架。\n",
                             encoding="utf-8")
            validator.validate_authoring_chain(root)

    def test_retired_pointer_scan_covers_every_skill_not_just_the_entry_points(self):
        """扫描面是**全部** Skill 正文与 references，不是 doubaoya / dby 那两份。

        这条测试是 2026-08-19 退役 10 个壳时买回来的：闸只盯 doubaoya，于是
        wechat-hot-article 正文里的 `gzh-search` 和 image-gen 正文里的 `xiaohongshu-search`
        全靠人 grep 才发现。闸盯着谁，就只有谁不会烂——所以这里把**普通 Skill**
        和 **references 目录**各钉一条；少扫任何一处，对应断言就不再抛错。
        """
        known = json.loads((validator.ROOT / "known-hashes.json").read_text(encoding="utf-8"))
        # ⚠️ 这里原本写死 `skills/image-gen/SKILL.md`——那个包 2026-08-19 随批 3 退役，
        # 于是**这条测试自己也烂了一次**（它正是为了防这种烂才写的）。改成现取一个普通 Skill：
        # 判据是「普通 Skill 的正文也在扫描面内」，具体是哪个包无关紧要。
        ordinary = next(
            d.name for d in validator.discover_skill_dirs(validator.ROOT)
            if d.name not in {"doubaoya", "dby", "doubaoya-gateway"}
        )
        for relative in (f"skills/{ordinary}/SKILL.md", "skills/doubaoya-gateway/references/routing-pitfalls.md"):
            with self.subTest(relative), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.repository_fixture(root)
                retired = sorted(set(known["skills"])
                                 - {path.name for path in validator.discover_skill_dirs(root)})
                self.assertTrue(retired, "历史闭集里没有已下架包，这条测试就没有素材")
                target = root / relative
                target.write_text(target.read_text(encoding="utf-8") + f"\n\n取数走 `{retired[0]}`。\n",
                                  encoding="utf-8")
                with self.assertRaisesRegex(validator.ValidationError, "还在点名已下架的技能包"):
                    validator.validate_authoring_chain(root)

    def test_authoring_chain_rejects_dead_skill_link(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            # 链上第一跳**现取**：写死包名的测试会跟着包一起烂（原来写的是 wechat-banned-words，
            # 它 2026-08-19 随批 3 退役，这条当场 FileNotFoundError）。
            skill = root / "skills" / validator.AUTHORING_CHAIN[0] / "SKILL.md"
            text = skill.read_text(encoding="utf-8")
            # `wechat-render` 只是一个 API 端点，不是 Skill——正是幻觉引用最爱的那种名字。
            skill.write_text(
                text.replace(validator.NEXT_STEP_HEADING, f"{validator.NEXT_STEP_HEADING}\n\n排版走 `wechat-render`。", 1),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(validator.ValidationError, "wechat-render"):
                validator.validate_authoring_chain(root)

    def repository_fixture(self, root: Path) -> None:
        shutil.copytree(validator.SKILLS, root / "skills")
        shutil.copy2(validator.ROOT / "README.md", root / "README.md")
        # 「doubaoya 不许点名已下架技能包」那道闸拿 known-hashes.json 的历史闭集当取材范围。
        shutil.copy2(validator.ROOT / "known-hashes.json", root / "known-hashes.json")

    def a_non_safety_skill(self, root: Path) -> Path:
        """现取一个**不碰违禁词检测**的存活 Skill，用作分域闸的域外样本。

        这里刻意不写死包名。原本三处写的是 `doubao-websearch`，它 2026-08-19 作为
        零装机纯壳退役，三条测试当场 FileNotFoundError——**写死包名的测试会跟着包一起烂**。
        分域闸要证的性质是「域外 / 域内」，从来不是「某个特定的包」，所以判据也该这么写。
        """
        markers = ("check-banned-words", "content-safety-check", "wechat-prohibited-word")
        for directory in validator.discover_skill_dirs(root):
            in_safety_domain = any(
                marker in candidate.read_text(encoding="utf-8", errors="ignore")
                for candidate in sorted(directory.rglob("*"))
                if candidate.is_file()
                for marker in markers
            )
            if not in_safety_domain:
                return directory
        self.fail("仓里一个域外 Skill 都没有了，分域闸的这几条测试失去素材")

    def test_banned_word_gate_rejects_ghost_fields(self):
        # 三个字段上游从来没回过。文档教 agent 读 `matchedWords` 的那阵子，「为空 ⇒ 合规 ✅」
        # 是个恒真判据，每一段文案都被放行——变异证据分别覆盖「全仓禁」与「只在违禁词 Skill 禁」两类。
        for skill_name, injection, ghost in (
            ("multi-banned-words", "若 `matchedWords` 为空则合规。", "matchedWords"),
            ("multi-banned-words", "读 `data.suggestions` 拿建议。", "suggestions"),
            # 第三条是**域外**样本：riskLevel 全仓禁，连不碰违禁词的包也不许写。
            # 用哪个包无所谓，现取即可（见 a_non_safety_skill 的注释）。
            (None, "整体风险等级看 `riskLevel`。", "riskLevel"),
        ):
            with self.subTest(skill=skill_name or "任一域外 Skill"), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.repository_fixture(root)
                skill = (root / "skills" / skill_name / "SKILL.md") if skill_name else (self.a_non_safety_skill(root) / "SKILL.md")
                skill.write_text(skill.read_text(encoding="utf-8") + f"\n\n{injection}\n", encoding="utf-8")
                with self.assertRaisesRegex(validator.ValidationError, f"still names .{ghost}."):
                    validator.validate_banned_word_fields(root)

    def test_banned_word_gate_keeps_the_real_suggestions_field(self):
        # `result.suggestions` 是联网搜索能力的真字段。闸若一刀切禁掉 `suggestions`，
        # 就会把域外那份没问题的文档打红，逼着后来的人删掉正确的指引——所以按 Skill 分域禁。
        #
        # 这条原本断言 doubao-websearch 的正文里**确实写着** result.suggestions；那个壳
        # 2026-08-19 退役后，全仓不再有任何一份文档提这个字段（字段规格改由详情端点现拉，
        # 是合并的设计而非回归）。所以判据从「找一份真写了的文档」改成**自己种一份**——
        # 要证的性质是「域外写 suggestions 不该红」，种出来的样本证得一样硬，且不会再烂。
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            outsider = self.a_non_safety_skill(root) / "SKILL.md"
            outsider.write_text(
                outsider.read_text(encoding="utf-8") + "\n\n综合答案与延伸提问在 `result.suggestions` 里。\n",
                encoding="utf-8",
            )
            validator.validate_banned_word_fields(root)

    def test_banned_word_gate_covers_skills_whose_endpoint_lives_in_scripts(self):
        # 回归证据：分域判定曾只读 SKILL.md，而当时 wechat-banned-words 的端点只写在
        # scripts/check_words.py 的 API_URL 里——于是**最该管的那个 Skill** 被判成域外，
        # `suggestions` 混进去也不报。分域改成扫整个技能包后这条才红。
        #
        # 那个包 2026-08-19 退役了，仓里也不再有「标记只出现在脚本里」的真实样本
        # （multi-banned-words 的标记 SKILL.md 与脚本里都有）。所以**自己种一个**这种形状的包：
        # 要证的性质是「分域看整个目录、不只看 SKILL.md」，种出来的样本证得一样硬，且不会再烂。
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            planted = root / "skills" / "planted-safety-skill"
            (planted / "scripts").mkdir(parents=True)
            # 标记**只**出现在脚本里，SKILL.md 一个字都不提——正是当年漏判的那种形状。
            (planted / "scripts" / "check.py").write_text(
                'API_URL = "https://doubaoya.com/api/skills/check-banned-words/invoke"\n', encoding="utf-8"
            )
            (planted / "SKILL.md").write_text(
                "---\nname: planted-safety-skill\ndescription: 违禁词检测样本包。\n---\n\n读 `data.suggestions` 拿建议。\n",
                encoding="utf-8",
            )
            self.assertNotIn("check-banned-words", (planted / "SKILL.md").read_text(encoding="utf-8"))
            with self.assertRaisesRegex(validator.ValidationError, "still names .suggestions."):
                validator.validate_banned_word_fields(root)

    def test_banned_word_gate_rejects_chinese_ghost_phrases_in_description(self):
        # 英文字面量禁掉之后，同一个谎换成中文说曾整个穿过去：头部话术承诺「标好风险等级」，
        # 而同一份文件的红线写着接口不返回它。description 是选路层，说错影响面最大。
        for skill_name, original, mutated, phrase in (
            (
                "multi-banned-words",
                "多平台违禁词检测——",
                "多平台违禁词检测，给替换建议——",
                "替换建议",
            ),
        ):
            with self.subTest(skill=skill_name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.repository_fixture(root)
                skill = root / "skills" / skill_name / "SKILL.md"
                text = skill.read_text(encoding="utf-8")
                self.assertIn(original, text)
                skill.write_text(text.replace(original, mutated, 1), encoding="utf-8")
                with self.assertRaisesRegex(validator.ValidationError, phrase):
                    validator.validate_banned_word_fields(root)

    def test_banned_word_gate_leaves_body_negations_alone(self):
        # 闸只扫 description 的**全部理由**：正文里那些「接口不返回风险等级」是对的，
        # 一刀切扫正文会把它们打红，逼后来的人删掉正确的指引。
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            skill = root / "skills" / "multi-banned-words" / "SKILL.md"
            skill.write_text(
                skill.read_text(encoding="utf-8") + "\n\n> 接口不返回风险等级与替换建议，命中词清单也没有。\n",
                encoding="utf-8",
            )
            validator.validate_banned_word_fields(root)

    def test_banned_word_gate_does_not_police_unrelated_skills(self):
        # 分域禁：违禁词之外的能力谈「风险等级」可能完全正当，闸不该越界。
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            skill = self.a_non_safety_skill(root) / "SKILL.md"
            skill.write_text(skill.read_text(encoding="utf-8").replace("description:", "description: 风险等级 ", 1), encoding="utf-8")
            validator.validate_banned_word_fields(root)

    def test_frontmatter_description_reads_folded_blocks(self):
        # doubaoya 用折叠式 ``>-``，description 正文在后面的缩进行里；
        # 只取首行会让闸对折叠式 description 视而不见。
        description = validator.frontmatter_description(validator.SKILLS / "doubaoya" / "SKILL.md")
        self.assertIn("都爆鸭", description)
        self.assertNotIn(">-", description)
        single = validator.frontmatter_description(validator.SKILLS / "multi-banned-words" / "SKILL.md")
        self.assertTrue(single.startswith("多平台违禁词检测"))
        self.assertNotIn("version:", single)

    def test_readme_rejects_stale_count_and_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.repository_fixture(root)
            readme = root / "README.md"
            # 计数从 skills/ 现场数出来：写死数字会随每次新增 Skill 变成哑弹（已哑过一次）。
            count = len(validator.discover_skill_dirs(root))
            readme.write_text(
                readme.read_text(encoding="utf-8").replace(f"共 {count} 个", f"共 {count - 1} 个"),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(validator.ValidationError, "README Skill count is stale"):
                validator.validate_readme(root)

    def test_artifacts_reject_developer_paths_and_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.mkdir(exist_ok=True)
            developer_path = Path("/", "Users", "example", "private")
            (root / "README.md").write_text(f"checkout: {developer_path}\n", encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "developer path found"):
                validator.validate_artifacts(root)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "tools" / "__pycache__"
            cache.mkdir(parents=True)
            (cache / "state.py").write_text("value = 1\n", encoding="utf-8")
            with self.assertRaisesRegex(validator.ValidationError, "runtime/cache artifact found"):
                validator.validate_artifacts(root)

    def test_artifacts_scan_every_skill_not_a_named_list(self):
        """扫描面必须从 skills/ 现算。

        从前它是一张点名到具体文件的白名单，于是**任何新建的 Skill 天生就在扫描面之外**——
        闸照常打绿，只是没看那个目录。这里用一个白名单里绝不可能出现的名字建 Skill，
        它必须照样被扫到；这条断言挂掉就说明白名单又长回来了。

        变异在**整包三处**各跑一遍：入口 SKILL.md、references/ 下的按需加载文档、scripts/
        下的脚本。密钥最可能落在后两处而不是入口——真要泄露，泄露的是作者本机跑通的那份
        脚本或那份细节文档，而不是他反复誊写的门面。只扫入口 = 把闸建在没人会走的那道门上。
        """
        for location in ("SKILL.md", "references/detail.md", "scripts/run.py"):
            for name, payload, expected in (
                ("secret", "token: " + "ghp_" + "A" * 30 + "\n", "possible secret found"),
                ("devpath", "cwd: " + str(Path("/", "Users", "example", "private")) + "\n", "developer path found"),
            ):
                with self.subTest(location=location, name=name), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    skill = root / "skills" / "brand-new-skill-nobody-listed"
                    target = skill / location
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(payload, encoding="utf-8")
                    with self.assertRaisesRegex(validator.ValidationError, expected):
                        validator.validate_artifacts(root)

    def test_artifacts_allow_ellipsis_placeholder_paths(self):
        """省略号占位不是泄露。

        文档教用户认「本地绝对路径」这种形态时，写的是家目录后面直接跟 `...`。那一段纯由点
        组成，不可能是真实用户名——判据本就该把它排除在外。要是靠登记豁免来放行，豁免表会
        随文档增长，而每条豁免都是一个真泄露可以藏进去的位置。
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            skill = root / "skills" / "placeholder-doc-skill"
            skill.mkdir(parents=True)
            placeholder = "/" + "Users/.../cover.png"
            (skill / "SKILL.md").write_text(f'本地图片（`<img src="{placeholder}">`）服务端读不到。\n', encoding="utf-8")
            validator.validate_artifacts(root)


class CallRouteGateTests(unittest.TestCase):
    """调用路由闸：文档/脚本里写死的每条路径都必须真的在主仓 catalog 的对应集合里。

    平台有两个不相交的能力集合（skills 走 /api/skills/<slug>/invoke，apis 走
    /api/apis/<platform>/<slug>/call），互相不回落。写错集合 = 必然 404，而"404 就去查
    发现接口"的指引又永远查不到那个 slug，agent 原地死循环——本闸防的就是这个。
    """

    # 一份最小的假 catalog：只要标记齐全，解析规则就该认得出这两个集合。
    # 用假数据而不是真主仓，测试才能在没有主仓的机器上跑。
    FAKE_CATALOG = (
        "const skillDefinitions: SkillDefinition[] = [\n"
        '  {\n    slug: "real-skill",\n    operationKey: "skill.real",\n  },\n'
        '  {\n    slug: "retired-skill",\n    operationKey: "skill.retired",\n'
        '    availability: { status: "hidden" },\n  },\n'
        "];\n"
        "export const skills: Skill[] = skillDefinitions.map(applyCreditPricing);\n"
        "const apiEndpointDefinitions: ApiEndpointDefinition[] = [\n"
        '  {\n    platform: "trend",\n    slug: "real-endpoint",\n    operationKey: "api.trend.real",\n  },\n'
        "];\n"
        "export const apiEndpoints: ApiEndpoint[] = apiEndpointDefinitions.map(applyCreditPricing);\n"
    )

    def fixture(self, body: str) -> tuple[Path, Path]:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        root = Path(directory)
        (root / "skills" / "probe").mkdir(parents=True)
        (root / "skills" / "probe" / "SKILL.md").write_text(body, encoding="utf-8")
        catalog = root / "catalog.ts"
        catalog.write_text(self.FAKE_CATALOG, encoding="utf-8")
        return root, catalog

    def check(self, body: str, catalog: Path | None = None) -> None:
        root, default_catalog = self.fixture(body)
        target = catalog if catalog is not None else default_catalog
        with unittest.mock.patch.dict(os.environ, {validator.CATALOG_ENV: str(target)}):
            validator.validate_call_routes(root)

    def test_real_routes_pass(self):
        self.check("`POST /api/skills/real-skill/invoke` `POST /api/apis/trend/real-endpoint/call`\n")

    def test_detail_endpoints_pass(self):
        """网关的选路索引给的是详情端点，不是调用路径——这两条形态也必须被认出来。"""
        self.check("`GET /api/skills/real-skill` `GET /api/apis/trend/real-endpoint`\n")

    def test_rejects_api_slug_on_the_skill_detail_endpoint(self):
        with self.assertRaisesRegex(validator.ValidationError, r"详情端点是 /api/apis/<platform>/real-endpoint"):
            self.check("`GET /api/skills/real-endpoint`\n")

    def test_rejects_skill_slug_on_the_api_detail_endpoint(self):
        with self.assertRaisesRegex(validator.ValidationError, r"详情端点是 /api/skills/real-skill"):
            self.check("`GET /api/apis/tool/real-skill`\n")

    def test_rejects_unknown_detail_endpoint(self):
        with self.assertRaisesRegex(validator.ValidationError, "指向详情端点 /api/skills/ghost"):
            self.check("`GET /api/skills/ghost`\n")

    def test_collection_endpoints_are_not_capability_details(self):
        """/api/skills/search|recommend|installs 是集合级端点，本来就不在 slug 集合里。"""
        self.check("`GET /api/skills/search` `POST /api/skills/recommend` `GET /api/skills/installs`\n")

    def test_invoke_path_is_not_double_counted_as_a_detail_path(self):
        """`…/invoke` 已由调用路径那条规则管；详情规则不许再把它的前缀当成一条详情端点。"""
        self.check("`POST /api/skills/real-skill/invoke`\n")

    def test_rejects_api_slug_on_the_skills_route(self):
        # 这是 2026-08 那轮的病根形状：83 条数据能力被写成 /api/skills/<slug>/invoke，全数 404。
        with self.assertRaisesRegex(validator.ValidationError, r"得走 /api/apis/<platform>/real-endpoint/call"):
            self.check("`POST /api/skills/real-endpoint/invoke`\n")

    def test_rejects_package_directory_name_masquerading_as_slug(self):
        # 用一个**仍然存在**的技能包目录名（原来写的是 content-parse，它随批 3 退役——
        # 那之后这条仍然绿，但走的是「历史闭集里的旧包名」那条分支，证的已经不是同一件事了）。
        with self.assertRaisesRegex(validator.ValidationError, "多半把技能包目录名当成了调用 slug"):
            self.check("`POST /api/skills/wechat-article-pipeline/invoke`\n")

    def test_rejects_skill_slug_on_the_apis_route(self):
        with self.assertRaisesRegex(validator.ValidationError, r"得走 /api/skills/real-skill/invoke"):
            self.check("`POST /api/apis/tool/real-skill/call`\n")

    def test_rejects_unknown_endpoint(self):
        with self.assertRaisesRegex(validator.ValidationError, "这条路径必然 404"):
            self.check("`POST /api/apis/douyin/no-such-endpoint/call`\n")

    def test_retired_capability_may_still_be_named(self):
        """已下架的能力允许被点名——文档本来就得写明某条能力不能用了。

        （原注举的例子是 seedream-5-lite 的墓碑 SKILL.md，那具墓碑 2026-08-19 也删了；
        判据与例子无关，用的是合成的 retired-skill。）
        """
        self.check("`POST /api/skills/retired-skill/invoke` 已下架，别调\n")

    def test_placeholders_are_not_call_sites(self):
        self.check("`/api/skills/<slug>/invoke` `/api/apis/<platform>/<slug>/call` `/api/skills/${s}/invoke`\n")

    def test_pending_route_exemption_clears_itself_once_landed(self):
        """豁免表不许留成永久的洞：路由一旦上线，闸反过来要求删掉那条豁免。"""
        with unittest.mock.patch.object(validator, "PENDING_UPSTREAM_ROUTES", {("trend", "real-endpoint")}):
            with self.assertRaisesRegex(validator.ValidationError, "请把它从 PENDING_UPSTREAM_ROUTES 里删掉"):
                self.check("`POST /api/apis/trend/real-endpoint/call`\n")

    def test_pending_route_exemption_passes_while_unlanded(self):
        with unittest.mock.patch.object(validator, "PENDING_UPSTREAM_ROUTES", {("media", "asr")}):
            self.check("`POST /api/apis/media/asr/call`\n")

    def test_missing_catalog_warns_instead_of_failing(self):
        """社区仓要能在没有主仓的机器上独立通过校验——跳过并 warn，不硬红。"""
        root, catalog = self.fixture("`POST /api/skills/whatever-bogus/invoke`\n")
        catalog.unlink()
        with unittest.mock.patch.dict(os.environ, {validator.CATALOG_ENV: str(catalog)}):
            validator.validate_call_routes(root)

    def test_catalog_shape_drift_fails_loudly(self):
        """闸悄悄退化成「什么都不查」比没有闸更糟：解析标记找不到就打红。"""
        root, catalog = self.fixture("`POST /api/skills/real-skill/invoke`\n")
        catalog.write_text("export const nothing = 1;\n", encoding="utf-8")
        with unittest.mock.patch.dict(os.environ, {validator.CATALOG_ENV: str(catalog)}):
            with self.assertRaisesRegex(validator.ValidationError, "catalog 结构已变"):
                validator.validate_call_routes(root)


class GatewayContractFreedomTests(unittest.TestCase):
    """选路层 Skill 不许把逐能力的入参烤进正文。

    每个用例都是一次变异：拿仓库里真实的文档，只做一处「有人图省事把参数抄进来」
    的改动，断言闸当场打红。控制组（未改动的真文件）必须绿——否则这些红只能证明闸很吵。
    """

    #: 每个变异都在这四处各跑一遍，钉住两件事：
    #: ① 扫描面是**整个技能包**（references/ 是参数最舒服的落点，README 是最容易被忘的那份）；
    #: ② 扫描面是**两个包**——doubaoya 的分发量比网关大，它烤进去的参数一样会漂。
    DOCUMENTS = (
        (validator.GATEWAY_SKILL, "SKILL.md"),
        (validator.GATEWAY_SKILL, "references/routing-pitfalls.md"),
        ("doubaoya", "SKILL.md"),
        ("doubaoya", "README.md"),
    )

    def fixture(self, mutate=None, target: tuple[str, str] | None = None) -> Path:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        root = Path(directory)
        (root / "skills").mkdir(parents=True)
        for name in validator.CONTRACT_FREE_SKILLS:
            shutil.copytree(validator.SKILLS / name, root / "skills" / name)
        if mutate is not None:
            skill, relative = target or (validator.GATEWAY_SKILL, "SKILL.md")
            document = root / "skills" / skill / relative
            document.write_text(mutate(document.read_text(encoding="utf-8")), encoding="utf-8")
        return root

    def assert_red(self, pattern: str, mutate) -> None:
        """同一处变异抄进两个包的入口和非入口文档，四处都必须打红。"""
        for target in self.DOCUMENTS:
            with self.subTest(target="/".join(target)):
                with self.assertRaisesRegex(validator.ValidationError, pattern):
                    validator.validate_gateway_contract_freedom(self.fixture(mutate, target))

    def test_unmodified_skills_are_green(self):
        validator.validate_gateway_contract_freedom(self.fixture())

    def test_scan_covers_the_business_entry_skill(self):
        """扫描面必须含 doubaoya——它是分发量最大的那个包，也是参数曾经真被烤进去的那个。

        没有这条断言，把 CONTRACT_FREE_SKILLS 悄悄改回只剩网关，上面所有 subTest 会
        「少跑两处」而不是「失败」，闸缩了一半却全绿。
        """
        self.assertIn("doubaoya", validator.CONTRACT_FREE_SKILLS)
        self.assertIn(validator.GATEWAY_SKILL, validator.CONTRACT_FREE_SKILLS)

    def test_rejects_camel_case_field_name_anywhere(self):
        """驼峰入参字段（真实字段名里 37/58 是这个形状）无论抄在哪里都拦得住。"""
        for smuggled in (
            "\n入参：`thumbMediaId` 选填。\n",                       # 中文散文里
            "\n| 字段 | 说明 |\n|---|---|\n| publishTimeStart | 起始时间 |\n",  # 表格里
            "\n```js\nconst body = { sortType: 1 };\n```\n",          # 代码块里的 JS 属性
        ):
            with self.subTest(smuggled=smuggled.strip()):
                self.assert_red("不属于调用协议的驼峰标识符", lambda text, s=smuggled: text + s)

    def test_rejects_request_body_example_with_real_fields(self):
        """小写单词字段名（keyword / limit …）抄进来时必然是请求体的 JSON 键。"""
        body = '\n```json\n{ "keyword": "AI 工具", "limit": 10 }\n```\n'
        self.assert_red(r"非协议 JSON 键：\['keyword', 'limit'\]", lambda text: text + body)

    def test_rejects_extra_column_on_the_index_table(self):
        """给索引加一列，装的多半就是入参——三列是结构约束，不是排版偏好。"""
        row = "\n| `api.trend.hotTopics` | 全网热榜 | `/api/apis/trend/hot-topics` | 必填一个关键词 |\n"
        self.assert_red("不是「operationKey \\| 用途 \\| 详情端点」三列", lambda text: text + row)

    def test_rejects_inline_code_in_the_purpose_column(self):
        row = "\n| `api.trend.hotTopics` | 全网热榜，传 `platforms` | `/api/apis/trend/hot-topics` |\n"
        self.assert_red("用途列里有行内代码", lambda text: text + row)

    def test_rejects_index_row_without_a_detail_endpoint(self):
        row = "\n| `api.trend.hotTopics` | 全网热榜 | 见上游文档 |\n"
        self.assert_red("第三列不是详情端点", lambda text: text + row)

    def test_other_tables_are_not_mistaken_for_the_index(self):
        """首列是行内代码的表格不止索引一张；只有首列是 operationKey 的才按索引校验。"""
        table = "\n| `references/whatever.md` | 两列，不是索引 |\n"
        for target in self.DOCUMENTS:
            with self.subTest(target="/".join(target)):
                validator.validate_gateway_contract_freedom(
                    self.fixture(lambda text: text + table, target)
                )

    def test_rejects_orphan_reference_document(self):
        """SKILL.md 从不点名的 references 文件 = 没有 agent 会加载它，只会腐烂在包里。"""
        def add_orphan(root: Path) -> None:
            (root / "skills" / validator.GATEWAY_SKILL / "references" / "orphan.md").write_text(
                "# 没人引用的文档\n", encoding="utf-8"
            )

        root = self.fixture()
        add_orphan(root)
        with self.assertRaisesRegex(validator.ValidationError, "从没点名 references/orphan.md"):
            validator.validate_gateway_contract_freedom(root)

    def test_package_readme_is_not_treated_as_an_orphan(self):
        """README.md 是给人看的包门面，不是 agent 按需加载的 references——SKILL.md 没理由点名它。

        它照样受契约自由扫描（见 DOCUMENTS 里那一项），只是不受「必须被点名」那一条约束。
        """
        root = self.fixture()
        readme = root / "skills" / validator.GATEWAY_SKILL / "README.md"
        readme.write_text("# 门面\n谁都没点名我。\n", encoding="utf-8")
        validator.validate_gateway_contract_freedom(root)

    def test_protocol_vocabulary_holds_no_capability_field_name(self):
        """反向断言：词汇表里不许混进已知的能力入参字段名。

        闸的强度全靠这份词汇表守得住——往里加一个 `keyword`，第 1、2 条判据就同时失效了。
        这里钉住几个**确定是入参、不可能是协议键**的名字（它们出现在真实的
        inputContract / inputUiSchema 里），作为改词汇表时的绊线。
        """
        capability_fields = {
            "keyword", "keywords", "limit", "page", "offset", "cursor", "pageSize", "pageNum",
            "sortType", "accountId", "accountName", "thumbMediaId", "publishTimeStart",
            "publishTimeEnd", "authorizerAppid", "contentHtml", "noteId", "secUid", "prompt",
        }
        leaked = sorted(capability_fields & validator.GATEWAY_PROTOCOL_VOCAB)
        self.assertEqual(leaked, [], f"协议词汇表里混进了能力入参字段：{leaked}")

    def test_missing_skill_fails_loudly(self):
        """扫描面里任何一个包不见了都要当场炸——闸不许因为「文件没了」而静默变绿。"""
        for name in validator.CONTRACT_FREE_SKILLS:
            with self.subTest(missing=name):
                root = self.fixture()
                shutil.rmtree(root / "skills" / name)
                with self.assertRaisesRegex(
                    validator.ValidationError, f"选路层 Skill 不见了：skills/{name}/SKILL.md"
                ):
                    validator.validate_gateway_contract_freedom(root)


if __name__ == "__main__":
    unittest.main()
