// credentials.mjs — 凭证解析的唯一实现（spec dby-cli-auth「凭证解析只有一套顺序」）。
//
// 顺序只有两层，且只在这里判：
//   ① 环境变量 DOUBAOYA_API_KEY（非空）；
//   ② ~/.doubaoya/credentials（`dby login` 写的 JSON，文件 0600、目录 0700）。
// 🔴 仓内不许有第二套 key 发现逻辑（钥匙串、~/.doubaoya/key、~/.doubaoya/env……），
//    tools/validate_community.py 的 validate_single_key_discovery 钉住。
// 🔴 key 明文一个字都不进任何输出：能显示的只有前缀（与服务端 ApiKey.prefix 同口径，前 8 个字符）
//    和来源（env / credentials）。

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** 服务端 ApiKey.prefix 的口径：原始 key 的前 8 个字符（`dyh_` + 4 位），网页密钥中心显示的就是它。 */
const KEY_PREFIX_CHARS = 8;

export function doubaoyaDir() {
  return path.join(os.homedir(), ".doubaoya");
}

export function credentialsPath() {
  return path.join(doubaoyaDir(), "credentials");
}

/** 可安全显示的 key 前缀（spec：输出只许出现前缀与来源）。 */
export function keyPrefixOf(key) {
  return typeof key === "string" && key.length > KEY_PREFIX_CHARS ? `${key.slice(0, KEY_PREFIX_CHARS)}…` : "…";
}

/** 权限检查：宽于 0600（组或其他人有任何位）就给一句带修复命令的警告；Windows 上 mode 位无意义，跳过。 */
export function permissionWarning(file, { platform = process.platform } = {}) {
  if (platform === "win32") return null;
  let mode;
  try {
    mode = statSync(file).mode & 0o777;
  } catch {
    return null;
  }
  if ((mode & 0o077) === 0) return null;
  return (
    `凭证文件 ${file} 的权限是 0${mode.toString(8)}，宽于 0600（同机其他用户可能读到你的 key）。` +
    `修复：chmod 600 ${JSON.stringify(file)}`
  );
}

/**
 * 读凭证文件。返回 { apiKey, keyPrefix, baseUrl, createdAt, warning } 或 null（文件不存在）。
 * 文件损坏时返回 { apiKey: null, warning }——不抛：凭证坏了不该让 `dby routes` 这类本地命令也跟着挂。
 */
export function readCredentials(file = credentialsPath()) {
  if (!existsSync(file)) return null;
  const warning = permissionWarning(file);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {
      apiKey: null,
      warning: [warning, `凭证文件 ${file} 不是合法 JSON，已忽略。重新运行 dby login 可覆盖它。`].filter(Boolean).join("\n")
    };
  }
  const apiKey = typeof parsed?.apiKey === "string" && parsed.apiKey ? parsed.apiKey : null;
  return {
    apiKey,
    keyPrefix: typeof parsed?.keyPrefix === "string" ? parsed.keyPrefix : null,
    baseUrl: typeof parsed?.baseUrl === "string" ? parsed.baseUrl : null,
    createdAt: typeof parsed?.createdAt === "string" ? parsed.createdAt : null,
    warning
  };
}

/**
 * 解析本次调用用哪把 key。返回 { key, keySource: "env"|"credentials"|null, baseUrl, warning }。
 * baseUrl 只在 key 取自凭证文件时给出（`dby login` 时连的是哪个站，key 就属于哪个站）。
 */
export function resolveCredentials(env = process.env, { file = credentialsPath() } = {}) {
  const creds = readCredentials(file);
  const warning = creds?.warning ?? null;
  const envKey = env.DOUBAOYA_API_KEY;
  if (typeof envKey === "string" && envKey !== "") {
    return { key: envKey, keySource: "env", baseUrl: null, warning };
  }
  if (creds?.apiKey) {
    return { key: creds.apiKey, keySource: "credentials", baseUrl: creds.baseUrl, warning };
  }
  return { key: null, keySource: null, baseUrl: null, warning };
}

/** 原子写：目录 0700、文件先写临时名（0600）再 rename，避免半写的凭证文件。 */
export function writeJsonPrivate(file, obj) {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // 目录不归我们管（例如 HOME 本身）时 chmod 失败不致命；文件本身仍是 0600。
    }
  }
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export function writeCredentials({ apiKey, keyPrefix, baseUrl }, file = credentialsPath()) {
  writeJsonPrivate(file, {
    apiKey,
    keyPrefix: keyPrefix ?? keyPrefixOf(apiKey),
    baseUrl,
    createdAt: new Date().toISOString(),
    via: "dby login"
  });
}

export function deleteCredentials(file = credentialsPath()) {
  rmSync(file, { force: true });
}
