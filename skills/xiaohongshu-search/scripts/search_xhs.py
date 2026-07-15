#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
都爆鸭 · 小红书爆款笔记搜索脚本

零依赖（仅用 Python 3 标准库 urllib）。从环境变量 DOUBAOYA_API_KEY 读取密钥，
调用 doubaoya.com 公开 API 搜索小红书笔记，把成功返回的 data 以 JSON 打印到 stdout。

用法:
    python3 search_xhs.py "<关键词>" [--page N]

例如:
    python3 search_xhs.py "减脂早餐"
    python3 search_xhs.py "通勤穿搭" --page 2

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

API_URL = "https://doubaoya.com/api/apis/xiaohongshu/search-note/call"
USER_AGENT = "doubaoya-skill/1.0"


def eprint(*args):
    print(*args, file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 小红书爆款笔记搜索",
        add_help=True,
    )
    parser.add_argument("keyword", help="搜索关键词，例如 减脂早餐")
    parser.add_argument(
        "--page",
        type=int,
        default=1,
        help="页码，正整数，默认 1",
    )
    args = parser.parse_args()

    # 读取密钥；绝不回显密钥本身
    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        eprint(
            "[error] 未检测到环境变量 DOUBAOYA_API_KEY。"
            "请到 doubaoya.com 登录后在「密钥中心」生成密钥，"
            "再执行 export DOUBAOYA_API_KEY=\"dyh_…\" 后重试。"
        )
        sys.exit(1)

    body = {
        "keyword": args.keyword,
        "page": args.page,
    }
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        # 服务端仍可能返回带 error 字段的 JSON 信封，尝试解析
        raw = ""
        try:
            raw = e.read().decode("utf-8")
        except Exception:
            pass
        parsed = None
        if raw:
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = None
        if isinstance(parsed, dict) and parsed.get("error"):
            err = parsed.get("error") or {}
            eprint("[error] {}: {}".format(
                err.get("code", "HTTP_{}".format(e.code)),
                err.get("message", "请求失败"),
            ))
        else:
            eprint("[error] HTTP_{}: 请求失败，请稍后重试。".format(e.code))
        sys.exit(1)
    except urllib.error.URLError as e:
        eprint("[error] NETWORK_ERROR: 无法连接 doubaoya.com（{}）。".format(e.reason))
        sys.exit(1)

    try:
        envelope = json.loads(raw)
    except ValueError:
        eprint("[error] BAD_RESPONSE: 服务端返回内容无法解析为 JSON。")
        sys.exit(1)

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        eprint("[error] {}: {}".format(
            err.get("code", "UNKNOWN"),
            err.get("message", "请求未成功"),
        ))
        sys.exit(1)

    data = envelope.get("data", {})
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
