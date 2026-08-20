#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dby-rewrite/scripts/rewrite.py

多平台文案改写辅助脚本（Python 版 · 纯本地）
用途：识别目标平台、取出对应平台的改写规则（System Prompt），
      供 Agent 据此进行文案改写。支持同时指定多个平台。

特性：
  - 纯本地运行，零网络请求，仅使用 Python 标准库
  - 支持平台别名（中英文、拼音缩写）与全平台关键词
  - 规则**一平台一文件**放在 references/ 下，脚本与 agent 读的是同一份

🔑 为什么规则不再是一个大文件：references/<平台>.md 同时是**给 agent 直接 Read 的**
   参考资料和**脚本的数据源**。合并成一个大文件就得两边各存一份或让脚本去切章节，
   前者会漂、后者曾经靠"章节标题模糊匹配"来切（`platform_name in first_line`），
   平台名互为子串时随时会切错。一平台一文件之后这里是一次精确的字典查表。

用法：
  python rewrite.py list                          # 列出所有支持平台及别名
  python rewrite.py <平台>                        # 输出单平台改写规则 prompt
  python rewrite.py <平台1,平台2,...> [文案]      # 解析多平台并逐一输出规则 prompt
  python rewrite.py 抖音 小红书 知乎 [文案]       # 多平台（空格分隔）
  python rewrite.py all [文案]                    # 全平台
"""

import sys
import os
from typing import Optional, Dict, List

# ── 路径 ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RULES_DIR = os.path.join(SCRIPT_DIR, '..', 'references')

# ── 平台别名映射 ──────────────────────────────────────────────────────────────
PLATFORM_ALIAS: Dict[str, str] = {
    '公众号':     '公众号',
    '微信公众号': '公众号',
    '视频号':     '视频号',
    '微信视频号': '视频号',
    '抖音':       '抖音',
    'dy':         '抖音',
    '快手':       '快手',
    'ks':         '快手',
    '哔站':       '哔站（B站）',
    'b站':        '哔站（B站）',
    'bilibili':   '哔站（B站）',
    '哔哩哔哩':   '哔站（B站）',
    '小红书':     '小红书',
    '红书':       '小红书',
    'xhs':        '小红书',
    '知乎':       '知乎',
    'zhihu':      '知乎',
}

SUPPORTED_PLATFORMS: List[str] = [
    '公众号', '视频号', '抖音', '快手', '哔站（B站）', '小红书', '知乎'
]

# 规范平台名 → references/ 下的文件名。只有 B 站那条不一样：
# 规范名里的全角括号落进文件名会给 shell 和补全添堵。
PLATFORM_FILE: Dict[str, str] = {p: p for p in SUPPORTED_PLATFORMS}
PLATFORM_FILE['哔站（B站）'] = 'B站'

# 全平台关键词
ALL_KEYWORDS = {'全部', 'all', '所有'}


# ─────────────────────────────────────────────────────────────────────────────
# 平台解析
# ─────────────────────────────────────────────────────────────────────────────

def resolve_platforms(tokens: List[str]) -> List[str]:
    """
    从 token 列表中识别所有平台，返回去重后的规范平台名列表。
    支持逗号分隔（如 "抖音,小红书"）或空格分隔（如 "抖音 小红书"）。
    若包含全平台关键词，直接返回全部七个平台。
    """
    # 展开逗号
    expanded: List[str] = []
    for t in tokens:
        expanded.extend(t.split(','))

    # 检查全平台
    for t in expanded:
        if t.strip().lower() in ALL_KEYWORDS:
            return list(SUPPORTED_PLATFORMS)

    seen: List[str] = []
    for t in expanded:
        t = t.strip()
        matched = PLATFORM_ALIAS.get(t) or PLATFORM_ALIAS.get(t.lower())
        if matched and matched not in seen:
            seen.append(matched)
    return seen


# ─────────────────────────────────────────────────────────────────────────────
# 规则提取
# ─────────────────────────────────────────────────────────────────────────────

def extract_platform_rules(platform_name: str) -> Optional[str]:
    """取出指定平台的完整规则（就是 references/<平台>.md 的全文）。"""
    file_name = PLATFORM_FILE.get(platform_name)
    if file_name is None:
        return None
    rules_path = os.path.normpath(os.path.join(RULES_DIR, f'{file_name}.md'))
    if not os.path.exists(rules_path):
        print(f'❌ 规则文件不存在：{rules_path}', file=sys.stderr)
        sys.exit(1)
    with open(rules_path, 'r', encoding='utf-8') as f:
        return f.read().strip()


# ─────────────────────────────────────────────────────────────────────────────
# CLI 命令
# ─────────────────────────────────────────────────────────────────────────────

def cmd_list() -> None:
    """列出所有支持平台及别名。"""
    print('\n支持的平台及别名：\n')
    print(f'{"平台名称":<18} | 可识别的别名')
    print('-' * 18 + '-+-' + '-' * 40)
    printed: set = set()
    for alias, platform in PLATFORM_ALIAS.items():
        if platform not in printed:
            aliases = [k for k, v in PLATFORM_ALIAS.items() if v == platform]
            print(f'{platform:<18} | {", ".join(aliases)}')
            printed.add(platform)
    print()


def cmd_platform_prompt(platform_input: str) -> None:
    """输出单个平台的改写规则 prompt。"""
    matched = PLATFORM_ALIAS.get(platform_input) or PLATFORM_ALIAS.get(platform_input.lower())
    if not matched:
        print(f'\n❌ 未识别的平台："{platform_input}"\n', file=sys.stderr)
        print(f'支持的平台：{"、".join(SUPPORTED_PLATFORMS)}\n', file=sys.stderr)
        sys.exit(1)

    rules = extract_platform_rules(matched)
    if not rules:
        print(f'\n❌ 规则文件中未找到平台"{matched}"的规则\n', file=sys.stderr)
        sys.exit(1)

    print(f'\n✅ 平台：{matched}\n')
    print('─' * 60)
    print('\n【System Prompt（供 AI 使用）】\n')
    print(rules)


def cmd_batch_prompt(platform_tokens: List[str], content: str) -> None:
    """
    解析多平台，逐一输出各平台的改写规则 prompt（纯本地，无任何网络请求）。
    platform_tokens: 可能含逗号分隔或多个独立 token
    content: 待改写文案（可为空，仅用于提示展示）
    """
    platforms = resolve_platforms(platform_tokens)

    if not platforms:
        print(f'\n❌ 未从输入中识别到任何有效平台：{platform_tokens}\n', file=sys.stderr)
        print(f'支持的平台：{"、".join(SUPPORTED_PLATFORMS)}\n', file=sys.stderr)
        sys.exit(1)

    print(f'\n📋 目标平台（共 {len(platforms)} 个）：{"、".join(platforms)}\n')
    if content:
        print(f'📝 原文：{content}\n')
    print('═' * 60)

    for idx, platform in enumerate(platforms, 1):
        print(f'\n[{idx}/{len(platforms)}] 📌 {platform}')
        print('─' * 60)
        rules = extract_platform_rules(platform)
        if rules:
            print('\n【System Prompt（供 AI 使用）】\n')
            print(rules)
        else:
            print(
                f'⚠️  规则文件中未找到平台"{platform}"的规则',
                file=sys.stderr
            )

    print('\n' + '═' * 60)
    print(f'\n✅ 全部 {len(platforms)} 个平台规则已提取完毕\n')


def print_help() -> None:
    platforms = '、'.join(SUPPORTED_PLATFORMS)
    print(f"""
