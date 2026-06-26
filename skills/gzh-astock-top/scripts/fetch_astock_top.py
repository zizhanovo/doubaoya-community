#!/usr/bin/env python3
"""都爆鸭 · A股公众号大V榜（组合编排）

零依赖（Python 3 标准库 urllib），单脚本按顺序编排：
  1. 账号发现   gongzhonghao-search-user      （关键词搜出 A股公众号）
  2. 账号画像   gongzhonghao-account-analyzer （综合指数、平均阅读等）
  3. 当日发文   gongzhonghao-daily-publish    （这些账号当天发了什么）
  4. 账号爆文   hot-article                   （可选 --with-hot，逐账号近期爆文）

把各步 data 合并成一份 JSON 打到 stdout。步骤 1 失败 = 没有账号 → 退出 1；
步骤 2/3/4 失败收进 "errors" 字段，不中断整轮。

用法:
    python3 fetch_astock_top.py [--keyword A股] [--date YYYY-MM-DD] [--top 30] [--with-hot]

默认: keyword=A股，date=今天，top=30。

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取口令（形如 dyh_…）。
    口令绝不会被打印或写入任何文件。
"""

import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

BASE = "https://doubaoya.com/api/apis/gongzhonghao"
EP_SEARCH_USER = BASE + "/gongzhonghao-search-user/call"
EP_ANALYZER = BASE + "/gongzhonghao-account-analyzer/call"
EP_DAILY_PUBLISH = BASE + "/gongzhonghao-daily-publish/call"
EP_HOT_ARTICLE = BASE + "/hot-article/call"


class ApiError(Exception):
    """携带信封里的 code/message。"""

    def __init__(self, code, message):
        super().__init__("%s: %s" % (code, message))
        self.code = code
        self.message = message


def call(endpoint, body, api_key):
    """发一次 POST，做信封校验，成功返回 data，失败抛 ApiError。"""
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
            raise ApiError(
                err.get("code", "HTTP_%d" % exc.code),
                err.get("message", exc.reason or "请求失败"),
            )
        except ApiError:
            raise
        except Exception:
            raise ApiError("HTTP_%d" % exc.code, exc.reason or "请求失败")
    except urllib.error.URLError as exc:
        raise ApiError("NETWORK_ERROR", "无法连接 doubaoya.com（%s）" % exc.reason)

    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError:
        raise ApiError("BAD_RESPONSE", "服务端返回非 JSON 内容")

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        raise ApiError(err.get("code", "UNKNOWN"), err.get("message", "请求未成功"))

    return envelope.get("data", {})


def extract_account_names(data, top):
    """从账号发现的 data 里抽出账号名列表（防御式）。"""
    items = []
    if isinstance(data, dict):
        items = data.get("items") or data.get("list") or data.get("accounts") or []
    elif isinstance(data, list):
        items = data
    names = []
    for it in items:
        if not isinstance(it, dict):
            continue
        name = it.get("accountName") or it.get("name") or it.get("nickname")
        if name and name not in names:
            names.append(name)
        if len(names) >= top:
            break
    return names


def main() -> int:
    today = datetime.date.today()
    parser = argparse.ArgumentParser(
        description="都爆鸭 · A股公众号大V榜（组合编排）",
    )
    parser.add_argument("--keyword", default="A股", help="账号发现关键词（默认 A股）")
    parser.add_argument(
        "--date",
        default=today.isoformat(),
        help="当日发文日期 YYYY-MM-DD（默认今天）",
    )
    parser.add_argument("--top", type=int, default=30, help="取前 N 个账号（默认 30）")
    parser.add_argument(
        "--with-hot",
        action="store_true",
        help="额外逐账号拉近期爆文（多花若干次调用）",
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

    result = {"keyword": args.keyword, "date": args.date}
    errors = {}

    # 步骤 1：账号发现（整轮地基，失败即退出 1）
    try:
        search_data = call(
            EP_SEARCH_USER, {"keyword": args.keyword, "page": 1}, api_key
        )
    except ApiError as exc:
        sys.stderr.write("[error] %s: %s\n" % (exc.code, exc.message))
        return 1

    accounts = extract_account_names(search_data, args.top)
    if not accounts:
        sys.stderr.write(
            "[error] NO_ACCOUNTS: 关键词「%s」未发现任何 A股公众号账号\n"
            % args.keyword
        )
        return 1
    result["accounts"] = accounts

    # 步骤 2：账号画像
    try:
        result["analysis"] = call(EP_ANALYZER, {"accountNames": accounts}, api_key)
    except ApiError as exc:
        errors["analysis"] = {"code": exc.code, "message": exc.message}

    # 步骤 3：当日发文
    try:
        result["dailyPublish"] = call(
            EP_DAILY_PUBLISH,
            {"date": args.date, "accountNames": accounts},
            api_key,
        )
    except ApiError as exc:
        errors["dailyPublish"] = {"code": exc.code, "message": exc.message}

    # 步骤 4（可选）：逐账号近期爆文
    if args.with_hot:
        start = (
            datetime.date.fromisoformat(args.date) - datetime.timedelta(days=6)
        ).isoformat()
        hot = {}
        hot_errors = {}
        for name in accounts:
            try:
                hot[name] = call(
                    EP_HOT_ARTICLE,
                    {"keyword": name, "startDate": start, "endDate": args.date},
                    api_key,
                )
            except ApiError as exc:
                hot_errors[name] = {"code": exc.code, "message": exc.message}
        result["hotArticles"] = hot
        if hot_errors:
            errors["hotArticles"] = hot_errors

    if errors:
        result["errors"] = errors

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
