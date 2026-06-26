#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
zhihu-rewrite/scripts/rewrite.py

知乎文案改写辅助脚本
用途：从 assets/platform-rules.md 提取知乎改写规则 prompt，供 AI 改写时使用。

本脚本为纯本地工具，仅读取本地规则文件，不进行任何网络请求，
不依赖任何第三方库（仅使用 Python 标准库）。

用法：
  python rewrite.py prompt                  # 输出知乎改写规则 prompt
"""

import sys
import os
import re

# ── 路径 ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RULES_FILE = os.path.join(SCRIPT_DIR, '..', 'assets', 'platform-rules.md')

# ── 平台 ──────────────────────────────────────────────────────────────────────
PLATFORM = '知乎'


# ─────────────────────────────────────────────────────────────────────────────
# 规则提取
# ─────────────────────────────────────────────────────────────────────────────

def extract_platform_rules() -> str:
    """读取规则文件，提取知乎规则块。"""
    rules_path = os.path.normpath(RULES_FILE)
    if not os.path.exists(rules_path):
        print(f'❌ 规则文件不存在：{rules_path}', file=sys.stderr)
        sys.exit(1)

    with open(rules_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 提取知乎部分（从 ## 知乎 到文件末尾）
    match = re.search(r'^## 知乎\n(.*)', content, re.DOTALL | re.MULTILINE)
    if match:
        return '## 知乎\n' + match.group(1).strip()
    return ''


# ─────────────────────────────────────────────────────────────────────────────
# CLI 命令
# ─────────────────────────────────────────────────────────────────────────────

def cmd_prompt() -> None:
    """输出知乎改写规则 prompt。"""
    rules = extract_platform_rules()
    if not rules:
        print(f'\n❌ 规则文件中未找到知乎规则\n', file=sys.stderr)
        sys.exit(1)

    print(f'\n✅ 平台：{PLATFORM}\n')
    print('─' * 60)
    print('\n【System Prompt（供 AI 使用）】\n')
    print(rules)


def print_help() -> None:
    print(f"""
📝 知乎文案改写辅助脚本（本鸭 · 都爆鸭社区）

用法：
  python rewrite.py prompt                    # 输出知乎改写规则 prompt

说明：
  纯本地脚本，仅读取 assets/platform-rules.md，不发起任何网络请求。
""")


# ─────────────────────────────────────────────────────────────────────────────
# 入口
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    args = sys.argv[1:]

    if not args or args[0] in ('-h', '--help'):
        print_help()
        sys.exit(0)

    first = args[0].lower()

    # ── prompt ──────────────────────────────────────────────────────────────
    if first == 'prompt':
        cmd_prompt()
        return

    # 其余参数：提示正确用法
    print_help()
    sys.exit(0)


if __name__ == '__main__':
    main()
