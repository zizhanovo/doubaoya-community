#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""都爆鸭 · 小红书账号诊断

零依赖（仅用 Python 3 标准库 urllib），按小红书号（redId）拉账号档案 +
画像 / 健康度，供主 Agent 做七维度诊断叙事。

可选 --sync：当账号在库里没有数据、或想拿最新数据时，先向同步接口提交
入库任务（约 30 分钟入库，ack-only），再调诊断接口。

用法:
    python3 analyze_xhs_account.py <redId> [<redId> ...]
    python3 analyze_xhs_account.py <redId> [<redId> ...] --sync

例如:
    python3 analyze_xhs_account.py 27493135897
    python3 analyze_xhs_account.py id1 id2 --sync

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

ANALYZE_ENDPOINT = (
    "https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-account-analyzer/call"
)
SYNC_ENDPOINT = "https://doubaoya.com/api/apis/xiaohongshu/xhs-sync-notes/call"
USER_AGENT = "doubaoya-skill/1.0"


def eprint(*args):
    print(*args, file=sys.stderr)


def post(endpoint, body, api_key):
    """发一个 POST，返回 (envelope_dict_or_None, error_tuple_or_None)。

    error_tuple = (code, message)。成功时 error_tuple 为 None。
    """
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raw = ""
        try:
            raw = exc.read().decode("utf-8")
        except Exception:
            pass
        parsed = None
        if raw:
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = None
        if isinstance(parsed, dict) and parsed.get("error"):
            err = parsed.get("error") or {}
            return None, (
                err.get("code", "HTTP_%d" % exc.code),
                err.get("message", "请求失败"),
            )
        return None, ("HTTP_%d" % exc.code, exc.reason or "请求失败")
    except urllib.error.URLError as exc:
        return None, ("NETWORK_ERROR", "无法连接 doubaoya.com（%s）" % exc.reason)

    try:
        envelope = json.loads(raw)
    except ValueError:
        return None, ("BAD_RESPONSE", "服务端返回非 JSON 内容")

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        return None, (err.get("code", "UNKNOWN"), err.get("message", "请求未成功"))

    return envelope, None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 小红书账号诊断",
    )
    parser.add_argument(
        "user_ids",
        nargs="+",
        help="一个或多个小红书号（redId，纯数字或字母数字组合，非中文昵称）",
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="先逐个提交入库同步任务（约 30 分钟入库），再调诊断接口",
    )
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        eprint(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 口令中心 → 生成口令，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的口令"'
        )
        return 1

    # 可选预同步：逐个账号提交入库任务，打印各自的 ack 信封。
    if args.sync:
        eprint("[info] 已提交入库同步任务（约 30 分钟入库），ack 如下：")
        for rid in args.user_ids:
            envelope, err = post(SYNC_ENDPOINT, {"redId": rid}, api_key)
            if err is not None:
                code, message = err
                eprint("[error] %s: %s（redId=%s）" % (code, message, rid))
                return 1
            ack = envelope.get("data", {})
            print(json.dumps({"redId": rid, "sync": ack}, ensure_ascii=False, indent=2))
        eprint(
            "[info] 同步为异步入库，约 30 分钟后数据才会就绪。\n"
            "请在约 30 分钟后【不带 --sync】重新运行本脚本以拉取诊断数据。"
        )
        return 0

    # 诊断：一次把所有 redId 作为 userIds 列表传给诊断接口。
    envelope, err = post(ANALYZE_ENDPOINT, {"userIds": args.user_ids}, api_key)
    if err is not None:
        code, message = err
        eprint("[error] %s: %s" % (code, message))
        return 1

    data = envelope.get("data", {})
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
