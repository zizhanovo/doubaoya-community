#!/usr/bin/env python3
"""都爆鸭 · 公众号热度指数榜 TOP

零依赖（Python 3 标准库 urllib），拉某分类下公众号的热度指数排行，
供主 Agent 做头部账号对标 / 竞品跟踪。

用法:
    python3 fetch_index_rank.py [--rank-type day|week|month] \
        [--date YYYY-MM-DD] [--category 人文资讯]

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取密钥（形如 dyh_…）。
    密钥绝不会被打印或写入任何文件。
"""

import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-index-rank/call"


def yesterday() -> str:
    """默认榜单日期 = 昨天（当日数据通常尚未结算）。"""
    return (datetime.date.today() - datetime.timedelta(days=1)).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 公众号热度指数榜 TOP",
    )
    parser.add_argument(
        "--rank-type",
        choices=["day", "week", "month"],
        default="day",
        help="榜单周期：day/week/month（可选，默认 day）",
    )
    parser.add_argument(
        "--date",
        default=None,
        help="榜单日期 YYYY-MM-DD（可选，默认昨天）",
    )
    parser.add_argument(
        "--category",
        default="人文资讯",
        help="垂直分类（可选，默认 人文资讯）",
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

    payload = json.dumps(
        {
            "rankType": args.rank_type,
            "rankDate": args.date or yesterday(),
            "category": args.category,
        }
    ).encode("utf-8")

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
        with urllib.request.urlopen(request, timeout=30) as response:
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


if __name__ == "__main__":
    sys.exit(main())
