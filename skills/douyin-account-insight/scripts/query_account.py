#!/usr/bin/env python3
"""都爆鸭 · 抖音账号档案查询脚本（零依赖，仅用标准库）。

用法:
    python3 query_account.py "<secUid>"

需要环境变量:
    DOUBAOYA_API_KEY   都爆鸭访问口令，形如 dyh_...

成功时把信封中的 data（含 profile）以 JSON 打印到标准输出。
失败时把 [error] code: message 打到标准错误并以退出码 1 结束。
"""

import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://doubaoya.com/api/apis/douyin/query-account/call"
USER_AGENT = "doubaoya-skill/1.0"


def fail(message):
    """打印错误到 stderr 并退出。"""
    sys.stderr.write(message.rstrip("\n") + "\n")
    sys.exit(1)


def main():
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        fail('用法: python3 query_account.py "<secUid>"')

    sec_uid = sys.argv[1].strip()

    api_key = os.environ.get("DOUBAOYA_API_KEY", "").strip()
    if not api_key:
        # 永不打印 Key 本身。
        fail("[error] 未检测到环境变量 DOUBAOYA_API_KEY。请前往 doubaoya.com 登录 → 口令中心 → 生成口令（形如 dyh_…），再 export 设入环境变量。")

    payload = json.dumps({"secUid": sec_uid}).encode("utf-8")
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

    raw = None
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # 服务端通常仍返回信封 JSON，尽量解析出 error 信息。
        body = ""
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = ""
        try:
            envelope = json.loads(body)
            err = envelope.get("error") or {}
            code = err.get("code") or ("HTTP_%s" % exc.code)
            message = err.get("message") or exc.reason or "请求失败"
            fail("[error] %s: %s" % (code, message))
        except (ValueError, TypeError):
            fail("[error] HTTP_%s: %s" % (exc.code, exc.reason or "请求失败"))
    except urllib.error.URLError as exc:
        fail("[error] NETWORK_ERROR: %s" % (getattr(exc, "reason", exc),))

    try:
        envelope = json.loads(raw)
    except (ValueError, TypeError):
        fail("[error] INVALID_RESPONSE: 接口返回内容不是合法 JSON")

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        code = err.get("code") or "UNKNOWN_ERROR"
        message = err.get("message") or "查询失败"
        fail("[error] %s: %s" % (code, message))

    data = envelope.get("data")
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
