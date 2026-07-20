# Shared runtime contracts

## Backend selection

- Treat `assets/backends.json` as the fail-closed single source of truth for modes, auto order, UI matrix, browser support, state paths, and prerequisite names. Reject unknown keys, schema versions, unsafe paths, or unsupported rule values.
- Resolve `auto` exactly once: explicit Docker API/auth forcing, saved non-auto preference, running legacy Docker, then declared capability order. Never switch after login, API, content, or archive errors.
- Require `--mode docker` on the current command before cloning, building, or starting a fresh Docker deployment. A saved Docker preference, `auto`, and an unprepared Docker candidate are insufficient authorization. Keep explicit Lite paths free of Docker calls and explicit Docker paths free of Selenium imports.

## Workflow and UI

- Treat `assets/workflows.json` as the fail-closed source of truth for user-facing defaults, limits, supported fields, unsupported metrics, terminal-state hold time, and the allowlisted login recovery policy.
- Treat Lite terminal, Lite HTML, and explicit Docker full UI as user-selectable experiences over two backends. Lite terminal creates no listener. Lite HTML serves one static status page on a fresh loopback URL and opens it with the system default browser. `--browser` selects the separate browser used for real WeChat login automation.
- Keep the QR code only on the real `https://mp.weixin.qq.com/` page. The local HTML page may expose redacted phase, code, next action, terminal state, and counts, but no QR pixels, credentials, article data, or arbitrary files.
- Make `onboard` and `init` exact aliases. In Lite, set up missing locked dependencies, reuse a locally valid session unless `--force-login`, complete login, and emit usable next commands. In Docker, set up/start only with explicit `--mode docker`; return a truthful nonterminal `qr_pending` result until login and auth are complete.

## State

- Default state root to `${XDG_DATA_HOME:-$HOME/.local/share}/wechat-mp-exporter`; require mode 0700 directories and mode 0600 secret/files.
- Preserve Docker `source`, `data/kv`, `lock.json`, `runtime.json`, and `secrets/auth-key` exactly.
- Add only `preferences.json` (0600), `secrets/lite/session.json` (0600), `lite/` (0700), and transient `runtime/lite.json` (0600, removed at exit). Reject symlinks for trusted state and secret paths.
- Keep Docker and Lite auth status/clear operations isolated.

## Adapter and redaction

- Implement search page, article page, account metadata, content fetch, lifecycle, auth/status, and redaction behind backend adapters. Keep one archive engine and one CLI.
- Never put auth keys, cookies, WeChat tokens, credentials, or token-bearing URLs in arguments, manifests, logs, status UI, or errors.
- Preserve every existing Docker invocation, option, output, and exit-code behavior. Accept mode/UI/browser flags before or after subcommands.

## User-facing commands

- Print compact human summaries for `search`, `articles`, `latest`, and `today`. Use `--json` for structured onboarding and query output; preserve the legacy complete JSON envelopes for `search` and `articles`. Keep archive's output path and manifest summary JSON behavior unchanged.
- Reject human `search --all` with exit `2` and require `--json`. Reject `articles --all` with exit `2` and direct complete history to `archive`.
- Resolve accounts for `latest`, `today`, and selected archives by unique exact display name, then unique exact WeChat ID, then sole result. On ambiguity, retain at most five candidates, exit `4`, and require `--pick N`; let `--account-id` bypass search.
- Parse second, millisecond, and numeric-string timestamps. Let `today` accept `local` or an IANA timezone. Exit nonzero with `truncated=true` when its page cap is reached before an empty page or day boundary.
- Support account search, title, publish time, article link/content, and archives. Report `read_count`, `like_count`, `recommend_count`, and `comment_count` as unsupported rather than fabricating them.

## Pagination and archive

- Increment `begin` by the requested message-group page size, not by the number of flattened articles. Flatten every `publish_info.appmsgex` item when an upstream group envelope is returned.
- Use `fakeid:aid` as the stable key when both components are safe. Otherwise use the SHA-256 of the canonical article URL.
- Normalize selected fields but preserve every upstream article object under `raw`.
- Write `manifest.json`, optional `account.json`, `articles.ndjson`, `failures.ndjson`, and `content/<stable-key>.<ext>` atomically. Never derive paths from titles.
- Establish and validate archive identity in `manifest.json` before writing new article records. Reject every existing article/account record whose `fakeid` differs, including records recovered from a manifestless partial archive.
- On each run, rescan metadata from `--begin`, deduplicate existing stable keys, skip complete content files, retry missing/failed content, and retry missing account metadata. Do not treat this as saved page-cursor resume.
- Mark `completed=true` only after observing an empty terminal page with no failures. Mark `truncated=true`, set `stop_reason=max-pages`, and exit nonzero when the page cap is reached first. Record explicit failures rather than placeholder content.
- Keep archive output backend-neutral. Do not record a backend in archive identity; permit a rerun in the other mode to resume the same archive.
- Let archive `--today` and `--limit 1..20` resolve an account name and remain mutually exclusive. Persist the exact selection in `manifest.json`, including the date/timezone boundaries for `--today`; reject reuse with a different selection.
- When `--output` is absent, derive `$PWD/mp-ark-archives/<sha256(fakeid)[:16]>-<format>` only after the fakeid is known, including account resolution when a selection uses a name. Never place a raw fakeid, account name, or article title in the default path.
