#!/usr/bin/env python3
"""都爆鸭 · 豆包联网搜索

零依赖（Python 3 标准库 urllib），提交一个查询给服务端做异步联网检索，
返回综合答案、引用来源与延伸建议。

注意：检索为服务端异步执行，整个过程约 5 分钟，单次请求内完成（无需客户端轮询）。

用法:
    python3 doubao_search.py "<查询>"

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

ENDPOINT = "https://doubaoya.com/api/skills/doubao-web-search/invoke"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 豆包联网搜索（异步约 5 分钟）",
    )
    parser.add_argument(
        "query",
        help="检索查询（必填）",
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

    payload = json.dumps({"query": args.query}).encode("utf-8")

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

    sys.stderr.write("[info] 已提交，服务端生成中，可能需要数分钟，请耐心等待…\n")

    try:
        with urllib.request.urlopen(request, timeout=360) as response:
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
