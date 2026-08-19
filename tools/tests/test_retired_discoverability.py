from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import unittest.mock


VALIDATOR = Path(__file__).resolve().parents[1] / "validate_community.py"
SPEC = importlib.util.spec_from_file_location("doubaoya_community_validator_retired", VALIDATOR)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)

INDEX_REL = Path("skills") / validator.GATEWAY_SKILL / "references" / "capability-index.md"


def build_root(directory: str, *, retired: dict[str, list[str]], index_endpoints: list[str]) -> Path:
    """搭一个最小仓库：一份 known-hashes.json + 一份能力索引。"""
    root = Path(directory)
    (root / "known-hashes.json").write_text(
        json.dumps({"skills": {s: ["deadbeef0000"] for s in retired}, "retiredEndpoints": retired}),
        encoding="utf-8",
    )
    index = root / INDEX_REL
    index.parent.mkdir(parents=True)
    index.write_text(
        "| operationKey | 用途 | 详情端点 |\n|---|---|---|\n"
        + "".join(f"| `api.x.y` | 用途 | `{e}` |\n" for e in index_endpoints),
        encoding="utf-8",
    )
    return root


def exempt(*slugs):
    """把豁免表换成这次用例自己的，免得真仓库那几条豁免污染合成夹具。"""
    return unittest.mock.patch.object(validator, "RETIRED_WITH_CAPABILITY", set(slugs))


class RetiredDiscoverabilityTests(unittest.TestCase):
    def test_passes_when_retired_capability_still_discoverable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = build_root(
                directory,
                retired={"gone-pkg": ["/api/apis/douyin/still-alive"]},
                index_endpoints=["/api/apis/douyin/still-alive"],
            )
            with exempt():
                validator.validate_retired_discoverability(root)

    def test_rejects_deleting_package_whose_capability_vanished_from_index(self):
        """删的是壳，能力的发现面必须先在新家站好——否则「删掉然后同步」= 「删掉然后失联」。"""
        with tempfile.TemporaryDirectory() as directory:
            root = build_root(
                directory,
                retired={"gone-pkg": ["/api/apis/douyin/orphaned"]},
                index_endpoints=["/api/apis/douyin/something-else"],
            )
            with exempt(), self.assertRaisesRegex(validator.ValidationError, "删包会让能力失联"):
                validator.validate_retired_discoverability(root)

    def test_exemption_clears_itself_when_capability_comes_back(self):
        """豁免表必须会自动清账，否则豁免会留成永久的洞。"""
        with tempfile.TemporaryDirectory() as directory:
            root = build_root(
                directory,
                retired={"gone-pkg": ["/api/apis/douyin/back-again"]},
                index_endpoints=["/api/apis/douyin/back-again"],
            )
            with exempt("gone-pkg"):
                with self.assertRaisesRegex(validator.ValidationError, "豁免表要自动清账"):
                    validator.validate_retired_discoverability(root)

    def test_rejects_orphan_exemption_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = build_root(directory, retired={}, index_endpoints=[])
            with exempt("never-existed"):
                with self.assertRaisesRegex(validator.ValidationError, "不该留孤儿"):
                    validator.validate_retired_discoverability(root)

    def test_exempted_package_passes_while_capability_absent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = build_root(
                directory,
                retired={"gone-pkg": ["/api/skills/also-retired"]},
                index_endpoints=["/api/apis/douyin/unrelated"],
            )
            with exempt("gone-pkg"):
                validator.validate_retired_discoverability(root)


if __name__ == "__main__":
    unittest.main()
