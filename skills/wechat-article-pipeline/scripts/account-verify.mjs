#!/usr/bin/env node
/**
 * account-verify.mjs — 都爆鸭 (doubaoya) universal account/key resolver.
 *
 * Purpose:
 *   Before any 都爆鸭 WeChat publish, resolve WHICH local DOUBAOYA_API_KEY
 *   belongs to the intended account, so an agent never publishes as the wrong
 *   account. A single machine may hold several keys (env / files / Keychain);
 *   this module asks the server who each key is and picks the right one.
 *
 * Zero external deps: Node >= 18 builtins + global fetch only.
 * SECURITY: the resolved key is returned in memory ONLY. It is never written
 *           to stdout/stderr/logs. Error and debug output redact key values.
 *
 * Server disambiguator:
 *   GET {baseUrl}/api/agent/whoami  (Authorization: Bearer <dyh_ key>)
 *   -> { success, data: { user: { id, email }, authVia } }
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";

const DEFAULT_BASE_URL = "https://doubaoya.com";
const WHOAMI_PATH = "/api/agent/whoami";

/**
 * Redact a key for safe display: keep a short human-recognizable prefix only.
 * Never reveals enough to be usable.
 * @param {string} key
 * @returns {string}
 */
function redactKey(key) {
  if (typeof key !== "string" || key.length === 0) return "(empty)";
  const prefixEnd = key.startsWith("dyh_") ? 4 : Math.min(3, key.length);
  return `${key.slice(0, prefixEnd)}****`;
}

/**
 * Run a command with argv (no shell) and resolve trimmed stdout, or null on
 * any failure (missing binary, non-zero exit, empty). Never throws.
 * @param {string} file
 * @param {string[]} args
 * @returns {Promise<string|null>}
 */
