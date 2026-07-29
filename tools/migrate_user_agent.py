#!/usr/bin/env python3
"""一次性迁移工具：把 skills/*/scripts/*.py 里旧的 User-Agent 写法批量换成
读取 .version 文件的写法（同 Task 2 手工做的改法，机械化批量执行）。

幂等：已经含 `_skill_user_agent` 定义的脚本会被跳过，可以放心重复跑。

已知处理两种既有写法：
  (a) 模块级常量: USER_AGENT = "doubaoya-skill/1.0"
  (b) headers 字典内联: "User-Agent": "doubaoya-skill/1.0"
跑完后必须过一遍 git diff 人工检查 + 全量 py_compile（见计划 Step 3/4），
因为这是字符串替换式代码修改，不保证覆盖所有历史上可能存在的第三种写法。

跑法（仓库根目录）：python3 tools/migrate_user_agent.py
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"

HELPER = '''def _skill_user_agent() -> str:
    """读取同目录下 .version 文件里发布时盖的版本戳；没有则退回旧版通用值（向后兼容）。"""
    try:
        version_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".version")
        with open(version_path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        return value or "doubaoya-skill/1.0"
    except OSError:
        return "doubaoya-skill/1.0"
'''

CONST_PATTERN = re.compile(r'^USER_AGENT = "doubaoya-skill/1\.0"$', re.MULTILINE)
INLINE_PATTERN = re.compile(r'"User-Agent": "doubaoya-skill/1\.0"')


def _ensure_import_os(text: str) -> str:
    if re.search(r"^import os$", text, re.MULTILINE):
        return text
    # 插在最后一个顶层 import 之后（简单起见：插在第一个 import 之后，Python 对 import 顺序无要求）
    match = re.search(r"^import \w+$", text, re.MULTILINE)
    if not match:
        return text
    insert_at = match.end()
    return text[:insert_at] + "\nimport os" + text[insert_at:]


def migrate_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "_skill_user_agent" in text:
        return False  # 已迁移，跳过（幂等）
    if "doubaoya-skill/1.0" not in text:
        return False  # 不含旧版 User-Agent 写法，跳过

    text = _ensure_import_os(text)

    if CONST_PATTERN.search(text):
        text = CONST_PATTERN.sub("USER_AGENT = _skill_user_agent()", text)
        text = text.replace(
            "USER_AGENT = _skill_user_agent()",
            HELPER + "\n\nUSER_AGENT = _skill_user_agent()",
            1,
        )
    elif INLINE_PATTERN.search(text):
        text = INLINE_PATTERN.sub('"User-Agent": _skill_user_agent()', text)
        first_def = text.find("\ndef ")
        if first_def == -1:
            return False
        text = text[:first_def] + "\n\n" + HELPER + text[first_def:]
    else:
        return False

    path.write_text(text, encoding="utf-8")
    return True


def main() -> int:
    changed = []
    for script in sorted(SKILLS.glob("*/scripts/*.py")):
        if migrate_file(script):
            changed.append(script.relative_to(ROOT))
    for p in changed:
        print(f"migrated: {p}")
    print(f"total migrated: {len(changed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