📝 多平台文案改写辅助脚本（Python 版 · 纯本地）

用法：
  python rewrite.py list                          # 列出所有支持平台
  python rewrite.py <平台>                        # 输出单平台改写规则 prompt
  python rewrite.py <平台1,平台2> [文案内容]      # 多平台规则提取（逗号分隔）
  python rewrite.py 抖音 小红书 知乎 [文案内容]   # 多平台规则提取（空格分隔）
  python rewrite.py all [文案内容]                # 全平台规则提取

支持平台：{platforms}
全平台关键词：全部、all、所有

说明：
  本脚本纯本地运行，仅读取本地规则库，不发起任何网络请求，无需任何 API Key。
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

    # ── list ──────────────────────────────────────────────────────────────
    if first == 'list':
        cmd_list()
        return

    # ── 判断是否为单平台 prompt 查询（无文案内容）─────────────────────────
    # 策略：若只有一个 token 且能精确匹配到平台，视为 prompt 查询
    if len(args) == 1:
        # 全平台关键词单独用也算数。帮助文本写的是 `rewrite.py all [文案内容]`——文案是可选的，
        # 所以「只给 all、不给文案」必须能跑。合并前的版本在这里只查平台别名表，
        # all / 全部 / 所有 查不到，于是打印帮助并以退出码 1 结束，与自己的帮助文本矛盾。
        if args[0].strip().lower() in ALL_KEYWORDS:
            cmd_batch_prompt([args[0]], '')
            return
        matched = (PLATFORM_ALIAS.get(args[0])
                   or PLATFORM_ALIAS.get(args[0].lower()))
        if matched:
            cmd_platform_prompt(args[0])
            return
        # 单 token 但不认识
        print(f'\n❌ 未识别的平台或命令："{args[0]}"\n', file=sys.stderr)
        print_help()
        sys.exit(1)

    # ── 多 token：尝试从前缀识别平台，其余部分作为文案 ───────────────────
    # 从左到右扫描，连续能识别为平台的 token 归入平台列表，之后视为文案
    platform_tokens: List[str] = []
    content_start = len(args)  # 默认无文案

    for i, token in enumerate(args):
        # 展开逗号分隔
        sub_tokens = token.split(',')
        all_platform = all(
            (PLATFORM_ALIAS.get(t.strip()) or PLATFORM_ALIAS.get(t.strip().lower())
             or t.strip().lower() in ALL_KEYWORDS)
            for t in sub_tokens if t.strip()
        )
        if all_platform:
            platform_tokens.append(token)
        else:
            content_start = i
            break

    content = ' '.join(args[content_start:]) if content_start < len(args) else ''

    if not platform_tokens:
        # 没有识别到任何平台 token
        print(f'\n❌ 输入中未找到可识别的平台关键词\n', file=sys.stderr)
        print(f'支持的平台：{"、".join(SUPPORTED_PLATFORMS)}\n', file=sys.stderr)
        print_help()
        sys.exit(1)

    cmd_batch_prompt(platform_tokens, content)


if __name__ == '__main__':
    main()
