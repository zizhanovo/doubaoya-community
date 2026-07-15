#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""都爆鸭 · 小红书爆款笔记检索脚本（供创作复盘用）

零依赖（仅用 Python 3 标准库 urllib）。从环境变量 DOUBAOYA_API_KEY 读取密钥，
调用 doubaoya.com 公开 API 按关键词检索小红书热门爆款笔记，把成功返回的
data 以 JSON 打印到 stdout，供主 Agent 复盘爆款结构、生成可发布文案。

本脚本只负责"取数"，不做分析、不生成文案——复盘与成文交给 SKILL.md 指导主 Agent。

用法:
    python3 search_xhs_work.py "<关键词>" [--page N] [--page-size N]

例如:
    python3 search_xhs_work.py "减脂餐"
    python3 search_xhs_work.py "通勤穿搭" --page 2 --page-size 20

安全约定:
    - 绝不打印完整密钥（key），即便出错也只提示"未设置/已失效"。
    - 只访问 doubaoya.com 的公开 API。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://doubaoya.com/api/apis/xiaohongshu/search-work/call"
USER_AGENT = "doubaoya-skill/1.0"


def eprint(*args):
    print(*args, file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 小红书爆款笔记检索（供创作复盘）",
    )
    parser.add_argument("keyword", help="搜索关键词（必填）")
    parser.add_argument(
        "--page",
        type=int,
        default=1,
        help="页码（可选，默认 1）",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=20,
        help="每页条数（可选，默认 20）",
    )
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        eprint(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 密钥中心 → 生成密钥，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的密钥"'
        )
        return 1

    body = {
        "keyword": args.keyword,
        "page": args.page,
        "pageSize": args.page_size,
    }
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
            "User-Agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # 即便是错误响应，服务端通常也返回结构化信封，尽量解析它。
        try:
            body_raw = exc.read().decode("utf-8")
            envelope = json.loads(body_raw)
            err = envelope.get("error") or {}
            code = err.get("code", "HTTP_%d" % exc.code)
            message = err.get("message", exc.reason or "请求失败")
            eprint("[error] %s: %s" % (code, message))
        except Exception:
            eprint("[error] HTTP_%d: %s" % (exc.code, exc.reason or "请求失败"))
        return 1
    except urllib.error.URLError as exc:
        eprint("[error] NETWORK_ERROR: 无法连接 doubaoya.com（%s）" % exc.reason)
        return 1

    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError:
        eprint("[error] BAD_RESPONSE: 服务端返回非 JSON 内容")
        return 1

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        code = err.get("code", "UNKNOWN")
        message = err.get("message", "请求未成功")
        eprint("[error] %s: %s" % (code, message))
        return 1

    data = envelope.get("data", {})
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
