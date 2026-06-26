#!/usr/bin/env python3
"""都爆鸭 · 全网热点聚合 — fetch_trends.py

零依赖（仅标准库 urllib）。从 doubaoya.com 拉取多平台聚合热榜。

用法:
    export DOUBAOYA_API_KEY="dyh_xxx..."
    python3 fetch_trends.py [--platforms douyin,xiaohongshu,gongzhonghao] [--limit 10]

成功时把 data（含 data.items 热榜）以 JSON 打印到 stdout；
失败时把 [error] code: message 打印到 stderr 并以退出码 1 退出。
绝不打印 API Key。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://doubaoya.com/api/apis/trend/hot-topics/call"
VALID_PLATFORMS = ("douyin", "xiaohongshu", "gongzhonghao")
DEFAULT_PLATFORMS = ["douyin", "xiaohongshu", "gongzhonghao"]


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser(
        description="拉取 都爆鸭 全网聚合热榜（抖音/小红书/公众号）"
    )
    parser.add_argument(
        "--platforms",
        default=",".join(DEFAULT_PLATFORMS),
        help="逗号分隔的平台列表，可选: douyin,xiaohongshu,gongzhonghao"
             "（默认全选）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="返回的热点条数上限（可选，整数）",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        die("[error] 未找到环境变量 DOUBAOYA_API_KEY，请先配置口令后再运行。"
            "（前往 doubaoya.com → 登录 → 口令中心 → 生成口令）")

    platforms = [p.strip() for p in args.platforms.split(",") if p.strip()]
    if not platforms:
        die("[error] --platforms 不能为空，可选: " + ",".join(VALID_PLATFORMS))
    invalid = [p for p in platforms if p not in VALID_PLATFORMS]
    if invalid:
        die("[error] 无效平台: " + ",".join(invalid) +
            "；可选: " + ",".join(VALID_PLATFORMS))

    body = {"platforms": platforms}
    if args.limit is not None:
        body["limit"] = args.limit

    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "User-Agent": "doubaoya-skill/1.0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        # 业务错误也可能带 JSON envelope，尽量解析出 code/message
        try:
            err_raw = e.read().decode("utf-8")
            env = json.loads(err_raw)
            error = env.get("error") or {}
            code = error.get("code") or ("HTTP_" + str(e.code))
            message = error.get("message") or str(e)
            die("[error] {}: {}".format(code, message))
        except (ValueError, AttributeError):
            die("[error] HTTP_{}: {}".format(e.code, e.reason))
    except urllib.error.URLError as e:
        die("[error] NETWORK_ERROR: 无法连接 doubaoya.com（{}）".format(e.reason))

    try:
        envelope = json.loads(raw)
    except ValueError:
        die("[error] BAD_RESPONSE: 返回内容不是合法 JSON")

    if envelope.get("success") is not True:
        error = envelope.get("error") or {}
        code = error.get("code") or "UNKNOWN"
        message = error.get("message") or "请求失败，未返回错误详情"
        die("[error] {}: {}".format(code, message))

    data = envelope.get("data") or {}
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
