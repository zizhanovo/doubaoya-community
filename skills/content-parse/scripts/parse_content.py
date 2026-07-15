#!/usr/bin/env python3
"""都爆鸭 · 内容解析 — 把一条公开作品/文章链接解析成结构化详情。

调用 doubaoya.com 的 parse-content-detail 接口，返回标题 / 作者 / 互动数据等
归一化字段。零依赖，仅用 Python 3 标准库。

用法:
    python3 parse_content.py "<url>"

环境变量:
    DOUBAOYA_API_KEY  —  你的密钥（形如 dyh_...），从 doubaoya.com 密钥中心生成。
"""

import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://doubaoya.com/api/apis/tool/parse-content-detail/call"
USER_AGENT = "doubaoya-skill/1.0"


def fail(message):
    """打印错误到 stderr 并退出。"""
    print(message, file=sys.stderr)
    sys.exit(1)


def main(argv):
    if len(argv) != 1 or not argv[0].strip():
        fail('用法: python3 parse_content.py "<url>"')

    url = argv[0].strip()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        fail(
            "[error] 未检测到 DOUBAOYA_API_KEY 环境变量。\n"
            "请前往 doubaoya.com 登录 → 密钥中心 → 生成密钥（形如 dyh_...），"
            "然后 export DOUBAOYA_API_KEY=<你的密钥>"
        )

    payload = json.dumps({"url": url}).encode("utf-8")

    request = urllib.request.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # 接口在非 2xx 时仍会返回标准信封，尽量解析出 code/message。
        raw = ""
        try:
            raw = exc.read().decode("utf-8")
        except Exception:
            raw = ""
        envelope = None
        if raw:
            try:
                envelope = json.loads(raw)
            except ValueError:
                envelope = None
        if isinstance(envelope, dict) and isinstance(envelope.get("error"), dict):
            code = envelope["error"].get("code", "HTTP_%s" % exc.code)
            message = envelope["error"].get("message", exc.reason)
            fail("[error] %s: %s" % (code, message))
        fail("[error] HTTP_%s: %s" % (exc.code, exc.reason))
    except urllib.error.URLError as exc:
        fail("[error] NETWORK_ERROR: 无法连接 doubaoya.com（%s）" % exc.reason)

    try:
        envelope = json.loads(body)
    except ValueError:
        fail("[error] INVALID_RESPONSE: 接口返回的不是合法 JSON")

    if envelope.get("success") is not True:
        error = envelope.get("error") or {}
        code = error.get("code", "UNKNOWN_ERROR")
        message = error.get("message", "解析失败，请稍后重试")
        fail("[error] %s: %s" % (code, message))

    data = envelope.get("data", {})
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
