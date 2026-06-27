#!/usr/bin/env python3
"""都爆鸭 · 抖音账号诊断脚本（零依赖，仅用标准库）。

用法:
    python3 diagnose_account.py "<账号名或抖音号>" ["<账号2>" ...] [--sync]

    位置参数：一个或多个账号，账号名（中文名）或抖音号皆可，后端自动识别。
              统一组装成接口要求的 accountNames[]（该字段同时接受名称与 ID）。
    --sync    首次诊断某账号若数据稀疏，先把该账号的作品同步入库（约 30 分钟），
              本脚本只发起同步任务并立刻打印回执，不阻塞、不轮询；随后照常发起诊断。

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取口令（形如 dyh_…）。
    口令绝不会被打印或写入任何文件。

成功时把信封中的 data（含 items[]）以 JSON 打印到标准输出。
失败时把 [error] code: message 打到标准错误并以退出码 1 结束。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DIAGNOSE_URL = "https://doubaoya.com/api/apis/douyin/douyin-account-diagnosis/call"
SYNC_URL = "https://doubaoya.com/api/apis/douyin/douyin-sync-notes/call"
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


def call_api(api_key, url, body):
    """发一次 POST，返回信封里的 data；失败时直接退出。"""
    payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
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
        # 服务端通常仍返回信封 JSON，尽量解析出 error 信息。
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
        description="都爆鸭 · 抖音账号批量诊断",
    )
    parser.add_argument(
        "accounts",
        nargs="+",
        help="一个或多个账号；账号名或抖音号皆可（后端自动识别）",
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="先同步各账号作品入库（约 30 分钟，不计费、不阻塞），再发起诊断",
    )
    args = parser.parse_args()

    accounts = [a.strip() for a in args.accounts if a.strip()]
    if not accounts:
        fail('[error] VALIDATION_ERROR: 请至少提供一个账号，例如 python3 diagnose_account.py "本鸭の小厨房"')

    api_key = require_api_key()

    # --sync：先逐个发起作品同步（ack-only），立刻打印回执，不阻塞。
    if args.sync:
        for account in accounts:
            data = call_api(api_key, SYNC_URL, {"accountId": account})
            print(json.dumps({"account": account, "sync": data}, ensure_ascii=False, indent=2))
        sys.stderr.write(
            "[info] 已发起作品同步任务（约 30 分钟入库，不计费）。\n"
            "同步完成前诊断数据可能稀疏，建议约 30 分钟后再重跑一次（去掉 --sync）。\n"
        )

    # 诊断请求体：统一用接口要求的 accountNames[]（该字段同时接受名称与抖音号）。
    body = {"accountNames": accounts}

    data = call_api(api_key, DIAGNOSE_URL, body)
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
