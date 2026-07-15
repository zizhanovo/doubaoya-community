#!/usr/bin/env python3
"""都爆鸭 · 公众号发文列表（盯单个账号）

零依赖（Python 3 标准库），拉取指定公众号在某时间区间内的历史发文列表，
打 JSON 到 stdout 供主 Agent 做追更 / 复盘表格。
这是「按账号」拉发文，不是关键词搜索。

用法:
    python3 account_works.py "<公众号名称>" [--page N] [--start YYYY-MM-DD] [--end YYYY-MM-DD]

默认时间区间:
    --end   默认今天
    --start 默认今天往前推 29 天（即最近 30 天）

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

ENDPOINT = "https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-work-list/call"


def main() -> int:
    today = datetime.date.today()
    default_end = today.isoformat()
    default_start = (today - datetime.timedelta(days=29)).isoformat()

    parser = argparse.ArgumentParser(
        description="都爆鸭 · 公众号发文列表（按账号追更/复盘）",
    )
    parser.add_argument("accountName", help="公众号名称（精确到账号，非关键词）")
    parser.add_argument(
        "--page",
        type=int,
        default=1,
        help="页码（可选，默认 1）",
    )
    parser.add_argument(
        "--start",
        default=default_start,
        help="发文起始日期 YYYY-MM-DD（默认今天往前 29 天）",
    )
    parser.add_argument(
        "--end",
        default=default_end,
        help="发文结束日期 YYYY-MM-DD（默认今天）",
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
            "accountName": args.accountName,
            "page": args.page,
            "publishTimeStart": args.start,
            "publishTimeEnd": args.end,
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
