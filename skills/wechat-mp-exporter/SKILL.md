---
name: wechat-mp-exporter
description: Use MP Ark to search, retrieve, and archive WeChat Official Account articles through an on-demand Lite workflow (terminal or temporary static HTML status) or an explicitly selected Docker full UI. Use when Codex needs user-approved QR login, account disambiguation, latest/today/article queries, safe HTML/Markdown/text retrieval, resumable deduplicated archives, backend diagnosis, or migration between Lite and Docker without changing archive format.
---

# MP Ark

Use MP Ark through the stable `wechat-mp-exporter` Skill ID and its single bundled CLI. Keep the user present for QR approval. Prefer `onboard`; accept `init` as its exact alias.

```bash
SCRIPT="${CODEX_HOME:-$HOME/.codex}/skills/wechat-mp-exporter/scripts/wechat_mp_exporter.py"
python3 "$SCRIPT" doctor --mode lite --json
```

## Choose an experience

- Prefer Lite terminal for the smallest footprint: `--mode lite --ui terminal`. Run an on-demand Python process and an installed browser with no persistent service or status listener.
- Offer Lite HTML when the user wants a visual status window: `--mode lite --ui html`. Open a temporary static page in the system default browser and show only redacted login state and progress. Keep the QR code on the real WeChat page opened in the selected automation browser; never copy or relay it into the status page.
- Keep Docker as an explicit full-UI option: `--mode docker --ui full`. Fetch/build/start it only after the user selects Docker.
- Use `auto` for an already ready path. Resolve it once, honor saved or running choices, and never create a fresh Docker deployment or switch backend after an error. Require an explicit `--mode docker` before Docker setup or onboarding.

```bash
python3 "$SCRIPT" onboard --mode lite --ui terminal
python3 "$SCRIPT" onboard --mode lite --ui html --browser auto
python3 "$SCRIPT" init --mode lite --ui html

python3 "$SCRIPT" onboard --mode docker --ui full
```

Use `--force-login` to discard a saved Lite session and require a new scan. Add `--json` to onboarding for phase, code, next action, terminal state, and executable examples. Accept global flags before or after a subcommand.

Treat `--browser auto|chrome|edge|brave|firefox` as the browser used for the real login page; it does not change the system-default status-page opener. Safari may display the HTML page but cannot automate login. No browser is bundled. Selenium Manager may download a driver on first login; pass `--driver-path` for an existing executable.

The user must scan and approve the real `https://mp.weixin.qq.com/` login page. Never render, crop, relay, log, or ask the user to paste QR codes, cookies, tokens, auth keys, or session files.

## Query and archive

```bash
python3 "$SCRIPT" search "公众号名称" --mode auto
python3 "$SCRIPT" search "公众号名称" --all --json --mode auto
python3 "$SCRIPT" latest "公众号名称" --limit 5 --mode auto
python3 "$SCRIPT" today "公众号名称" --timezone Asia/Shanghai --mode auto
python3 "$SCRIPT" articles 'FAKEID' --pages 1 --json --mode auto
python3 "$SCRIPT" fetch 'https://mp.weixin.qq.com/s/ARTICLE' --format markdown --output "$PWD/article.md" --mode auto
python3 "$SCRIPT" archive "公众号名称" --limit 5 --format markdown --mode auto
python3 "$SCRIPT" archive "公众号名称" --today --timezone Asia/Shanghai --format markdown --mode auto
```

Use compact human output by default. Use `--json` for machine-readable onboarding and query output; it preserves the legacy complete envelopes for `search` and `articles`. Permit `search --all` only with `--json`. Reject `articles --all` and direct historical aggregation to `archive`. Treat archive's always-JSON output path and manifest summary as its structured result.

Resolve account names for `latest`, `today`, and selected archives in this order: one exact display-name match, one exact WeChat-ID match, or the sole result. On ambiguity, preserve up to five candidates, exit `4`, and require `--pick N`; accept `--account-id FAKEID` to bypass search. Never guess silently.

State the capability boundary: MP Ark supports account search, title, publish time, article link/content, and archives. It does not promise `read_count`, `like_count`, `recommend_count`, or `comment_count`.

For archive selection, make `--today` and `--limit 1..20` mutually exclusive and record the selection, date/timezone window, and account identity in `manifest.json`. When `--output` is omitted, accept the safe hashed directory under `$PWD/mp-ark-archives/`. Treat archive exit status and `manifest.json` as authoritative. A capped, truncated, or failed run exits nonzero; rerun the same selection and format against either backend to rescan, deduplicate, and fill missing content.

Use `config` to persist only non-secret defaults:

```bash
python3 "$SCRIPT" config --default-mode auto --default-ui auto --default-browser auto
python3 "$SCRIPT" auth status --mode lite --json
python3 "$SCRIPT" auth clear --mode lite
python3 "$SCRIPT" status --mode docker --json
```

Read [references/lite.md](references/lite.md) before Lite setup, onboarding, login, HTML status, browser changes, or session handling. Read [references/docker.md](references/docker.md) before Docker onboarding, setup, lifecycle, API, patch, image, or auth changes. Read [references/contracts.md](references/contracts.md) before changing shared commands, selection, pagination, adapters, archives, paths, or redaction. Read [references/third-party-notices.md](references/third-party-notices.md) before redistribution.

Do not enable proxies, TLS bypasses, analytics, membership, request debugging, or Docker server-side JSON parsing. Do not silently build Docker or switch backends after login, API, or content failures. Live access remains subject to WeChat's terms and rate limits.
