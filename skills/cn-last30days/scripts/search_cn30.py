#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""都爆鸭 · 全网近30天作品聚合搜索

零依赖（仅用 Python 3 标准库 urllib）。从环境变量 DOUBAOYA_API_KEY 读取密钥，
一次调用聚合「小红书 + 抖音 + 公众号」近30天作品，把成功返回的 data 以 JSON 打到 stdout。

返回的 data 内含三组数组：
    xhsResult  小红书作品
    dyResult   抖音作品
    gzhResult  公众号作品

用法:
    python3 search_cn30.py "<关键词>" [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]

例如:
    python3 search_cn30.py "AI 视频工具"
    python3 search_cn30.py "大模型" --start-date 2026-06-01 --end-date 2026-06-24

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取密钥（形如 dyh_…）。
    密钥绝不会被打印或写入任何文件。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://doubaoya.com/api/apis/multi/cn30-multi-search/call"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 全网近30天作品聚合搜索（小红书 + 抖音 + 公众号）",
    )
    parser.add_argument("keyword", help="搜索关键词（建议精简，2~6 字最佳）")
    parser.add_argument(
        "--start-date",
        default=None,
        help="起始日期 YYYY-MM-DD（可选，不传由服务端取默认近30天）",
    )
    parser.add_argument(
        "--end-date",
        default=None,
        help="结束日期 YYYY-MM-DD（可选）",
    )
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 密钥中心 → 生成密钥，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的密钥"\n'
        )
        return 1

    body = {"keyword": args.keyword}
    if args.start_date:
        body["startDate"] = args.start_date
    if args.end_date:
        body["endDate"] = args.end_date

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
