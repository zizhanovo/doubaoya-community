#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""都爆鸭 · 小红书笔记评论拉取脚本

零依赖（仅用 Python 3 标准库 urllib）。从环境变量 DOUBAOYA_API_KEY 读取口令，
调用 doubaoya.com 公开 API 拉取某条小红书笔记的一级评论，把成功返回的
data 以 JSON 打印到 stdout（含评论列表与下一页游标 nextCursor）。

用法:
    python3 fetch_xhs_comments.py "<noteId>" [--cursor <游标>] [--sort <排序>]

例如:
    # 第 1 页：不传 --cursor（首页游标留空即可）
    python3 fetch_xhs_comments.py "6a2ac3020000000035022d8e"
    # 下一页：把上一页 data 里的 nextCursor 原样传进来
    python3 fetch_xhs_comments.py "6a2ac3020000000035022d8e" --cursor "<上一页nextCursor>"

安全约定:
    - 绝不打印完整口令（key），即便出错也只提示"未设置/已失效"。
    - 只访问 doubaoya.com 的公开 API。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://doubaoya.com/api/apis/xiaohongshu/comments/call"
USER_AGENT = "doubaoya-skill/1.0"


def eprint(*args):
    print(*args, file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 小红书笔记评论拉取",
    )
    parser.add_argument("note_id", help="小红书笔记 noteId（必填）")
    parser.add_argument(
        "--cursor",
        default=None,
        help="下一页游标（可选）。首页不传；翻页时传上一页返回的 nextCursor",
    )
    parser.add_argument(
        "--sort",
        default=None,
        help="评论排序（可选）",
    )
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        eprint(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 口令中心 → 生成口令，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的口令"'
        )
        return 1

    # 仅在显式提供时才带上 cursor / sort（首页留空靠不传 --cursor 实现）。
    body = {"noteId": args.note_id}
    if args.cursor is not None:
        body["cursor"] = args.cursor
    if args.sort is not None:
        body["sort"] = args.sort
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
