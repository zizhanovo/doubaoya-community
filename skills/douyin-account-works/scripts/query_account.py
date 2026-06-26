#!/usr/bin/env python3
"""都爆鸭 · 抖音账号概况查询

调用 doubaoya.com 的 douyin/query-account 接口，返回账号档案
（昵称 / 粉丝数 / 关注数 / 作品总数）。

用法：
    python3 query_account.py "<secUid>"

环境变量：
    DOUBAOYA_API_KEY  必填，形如 dyh_xxx 的口令。脚本不会打印它。
"""

import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://doubaoya.com/api/apis/douyin/query-account/call"
USER_AGENT = "doubaoya-skill/1.0"
TIMEOUT = 30


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        fail('用法: python3 query_account.py "<secUid>"')

    sec_uid = sys.argv[1].strip()

    api_key = os.environ.get("DOUBAOYA_API_KEY", "").strip()
    if not api_key:
        fail(
            "[error] 未设置环境变量 DOUBAOYA_API_KEY。\n"
            "请在 doubaoya.com → 登录 → 口令中心 → 生成口令，得到形如 dyh_xxx 的口令，\n"
            "然后执行： export DOUBAOYA_API_KEY=你的口令"
        )

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

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # 服务端通常仍返回标准信封，尽量解析出 error.code/message。
        body = ""
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            pass
        try:
            envelope = json.loads(body)
            err = (envelope or {}).get("error") or {}
            code = err.get("code") or ("HTTP_%s" % exc.code)
            message = err.get("message") or exc.reason
            fail("[error] %s: %s" % (code, message))
        except (ValueError, AttributeError):
            fail("[error] HTTP_%s: %s" % (exc.code, exc.reason))
    except urllib.error.URLError as exc:
        fail("[error] NETWORK_ERROR: %s" % exc.reason)

    try:
        envelope = json.loads(raw)
    except ValueError:
        fail("[error] INVALID_RESPONSE: 返回内容不是合法 JSON")

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        code = err.get("code") or "UNKNOWN_ERROR"
        message = err.get("message") or "请求未成功，且未返回错误详情"
        fail("[error] %s: %s" % (code, message))

    data = envelope.get("data") or {}
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
