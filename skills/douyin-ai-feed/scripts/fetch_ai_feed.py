#!/usr/bin/env python3
"""都爆鸭 · 抖音 AI 日报内容流脚本（零依赖，仅用标准库）。

用法:
    python3 fetch_ai_feed.py "<关键词>" [--page 1] [--page-size 20] \
        [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]

    关键词为必填位置参数。
    --page       页码，映射为 pageNum（默认 1）。
    --page-size  每页条数，映射为 pageSize（默认 20）。
    --start-date / --end-date  仅在提供时才加入请求体（YYYY-MM-DD）。

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取口令（形如 dyh_…）。
    口令绝不会被打印或写入任何文件。

成功时把信封中的 data（含 items[]）以 JSON 打印到标准输出。
失败时把 [error] code: message 打到标准错误并以退出码 1 结束。
"""

import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://doubaoya.com/api/apis/douyin/douyin-ai-feed/call"
USER_AGENT = "doubaoya-skill/1.0"


def fail(message):
    """打印错误到 stderr 并以退出码 1 结束。"""
    sys.stderr.write(message.rstrip("\n") + "\n")
    sys.exit(1)


def require_api_key():
    """读取并校验口令；缺失时给出标准指引并退出。永不打印 Key 本身。"""
    api_key = os.environ.get("DOUBAOYA_API_KEY", "").strip()
    if not api_key:
        fail(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 口令中心 → 生成口令，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的口令"'
        )
    return api_key


def valid_date(raw):
    """校验 YYYY-MM-DD；不合法则退出。"""
    try:
        datetime.date.fromisoformat(raw)
    except ValueError:
        fail("[error] VALIDATION_ERROR: 日期需为 YYYY-MM-DD 格式（%s）" % raw)
    return raw


def call_api(api_key, body):
    """发一次 POST，返回信封里的 data；失败时直接退出。"""
    payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )

    raw = None
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body_text = ""
        try:
            body_text = exc.read().decode("utf-8")
        except Exception:
            body_text = ""
        try:
            envelope = json.loads(body_text)
            err = envelope.get("error") or {}
            code = err.get("code") or ("HTTP_%s" % exc.code)
            message = err.get("message") or exc.reason or "请求失败"
            fail("[error] %s: %s" % (code, message))
        except (ValueError, TypeError):
            fail("[error] HTTP_%s: %s" % (exc.code, exc.reason or "请求失败"))
    except urllib.error.URLError as exc:
        fail("[error] NETWORK_ERROR: 无法连接 doubaoya.com（%s）" % getattr(exc, "reason", exc))

    try:
        envelope = json.loads(raw)
    except (ValueError, TypeError):
        fail("[error] BAD_RESPONSE: 接口返回内容不是合法 JSON")

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        code = err.get("code") or "UNKNOWN_ERROR"
        message = err.get("message") or "请求失败"
        fail("[error] %s: %s" % (code, message))

    return envelope.get("data")


def main():
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 抖音 AI 日报内容流",
    )
    parser.add_argument("keyword", help="检索关键词（必填）")
    parser.add_argument("--page", type=int, default=1, help="页码，映射为 pageNum（默认 1）")
    parser.add_argument("--page-size", type=int, default=20, help="每页条数，映射为 pageSize（默认 20）")
    parser.add_argument("--start-date", help="起始日期 YYYY-MM-DD（可选）")
    parser.add_argument("--end-date", help="结束日期 YYYY-MM-DD（可选）")
    args = parser.parse_args()

    keyword = args.keyword.strip()
    if not keyword:
        fail('[error] VALIDATION_ERROR: 请提供关键词，例如 python3 fetch_ai_feed.py "AI 工具"')

    api_key = require_api_key()

    body = {
        "keyword": keyword,
        "pageNum": args.page,
        "pageSize": args.page_size,
    }
    if args.start_date:
        body["startTime"] = valid_date(args.start_date)
    if args.end_date:
        body["endTime"] = valid_date(args.end_date)

    data = call_api(api_key, body)
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
