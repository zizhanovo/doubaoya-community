"""每一个读成功信封的脚本，都必须把 notice 转达出去。

🔴 这条链 2026-08-21 一天之内断过**三处**，每一处都是静默的：

  ① 服务端三条专用路由（render / publish / charter）给 success() 传 null
     —— 107 个能力里只有这 3 个走专用路由，但它们恰好是整条发布链。
     主仓 0563fa5 改成 preSerialization 钩子统一注入（92 个出口一次性全接）。
  ② dby-publish 17 个脚本读 notice 的次数是 0 —— 服务端老实挂上，流水线转手丢掉。
     社区仓 3537e22 补上。
  ③ 新写的 dby-charter/scripts/charter.mjs 与 dby-image/scripts/gen.mjs 同样是 0
     —— 而 gen.mjs 正是一条 BREAKING 变更的落点，会主动把用户升上来。

**挂了没人读 == 没挂。** 而三处都是"每一段自己都对，接缝没人管"。
所以判据不落在某一个脚本上，落在**这一类脚本**上：谁解析成功信封，谁就得转达。

样板：skills/dby-api/scripts/doubaoya.mjs
    if (env.notice) console.error(`[notice] ${env.notice}`);
走 stderr 是刻意的 —— stdout 要留给 JSON，混进去会让调用方解析失败。
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

# 解析成功信封、因而必须转达 notice 的脚本。
# 加新脚本时往这里加一行 —— 漏加不会被自动发现，所以下面另有一条元断言兜底。
ENVELOPE_READERS = [
    "skills/dby-api/scripts/doubaoya.mjs",
    "skills/dby-publish/scripts/pipeline.mjs",
    "skills/dby-charter/scripts/charter.mjs",
    "skills/dby-image/scripts/gen.mjs",
    "skills/dby-publish/scripts/gen-image.mjs",
    "skills/dby-publish/scripts/preprocess-and-publish.mjs",
    "skills/dby-write/scripts/write.mjs",
    "skills/dby-banned-words/scripts/check_multi.py",
    "skills/dby-publish/scripts/publish_draft.py",
]


def _read(rel: str) -> str:
    p = ROOT / rel
    assert p.exists(), f"清单里的脚本不存在：{rel}（改名了就同步这张表）"
    return p.read_text(encoding="utf-8")


@pytest.mark.parametrize("rel", ENVELOPE_READERS)
def test_notice_is_read_and_surfaced(rel: str) -> None:
    """读出来还不够，必须真的送到用户眼前。"""
    src = _read(rel)
    # ① 读：从信封上取 notice。JS 侧 env.notice / j.notice / rendered.notice 都算；
    #    Python 侧 body.get("notice") / body["notice"] 都算。
    assert re.search(r'\.notice\b|\.get\(\s*[\'"]notice[\'"]\s*\)|\[[\'"]notice[\'"]\]', src), (
        f"{rel} 一次都没读过 notice —— 服务端挂了没人读，等于没挂。"
        f"样板见 skills/dby-api/scripts/doubaoya.mjs"
    )
    # ② 送：要么打给用户（stderr / 回报），要么原样带出给上层。
    # 合格的「送出去」：console.error/stderr.write 打给用户，或原样放进返回值交给上层去打。
    surfaced = (
        re.search(r"console\.error\([^)]*notice", src)
        or re.search(r"^\s*notice:", src, re.M)
        or re.search(r"stderr\.write\([^)]*notice", src)
    )
    assert surfaced, (
        f"{rel} 读了 notice 但没送出去 —— 读了没人看见，与没读没有区别。"
        f"打 stderr（别打 stdout，那里留给 JSON）或原样带给上层。"
    )


def test_no_envelope_reader_is_missing_from_the_list() -> None:
    """🔴 元断言：防止「新脚本忘了加进清单」让上面那条空跑成绿。

    判据：凡是自己解析成功信封的脚本（出现 `.success` 判定），都该在清单里。
    这一条抓的是**清单本身过期**——它正是 ① ② ③ 三次断裂的共同形状。

    扫描面覆盖 `*.mjs` 与 `*.py`（原来只扫 `.mjs`，check_multi.py 这类纯 Python 脚本
    整类不在扫描面内，加了 notice 也不会被这道闸看见）；`.py` 的判据换成
    `body.get("success")` / `body["success"]` 这类形态，JS 的 `.success` 判据不变。
    """
    suspects = []
    js_success = re.compile(r"\b(?:if\s*\(\s*!?\w+\.success|\w+\.success\s*(?:!==|===))")
    py_success = re.compile(
        r'\.get\(\s*[\'"]success[\'"]\s*\)|\[[\'"]success[\'"]\]'
    )
    for p in sorted((ROOT / "skills").rglob("*.mjs")) + sorted((ROOT / "skills").rglob("*.py")):
        rel = p.relative_to(ROOT).as_posix()
        if rel in ENVELOPE_READERS:
            continue
        src = p.read_text(encoding="utf-8")
        # 自己判 success 的 = 自己在解析信封的（按后缀选对应形态的判据）
        pattern = py_success if p.suffix == ".py" else js_success
        if pattern.search(src):
            suspects.append(rel)
    assert not suspects, (
        "下列脚本自己在解析成功信封，却不在 ENVELOPE_READERS 清单里 —— "
        "要么把它加进清单（并按样板转达 notice），要么说明它为什么不必：\n  "
        + "\n  ".join(suspects)
    )


def test_the_list_itself_is_not_empty() -> None:
    """闸自身不许空跑：清单被清空 / 路径全改名时，上面的 parametrize 会零迭代而全绿。"""
    assert len(ENVELOPE_READERS) >= 4, "清单少于 4 条，多半是被误删了"
