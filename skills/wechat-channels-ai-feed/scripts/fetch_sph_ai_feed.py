#!/usr/bin/env python3
"""都爆鸭 · AI 视频号日报内容源

零依赖（Python 3 标准库 urllib），按关键词扫描视频号平台的
AI 方向爆款作品，用于做每日 AI 视频号选题日报。

用法:
    python3 fetch_sph_ai_feed.py "<关键词>" [--page N] [--size N]

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取口令（形如 dyh_…）。
    口令绝不会被打印或写入任何文件。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://doubaoya.com/api/apis/sph/shipinhao-ai-feed/call"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · AI 视频号日报内容源（按关键词）",
    )
    parser.add_argument(
        "keyword",
        help="AI 方向关键词（必填，如 AI / 大模型 / AI绘画 / 数字人）",
    )
    parser.add_argument(
        "--page",
        type=int,
        default=1,
        help="页码 pageNum（可选，默认 1）",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=20,
        help="每页条数 pageSize（可选，默认 20）",
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

    payload = json.dumps(
        {"keyword": args.keyword, "pageNum": args.page, "pageSize": args.size}
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
