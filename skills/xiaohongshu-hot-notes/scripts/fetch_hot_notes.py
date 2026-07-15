#!/usr/bin/env python3
"""都爆鸭 · 小红书爆款笔记发现脚本

按关键词 / 赛道搜索小红书笔记，按互动量（点赞 + 评论）从高到低排序，
把最热门的笔记冒泡到顶部，输出一个排好序的 JSON 列表。

依赖：仅标准库（urllib），无需 pip install。
鉴权：从环境变量 DOUBAOYA_API_KEY 读取密钥（形如 dyh_…），绝不打印。

用法：
    python3 fetch_hot_notes.py "<关键词>" [--pages N]

示例：
    python3 fetch_hot_notes.py "减脂早餐"
    python3 fetch_hot_notes.py "通勤穿搭" --pages 3
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://doubaoya.com/api/apis/xiaohongshu/search-note/call"
USER_AGENT = "doubaoya-skill/1.0"
MAX_PAGES = 3


def _to_int(value):
    """把可能是字符串 / None / 数字的互动字段安全地转成 int。"""
    try:
        if value is None:
            return 0
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def fetch_page(api_key, keyword, page):
    """请求单页，返回 data.items 列表；非成功则报错退出。"""
    body = json.dumps({"keyword": keyword, "page": page}).encode("utf-8")
    req = urllib.request.Request(API_URL, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + api_key)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", USER_AGENT)

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # 尝试从错误响应体里解析出 code / message
        detail = ""
        try:
            err_payload = json.loads(exc.read().decode("utf-8"))
            err = err_payload.get("error") or {}
            code = err.get("code", "HTTP_%s" % exc.code)
            message = err.get("message", exc.reason)
            detail = "%s: %s" % (code, message)
        except Exception:
            detail = "HTTP_%s: %s" % (exc.code, exc.reason)
        sys.stderr.write("[error] %s\n" % detail)
        sys.exit(1)
    except urllib.error.URLError as exc:
        sys.stderr.write("[error] NETWORK_ERROR: %s\n" % exc.reason)
        sys.exit(1)

    if not payload.get("success"):
        err = payload.get("error") or {}
        code = err.get("code", "UNKNOWN")
        message = err.get("message", "请求未成功，且未返回错误信息")
        sys.stderr.write("[error] %s: %s\n" % (code, message))
        sys.exit(1)

    data = payload.get("data") or {}
    items = data.get("items") or []
    return items


def main():
    parser = argparse.ArgumentParser(
        description="搜索小红书笔记并按互动量排序，发现当下爆款。"
    )
    parser.add_argument("keyword", help="话题 / 赛道关键词，如 减脂早餐")
    parser.add_argument(
        "--pages",
        type=int,
        default=1,
        help="抓取页数（默认 1，最多 %d）" % MAX_PAGES,
    )
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 未找到环境变量 DOUBAOYA_API_KEY。\n"
            "请到 doubaoya.com 登录 → 密钥中心 → 生成密钥（形如 dyh_…），\n"
            "然后执行：export DOUBAOYA_API_KEY=<你的密钥>\n"
        )
        sys.exit(1)

    pages = max(1, min(args.pages, MAX_PAGES))

    collected = []
    for page in range(1, pages + 1):
        items = fetch_page(api_key, args.keyword, page)
        if not items:
            # 该页没有更多结果，提前结束翻页
            break
        collected.extend(items)

    # 按互动热度（点赞 + 评论）从高到低排序
    def heat(note):
        return _to_int(note.get("likeCount")) + _to_int(note.get("commentCount"))

    ranked = sorted(collected, key=heat, reverse=True)

    print(json.dumps(ranked, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
