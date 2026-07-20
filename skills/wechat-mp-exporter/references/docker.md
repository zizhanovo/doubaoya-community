# Docker backend contract

## Supply chain

- Fetch only `https://github.com/wechat-article/wechat-article-exporter.git` at commit `6b67dfe64f6f359be604239e98f74c1021fc9d5f`.
- Keep `HEAD` at that commit. Treat `assets/upstream-privacy.patch` as the only permitted worktree diff; fail on staged, untracked, missing, or additional changes.
- Build `wechat-mp-exporter-local:6b67dfe64f6f359be604239e98f74c1021fc9d5f`, record its immutable image ID, and run Compose by image ID. Never silently build Docker from `auto` or substitute an upstream registry image.
- Require `--mode docker` on the current setup or onboarding command before cloning, building, or starting an unprepared Docker backend. Do not treat a saved preference or an `auto` resolution as permission to deploy Docker.

## State and lifecycle

- Preserve `source`, `data/kv`, `lock.json`, `runtime.json`, `secrets/auth-key`, Compose project/image names, and every existing Docker command/output semantic.
- Bind only `127.0.0.1`; persist `/app/.data` at `<state>/data`; retain `NITRO_KV_DRIVER=fs` and `NITRO_KV_BASE=.data/kv`.
- Keep public proxies, server-side JSON parsing, analytics, membership, request debug logging, and TLS bypasses disabled.
- Retain Docker as the optional full-UI and compatibility path. `onboard --mode docker --ui full` may perform explicit setup/start, then open the loopback UI; report `qr_pending` until the user completes the real QR login and saves/verifies the local API auth key.

## Auth and API

- Obtain login only through the local full UI and user-approved QR scan. Store the public API auth key only through hidden input, stdin, `WECHAT_MP_EXPORTER_AUTH_KEY`, or a checked mode-0600 file in a mode-0700 directory.
- Send the auth key only in `X-Auth-Key`. Keep it out of arguments, URLs, manifests, logs, and errors.
- Accept API bases only on HTTP loopback with no credentials, query, fragment, or path. Detect HTTP-200 application errors and permit only HTML, Markdown, or text downloads for exact-host WeChat article URLs.
- After parsing any JSON application-error envelope, require Docker downloads to match the requested media type exactly: `text/html`, `text/markdown`, or `text/plain`, with optional parameters. Reject missing, malformed, binary, or mismatched media types before archive writes.
