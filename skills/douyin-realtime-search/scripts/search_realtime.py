#!/usr/bin/env python3
"""都爆鸭 · 抖音实时综合搜索

零依赖（Python 3 标准库 urllib），按关键词实时综合搜抖音内容，
可切换排序（综合/最新/最多点赞）与时间窗，打 JSON 到 stdout，
由主 Agent 铺成「描述/达人/点赞/链接」终端表格做选题洞察。

用法:
    python3 search_realtime.py "<关键词>" [--sort 1|2|3] [--time 0|7|30|90] [--page N]

    --sort  sortType：1=综合排序(默认) / 2=最新发布 / 3=最多点赞
    --time  publishTime：0=不限(默认) / 7=最近7天 / 30=最近30天 / 90=最近90天
    --page  页码（默认 1）

    sortType / publishTime / page 始终随请求体发送（默认 1 / 0 / 1）。

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

ENDPOINT = "https://doubaoya.com/api/apis/douyin/realtime-search/call"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 抖音实时综合搜索",
    )
    parser.add_argument("keyword", help="搜索关键词（建议精简，2~6 字最佳）")
    parser.add_argument(
        "--sort",
        dest="sort",
        choices=["1", "2", "3"],
        default="1",
        help="排序 sortType：1=综合(默认) / 2=最新发布 / 3=最多点赞",
    )
    parser.add_argument(
        "--time",
        dest="time",
        choices=["0", "7", "30", "90"],
        default="0",
        help="时间窗 publishTime：0=不限(默认) / 7=近7天 / 30=近30天 / 90=近90天",
    )
    parser.add_argument(
        "--page",
        type=int,
        default=1,
        help="页码（可选，默认 1）",
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

    payload = json.dumps(
        {
            "keyword": args.keyword,
            "sortType": args.sort,
            "publishTime": args.time,
            "page": args.page,
        }
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
            raw_body = response.read().decode("utf-8")
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
        envelope = json.loads(raw_body)
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
