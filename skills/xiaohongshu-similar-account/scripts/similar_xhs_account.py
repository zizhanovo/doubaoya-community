#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""都爆鸭 · 小红书对标账号推荐

零依赖（仅用 Python 3 标准库 urllib）。两种输入模式：
  A. 按小红书号（redId）精准查相似账号；
  B. 按赛道 + 粉丝量 + 账号等级灵活筛选。
把成功返回的 data 以 JSON 打印到 stdout，供主 Agent 渲染对标表格。

用法:
    # 模式 A：按 redId
    python3 similar_xhs_account.py --red-id 27493135897

    # 模式 B：按赛道 + 粉丝量 + 等级
    python3 similar_xhs_account.py --track 美味佳肴 --min-fans 0 --max-fans 3000 --level 素人

至少要给 --red-id 或 --track 其一，否则报错退出。

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取口令（形如 dyh_…）。
    口令绝不会被打印或写入任何文件。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = (
    "https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-similar-account/call"
)
USER_AGENT = "doubaoya-skill/1.0"


def eprint(*args):
    print(*args, file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 小红书对标账号推荐",
    )
    parser.add_argument(
        "--red-id",
        default=None,
        help="小红书号（redId），精准查相似账号；与 --track 二选一",
    )
    parser.add_argument(
        "--track",
        default=None,
        help="赛道（如 美味佳肴）；与 --red-id 二选一",
    )
    parser.add_argument(
        "--min-fans",
        type=int,
        default=None,
        help="粉丝量下限（整数，可为 0）",
    )
    parser.add_argument(
        "--max-fans",
        type=int,
        default=None,
        help="粉丝量上限（整数，可为 0）",
    )
    parser.add_argument(
        "--level",
        default=None,
        help="账号等级（如 素人/初级达人/腰部达人 等）",
    )
    args = parser.parse_args()

    # 至少要有 red-id 或 track 之一。
    if not args.red_id and not args.track:
        eprint(
            "[error] 至少需要提供 --red-id 或 --track 其一。\n"
            "  按账号查：--red-id 27493135897\n"
            "  按赛道查：--track 美味佳肴 --max-fans 3000 --level 素人"
        )
        return 1

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        eprint(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 口令中心 → 生成口令，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的口令"'
        )
        return 1

    # 只在提供时带上对应字段（int 的 0 也算"已提供"，需保留）。
    body = {}
    if args.red_id:
        body["redId"] = args.red_id
    if args.track:
        body["track"] = args.track
    if args.min_fans is not None:
        body["minFans"] = args.min_fans
    if args.max_fans is not None:
        body["maxFans"] = args.max_fans
    if args.level:
        body["level"] = args.level

    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body_raw = ""
        try:
            body_raw = exc.read().decode("utf-8")
        except Exception:
            pass
        parsed = None
        if body_raw:
            try:
                parsed = json.loads(body_raw)
            except ValueError:
                parsed = None
        if isinstance(parsed, dict) and parsed.get("error"):
            err = parsed.get("error") or {}
            eprint(
                "[error] %s: %s"
                % (err.get("code", "HTTP_%d" % exc.code), err.get("message", "请求失败"))
            )
        else:
            eprint("[error] HTTP_%d: %s" % (exc.code, exc.reason or "请求失败"))
        return 1
    except urllib.error.URLError as exc:
        eprint("[error] NETWORK_ERROR: 无法连接 doubaoya.com（%s）" % exc.reason)
        return 1

    try:
        envelope = json.loads(raw)
    except ValueError:
        eprint("[error] BAD_RESPONSE: 服务端返回非 JSON 内容")
        return 1

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        eprint(
            "[error] %s: %s"
            % (err.get("code", "UNKNOWN"), err.get("message", "请求未成功"))
        )
        return 1

    data = envelope.get("data", {})
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
