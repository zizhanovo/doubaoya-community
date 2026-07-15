#!/usr/bin/env python3
"""都爆鸭 · 公众号阅读增长榜（黑马账号）

零依赖（Python 3 标准库 urllib），拉某天的公众号阅读增长榜，
供主 Agent 发现高增长黑马账号 / 判断流量风向。

用法:
    python3 fetch_growth_rank.py [--date yesterday|today|YYYY-MM-DD] [--auto-back]

    --date 接受口语化 "yesterday" / "today" 或具体 YYYY-MM-DD，默认昨天。
    --auto-back 当指定日期无数据时，自动向前逐天追溯（最多 7 天），找到即停。

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

ENDPOINT = "https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-raise-rank/call"


def resolve_date(raw: str) -> str:
    """把 yesterday/today/YYYY-MM-DD 映射成具体日期串，默认昨天。"""
    today = datetime.date.today()
    if not raw or raw == "yesterday":
        return (today - datetime.timedelta(days=1)).isoformat()
    if raw == "today":
        return today.isoformat()
    # 校验 YYYY-MM-DD 格式
    datetime.date.fromisoformat(raw)
    return raw


def call_api(api_key: str, rank_date: str):
    """发一次请求，返回 (ok, data_or_none, err_tuple_or_none)。"""
    payload = json.dumps({"rankDate": rank_date}).encode("utf-8")
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
            return False, None, (code, message)
        except Exception:
            return False, None, ("HTTP_%d" % exc.code, exc.reason or "请求失败")
    except urllib.error.URLError as exc:
        return False, None, ("NETWORK_ERROR", "无法连接 doubaoya.com（%s）" % exc.reason)

    try:
        envelope = json.loads(body)
    except json.JSONDecodeError:
        return False, None, ("BAD_RESPONSE", "服务端返回非 JSON 内容")

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        return False, None, (err.get("code", "UNKNOWN"), err.get("message", "请求未成功"))

    return True, envelope.get("data", {}), None


def has_rows(data) -> bool:
    items = (data or {}).get("items")
    return bool(items)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 公众号阅读增长榜（黑马账号）",
    )
    parser.add_argument(
        "--date",
        default="yesterday",
        help="榜单日期：yesterday / today / YYYY-MM-DD（可选，默认昨天）",
    )
    parser.add_argument(
        "--auto-back",
        action="store_true",
        help="指定日期无数据时自动向前逐天追溯（最多 7 天），找到即停",
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

    try:
        start_date = resolve_date(args.date)
    except ValueError:
        sys.stderr.write(
            "[error] VALIDATION_ERROR: --date 需为 yesterday / today / YYYY-MM-DD\n"
        )
        return 1

    attempts = 7 if args.auto_back else 1
    cursor = datetime.date.fromisoformat(start_date)
    last_err = None

    for _ in range(attempts):
        rank_date = cursor.isoformat()
        ok, data, err = call_api(api_key, rank_date)
        if not ok:
            last_err = err
            break
        if has_rows(data) or not args.auto_back:
            print(json.dumps(data, ensure_ascii=False, indent=2))
            return 0
        # auto-back 且当天空数据：往前挪一天再试
        cursor = cursor - datetime.timedelta(days=1)

    if last_err is not None:
        sys.stderr.write("[error] %s: %s\n" % (last_err[0], last_err[1]))
        return 1

    sys.stderr.write(
        "[error] NO_DATA: 起始日向前追溯 %d 天仍无增长榜数据，请换个日期\n" % attempts
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
