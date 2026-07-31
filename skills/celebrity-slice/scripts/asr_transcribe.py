#!/usr/bin/env python3
"""都爆鸭 · 词级 ASR 转写：ffmpeg 抽音频 → ≤10MB 分块 → POST doubaoya ASR 代理 → 合并词级时间戳。

输出：词级 ASR JSON（本 skill 数据契约：segments=[{"text","start","end"}]，源时间轴）
+ 可选参考 SRT（聚合规则读 ../references/rules.json 的 caption_group_rule）。

鉴权：环境变量 DOUBAOYA_API_KEY（doubaoya.com → 登录 → 密钥中心 → 生成密钥）。
密钥只进请求头，绝不打印、绝不写文件。

接口契约见 ../references/asr-api.md。注意：**ASR 代理路由待后端上线**——404 或缺密钥时
本脚本会给出降级路径（用户提供现成 srt/vtt，或本机 whisper 转写后转成本契约 JSON）。

分块：契约限制 base64 音频块 ≤ 10MB/次。音频统一抽成 mono 16kHz 64kbps mp3
（8KB/s，600s 块 ≈ 4.7MB base64，留足余量）；个别块仍超限时对半递归再切。

用法:
    python3 asr_transcribe.py 直播录像.mp4 [--language zh] [--chunk-seconds 600] \
        [--endpoint URL] [--rules rules.json] [--out-json words.json] [--out-srt raw.srt]

退出码：0 成功；1 调用/网络失败；2 缺 DOUBAOYA_API_KEY。
"""
import argparse
import base64
import json
import math
import os
import subprocess
import sys
import urllib.error
import urllib.request

# 后端任务可能改 platform/slug；届时用 --endpoint 或 DOUBAOYA_ASR_ENDPOINT 覆盖（asr-api.md 有说明）
DEFAULT_ENDPOINT = "https://doubaoya.com/api/apis/media/asr/call"
MAX_B64_BYTES = 10 * 1024 * 1024   # 契约：base64 音频块 ≤ 10MB/次
AUDIO_BITRATE_KBPS = 64            # 抽音频码率（mono 16k mp3）


def _skill_user_agent() -> str:
    """读取同目录下 .version 文件里发布时盖的版本戳；没有则退回旧版通用值（向后兼容）。"""
    try:
        version_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".version")
        with open(version_path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        return value or "doubaoya-skill/1.0"
    except OSError:
        return "doubaoya-skill/1.0"


def default_rules_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "references", "rules.json")


