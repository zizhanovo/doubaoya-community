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

样板（dby-cli-unification 搬家后）：skills/dby-api/scripts/lib/http.mjs 的公共请求层，
经 warn(ctx, ...) 这层薄封装转达（不是裸 console.error/stderr.write 了）：
    if (env.notice) warn(ctx, `[notice] ${env.notice}`);
走 stderr 是刻意的 —— stdout 要留给 JSON，混进去会让调用方解析失败。
旧样板 skills/dby-api/scripts/doubaoya.mjs 已退成转发壳（design D3），自己不再解析
信封、不再读 notice —— 真正读信封的地方收敛到了 lib/http.mjs 这一份请求层，doubaoya.mjs
从下面的清单里退出。
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

# 解析成功信封、因而必须转达 notice 的脚本。
# 加新脚本时往这里加一行 —— 漏加不会被自动发现，所以下面另有一条元断言兜底。
# 🔴 dby-cli-unification 搬家：doubaoya.mjs 已退成转发壳（不再自己解析信封，见上面文档
#    字符串），真正解析信封的地方收敛到 lib/http.mjs 这一份公共请求层 —— 一进一出。
# dby-cli-unification 之后仓里只剩两个真正解析 doubaoya 信封的地方：
#   - dby-api 的 lib/http.mjs —— 唯一请求层，兄弟包（write/charter/publish）都经由它，自己不再碰信封；
#   - dby-feedback 的 submit_feedback.py —— 独立反馈端点，不走 doubaoya API，自带信封语义。
# 别把兄弟包脚本重新加回来：它们若又开始自己读信封，就是「仓内只有一份请求层」被破了。
ENVELOPE_READERS = [
    "skills/dby-api/scripts/lib/http.mjs",
    "skills/dby-feedback/scripts/submit_feedback.py",
]


def _read(rel: str) -> str:
    p = ROOT / rel
    assert p.exists(), f"清单里的脚本不存在：{rel}（改名了就同步这张表）"
    return p.read_text(encoding="utf-8")


def _is_notice_surfaced(src: str) -> bool:
    """② 送：要么打给用户（stderr / 回报），要么原样带出给上层。

    合格的「送出去」：console.error/stderr.write 打给用户；warn(...) 转达（lib/http.mjs
    这层公共请求层把 console.error/stderr.write 抽成了 warn(ctx, ...) 的薄封装，判据要
    跟着抽象走，不能只认裸调用）；或原样放进返回值交给上层去打。
    抽成函数是因为下面的「破坏演练」要复用同一份判据，防止两处判据各写一份、悄悄漂移。
    """
    return bool(
        re.search(r"console\.error\([^)]*notice", src)
        or re.search(r"^\s*notice:", src, re.M)
        or re.search(r"stderr\.write\([^)]*notice", src)
        or re.search(r"\bwarn\([^)]*notice", src)
    )


@pytest.mark.parametrize("rel", ENVELOPE_READERS)
def test_notice_is_read_and_surfaced(rel: str) -> None:
    """读出来还不够，必须真的送到用户眼前。"""
    src = _read(rel)
    # ① 读：从信封上取 notice。JS 侧 env.notice / j.notice / rendered.notice 都算；
    #    Python 侧 body.get("notice") / body["notice"] 都算。
    assert re.search(r'\.notice\b|\.get\(\s*[\'"]notice[\'"]\s*\)|\[[\'"]notice[\'"]\]', src), (
        f"{rel} 一次都没读过 notice —— 服务端挂了没人读，等于没挂。"
        f"样板见 skills/dby-api/scripts/lib/http.mjs"
    )
    assert _is_notice_surfaced(src), (
        f"{rel} 读了 notice 但没送出去 —— 读了没人看见，与没读没有区别。"
        f"打 stderr（别打 stdout，那里留给 JSON）或原样带给上层。"
    )


def test_reverse_removing_the_relay_line_from_http_mjs_makes_the_gate_red() -> None:
    """🔴 破坏演练：闸不能只是「刚好绿」——证明它真的在盯着转达那一行，不是空转。

    只在内存里把 lib/http.mjs 那行 notice 转达删掉（不落盘、不碰真文件），
    重新跑一遍 _is_notice_surfaced 判据，必须由绿转红；否则说明上面那条
    parametrize 测试绑定的不是这一行，是「碰巧」通过的。
    """
    src = _read("skills/dby-api/scripts/lib/http.mjs")
    relay_line = "if (env.notice) warn(ctx, `[notice] ${env.notice}`);"
    assert relay_line in src, (
        "样板行文本对不上，先确认 lib/http.mjs 有没有改动过转达那一行，再同步这条破坏演练的字面量"
    )
    assert _is_notice_surfaced(src), "破坏演练的前提都不成立：改动前这份源码本就没被判成 surfaced"
    sabotaged = src.replace(relay_line, "// (notice 转达已被破坏演练拿掉)")
    assert not _is_notice_surfaced(sabotaged), (
        "破坏演练失效：拿掉转达行之后闸应该判不到 surfaced，若还判到说明判据没有真的锁定这一行"
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
    # dby-cli-unification 把清单从 8 条收到 2 条——收缩是设计目标（一份请求层），不是误删；
    # 下限因此改成 2：再少一条就意味着 http.mjs 或反馈脚本本身丢了。
    assert len(ENVELOPE_READERS) >= 2, "清单少于 2 条，多半是被误删了"
