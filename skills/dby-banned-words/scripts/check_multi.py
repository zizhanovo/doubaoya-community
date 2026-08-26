#!/usr/bin/env python3
"""都爆鸭 · 多平台违禁词检测脚本（零依赖，仅用 Python 3 标准库）。

逐个平台调用都爆鸭 check-banned-words 接口，把每个平台的结果汇总成
一个 map 后输出。每个平台是一次独立计费调用。

用法：
    python3 check_multi.py "<文案>" [--platforms xiaohongshu,douyin,gongzhonghao] [--raw]
    python3 check_multi.py --selfcheck        离线自检，不联网不需要 key

默认剥掉 data.raw 里与顶层 content / originalContent 重复的两键（其余键保留），--raw 保留原样。

环境变量：
    DOUBAOYA_API_KEY    必填，密钥形如 dyh_...（绝不打印到任何输出）
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://doubaoya.com/api/apis/tool/check-banned-words/call"


def _skill_user_agent() -> str:
    """读取同目录下 .version 文件里发布时盖的版本戳；没有则退回旧版通用值（向后兼容）。"""
    try:
        version_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".version")
        with open(version_path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        return value or "doubaoya-skill/1.0"
    except OSError:
        return "doubaoya-skill/1.0"


USER_AGENT = _skill_user_agent()
DEFAULT_PLATFORMS = ["xiaohongshu", "douyin", "gongzhonghao"]

# 「你安装的 skill 有更新」挂在成功信封的 notice 字段上，SKILL.md 承诺原样转达给用户。
# 多平台扇出时同一条 notice 会在每个平台的响应里重复出现，去重后只提示一次。
_NOTICES_SEEN = set()


def check_one(platform, content, api_key):
    """对单个平台发起一次检测，返回 data 字典或 {"error": ...} 字典。"""
    payload = json.dumps(
        {"platform": platform, "content": content}
    ).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + api_key,
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
            err = body.get("error") or {}
            return {
                "error": {
                    "code": err.get("code", "HTTP_%d" % exc.code),
                    "message": err.get("message", exc.reason),
                }
            }
        except Exception:
            return {
                "error": {
                    "code": "HTTP_%d" % exc.code,
                    "message": str(exc.reason),
                }
            }
    except urllib.error.URLError as exc:
        return {"error": {"code": "NETWORK_ERROR", "message": str(exc.reason)}}
    except Exception as exc:  # noqa: BLE001 — 兜底，保证别的平台继续
        return {"error": {"code": "UNKNOWN_ERROR", "message": str(exc)}}

    notice = body.get("notice")
    if notice and notice not in _NOTICES_SEEN:
        _NOTICES_SEEN.add(notice)
        # 走 stderr，stdout 留给 json.dumps 的结果，别把它污染成非法 JSON。
        sys.stderr.write(f"[notice] {notice}\n")

    if not body.get("success"):
        err = body.get("error") or {}
        return {
            "error": {
                "code": err.get("code", "UNKNOWN"),
                "message": err.get("message", "请求失败"),
            }
        }
    return body.get("data") or {}


DUP_KEYS = ("content", "originalContent")


def slim(data):
    """剥掉 data["raw"] 里与顶层重复的 content / originalContent，其余键原样保留。

    只剥 raw 里的这两键——顶层那两份是判定与取命中词的依据，动不得；raw 的其它键（上游状态码等）
    也不动。raw 不是 dict（缺失 / null / 字符串）时原样返回。
    """
    if not isinstance(data, dict):
        return data
    raw = data.get("raw")
    if not isinstance(raw, dict):
        return data
    out = dict(data)
    out["raw"] = {k: v for k, v in raw.items() if k not in DUP_KEYS}
    return out


def selfcheck():
    """用构造 JSON 验证 slim；不联网、不计费。"""
    full = {
        "source": "contentSafety.sensitiveWords",
        "content": "全网<span class=\"banned-word\">最低</span>价",
        "originalContent": "全网最低价",
        "prohibitedWordsType": ["禁用词"],
        "raw": {"content": "全网最低价", "originalContent": "全网最低价", "code": 0, "level": "high"},
    }
    s = slim(full)
    assert "content" not in s["raw"] and "originalContent" not in s["raw"], "raw 里的重复键没剥掉"
    assert s["raw"] == {"code": 0, "level": "high"}, "raw 的其它键被误删"
    assert s["content"] == full["content"] and s["originalContent"] == full["originalContent"], "顶层字段被动了"
    assert full["raw"].get("content") == "全网最低价", "slim 改了入参（应返回新对象）"
    assert slim({"error": {"code": "X"}}) == {"error": {"code": "X"}}, "无 raw 时应原样返回"
    assert slim({"raw": None})["raw"] is None, "raw 为 null 时应原样返回"
    assert slim({"raw": "str"})["raw"] == "str", "raw 非 dict 时应原样返回"
    assert slim(None) is None, "非 dict 入参应原样返回"
    # 破坏演练：证明断言不是恒真
    assert "content" in full["raw"], "破坏演练失效"
    print("selfcheck ok: slim（剥 raw 重复键 / 保留其它键 / 不动顶层 / 不改入参 / 缺 raw 原样）")


def main():
    if "--selfcheck" in sys.argv:
        selfcheck()
        return
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 多平台违禁词检测"
    )
    parser.add_argument("content", help="待检测的文案内容")
    parser.add_argument(
        "--raw",
        action="store_true",
        help="保留 raw 里与顶层重复的 content / originalContent（默认剥掉）",
    )
    parser.add_argument(
        "--platforms",
        default=",".join(DEFAULT_PLATFORMS),
        help="逗号分隔的平台列表，默认 xiaohongshu,douyin,gongzhonghao",
    )
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "错误：未检测到 DOUBAOYA_API_KEY 环境变量。\n"
            "请到 doubaoya.com 登录 → 密钥中心 → 生成密钥，然后：\n"
            "    export DOUBAOYA_API_KEY=<你的密钥>\n"
        )
        sys.exit(1)

    platforms = [p.strip() for p in args.platforms.split(",") if p.strip()]
    if not platforms:
        sys.stderr.write("错误：平台列表为空。\n")
        sys.exit(1)

    results = {}
    for platform in platforms:
        result = check_one(platform, args.content, api_key)
        results[platform] = result if args.raw else slim(result)

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
