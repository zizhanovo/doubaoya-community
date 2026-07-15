#!/usr/bin/env python3
"""都爆鸭 · 多平台违禁词检测脚本（零依赖，仅用 Python 3 标准库）。

逐个平台调用都爆鸭 check-banned-words 接口，把每个平台的结果汇总成
一个 map 后输出。每个平台是一次独立计费调用。

用法：
    python3 check_multi.py "<文案>" [--platforms xiaohongshu,douyin,gongzhonghao]

环境变量：
    DOUBAOYA_API_KEY    必填，密钥形如 dyh_...（绝不打印到任何输出）
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://doubaoya.com/api/apis/tool/check-banned-words/call"
USER_AGENT = "doubaoya-skill/1.0"
DEFAULT_PLATFORMS = ["xiaohongshu", "douyin", "gongzhonghao"]


def check_one(platform, content, api_key):
    """对单个平台发起一次检测，返回 data 字典或 {"error": ...} 字典。"""
    payload = json.dumps(
        {"platform": platform, "content": content}
    ).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
            err = body.get("error") or {}
            return {
                "error": {
                    "code": err.get("code", "HTTP_%d" % exc.code),
                    "message": err.get("message", exc.reason),
                }
            }
        except Exception:
            return {
                "error": {
                    "code": "HTTP_%d" % exc.code,
                    "message": str(exc.reason),
                }
            }
    except urllib.error.URLError as exc:
        return {"error": {"code": "NETWORK_ERROR", "message": str(exc.reason)}}
    except Exception as exc:  # noqa: BLE001 — 兜底，保证别的平台继续
        return {"error": {"code": "UNKNOWN_ERROR", "message": str(exc)}}

    if not body.get("success"):
        err = body.get("error") or {}
        return {
            "error": {
                "code": err.get("code", "UNKNOWN"),
                "message": err.get("message", "请求失败"),
            }
        }
    return body.get("data") or {}


def main():
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 多平台违禁词检测"
    )
    parser.add_argument("content", help="待检测的文案内容")
    parser.add_argument(
        "--platforms",
        default=",".join(DEFAULT_PLATFORMS),
        help="逗号分隔的平台列表，默认 xiaohongshu,douyin,gongzhonghao",
    )
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "错误：未检测到 DOUBAOYA_API_KEY 环境变量。\n"
            "请到 doubaoya.com 登录 → 密钥中心 → 生成密钥，然后：\n"
            "    export DOUBAOYA_API_KEY=<你的密钥>\n"
        )
        sys.exit(1)

    platforms = [p.strip() for p in args.platforms.split(",") if p.strip()]
    if not platforms:
        sys.stderr.write("错误：平台列表为空。\n")
        sys.exit(1)

    results = {}
    for platform in platforms:
        results[platform] = check_one(platform, args.content, api_key)

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
