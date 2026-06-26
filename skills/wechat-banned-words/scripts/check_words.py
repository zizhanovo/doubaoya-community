#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
都爆鸭 · 违禁词检测脚本（零依赖，仅用 Python 3 标准库）

用法：
    python3 check_words.py "<待检测文案>" [--platform gongzhonghao]

说明：
    - 从环境变量 DOUBAOYA_API_KEY 读取口令（形如 dyh_...），缺失时报错退出，绝不打印口令本身。
    - 默认 platform 为 gongzhonghao（公众号）；也可传 xiaohongshu / douyin 等。
    - POST 至都爆鸭 API，解析统一信封；success != true 时输出 [error] code: message 并退出 1。
    - 成功时打印 data 字段（riskLevel / matchedWords / suggestions）的 JSON，供智能体解析。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://doubaoya.com/api/apis/tool/check-banned-words/call"
ENV_KEY_NAME = "DOUBAOYA_API_KEY"
USER_AGENT = "doubaoya-skill/1.0"
TIMEOUT = 60


def _fail(message):
    """向 stderr 写一行错误并以非零码退出。"""
    sys.stderr.write(message.rstrip("\n") + "\n")
    sys.exit(1)


def _get_api_key():
    """从环境变量读取口令；缺失则报错退出，绝不回显口令内容。"""
    api_key = os.environ.get(ENV_KEY_NAME, "").strip()
    if not api_key:
        _fail(
            "[error] 未配置 {name}。\n"
            "请到 doubaoya.com 登录 → 口令中心 → 生成口令，得到形如 dyh_ 开头的口令，\n"
            "然后执行：export {name}=dyh_你的口令".format(name=ENV_KEY_NAME)
        )
    return api_key


def call_api(content, platform):
    """POST {platform, content} 到都爆鸭 API，返回解析后的信封 dict。"""
    api_key = _get_api_key()

    body = json.dumps(
        {"platform": platform, "content": content},
        ensure_ascii=False,
    ).encode("utf-8")

    req = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": "Bearer " + api_key,
            "User-Agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        # 服务端通常仍返回统一信封，尝试解析以拿到 error.code / message
        raw = ""
        try:
            raw = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        if raw:
            try:
                return json.loads(raw)
            except ValueError:
                pass
        _fail("[error] HTTP_{code}: 请求失败".format(code=exc.code))
    except urllib.error.URLError as exc:
        _fail("[error] NETWORK_ERROR: 无法连接检测服务（{reason}）".format(reason=exc.reason))

    try:
        return json.loads(raw)
    except ValueError:
        _fail("[error] BAD_RESPONSE: 服务返回的内容不是合法 JSON")


def main():
    parser = argparse.ArgumentParser(
        description="都爆鸭违禁词检测：检测文案中的违禁词/敏感词并给出合规建议",
    )
    parser.add_argument("content", help="待检测的文案内容")
    parser.add_argument(
        "--platform",
        default="gongzhonghao",
        help="平台标识，默认 gongzhonghao（公众号）；也可填 xiaohongshu / douyin 等",
    )
    args = parser.parse_args()

    content = (args.content or "").strip()
    if not content:
        _fail("[error] VALIDATION_ERROR: 待检测文案不能为空")

    envelope = call_api(content, args.platform)

    if not isinstance(envelope, dict) or envelope.get("success") is not True:
        err = {}
        if isinstance(envelope, dict):
            err = envelope.get("error") or {}
        code = err.get("code", "UNKNOWN_ERROR")
        message = err.get("message", "检测服务返回异常")
        _fail("[error] {code}: {message}".format(code=code, message=message))

    data = envelope.get("data") or {}
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