def probe_duration(path) -> float:
    """ffprobe 探测媒体时长（秒）；失败直接退出（没有时长无法分块）。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=True)
        return float(out.stdout.strip())
    except (OSError, subprocess.SubprocessError, ValueError):
        sys.stderr.write("[error] FFPROBE_FAILED: 无法探测 %s 的时长（ffprobe 在 PATH 里吗？）\n" % path)
        raise SystemExit(1)


def plan_chunks(duration_s: float, chunk_s: float) -> list:
    """把 [0, duration] 均匀切块。返回 [(offset_s, length_s)]（纯函数）。"""
    if duration_s <= 0:
        return []
    n = max(1, int(math.ceil(duration_s / chunk_s)))
    out = []
    for i in range(n):
        off = i * chunk_s
        out.append((round(off, 3), round(min(chunk_s, duration_s - off), 3)))
    return out


def extract_chunk(video: str, offset_s: float, length_s: float) -> bytes:
    """ffmpeg 抽 [offset, offset+length) 的音频为 mono 16kHz 64kbps mp3 字节流。"""
    cmd = ["ffmpeg", "-v", "error", "-ss", str(offset_s), "-t", str(length_s),
           "-i", str(video), "-vn", "-ac", "1", "-ar", "16000",
           "-b:a", "%dk" % AUDIO_BITRATE_KBPS, "-f", "mp3", "-"]
    try:
        return subprocess.run(cmd, capture_output=True, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        sys.stderr.write("[error] FFMPEG_FAILED: 抽音频失败（offset=%.1fs len=%.1fs）\n"
                         % (offset_s, length_s))
        raise SystemExit(1)


def encode_chunks(video: str, offset_s: float, length_s: float) -> list:
    """抽块并 base64；超 10MB 限制时对半递归再切。返回 [(offset_s, b64)]。"""
    raw = extract_chunk(video, offset_s, length_s)
    b64 = base64.b64encode(raw).decode("ascii")
    if len(b64) <= MAX_B64_BYTES:
        return [(offset_s, b64)]
    if length_s < 10:
        sys.stderr.write("[error] AUDIO_TOO_DENSE: %.1fs 音频块 base64 仍超 10MB，无法继续细分\n"
                         % length_s)
        raise SystemExit(1)
    half = length_s / 2
    return (encode_chunks(video, offset_s, half)
            + encode_chunks(video, offset_s + half, length_s - half))


def call_asr(api_key: str, endpoint: str, b64: str, language: str) -> dict:
    """POST 一个音频块到 doubaoya ASR 信封接口，返回 data（契约见 asr-api.md）。"""
    payload = json.dumps({
        "audio": "data:audio/mpeg;base64," + b64,
        "format": "mp3",
        "language": language,
    }).encode("utf-8")
    request = urllib.request.Request(
        endpoint, data=payload, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + api_key,
                 "User-Agent": _skill_user_agent()})
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raw = b""
        try:
            raw = exc.read()
        except Exception:
            pass
        code, message = "HTTP_%d" % exc.code, exc.reason or "请求失败"
        try:
            err = (json.loads(raw.decode("utf-8")).get("error") or {})
            code = err.get("code", code)
            message = err.get("message", message)
        except Exception:
            pass
        if exc.code == 402 or code == "INSUFFICIENT_CREDITS":
            sys.stderr.write("[error] INSUFFICIENT_CREDITS: 额度不足（本路由按次扣点）"
                             "→ 去 doubaoya.com 充值/续额\n")
        elif exc.code == 502 or code == "PROVIDER_FAILED":
            sys.stderr.write("[error] PROVIDER_FAILED: 上游 ASR 临时故障，已自动退款、"
                             "可安全重试 → 稍后重跑即可\n")
        elif exc.code == 404:
            sys.stderr.write("[error] NOT_FOUND: ASR 代理路由待后端上线（见 references/asr-api.md）。"
                             "降级路径：请用户提供现成 srt/vtt 字幕，或本机 whisper 转写后"
                             "转成词级 JSON 契约\n")
        else:
            sys.stderr.write("[error] %s: %s\n" % (code, message))
        raise SystemExit(1)
    except urllib.error.URLError as exc:
        sys.stderr.write("[error] NETWORK_ERROR: 无法连接 doubaoya.com（%s）\n" % exc.reason)
        raise SystemExit(1)

    try:
        envelope = json.loads(body)
    except json.JSONDecodeError:
        sys.stderr.write("[error] BAD_RESPONSE: 服务端返回非 JSON 内容\n")
        raise SystemExit(1)
    if envelope.get("success") is not True:
        err = envelope.get("error") or {}
        sys.stderr.write("[error] %s: %s\n"
                         % (err.get("code", "UNKNOWN"), err.get("message", "请求未成功")))
        raise SystemExit(1)
    if envelope.get("notice"):
        # notice 是本 skill 有更新的提示，原样转达（SKILL.md 末尾约定）
        sys.stderr.write("[notice] %s\n" % envelope["notice"])
    return envelope.get("data") or {}


def merge_words(results: list) -> list:
    """[(offset_s, data)] → 全片词级 token 流（按块偏移平移时间戳，纯函数）。
    data.segments=[{start,end,text,words:[{start,end,text}]}]；无 words 时退化用整段。"""
    tokens = []
    for offset, data in results:
        for seg in (data.get("segments") or []):
            words = seg.get("words") or []
            if words:
                for w in words:
                    tokens.append({"text": str(w.get("text", "")),
                                   "start": round(float(w["start"]) + offset, 3),
                                   "end": round(float(w["end"]) + offset, 3)})
            elif seg.get("text"):
                tokens.append({"text": str(seg["text"]),
                               "start": round(float(seg["start"]) + offset, 3),
                               "end": round(float(seg["end"]) + offset, 3)})
    tokens.sort(key=lambda t: (t["start"], t["end"]))
    return [t for t in tokens if t["text"]]


def fmt_srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return "%02d:%02d:%02d,%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


PUNCT = "。！？?!，,"


def build_srt(tokens: list, group_rule: dict) -> str:
    """词流 → 参考 SRT（校对闸人读用）。聚合规则读 caption_group_rule，与
    make_captions.py 的 group_sentences 同一套参数。"""
    gap_flush = float(group_rule["gap_flush_s"])
    max_chars = int(group_rule["max_chars_flush"])
    punct_min = int(group_rule["punct_flush_min_chars"])
    blocks = []
    current = []

    def flush():
        if not current:
            return
        text = "".join(c["text"] for c in current).strip()
        if text:
            blocks.append({"start": current[0]["start"], "end": current[-1]["end"], "text": text})
        current.clear()

    previous = None
    for c in tokens:
        if previous is not None and (float(c["start"]) - float(previous["end"]) > gap_flush):
            flush()
        current.append(c)
        text = "".join(x["text"] for x in current)
        if len(text) >= max_chars or (len(text) >= punct_min and c["text"] in PUNCT):
            flush()
        previous = c
    flush()
    parts = []
    for i, b in enumerate(blocks):
        parts.append("%d\n%s --> %s\n%s\n" % (
            i + 1, fmt_srt_time(b["start"]), fmt_srt_time(b["end"]), b["text"]))
    return "\n".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description="都爆鸭 · 词级 ASR 转写（分块 → doubaoya 信封 → 合并）")
    ap.add_argument("video", help="源视频/音频路径")
    ap.add_argument("--language", default="zh", choices=["zh", "en", "auto"])
    ap.add_argument("--chunk-seconds", type=float, default=600.0,
                    help="分块长度（秒，默认 600；64kbps 下 ≈ 4.7MB base64）")
    ap.add_argument("--endpoint", default=None,
                    help="覆盖 ASR 信封地址（缺省取环境变量 DOUBAOYA_ASR_ENDPOINT，再缺省用内置默认）")
    ap.add_argument("--rules", default=default_rules_path(), help="rules.json 路径（SRT 聚合用）")
    ap.add_argument("--out-json", default=None, help="词级 JSON 输出路径（默认 <video>.words.json）")
    ap.add_argument("--out-srt", default=None, help="参考 SRT 输出路径（可选）")
    args = ap.parse_args()

    api_key = os.environ.get("DOUBAOYA_API_KEY")
    if not api_key:
        sys.stderr.write(
            "[error] 缺少环境变量 DOUBAOYA_API_KEY。\n"
            "取钥匙：doubaoya.com → 登录 → 密钥中心 → 生成密钥，然后:\n"
            '  export DOUBAOYA_API_KEY="dyh_你的密钥"\n'
            "降级路径（无密钥/后端未上线时）：提供现成 srt/vtt 字幕，或用本机 whisper\n"
            "转写后转成词级 JSON 契约（见 SKILL.md 第 6 节与 references/asr-api.md）。\n")
        return 2

    endpoint = args.endpoint or os.environ.get("DOUBAOYA_ASR_ENDPOINT") or DEFAULT_ENDPOINT
    duration = probe_duration(args.video)
    results = []
    for offset, length in plan_chunks(duration, args.chunk_seconds):
        for off2, b64 in encode_chunks(args.video, offset, length):
            sys.stderr.write("[..] ASR 块 offset=%.1fs（%.1fKB base64）\n" % (off2, len(b64) / 1024))
            results.append((off2, call_asr(api_key, endpoint, b64, args.language)))

    tokens = merge_words(results)
    if not tokens:
        sys.stderr.write("[error] EMPTY_TRANSCRIPT: 全片没有识别出任何词（纯音乐/静音？）\n")
        return 1

    out_json = args.out_json or (os.path.basename(args.video) + ".words.json")
    doc = {"version": 1, "source": os.path.basename(args.video),
           "duration_s": round(duration, 3), "segments": tokens}
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    sys.stderr.write("[ok] 词级 JSON → %s（%d 个 token）\n" % (out_json, len(tokens)))

    if args.out_srt:
        with open(args.rules, encoding="utf-8") as f:
            group_rule = json.load(f)["caption_group_rule"]
        with open(args.out_srt, "w", encoding="utf-8") as f:
            f.write(build_srt(tokens, group_rule))
        sys.stderr.write("[ok] 参考 SRT → %s\n" % args.out_srt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
