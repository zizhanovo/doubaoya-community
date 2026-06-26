#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""都爆鸭 · 全网内容出海信息源

零依赖（仅用 Python 3 标准库 urllib）。从环境变量 DOUBAOYA_API_KEY 读取口令，
扫描全平台（公众号/抖音/视频号/小红书/快手/B站）内容出海 Top 榜，
把成功返回的 data 以 JSON 打到 stdout。

平台编号：0=公众号, 1=抖音, 2=视频号, 3=小红书, 4=快手, 6=B站

用法:
    python3 fetch_content_export_top.py [--platforms 0,1,3] [--keyword 关键词] \
        [--start-time YYYY-MM-DD] [--end-time YYYY-MM-DD]

例如:
    python3 fetch_content_export_top.py
    python3 fetch_content_export_top.py --platforms 3,1
    python3 fetch_content_export_top.py --keyword 品牌出海 --start-time 2026-06-10 --end-time 2026-06-15

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

ENDPOINT = "https://doubaoya.com/api/apis/multi/multi-content-export-top/call"

DEFAULT_PLATFORMS = [0, 1, 2, 3, 4, 6]


def parse_platforms(raw):
    if not raw:
        return DEFAULT_PLATFORMS
    out = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        out.append(int(part))
    return out or DEFAULT_PLATFORMS


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 全网内容出海信息源（全平台 Top 榜）",
    )
    parser.add_argument(
        "--platforms",
        default=None,
        help="平台编号，逗号分隔，如 0,1,3（可选，默认全平台 0,1,2,3,4,6）",
    )
    parser.add_argument(
        "--keyword",
        default=None,
        help="关键词，模糊匹配标题/作者（可选，不传则不限关键词）",
    )
    parser.add_argument(
        "--start-time",
        default=None,
        help="起始日期 YYYY-MM-DD（可选）",
    )
    parser.add_argument(
        "--end-time",
        default=None,
        help="结束日期 YYYY-MM-DD（可选）",
    )
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 口令中心 → 生成口令，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的口令"\n'
        )
        return 1

    try:
        platforms = parse_platforms(args.platforms)
    except ValueError:
        sys.stderr.write(
            "[error] VALIDATION_ERROR: --platforms 只能是逗号分隔的整数，如 0,1,3\n"
        )
        return 1

    # 服务端要求始终带 startTime/endTime 两个键；缺省时传空字符串。
    body = {
        "platforms": platforms,
        "startTime": args.start_time or "",
        "endTime": args.end_time or "",
    }
    if args.keyword:
        body["keyword"] = args.keyword

    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
            "User-Agent": "doubaoya-skill/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body_text = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read().decode("utf-8")
            envelope = json.loads(raw)
            err = envelope.get("error") or {}
            code = err.get("code", "HTTP_%d" % exc.code)
            message = err.get("message", exc.reason or "请求失败")
            sys.stderr.write("[error] %s: %s\n" % (code, message))
        except Exception:
            sys.stderr.write(
                "[error] HTTP_%d: %s\n" % (exc.code, exc.reason or "请求失败")
            )
        return 1
    except urllib.error.URLError as exc:
        sys.stderr.write(
            "[error] NETWORK_ERROR: 无法连接 doubaoya.com（%s）\n" % exc.reason
        )
        return 1

    try:
        envelope = json.loads(body_text)
    except json.JSONDecodeError:
        sys.stderr.write("[error] BAD_RESPONSE: 服务端返回非 JSON 内容\n")
        return 1

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        code = err.get("code", "UNKNOWN")
        message = err.get("message", "请求未成功")
        sys.stderr.write("[error] %s: %s\n" % (code, message))
        return 1

    data = envelope.get("data", {})
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
