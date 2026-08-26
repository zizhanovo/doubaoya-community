"""`validate-theme.mjs` 在 dby-theme 与 dby-publish 里各存一份，字节必须相同。

🔴 这是**有意的 vendoring**：skills 各自独立安装、不能跨包 import
（见 `skills/dby-publish/scripts/pipeline.mjs:939-941`），所以同一份校验逻辑
不得不在两个包里各放一份源码。

但目前没有同步脚本、没有测试——下次谁只改了一边（比如给 dby-theme 那份新增一条
微信兼容 warning，却忘了同步 dby-publish 那份），两边就会在同一份 themeJson 上
给出不同判决：dby-theme 里合法的主题，喂给 dby-publish 的流水线会 400；或者反过来，
本地校验放行了 dby-publish 实际会拒收的写法。这条闸把"改一份忘了另一份"堵在 CI 里。

改哪一份都必须同步另一份——不是"选一份改就行"。
"""

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

THEME_COPY = ROOT / "skills" / "dby-theme" / "scripts" / "validate-theme.mjs"
PUBLISH_COPY = ROOT / "skills" / "dby-publish" / "scripts" / "validate-theme.mjs"


def _md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def test_两份文件都在() -> None:
    assert THEME_COPY.is_file(), f"缺失:{THEME_COPY}"
    assert PUBLISH_COPY.is_file(), f"缺失:{PUBLISH_COPY}"


def test_两份_validate_theme_逐字节相同() -> None:
    theme_bytes = THEME_COPY.read_bytes()
    publish_bytes = PUBLISH_COPY.read_bytes()
    assert theme_bytes == publish_bytes, (
        f"{THEME_COPY} (md5={_md5(THEME_COPY)}) 与 "
        f"{PUBLISH_COPY} (md5={_md5(PUBLISH_COPY)}) 内容不一致。\n"
        "这是有意 vendoring 的两份副本（skills 各自独立安装、不能跨包 import），"
        "改一份必须同步另一份——否则同一份 themeJson 会在两个包里得到不同的校验结果。"
    )
