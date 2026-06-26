#!/usr/bin/env python3
"""都爆鸭 · 抖音每日点赞 TOP 榜

零依赖（Python 3 标准库 urllib），按分类 + 日期拉抖音每日点赞 TOP 榜，
供主 Agent 看当天哪些作品最吸赞、出自哪些账号。

用法:
    python3 fetch_daily_hot.py [--type 美食] [--start-time YYYY-MM-DD] [--end-time YYYY-MM-DD]

    --type       内容分类，默认「美食」。
    --start-time 起始日期 YYYY-MM-DD，默认昨天。
    --end-time   结束日期 YYYY-MM-DD，默认昨天。

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

ENDPOINT = "https://doubaoya.com/api/apis/douyin/douyin-likes-rank/call"


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
        description="都爆鸭 · 抖音每日点赞 TOP 榜",
    )
    parser.add_argument("--type", default="美食", help="内容分类（默认 美食）")
    parser.add_argument("--start-time", default=None, help="起始日期 YYYY-MM-DD（默认昨天）")
    parser.add_argument("--end-time", default=None, help="结束日期 YYYY-MM-DD（默认昨天）")
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 口令中心 → 生成口令，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的口令"\n'
        )
        return 1

    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    if args.start_time:
        try:
            datetime.date.fromisoformat(args.start_time)
        except ValueError:
            sys.stderr.write("[error] VALIDATION_ERROR: --start-time 需为 YYYY-MM-DD 格式\n")
            return 1
        start_time = args.start_time
    else:
        start_time = yesterday
    if args.end_time:
        try:
            datetime.date.fromisoformat(args.end_time)
        except ValueError:
            sys.stderr.write("[error] VALIDATION_ERROR: --end-time 需为 YYYY-MM-DD 格式\n")
            return 1
        end_time = args.end_time
    else:
        end_time = yesterday

    return call_api(api_key, {
        "type": args.type,
        "startTime": start_time,
        "endTime": end_time,
    })


if __name__ == "__main__":
    sys.exit(main())
