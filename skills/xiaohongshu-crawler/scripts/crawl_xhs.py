#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""都爆鸭 · 小红书作品爬取脚本

零依赖（仅用 Python 3 标准库 urllib）。从环境变量 DOUBAOYA_API_KEY 读取口令，
调用 doubaoya.com 公开 API 按关键词爬取小红书热门作品，支持日期范围与排序方式，
把成功返回的 data 以 JSON 打印到 stdout。

用法:
    python3 crawl_xhs.py "<关键词>" [--start-date YYYY-MM-DD] \
        [--end-date YYYY-MM-DD] [--sort-type _0|_2|_4]

例如:
    python3 crawl_xhs.py "减脂餐"
    python3 crawl_xhs.py "通勤穿搭" --start-date 2026-06-01 --end-date 2026-06-20
    python3 crawl_xhs.py "露营" --sort-type _4

排序（sortType）:
    _0  综合 / 相关（默认）
    _2  最新（按发布时间）
    _4  最热（按互动数）

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

ENDPOINT = "https://doubaoya.com/api/apis/xiaohongshu/crawl-work/call"
USER_AGENT = "doubaoya-skill/1.0"


def eprint(*args):
    print(*args, file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 小红书作品爬取（按关键词，可选日期范围与排序）",
    )
    parser.add_argument("keyword", help="搜索关键词（必填）")
    parser.add_argument(
        "--start-date",
        default=None,
        help="起始日期 YYYY-MM-DD（可选，不传则由服务端默认处理）",
    )
    parser.add_argument(
        "--end-date",
        default=None,
        help="结束日期 YYYY-MM-DD（可选，不传则由服务端默认处理）",
    )
    parser.add_argument(
        "--sort-type",
        default="_0",
        help="排序方式：_0 综合/相关（默认）、_2 最新、_4 最热",
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

    # sortType 有默认值（_0），始终带上；日期参数仅在显式提供时才带上。
    body = {"keyword": args.keyword, "sortType": args.sort_type}
    if args.start_date is not None:
        body["startDate"] = args.start_date
    if args.end_date is not None:
        body["endDate"] = args.end_date
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
