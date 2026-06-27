#!/usr/bin/env python3
"""都爆鸭 · 公众号账号诊断（批量体检 / 竞品诊断）

零依赖（Python 3 标准库），按账号名称批量诊断公众号画像 / 发文表现 / 健康度。
打 JSON 到 stdout 供主 Agent 出诊断报告。

用法:
    python3 analyze_accounts.py "<账号名1>" ["<账号名2>" ...] [--sync]

诊断接口（默认直接调用）:
    POST .../gongzhonghao-account-analyzer/call   body {"accountNames": [...]}
    读「库」里现有的数据，不保证最新。

可选预同步（--sync）:
    先对每个账号触发一次异步同步（用账号名作为 accountId），打印各自的受理回执
    （状态通常为 syncing，落库需要时间，详见回执 retryAfterMinutes），再调用诊断接口。
    同步是异步的：本次诊断仍读库里现有数据；想要最新数据，等同步完成后再跑一次（不带 --sync）。
    POST .../gzh-sync-notes/call   body {"accountId": "<账号名>"}

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

BASE = "https://doubaoya.com/api/apis/gongzhonghao"
ANALYZER_ENDPOINT = BASE + "/gongzhonghao-account-analyzer/call"
SYNC_ENDPOINT = BASE + "/gzh-sync-notes/call"


def call(endpoint, payload, api_key):
    """调用一个 doubaoya 接口，返回 (ok, data_or_none, code, message)。"""
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
            "User-Agent": "doubaoya-skill/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        try:
            envelope = json.loads(exc.read().decode("utf-8"))
            err = envelope.get("error") or {}
            return (
                False,
                None,
                err.get("code", "HTTP_%d" % exc.code),
                err.get("message", exc.reason or "请求失败"),
            )
        except Exception:
            return (False, None, "HTTP_%d" % exc.code, exc.reason or "请求失败")
    except urllib.error.URLError as exc:
        return (False, None, "NETWORK_ERROR", "无法连接 doubaoya.com（%s）" % exc.reason)

    try:
        envelope = json.loads(body)
    except json.JSONDecodeError:
        return (False, None, "BAD_RESPONSE", "服务端返回非 JSON 内容")

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        return (False, None, err.get("code", "UNKNOWN"), err.get("message", "请求未成功"))

    return (True, envelope.get("data", {}), None, None)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 公众号账号诊断（批量体检/竞品诊断）",
    )
    parser.add_argument(
        "accountNames",
        nargs="+",
        help="一个或多个公众号名称（空格分隔）",
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="诊断前先对每个账号触发异步同步（落库需要时间，详见回执 retryAfterMinutes），并打印受理回执",
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

    if args.sync:
        receipts = []
        for name in args.accountNames:
            ok, data, code, message = call(SYNC_ENDPOINT, {"accountId": name}, api_key)
            if not ok:
                sys.stderr.write("[error] %s: %s\n" % (code, message))
                return 1
            receipts.append({"accountName": name, "receipt": data})
        sys.stderr.write(
            "[info] 已触发同步（异步，落库需要时间，详见回执 retryAfterMinutes）。本次诊断仍读库里现有数据；"
            "想要最新数据，待同步完成后再不带 --sync 跑一次。\n"
        )
        print(json.dumps({"syncReceipts": receipts}, ensure_ascii=False, indent=2))

    ok, data, code, message = call(
        ANALYZER_ENDPOINT, {"accountNames": args.accountNames}, api_key
    )
    if not ok:
        sys.stderr.write("[error] %s: %s\n" % (code, message))
        return 1

    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
