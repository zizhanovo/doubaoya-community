"""known-hashes.json 的路径解析 self-check。

`build_known_hashes.py` 从 `git ls-tree` 的输出里切 slug：`skills/<slug>/<rel>`。
这个切法有一个**只在特定内容下才现形、且现形时完全静默**的坑：

git 默认开着 `core.quotePath`。路径里只要出现一个非 ASCII 字符（本仓真的有——
`skills/dby-rewrite/references/公众号.md` 这类），ls-tree 就把整条路径**加引号并转义**
成 `"skills/…/B\\347\\253\\231.md"`。那个前导引号让按前缀长度切片整体错位一格，后果有两层：

  1. 切出一个**空字符串 slug**，混进历史闭集；
  2. 更要命的是，那个包的**中文名文件整体从文件集里消失**，于是它的哈希算错——
     而 known-hashes.json 正是用户机对账（reconcile）认领旧包的依据。
     当前版哈希不在闭集里 = 装了这个包的用户被当成装了个陌生包。**全程零报错。**

实测过：加完 references/ 那七份中文文件后，dby-rewrite（历史名字已改名）的当前哈希直接不在闭集里；
空 slug 还顺手把两条死指针闸的测试搞红了（它们取 `sorted(retired)[0]`，空串排最前）。

下面两条各守一端：产物里不许有畸形 slug，取材的命令不许把引号开回来。
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools" / "build_known_hashes.py"
SPEC = importlib.util.spec_from_file_location("doubaoya_build_known_hashes", MODULE_PATH)
assert SPEC and SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class KnownHashesPathParsingTests(unittest.TestCase):
    def test_no_malformed_slugs_in_the_closed_set(self):
        """产物端：空 slug、带斜杠或引号的 slug，都是路径切错位的症状。"""
        known = json.loads((ROOT / "known-hashes.json").read_text(encoding="utf-8"))
        for slug in known["skills"]:
            with self.subTest(slug=slug):
                self.assertTrue(slug, "闭集里出现了空字符串 slug —— 路径解析错位了")
                self.assertNotIn("/", slug)
                self.assertNotIn('"', slug)
                self.assertNotIn("\\", slug)

    def test_ls_tree_gives_unquoted_paths(self):
        """取材端：ls-tree 必须吐**未加引号**的路径，否则上面那条迟早再红一次。

        这条直接跑 build_known_hashes 真正用的那条命令。谁把 `-c core.quotePath=false`
        删了，这里当场红——而不是等到某个用户的包认不出来。
        （`-z` 单独不够：它只换记录分隔符，`%(path)` 照样转义。）
        """
        listing = builder.tree_listing("HEAD")
        paths = [line.split(" ", 1)[1] for line in listing.split("\0") if line.strip()]
        self.assertTrue(paths, "扫描面为空：skills/ 下一个文件都没有，这条测试就没有素材")
        # 先断这一条：引号一开，路径就变成 `"skills/…`，直接够不着前缀。
        # 顺序很重要——下面那条「有没有素材」在引号开着时也会红（转义完全是 ASCII 了），
        # 但它的报错信息会把人指向错的方向。
        for path in paths:
            with self.subTest(path=path):
                self.assertTrue(path.startswith(builder.PREFIX), f"路径被转义了：{path!r}")
        non_ascii = [p for p in paths if any(ord(c) > 127 for c in p)]
        self.assertTrue(
            non_ascii,
            "仓里已经没有非 ASCII 的 skill 文件了 —— 这条测试失去素材，"
            "要么是有人把它们改名了（那就把本测试一起删掉），要么是取材面缩了",
        )


if __name__ == "__main__":
    unittest.main()
