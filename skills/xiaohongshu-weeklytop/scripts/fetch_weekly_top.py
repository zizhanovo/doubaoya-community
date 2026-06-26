#!/usr/bin/env python3
"""都爆鸭 · 小红书周榜

零依赖（Python 3 标准库 urllib），按日期 + 分类拉小红书周榜爆文，
供主 Agent 看一周里持续走高的笔记、判断中线趋势。

用法:
    python3 fetch_weekly_top.py [--rank-date YYYY-MM-DD] [--category 综合]

    --rank-date 榜单日期 YYYY-MM-DD，默认昨天。
    --category  分类，默认「综合」。

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取口令（形如 dyh_…）。
    口令绝不会被打印或写入任何文件。
"""

import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-weekly-top/call"


def call_api(api_key: str, payload_dict: dict) -> int:
    payload = json.dumps(payload_dict).encode("utf-8")

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
            body = response.read().decode("utf-8")
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
        envelope = json.loads(body)
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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 小红书周榜",
    )
    parser.add_argument("--rank-date", default=None, help="榜单日期 YYYY-MM-DD（默认昨天）")
    parser.add_argument("--category", default="综合", help="分类（默认 综合）")
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 口令中心 → 生成口令，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的口令"\n'
        )
        return 1

    if args.rank_date:
        try:
            datetime.date.fromisoformat(args.rank_date)
        except ValueError:
            sys.stderr.write("[error] VALIDATION_ERROR: --rank-date 需为 YYYY-MM-DD 格式\n")
            return 1
        rank_date = args.rank_date
    else:
        rank_date = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

    return call_api(api_key, {"rankDate": rank_date, "category": args.category})


if __name__ == "__main__":
    sys.exit(main())
