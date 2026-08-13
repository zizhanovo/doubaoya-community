#!/usr/bin/env python3
"""都爆鸭 · 小红书封面选题数据

零依赖（Python 3 标准库 urllib），按关键词拉小红书爆款多榜数据
（低粉爆款 / 点赞 TOP500 / 单日互动 / 七日增长），供主 Agent 提炼封面选题灵感。

用法:
    python3 fetch_cover_data.py --keyword 露营 [--start-date YYYY-MM-DD]

    --keyword    关键词（必填）。
    --start-date 起始日期 YYYY-MM-DD，默认 30 天前。

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

ENDPOINT = "https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-coze/call"



def _skill_user_agent() -> str:
    """读取同目录下 .version 文件里发布时盖的版本戳；没有则退回旧版通用值（向后兼容）。"""
    try:
        version_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".version")
        with open(version_path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        return value or "doubaoya-skill/1.0"
    except OSError:
        return "doubaoya-skill/1.0"

def call_api(api_key: str, payload_dict: dict) -> int:
    payload = json.dumps(payload_dict).encode("utf-8")

    request = urllib.request.Request(
        ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
            "User-Agent": _skill_user_agent(),
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
        description="都爆鸭 · 小红书封面选题数据",
    )
    parser.add_argument("--keyword", required=True, help="关键词（必填）")
    parser.add_argument(
        "--start-date",
        default=None,
        help="起始日期 YYYY-MM-DD（可选，默认不传 = 上游最新一批爆款榜）",
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

    body = {"keyword": args.keyword}
    # startDate 只在调用方明确给了才带上。实测（2026-08-13）：上游这份爆款榜是按批次
    # 归档的，任何"最近 N 天"的 startDate 都会把整份榜过滤成空（四张榜全 0 条）；
    # 不传 startDate 才回落到最新一批满榜数据。原来这里默认塞 T-30，等于每次必空。
    if args.start_date:
        try:
            datetime.date.fromisoformat(args.start_date)
        except ValueError:
            sys.stderr.write("[error] VALIDATION_ERROR: --start-date 需为 YYYY-MM-DD 格式\n")
            return 1
        body["startDate"] = args.start_date

    return call_api(api_key, body)


if __name__ == "__main__":
    sys.exit(main())
