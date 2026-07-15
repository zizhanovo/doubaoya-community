#!/usr/bin/env python3
"""都爆鸭 · 公众号原创热门榜

零依赖（Python 3 标准库 urllib），按行业分类 + 时间区间拉取
微信公众号的原创热门爆款（站在原创创作者视角解读）。

与 10万+ 爆文榜接口同源（category-time-hot），区别在展示层/解读层侧重。

用法:
    python3 fetch_original_hot.py [--type 科技] [--start YYYY-MM-DD] [--end YYYY-MM-DD]

默认区间: 结束日 = 今天，开始日 = 今天往前 6 天（近一周）。

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

ENDPOINT = "https://doubaoya.com/api/apis/gongzhonghao/category-time-hot/call"


def main() -> int:
    today = datetime.date.today()
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 公众号原创热门榜（行业分类 + 时间区间）",
    )
    parser.add_argument(
        "--type",
        default="科技",
        help="行业分类（如 科技/财经/人文资讯/职场/教育，默认 科技）",
    )
    parser.add_argument(
        "--start",
        default=(today - datetime.timedelta(days=6)).isoformat(),
        help="开始日 YYYY-MM-DD（默认今天往前 6 天）",
    )
    parser.add_argument(
        "--end",
        default=today.isoformat(),
        help="结束日 YYYY-MM-DD（默认今天）",
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

    payload = json.dumps(
        {"type": args.type, "startDate": args.start, "endDate": args.end}
    ).encode("utf-8")

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
        with urllib.request.urlopen(request, timeout=30) as response:
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


if __name__ == "__main__":
    sys.exit(main())
