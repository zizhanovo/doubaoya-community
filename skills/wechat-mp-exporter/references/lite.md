# Lite backend contract

## Runtime

- Require Python 3.12. Create `<state>/lite/venv` with `uv` when available; fall back to stdlib `venv` plus pip.
- Install only `assets/lite-requirements.lock` with hashes enforced. Its direct pins are Selenium 4.46.0, Beautiful Soup 4.13.4, and markdownify 1.1.0. Do not bundle a browser or add requests, Playwright, Pillow, lxml, or webdriver-manager.
- Keep `<state>/lite` and its dedicated `profile` at mode 0700. Never point Selenium at a user's normal browser profile.
- Detect Chrome, Edge, Brave, Firefox, and Safari from `assets/backends.json`. Treat Safari as progress-display only. Accept a checked non-symlink executable with `--driver-path`; otherwise disclose Selenium Manager's possible first-login driver download.
- Keep `doctor` offline by default. Report the browser, Selenium, Selenium Manager, and selected driver source/version when locally available. Fail an explicit browser/driver major-version mismatch; for Chrome 150+ with Selenium below 4.46, warn without asserting that it caused a failure.

## Onboarding

- Prefer `onboard --mode lite`; treat `init` identically. Install the locked runtime only when missing, re-enter through its Python, and reuse a locally valid saved session unless `--force-login` is present.
- Support `--ui terminal` for no local status listener and `--ui html` for a temporary static status page. Let `--browser` choose the real login browser, independently of the system-default browser used to display the status page.
- On success, print executable `search`, `latest`, and limited `archive` examples. With `--json`, return phase, code, next action, terminal state, and examples without secret-bearing fields.

## Login and session

- Acquire `<state>/lite/login.lock` exclusively. Open the real headed `https://mp.weixin.qq.com/` page and wait at most five minutes for user QR approval.
- Accept completion only on exact HTTPS host `mp.weixin.qq.com` with a valid numeric token. Capture Selenium's complete cookie list and the real browser user agent.
- Atomically write only `<state>/secrets/lite/session.json` at mode 0600. Never print its token/cookies or place them in arguments, URLs, runtime status, logs, errors, or archive files.
- Keep Lite and Docker auth isolated. `auth clear --mode lite` must never remove `secrets/auth-key`.
- Classify and redact startup, driver, profile, crash/disconnect, browser-close, and QR-timeout failures. Retry exactly once only for allowlisted Chrome/Edge/Brave startup or first-navigation failures, using a disposable recovery profile and only the safe flags declared in `assets/workflows.json`. Never retry a QR timeout.

## API and content

- Use stdlib `urllib` plus `http.cookiejar`, disable proxies, URL-encode search/article queries, bound responses, detect application errors, delay API calls, and apply bounded retry/backoff to 429 and 5xx/network failures.
- Page article groups by the requested group size. Parse string or object `publish_page` and `publish_info` forms; flatten every `appmsgex` item.
- Fetch article HTML only from exact HTTPS host `mp.weixin.qq.com`. Allow redirects only to the same exact origin. Reject empty, blocked, abnormal, or missing-`#js_content` pages.
- Extract deterministic HTML, text, or Markdown with Beautiful Soup and markdownify. Permit at most one visible managed-profile browser fallback per command batch.

## Temporary status UI

- Serve `assets/lite-status.html` only for a running Lite login/archive command on `127.0.0.1:0` under a fresh unguessable path. Open it with the system default browser; if that fails, expose the temporary loopback URL for manual opening in another installed browser without weakening the boundary.
- Expose redacted phase, code, next action, terminal state, and counts only. Keep the QR on the separate real WeChat page. Apply no-store, no-referrer, CSP, nosniff, and frame-deny headers. Do not serve credentials, QR pixels, article data, or arbitrary files.
- Preserve the last terminal success/failure view after polling disconnects and hold the local server for no more than the workflow-declared two seconds. Show three usable next commands after login success.
- Write transient `<state>/runtime/lite.json` at mode 0600 and remove it while unwinding success, failure, interruption, or signal-driven shutdown. Terminal UI must create no listener.