function execCapture(file, args) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => {
      if (!done) {
        done = true;
        resolve(val);
      }
    };
    try {
      execFile(file, args, { timeout: 5000 }, (err, stdout) => {
        if (err) return finish(null);
        const out = typeof stdout === "string" ? stdout.trim() : "";
        finish(out.length ? out : null);
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * Read a file and return its trimmed contents, or null if unreadable/empty.
 * @param {string} path
 * @returns {Promise<string|null>}
 */
async function readTrimmed(path) {
  try {
    const raw = await readFile(path, "utf8");
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Parse a DOUBAOYA_API_KEY value out of an env-style file body.
 * Accepts lines like `export DOUBAOYA_API_KEY=xxx` or `DOUBAOYA_API_KEY="xxx"`.
 * @param {string|null} body
 * @returns {string|null}
 */
function parseEnvKey(body) {
  if (!body) return null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?DOUBAOYA_API_KEY\s*=\s*(.+)$/);
    if (m) {
      let val = m[1].trim();
      // strip surrounding single/double quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      val = val.trim();
      if (val.length) return val;
    }
  }
  return null;
}

/**
 * Enumerate candidate keys from all sources, in priority order, deduped.
 * Each entry: { key, source }. `source` is a human label (never contains the key).
 * @param {{ account?: string }} opts
 * @returns {Promise<Array<{ key: string, source: string }>>}
 */
async function collectCandidates({ account } = {}) {
  /** @type {Array<{ key: string, source: string }>} */
  const found = [];
  const push = (key, source) => {
    if (typeof key === "string" && key.trim().length) {
      found.push({ key: key.trim(), source });
    }
  };

  // a. environment variable
  push(process.env.DOUBAOYA_API_KEY, "env:DOUBAOYA_API_KEY");

  const home = homedir();

  // b. ~/.doubaoya/key
  push(await readTrimmed(join(home, ".doubaoya", "key")), "file:~/.doubaoya/key");

  // c. ~/.doubaoya/env
  push(
    parseEnvKey(await readTrimmed(join(home, ".doubaoya", "env"))),
    "file:~/.doubaoya/env"
  );

  // d. macOS Keychain (generic-password, service "doubaoya").
  //    execFile (argv, no shell) avoids command injection from `account`.
  push(
    await execCapture("security", ["find-generic-password", "-s", "doubaoya", "-w"]),
    "keychain:service=doubaoya"
  );
  if (account && String(account).trim().length) {
    push(
      await execCapture("security", [
        "find-generic-password",
        "-a",
        String(account),
        "-s",
        "doubaoya",
        "-w",
      ]),
      "keychain:account+service=doubaoya"
    );
  }

  // Dedup by key value, keeping the FIRST source (priority order preserved).
  /** @type {Map<string, { key: string, source: string }>} */
  const byKey = new Map();
  for (const c of found) {
    if (!byKey.has(c.key)) byKey.set(c.key, c);
  }
  return [...byKey.values()];
}

/**
 * Query the whoami endpoint for a single key.
 * @param {string} baseUrl
 * @param {string} key
 * @returns {Promise<{ id: string, email: string, authVia: any } | null>}
 *   Resolved account, or null if the key is invalid / rejected / unparseable.
 */
async function whoami(baseUrl, key) {
  const url = baseUrl.replace(/\/+$/, "") + WHOAMI_PATH;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
  } catch {
    // network error — treat as unresolvable (do not leak key)
    return null;
  }
  if (!res.ok) return null; // 401/403/etc -> invalid key, dropped
  let body;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  const user = body && body.data && body.data.user;
  if (!user || typeof user.email !== "string") return null;
  return {
    id: user.id,
    email: user.email,
    authVia: body.data.authVia,
  };
}

const norm = (s) => String(s).trim().toLowerCase();

const NO_KEY_MSG =
  "本地没有可用的 DOUBAOYA_API_KEY（env / ~/.doubaoya / Keychain 都没有有效凭证），请先在 doubaoya.com 生成密钥并保存。";

/**
 * Collect + resolve every candidate against whoami ONCE, then pick the target.
 * Shared by the exported resolver and the CLI (so whoami is not queried twice).
 *
 * @param {{ account?: string, baseUrl?: string }} [opts]
 * @returns {Promise<{
 *   base: string,
 *   target: string|null,
 *   valid: Array<{ key: string, source: string, account: { id: string, email: string }, authVia: any }>,
 *   invalidSources: string[],
 *   chosen: { key: string, source: string, account: { id: string, email: string }, authVia: any } | null,
 *   error: Error | null,
 * }>}
 */
async function resolveInternal({ account, baseUrl } = {}) {
  const base =
    (typeof baseUrl === "string" && baseUrl.trim()) ||
    process.env.DOUBAOYA_BASE_URL ||
    DEFAULT_BASE_URL;

  const target =
    typeof account === "string" && account.trim().length ? account.trim() : null;

  const candidates = await collectCandidates({ account: target });

  /** @type {Array<{ key: string, source: string, account: { id: string, email: string }, authVia: any }>} */
  const valid = [];
  const invalidSources = [];
  for (const cand of candidates) {
    const acct = await whoami(base, cand.key);
    if (acct) {
      valid.push({
        key: cand.key,
        source: cand.source,
        account: { id: acct.id, email: acct.email },
        authVia: acct.authVia,
      });
    } else {
      invalidSources.push(cand.source);
    }
  }

  const out = { base, target, valid, invalidSources, chosen: null, error: null };

  if (valid.length === 0) {
    out.error = new Error(NO_KEY_MSG);
    return out;
  }

  if (target) {
    const match = valid.find((v) => norm(v.account.email) === norm(target));
    if (!match) {
      const accounts = valid
        .map((v) => `${v.account.email}（来源 ${v.source}）`)
        .join("、");
      out.error = new Error(
        `本地找到的 key 分别对应账号：${accounts}；没有一个匹配目标 ${target}。` +
          `请设置对应账号的 DOUBAOYA_API_KEY，或重新在 doubaoya.com 生成密钥。`
      );
      return out;
    }
    out.chosen = match;
    return out;
  }

  // No account specified: all valid keys must agree on a single account.
  const distinct = new Map();
  for (const v of valid) {
    const k = norm(v.account.email);
    if (!distinct.has(k)) distinct.set(k, v);
  }
  if (distinct.size === 1) {
    out.chosen = valid[0];
    return out;
  }
  const listing = [...distinct.values()]
    .map((v) => `${v.account.email}（来源 ${v.source}）`)
    .join("、");
  out.error = new Error(
    `本地存在多个有效 key，分别对应不同账号：${listing}。` +
      `请通过 --account <账号> 指定要发布的目标账号。`
  );
  return out;
}

/**
 * Resolve the local DOUBAOYA_API_KEY belonging to the intended account.
 *
 * @param {{ account?: string, baseUrl?: string }} [opts]
 * @returns {Promise<{
 *   key: string,                       // IN MEMORY ONLY — never log this
 *   account: { id: string, email: string },
 *   source: string,
 *   authVia: any,
 * }>}
 * @throws {Error} with an actionable, key-free message on any failure.
 */
export async function resolveAccountKey({ account, baseUrl } = {}) {
  const res = await resolveInternal({ account, baseUrl });
  if (res.error) throw res.error;
  const c = res.chosen;
  return { key: c.key, account: c.account, source: c.source, authVia: c.authVia };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

/**
 * Minimal argv parser for: --account <x> --base-url <u> --json
 * @param {string[]} argv
 * @returns {{ account?: string, baseUrl?: string, json: boolean }}
 */
function parseArgs(argv) {
  const out = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--account" || a === "-a") out.account = argv[++i];
    else if (a === "--base-url" || a === "-b") out.baseUrl = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const HELP = `account-verify.mjs — resolve the local DOUBAOYA_API_KEY for an account

Usage:
  node account-verify.mjs [--account <email|phone>] [--base-url <url>] [--json]

Options:
  -a, --account <x>    Target account login (email or phone). If omitted, all
                       valid local keys must resolve to the same account.
  -b, --base-url <u>   API base URL (default: $DOUBAOYA_BASE_URL or
                       https://doubaoya.com).
      --json           Emit a JSON summary instead of human text.
  -h, --help           Show this help.

Never prints the key value. Exits non-zero with an actionable message on failure.
Sources checked (priority): env DOUBAOYA_API_KEY, ~/.doubaoya/key,
~/.doubaoya/env, macOS Keychain (service "doubaoya").`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }

  const res = await resolveInternal({
    account: args.account,
    baseUrl: args.baseUrl,
  });

  // candidate -> account map (redacted; no key values, only source + resolved email)
  const candidateMap = res.valid.map((v) => ({
    source: v.source,
    account: { id: v.account.id, email: v.account.email },
    authVia: v.authVia,
    keyRef: redactKey(v.key),
  }));

  if (res.error) {
    const msg = res.error.message;
    if (args.json) {
      process.stderr.write(
        JSON.stringify(
          {
            success: false,
            error: msg,
            candidates: candidateMap,
            invalidSources: res.invalidSources,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`❌ ${msg}\n`);
      if (candidateMap.length) {
        process.stderr.write("   本地有效候选 → 账号：\n");
        for (const c of candidateMap) {
          process.stderr.write(
            `     - ${c.account.email}（来源 ${c.source}，密钥 ${c.keyRef}）\n`
          );
        }
      }
    }
    return 1;
  }

  const chosen = res.chosen;
  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          success: true,
          account: chosen.account, // { id, email }
          source: chosen.source,
          authVia: chosen.authVia,
          keyRef: redactKey(chosen.key), // redacted reference only
          candidates: candidateMap,
          invalidSources: res.invalidSources,
        },
        null,
        2
      ) + "\n"
    );
  } else {
    const lines = [
      "✅ 已解析目标账号对应的本地密钥（密钥值不显示）",
      `   账号:    ${chosen.account.email}`,
      `   账号 ID: ${chosen.account.id}`,
      `   来源:    ${chosen.source}`,
      `   authVia: ${JSON.stringify(chosen.authVia)}`,
      `   密钥引用: ${redactKey(chosen.key)}（仅供识别，非完整密钥）`,
      "   本地候选 → 账号：",
    ];
    for (const c of candidateMap) {
      const mark = c.source === chosen.source ? "★" : "-";
      lines.push(
        `     ${mark} ${c.account.email}（来源 ${c.source}，密钥 ${c.keyRef}）`
      );
    }
    if (res.invalidSources.length) {
      lines.push(`   已忽略的无效来源: ${res.invalidSources.join("、")}`);
    }
    process.stdout.write(lines.join("\n") + "\n");
  }
  return 0;
}

// Run as CLI only when invoked directly (not when imported).
const invokedDirectly =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

// A more robust direct-invocation check that tolerates symlinks / spaces.
async function isMain() {
  if (!process.argv[1]) return false;
  try {
    const { realpath } = await import("node:fs/promises");
    const argvPath = await realpath(process.argv[1]).catch(() => process.argv[1]);
    const selfPath = await realpath(new URL(import.meta.url).pathname).catch(
      () => new URL(import.meta.url).pathname
    );
    return argvPath === selfPath;
  } catch {
    return invokedDirectly;
  }
}

if (await isMain()) {
  process.exit(await main());
}
