#!/usr/bin/env python3
"""都爆鸭 · 小红书低粉爆款榜

零依赖（Python 3 标准库 urllib），按日期 + 分类拉小红书低粉爆款榜，
专挑粉丝不多却跑出爆款的笔记，供主 Agent 找可复制的素人打法。

用法:
    python3 fetch_low_fans_top.py [--rank-date YYYY-MM-DD] [--category 综合]

    --rank-date 榜单日期 YYYY-MM-DD，默认今天往前 2 天。
    --category  分类，默认「综合全部」（官方闭集里的泛分类值）。

日期与分类口径（2026-08-13 实测）:
    · 出数滞后约两天 —— 昨天(T-1)与今天(T-0)都是空榜，所以默认取 T-2。
    · 榜单只保留最近 30 天，更早的日期上游直接判为查无结果。
    · 分类是官方闭集（25 个），泛分类的正确写法是「综合全部」，不是「综合」——
      「综合」不在闭集里，传了会被判查无结果（不是空榜，是直接报错）。
    · 可选值：综合全部、出行代步、休闲爱好、影视娱乐、数码科技、医疗保健、综合杂项、星座情感、时尚穿搭、婚庆婚礼、拍摄记录、学习教育、化妆美容、居家装修、旅行度假、亲子育儿、个人护理、美味佳肴、职业发展、宠物天地、潮流鞋包、日常生活、科学探索、新闻资讯、体育锻炼
    · 上游偶发瞬时空值：同一组参数一次空、下一次满榜都出现过，返空先原样重试一次
      再下"这天/这个分类没数据"的结论。

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

ENDPOINT = "https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-low-fans-top/call"



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
        description="都爆鸭 · 小红书低粉爆款榜",
    )
    parser.add_argument(
        "--rank-date", default=None, help="榜单日期 YYYY-MM-DD（默认今天往前 2 天；只保留最近 30 天）"
    )
    parser.add_argument(
        "--category",
        default="综合全部",
        help="分类（默认 综合全部）。别传「综合」——它不在官方闭集里，会被判查无结果",
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

    if args.rank_date:
        try:
            datetime.date.fromisoformat(args.rank_date)
        except ValueError:
            sys.stderr.write("[error] VALIDATION_ERROR: --rank-date 需为 YYYY-MM-DD 格式\n")
            return 1
        rank_date = args.rank_date
    else:
        # T-1 / T-0 上游还没结算，直接查是空榜；T-2 起才有数据。
        rank_date = (datetime.date.today() - datetime.timedelta(days=2)).isoformat()

    body = {"rankDate": rank_date}
    # 分类是官方闭集，泛分类值是「综合全部」（实测 50 条满榜）。曾经的默认值「综合」
    # 不在闭集里，上游直接判查无结果 —— 那是本 skill 默认调用长期拿不到数据的真因。
    if args.category:
        body["category"] = args.category
    return call_api(api_key, body)


if __name__ == "__main__":
    sys.exit(main())
