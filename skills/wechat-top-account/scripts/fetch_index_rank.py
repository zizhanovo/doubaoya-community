#!/usr/bin/env python3
"""都爆鸭 · 公众号热度指数榜 TOP

零依赖（Python 3 标准库 urllib），拉某分类下公众号的热度指数排行，
供主 Agent 做头部账号对标 / 竞品跟踪。

用法:
    python3 fetch_index_rank.py [--date YYYY-MM-DD] [--category 人文资讯]

分类只认官方 22 个赛道全称（实测 22 个全部出数）:
    人文资讯 知识百科 健康养生 时尚潮流 美食餐饮 乐活生活 旅游出行 搞笑幽默
    情感心理 体育娱乐 美容美体 文摘精选 民生资讯 财富理财 科技数码 创投商业
    汽车交通 房产楼市 职场发展 教育考试 学术研究 企业品牌
写「职场」「财经」这类简称不会报错，只会返空榜 —— 正确写法是 职场发展 / 财富理财。

日期口径: 榜单只保留最近 7 天，且出数滞后约两天 —— 默认取今天往前 2 天。
周期: 目前只有 day(日榜) 有数据，week/month 上游一律返空榜。

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

ENDPOINT = "https://doubaoya.com/api/apis/gongzhonghao/gongzhonghao-index-rank/call"



def _skill_user_agent() -> str:
    """读取同目录下 .version 文件里发布时盖的版本戳；没有则退回旧版通用值（向后兼容）。"""
    try:
        version_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".version")
        with open(version_path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        return value or "doubaoya-skill/1.0"
    except OSError:
        return "doubaoya-skill/1.0"

def default_rank_date() -> str:
    """默认榜单日期 = 今天往前 2 天。

    实测（2026-08-13）：昨天(T-1)与今天(T-0)都还没结算，返回空榜；T-2 起才有数据。
    榜单只保留最近 7 天，更早的日期上游直接判为查无结果。
    """
    return (datetime.date.today() - datetime.timedelta(days=2)).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 公众号热度指数榜 TOP",
    )
    parser.add_argument(
        "--rank-type",
        choices=["day", "week", "month"],
        default="day",
        help="榜单周期（可选，默认 day）。实测只有 day 出数，week/month 上游返空榜",
    )
    parser.add_argument(
        "--date",
        default=None,
        help="榜单日期 YYYY-MM-DD（可选，默认今天往前 2 天；只保留最近 7 天）",
    )
    parser.add_argument(
        "--category",
        default="人文资讯",
        help=(
            "垂直分类，只认官方 22 个赛道全称（可选，默认 人文资讯）。"
            "写「职场」「财经」这类简称只会返空榜，正确写法是 职场发展 / 财富理财。"
            "可选值：人文资讯/知识百科/健康养生/时尚潮流/美食餐饮/乐活生活/旅游出行/搞笑幽默/情感心理/体育娱乐/美容美体/文摘精选/民生资讯/财富理财/科技数码/创投商业/汽车交通/房产楼市/职场发展/教育考试/学术研究/企业品牌"
        ),
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
        {
            "rankType": args.rank_type,
            "rankDate": args.date or default_rank_date(),
            "category": args.category,
        }
    ).encode("utf-8")

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
