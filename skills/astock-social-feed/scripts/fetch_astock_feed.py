#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""都爆鸭 · A股社媒每日信息源

零依赖（仅用 Python 3 标准库 urllib / datetime）。从环境变量 DOUBAOYA_API_KEY 读取口令，
聚合「小红书 + 抖音 + 公众号」上 A股相关作品，默认拉取近7天。

不传关键词时，自动遍历一批内置 A股核心关键词逐个查询；
传了关键词时只查该关键词。每个关键词的返回 data 内含三组数组：
    xhsResult  小红书作品
    dyResult   抖音作品
    gzhResult  公众号作品

用法:
    python3 fetch_astock_feed.py [<关键词>] [--days N]

例如:
    python3 fetch_astock_feed.py                 # 遍历内置 A股关键词，近7天
    python3 fetch_astock_feed.py "半导体" --days 3
    python3 fetch_astock_feed.py "券商"

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

ENDPOINT = "https://doubaoya.com/api/apis/multi/cn30-multi-search/call"

# 内置 A股核心关键词（不传 keyword 时逐个查询）
DEFAULT_KEYWORDS = [
    "A股",
    "大盘",
    "涨停",
    "选股",
    "牛市",
    "券商",
    "北交所",
    "科创板",
    "题材股",
    "龙头股",
    "加仓",
    "复盘",
]


def date_range(days):
    """endDate = 今天，startDate = 今天 - days。"""
    today = datetime.date.today()
    start = today - datetime.timedelta(days=days)
    return start.isoformat(), today.isoformat()


def fetch_one(keyword, start_date, end_date, api_key):
    """查询单个关键词，返回 (data, None) 或 (None, "CODE: message")。"""
    body = {
        "keyword": keyword,
        "startDate": start_date,
        "endDate": end_date,
    }
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
            return None, "%s: %s" % (code, message)
        except Exception:
            return None, "HTTP_%d: %s" % (exc.code, exc.reason or "请求失败")
    except urllib.error.URLError as exc:
        return None, "NETWORK_ERROR: 无法连接 doubaoya.com（%s）" % exc.reason

    try:
        envelope = json.loads(body_text)
    except json.JSONDecodeError:
        return None, "BAD_RESPONSE: 服务端返回非 JSON 内容"

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        return None, "%s: %s" % (
            err.get("code", "UNKNOWN"),
            err.get("message", "请求未成功"),
        )

    return envelope.get("data", {}), None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · A股社媒每日信息源（小红书 + 抖音 + 公众号）",
    )
    parser.add_argument(
        "keyword",
        nargs="?",
        default=None,
        help="搜索关键词（可选，不传则遍历内置 A股核心关键词）",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        help="回溯天数（可选，默认 7；startDate = 今天 - days）",
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

    start_date, end_date = date_range(args.days)
    keywords = [args.keyword] if args.keyword else DEFAULT_KEYWORDS

    results = {}
    errors = {}
    for kw in keywords:
        data, err = fetch_one(kw, start_date, end_date, api_key)
        if err is not None:
            errors[kw] = err
            sys.stderr.write("[error] %s（关键词「%s」）\n" % (err, kw))
        else:
            results[kw] = data

    output = {
        "range": {"startDate": start_date, "endDate": end_date},
        "results": results,
    }
    if errors:
        output["errors"] = errors

    print(json.dumps(output, ensure_ascii=False, indent=2))

    # 全部失败才以非零退出
    return 1 if (not results and errors) else 0


if __name__ == "__main__":
    sys.exit(main())
