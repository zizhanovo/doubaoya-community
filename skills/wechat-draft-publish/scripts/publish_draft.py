#!/usr/bin/env python3
"""都爆鸭 · 公众号草稿发布（存草稿箱，不群发）

零依赖（Python 3 标准库 urllib），把一篇写好的图文存进你自己公众号的**草稿箱**。
它只存草稿，绝不群发/推送——之后你去公众号后台确认后再手动群发。

用法:
    # 正文直接传（公众号风格 HTML，不是 markdown）
    python3 publish_draft.py --title "标题" --content "<p>正文 HTML</p>"

    # 正文从文件读
    python3 publish_draft.py --title "标题" --content-file article.html

    # 绑定了多个公众号时，指定用哪个（authorizerAppid）
    python3 publish_draft.py --title "标题" --content-file a.html --appid wx1234567890

    # 可选摘要
    python3 publish_draft.py --title "标题" --content-file a.html --digest "一句话摘要"

鉴权:
    从环境变量 DOUBAOYA_API_KEY 读取口令（形如 dyh_…）。
    口令绝不会被打印或写入任何文件。

前置:
    需先在 doubaoya.com → 公众号 页面把公众号授权绑定。
    若没有已绑定的公众号，本脚本无法替你绑定，会提示你先去绑定。
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BASE_URL = "https://doubaoya.com"
STATUS_ENDPOINT = BASE_URL + "/api/wechat/status"
PUBLISH_ENDPOINT = BASE_URL + "/api/wechat/publish"


def _request(url, api_key, method, payload=None):
    """发一个带鉴权头的请求，返回解析后的信封 dict。

    出错时返回 (None, code, message)；成功时返回 (envelope, None, None)。
    HTTPError 也尽量解析结构化信封，把真实 error.code/message 交给上层。
    """
    data = None
    headers = {
        "Authorization": "Bearer " + api_key,
        "User-Agent": "doubaoya-skill/1.0",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        url, data=data, method=method, headers=headers
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
            return None, code, message
        except Exception:
            return None, "HTTP_%d" % exc.code, (exc.reason or "请求失败")
    except urllib.error.URLError as exc:
        return None, "NETWORK_ERROR", "无法连接 doubaoya.com（%s）" % exc.reason

    try:
        envelope = json.loads(body)
    except json.JSONDecodeError:
        return None, "BAD_RESPONSE", "服务端返回非 JSON 内容"

    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        return None, err.get("code", "UNKNOWN"), err.get("message", "请求未成功")

    return envelope, None, None


def _resolve_appid(api_key, wanted_appid):
    """确定要用哪个公众号（authorizerAppid）。

    返回 (appid, nickname)；失败时向 stderr 打印原因并返回 (None, None)。
    """
    envelope, code, message = _request(STATUS_ENDPOINT, api_key, "GET")
    if envelope is None:
        sys.stderr.write("[error] %s: %s\n" % (code, message))
        return None, None

    data = envelope.get("data") or {}
    accounts = data.get("accounts") or []

    if wanted_appid:
        for acc in accounts:
            if acc.get("authorizerAppid") == wanted_appid:
                return wanted_appid, acc.get("nickname", "")
        # 用户指定了 appid，但不在已绑定列表里——仍然用它，让服务端裁决（可能返回 403）。
        return wanted_appid, ""

    if len(accounts) == 1:
        acc = accounts[0]
        appid = acc.get("authorizerAppid")
        nickname = acc.get("nickname", "")
        sys.stderr.write(
            "[info] 已自动选用唯一绑定的公众号：%s（%s）\n" % (nickname, appid)
        )
        return appid, nickname

    if len(accounts) == 0:
        sys.stderr.write(
            "[error] NO_ACCOUNT: 没有已绑定的公众号。\n"
            "请先去 doubaoya.com → 公众号 页面绑定公众号，再回来发草稿。\n"
        )
        return None, None

    # 多个绑定，且未指定 --appid：列出来让用户选。
    sys.stderr.write(
        "[error] MULTIPLE_ACCOUNTS: 你绑定了多个公众号，请用 --appid 指定其一：\n"
    )
    for acc in accounts:
        sys.stderr.write(
            "  - %s  (authorizerAppid: %s)\n"
            % (acc.get("nickname", "(未命名)"), acc.get("authorizerAppid", ""))
        )
    sys.stderr.write(
        "  重新运行，例如：--appid <上面某个 authorizerAppid>\n"
    )
    return None, None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="都爆鸭 · 把图文存进公众号草稿箱（不群发）",
    )
    parser.add_argument("--title", required=True, help="文章标题（必填）")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--content",
        help="正文（公众号风格 HTML，不是 markdown）",
    )
    group.add_argument(
        "--content-file",
        help="从文件读取正文 HTML（公众号风格 HTML，不是 markdown）",
    )
    parser.add_argument(
        "--appid",
        help="指定公众号 authorizerAppid（绑定了多个时必填）",
    )
    parser.add_argument("--digest", help="摘要（可选）")
    args = parser.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "请前往 doubaoya.com → 登录 → 口令中心 → 生成口令，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的口令"\n'
        )
        return 1

    if args.content_file:
        try:
            with open(args.content_file, "r", encoding="utf-8") as fh:
                content_html = fh.read()
        except OSError as exc:
            sys.stderr.write(
                "[error] FILE_ERROR: 读不到正文文件 %s（%s）\n"
                % (args.content_file, exc)
            )
            return 1
    else:
        content_html = args.content

    if not content_html or not content_html.strip():
        sys.stderr.write("[error] VALIDATION_ERROR: 正文 contentHtml 不能为空\n")
        return 1

    # 1) 确定用哪个公众号
    appid, nickname = _resolve_appid(api_key, args.appid)
    if not appid:
        return 1

    # 2) 存草稿
    payload = {
        "authorizerAppid": appid,
        "title": args.title,
        "contentHtml": content_html,
    }
    if args.digest:
        payload["digest"] = args.digest

    envelope, code, message = _request(
        PUBLISH_ENDPOINT, api_key, "POST", payload
    )
    if envelope is None:
        sys.stderr.write("[error] %s: %s\n" % (code, message))
        return 1

    data = envelope.get("data") or {}
    media_id = data.get("mediaId", "")

    # 3) 报告结果
    print(
        "已存入公众号草稿箱，去公众号后台确认后手动群发。\n"
        "  公众号：%s（%s）\n"
        "  标题：%s\n"
        "  mediaId：%s"
        % (nickname or "(已绑定公众号)", appid, args.title, media_id)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
