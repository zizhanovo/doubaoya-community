#!/usr/bin/env python3
"""都爆鸭 · 直取综合热点（无关键词的全网热榜）

零依赖（Python 3 标准库 urllib）。默认**不带关键词**，直接把当下全网最热的一批
（微博/抖音/B站…）拉下来，供主 Agent 结合用户 IP 定位做智能匹配、产选题。

⚠️ 默认就是无关键词的「综合热点直取」——这才是选题的正确起手。
`--keywords` 仅供极少数「就想看某垂类词的热榜」场景，**绝不要把用户的账号名/IP名
（如「菜籽油」这类公众号名）丢进来当关键词**——那只会搜到字面同名内容。IP 名字只用于
后续匹配筛选，不进搜索接口。

用法:
    python3 fetch_trends.py [--platforms 2,5,8] [--keywords 词1,词2] [--start-date "YYYY-MM-DD HH:MM:SS"] [--end-date "YYYY-MM-DD HH:MM:SS"]

    --platforms  逗号分隔的平台编号（整数），默认 2,5,8。
    --keywords   逗号分隔的关键词，**默认不带**（综合热点直取）。仅垂类场景才用。
    --start-date 区间起始 datetime（默认今天 00:00:00）。
    --end-date   区间结束 datetime（默认当前时刻）。

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取密钥（形如 dyh_…）。
    密钥绝不会被打印或写入任何文件。
"""

import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://doubaoya.com/api/apis/trend/trending-hub-keyword/call"


def call_api(api_key: str, payload_dict: dict) -> int:
    payload = json.dumps(payload_dict).encode("utf-8")

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

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 全网热点聚合（按平台编号 + 关键词）",
    )
    parser.add_argument("--platforms", default="2,5,8", help="逗号分隔的平台编号（整数，默认 2,5,8）")
    parser.add_argument("--keywords", default=None, help="逗号分隔的关键词（默认不带 = 综合热点直取；仅垂类场景才用，绝不用账号名/IP名）")
    parser.add_argument("--start-date", default=None, help='区间起始 datetime "YYYY-MM-DD HH:MM:SS"（默认今天 00:00:00）')
    parser.add_argument("--end-date", default=None, help='区间结束 datetime "YYYY-MM-DD HH:MM:SS"（默认当前时刻）')
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 密钥中心 → 生成密钥，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的密钥"\n'
        )
        return 1

    try:
        platforms = [int(p.strip()) for p in args.platforms.split(",") if p.strip()]
    except ValueError:
        sys.stderr.write("[error] VALIDATION_ERROR: --platforms 需为逗号分隔的整数，如 2,5,8\n")
        return 1
    if not platforms:
        sys.stderr.write("[error] VALIDATION_ERROR: --platforms 不能为空\n")
        return 1

    # 默认不带关键词 = 综合热点直取。只有显式给 --keywords 时才带上。
    keywords = []
    if args.keywords:
        keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]

    now = datetime.datetime.now()
    start_date = args.start_date or now.strftime("%Y-%m-%d 00:00:00")
    end_date = args.end_date or now.strftime("%Y-%m-%d %H:%M:%S")

    payload = {
        "platforms": platforms,
        "startDate": start_date,
        "endDate": end_date,
    }
    if keywords:
        payload["keywords"] = keywords

    return call_api(api_key, payload)


if __name__ == "__main__":
    sys.exit(main())
