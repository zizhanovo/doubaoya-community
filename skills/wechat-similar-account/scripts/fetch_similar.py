#!/usr/bin/env python3
"""都爆鸭 · 公众号相似/对标账号推荐

零依赖（Python 3 标准库 urllib），输入一个公众号名称，拉同赛道对标账号 +
高阶标杆账号，供主 Agent 搭竞品矩阵 / 找起号参考。

未收录的账号可先用 --sync（需配合 --wechat-id）提交同步受理，
同步是异步的（约 30 分钟），受理回执返回后脚本会继续发相似账号请求。

用法:
    python3 fetch_similar.py "<公众号名称>" [--type <账号分类>]
    python3 fetch_similar.py "<公众号名称>" --sync --wechat-id <微信号> [--type <分类>]

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取密钥（形如 dyh_…）。
    密钥绝不会被打印或写入任何文件。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

SIMILAR_ENDPOINT = (
    "https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-similar-account/call"
)
SYNC_ENDPOINT = (
    "https://doubaoya.com/api/apis/gongzhonghao/gzh-sync-account/call"
)


def post(endpoint: str, body: dict, api_key: str):
    """发一次 POST，返回 (ok, data_or_none, err_tuple_or_none)。"""
    payload = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
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
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        try:
            envelope = json.loads(exc.read().decode("utf-8"))
            err = envelope.get("error") or {}
            code = err.get("code", "HTTP_%d" % exc.code)
            message = err.get("message", exc.reason or "请求失败")
            return False, None, (code, message)
        except Exception:
            return False, None, ("HTTP_%d" % exc.code, exc.reason or "请求失败")
    except urllib.error.URLError as exc:
        return False, None, ("NETWORK_ERROR", "无法连接 doubaoya.com（%s）" % exc.reason)

    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError:
        return False, None, ("BAD_RESPONSE", "服务端返回非 JSON 内容")

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        return False, None, (err.get("code", "UNKNOWN"), err.get("message", "请求未成功"))

    return True, envelope.get("data", {}), None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 公众号相似/对标账号推荐",
    )
    parser.add_argument("accountName", help="公众号名称（必填）")
    parser.add_argument(
        "--type",
        dest="account_type",
        default=None,
        help="账号分类（可选，用于收窄对标赛道）",
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="先提交账号同步受理（需配合 --wechat-id），再拉相似账号",
    )
    parser.add_argument(
        "--wechat-id",
        dest="wechat_id",
        default=None,
        help="公众号微信号（--sync 时必填）",
    )
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 密钥中心 → 生成密钥，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的密钥"\n'
        )
        return 1

    if args.sync and not args.wechat_id:
        sys.stderr.write(
            "[error] VALIDATION_ERROR: --sync 需配合 --wechat-id 一起使用\n"
        )
        return 1

    # 可选预同步：提交受理回执（异步，约 30 分钟），不阻塞后续相似账号请求。
    if args.sync:
        sync_body = {"wechatId": args.wechat_id, "accountName": args.accountName}
        ok, sync_data, err = post(SYNC_ENDPOINT, sync_body, api_key)
        if not ok:
            sys.stderr.write("[error] %s: %s\n" % (err[0], err[1]))
            return 1
        sys.stderr.write(
            "[info] 已提交同步受理（异步，约 30 分钟生效）；继续拉取当前可用的相似账号。\n"
        )

    body = {"accountName": args.accountName}
    if args.account_type:
        body["accountType"] = args.account_type

    ok, data, err = post(SIMILAR_ENDPOINT, body, api_key)
    if not ok:
        sys.stderr.write("[error] %s: %s\n" % (err[0], err[1]))
        return 1

    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
