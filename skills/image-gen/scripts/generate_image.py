#!/usr/bin/env python3
"""都爆鸭 · GPT-image2 AI 图片生成

零依赖（Python 3 标准库 urllib），用一句提示词生成图片；可选传入参考图
URL 进入图生图 / 编辑模式。返回生成图片的 URL。

注意：生成为服务端异步执行，约 3 分钟，单次请求内完成（无需客户端轮询）。

用法:
    python3 generate_image.py "<提示词>"
    python3 generate_image.py "<提示词>" --image "https://example.com/ref.png"

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

ENDPOINT = "https://doubaoya.com/api/skills/gpt-image-gen/invoke"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · GPT-image2 AI 图片生成（异步约 3 分钟）",
    )
    parser.add_argument(
        "prompt",
        help="图片提示词（必填）",
    )
    parser.add_argument(
        "--image",
        dest="image",
        default=None,
        help="可选参考图 URL（传入即进入图生图 / 编辑模式）",
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

    body_obj = {"prompt": args.prompt}
    if args.image:
        body_obj["referenceImage"] = args.image
    payload = json.dumps(body_obj).encode("utf-8")

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

    sys.stderr.write("[info] 已提交，服务端生成中，可能需要数分钟，请耐心等待…\n")

    try:
        with urllib.request.urlopen(request, timeout=300) as response:
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
