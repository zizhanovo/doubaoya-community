#!/usr/bin/env python3
"""都爆鸭 · Seedream 5.0 lite AI 图片生成 —— ⛔ 能力已下架，本脚本恒失败

上游能力 `seedream-lite` 于 2026-08-10 下架（下架前成功率 0%）。服务端在鉴权与计费
之前就返回 503 CAPABILITY_UNAVAILABLE，所以本脚本**不会扣点**，也**不会等 6 分钟**——
它会立刻拿到 503 并打印改用 image-gen 的指引。脚本本身保留原契约不改：若该能力日后
重新上架，无需改代码即可恢复工作。

要出图请改用 image-gen Skill（POST /api/skills/gpt-image-gen/invoke）。

零依赖（Python 3 标准库 urllib），用一句提示词生成图片，可指定尺寸。
支持文生图 / 图生图 / 组图 / 提示词优化等玩法。

注意：生成为服务端异步执行，约 6 分钟，单次请求内完成（无需客户端轮询）。

用法:
    python3 generate_image.py "<提示词>"
    python3 generate_image.py "<提示词>" --size 2048x2048

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

ENDPOINT = "https://doubaoya.com/api/skills/seedream-lite/invoke"

RETIRED_HINT = (
    "该能力（seedream-lite）已于 2026-08-10 下架，任何调用都会返回 503，重试不会成功。\n"
    "        请改用 image-gen Skill 出图：POST /api/skills/gpt-image-gen/invoke\n"
    "        （做公众号封面则用 wechat-cover Skill）"
)


def _explain(code: str, message: str) -> str:
    """把服务端错误码翻成人话。503 是本能力的常态，必须给出替代路径而不是让调用方干瞪眼。"""
    if code == "CAPABILITY_UNAVAILABLE":
        return "%s: %s\n        %s" % (code, message, RETIRED_HINT)
    return "%s: %s" % (code, message)


def _skill_user_agent() -> str:
    """读取同目录下 .version 文件里发布时盖的版本戳；没有则退回旧版通用值（向后兼容）。"""
    try:
        version_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".version")
        with open(version_path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        return value or "doubaoya-skill/1.0"
    except OSError:
        return "doubaoya-skill/1.0"

def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · Seedream 5.0 lite AI 图片生成（异步约 6 分钟）",
    )
    parser.add_argument(
        "prompt",
        help="图片提示词（必填）",
    )
    parser.add_argument(
        "--size",
        dest="size",
        default="2048x2048",
        help="图片尺寸 WxH（默认 2048x2048）",
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
        {"prompt": args.prompt, "size": args.size}
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

    sys.stderr.write(
        "[warn] seedream-lite 已下架，本次调用预计返回 503；要出图请改用 image-gen Skill。\n"
    )
    sys.stderr.write("[info] 已提交，等待服务端响应（成功时出图需数分钟）…\n")

    try:
        with urllib.request.urlopen(request, timeout=420) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read().decode("utf-8")
            envelope = json.loads(raw)
            err = envelope.get("error") or {}
            code = err.get("code", "HTTP_%d" % exc.code)
            message = err.get("message", exc.reason or "请求失败")
            sys.stderr.write("[error] %s\n" % _explain(code, message))
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
        sys.stderr.write("[error] %s\n" % _explain(code, message))
        return 1

    data = envelope.get("data", {})
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
