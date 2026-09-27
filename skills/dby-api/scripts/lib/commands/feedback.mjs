// feedback.mjs — `dby feedback prepare|submit|keep|reset-id`
// （移植自 skills/dby-feedback/scripts/submit_feedback.py，design D5；端点配置并入 ../data/feedback-endpoint.json）。
//
// 两步走，中间隔着「用户过目」这道人工闸：
//   1. prepare：按白名单采集机器事实 + agent 写好的报告 → 拼成待发送载荷，过一遍凭证/高熵检测，
//      把**最终要发出去的那份**逐字节写进 --out。人读形态把全文打到 stdout；JSON 形态只给路径
//      （agent 把 --out 文件全文原样给用户过目——呈现的就是要发的，不是摘要）。
//   2. submit：把 --file（prepare 的产物）**原样**发出去。发送前再扫一遍（双闸的机器侧）。
//      端点未配置 → 落本地 markdown、告知路径、退出码 0（spec「反馈端点未配置」）；此时什么都不出本机，
//      所以不需要同意。端点已配置 → 必须带 --user-consented 才发；发送失败同样落本地，内容绝不丢。
//      一步式：--file 给报告 .md 时，submit 内部先走 1 再走 2（载荷落在 <报告>.payload.json）。
//
// kind=local：本命令从不发 doubaoya API 请求（不读 DOUBAOYA_BASE_URL、不带 key）。唯一的出网是
// 端点**已配置且用户同意**时打那个独立的反馈端点；端点未配置（当前出厂状态）时零出网。
//
// 隐私红线（与 skills/dby-feedback 的 SKILL.md、references/report-protocol.md 同一契约）：
//   · 机器事实**只采白名单字段**（下面的常量是唯一事实源），白名单外的键根本不进待发送结构；
//   · 检测命中时不发送、不回显命中内容——只报规则名与位置；
//   · 没拿到 --user-consented（拒绝、无回应都算未同意）绝不发送。注意全局 --confirm **不算**同意。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { EXIT, DbyError } from "../errors.mjs";
import { userAgent } from "../version.mjs";
import { resolveProxy, requestViaProxy } from "../proxy.mjs";

// ── 采集白名单（隐私的地基）──────────────────────────────────────────────────
// 🔴 清单之外的任何键（appid、author、publicAccountName、targetAccount、ipProfile、用户正文、
//    号章程、创作 DNA、任何凭证）即使出现在被读的文件里，也不进内存中的待发送结构。
export const ORIGIN_FIELD_WHITELIST = Object.freeze(["slug", "version", "hash", "ref", "installedAt"]);
// lock 的 per-skill 条目里 pinReason 是用户手写的自由文本，**故意不在清单里**。
export const LOCK_FIELD_WHITELIST = Object.freeze(["version", "hash", "installedAt", "pinned"]);
export const RUNTIME_FACT_WHITELIST = Object.freeze(["node", "os", "agentType", "commands"]);

export const CATEGORIES = Object.freeze(["bug", "friction", "idea"]);

// ── 凭证 / 高熵检测（双闸的机器侧）────────────────────────────────────────────
// 与原脚本同一张规则表。差别：JS 的 \b 按 ASCII 判词界，汉字紧贴密钥（如「密钥dyh_…」）时
// Python（Unicode \b）不命中而这里命中——只会多拦，不会少拦，故意保留。
export const SECRET_RULES = Object.freeze([
  // dyh_ 真钥匙：后跟 12+ 位含数字的字母数字串；占位符（dyh_… / dyh_xxx）天然不命中。
  ["doubaoya-key", /\bdyh_(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{12,}\b/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ["github-pat", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["openai-style-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g],
  ["private-key-block", new RegExp("-----BEGIN " + "[A-Z0-9 ]*" + "PRIVATE KEY-----", "g")],
  ["bearer-header", /\bBearer\s+[A-Za-z0-9._-]{16,}/g]
]);
// 高熵串：长于 24 的连续片段，香农熵超过阈值就当疑似凭证。
// 纯十六进制（安装标识、12 位包哈希）熵上限 4.0 bits/char，天然低于阈值。
const ENTROPY_RUN = /[A-Za-z0-9+/=_-]{24,}/g;
export const ENTROPY_THRESHOLD = 4.2;

export function entropyBitsPerChar(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const n = s.length;
  let h = 0;
  for (const c of counts.values()) h -= (c / n) * Math.log2(c / n);
  return h;
}

function position(text, index) {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line, col: [...text.slice(lineStart, index)].length + 1 }; // 列按码点算（同 Python）
}

/** 命中列表：每项只含规则名与位置（行、列、长度）——**绝不包含命中内容本身**。**纯函数**。 */
export function scanSecrets(text) {
  const hits = [];
  for (const [rule, re] of SECRET_RULES) {
    for (const m of text.matchAll(re)) hits.push({ rule, ...position(text, m.index), length: m[0].length });
  }
  for (const m of text.matchAll(ENTROPY_RUN)) {
    if (entropyBitsPerChar(m[0]) >= ENTROPY_THRESHOLD) {
      hits.push({ rule: "high-entropy", ...position(text, m.index), length: m[0].length });
    }
  }
  return hits.sort((a, b) => a.line - b.line || a.col - b.col);
}

function secretError(hits) {
  const err = new DbyError("SECRET_DETECTED", "检测到疑似凭证/高熵串，不发送。", {
    exit: EXIT.BUSINESS,
    remediation: "按 data.hits 指出的位置处理（删掉或换成占位符）后重新 `dby feedback prepare`。命中内容本身不回显。"
  });
  err.data = { hits };
  err.human = hits.map((h) => `第 ${h.line} 行第 ${h.col} 列：疑似 ${h.rule}（长度 ${h.length}，内容不回显）`).join("\n");
  return err;
}

// ── 机器事实采集（只按白名单取）───────────────────────────────────────────────
/** 只取白名单字段——清单外的键**在这一步就被丢弃**，不进返回的结构。 */
function filtered(data, whitelist) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return Object.fromEntries(whitelist.filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]));
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * 按白名单采集机器事实。scopeRoot 默认家目录（与 dby-update 的 global scope 同根）。
 * ponytail: 只扫 <scopeRoot>/.claude/skills/ 这一处装机位；project scope / 其他 agent 目录不扫。
 *           升级路径 = 照 reconcile.mjs 的多 scope 枚举来（同原脚本）。
 */
export function collectMachineFacts(scopeRoot, agentType, commandsRun) {
  const packages = [];
  const skillsDir = path.join(scopeRoot, ".claude", "skills");
  if (existsSync(skillsDir)) {
    let names = [];
    try {
      names = readdirSync(skillsDir).sort();
    } catch {
      names = [];
    }
    for (const name of names) {
      const origin = readJson(path.join(skillsDir, name, ".dby", "origin.json"));
      if (origin === undefined) continue;
      const entry = filtered(origin, ORIGIN_FIELD_WHITELIST);
      if (Object.keys(entry).length) packages.push(entry);
    }
  }

  let lock = {};
  const rawLock = readJson(path.join(scopeRoot, ".dby", "lock.json"));
  const skillsMap = rawLock && typeof rawLock === "object" && !Array.isArray(rawLock) ? rawLock.skills : null;
  if (skillsMap && typeof skillsMap === "object" && !Array.isArray(skillsMap)) {
    lock = Object.fromEntries(
      Object.keys(skillsMap).sort().map((slug) => [slug, filtered(skillsMap[slug], LOCK_FIELD_WHITELIST)])
    );
  }

  const facts = filtered(
    { node: process.version, os: `${os.type()} ${os.release()}`, agentType: agentType ?? null, commands: commandsRun },
    RUNTIME_FACT_WHITELIST
  );
  facts.packages = packages;
  facts.lock = lock;
  return facts;
}

// ── 安装标识（假名标识符）──────────────────────────────────────────────────────
// 本地随机生成、不从机器名/用户名/邮箱/密钥等任何可识别信息派生、支持重置。
// ⚠️ 它是假名标识符，不是「匿名」——措辞红线见 skills/dby-feedback/references/maintainer-loop.md。
const idPath = (scopeRoot) => path.join(scopeRoot, ".dby", "feedback-id");

export function installId(scopeRoot, { reset = false } = {}) {
  const file = idPath(scopeRoot);
  if (!reset) {
    try {
      const existing = readFileSync(file, "utf8").trim();
      if (/^[0-9a-f]{32}$/.test(existing)) return existing;
    } catch {
      // 没有就新建
    }
  }
  const fresh = randomBytes(16).toString("hex"); // 唯一输入是系统 CSPRNG，不掺任何机器/用户信息
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${fresh}\n`);
  return fresh;
}

// ── 端点配置 ───────────────────────────────────────────────────────────────────
const ENDPOINT = JSON.parse(readFileSync(new URL("../data/feedback-endpoint.json", import.meta.url), "utf8"));

/**
 * 只许 https，或本机回环 http（联调 / 测试桩）——反馈数据不走明文出网。
 * 比原脚本严：原脚本按前缀判（`http://127.0.0.1` / `http://localhost`），`http://localhost.evil.com`
 * 这类地址会被放行；这里按解析后的主机名精确判。**纯函数**。
 */
export function isAllowedFeedbackUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
}

/** 端点地址与请求体字段名来自 data/feedback-endpoint.json；DOUBAOYA_FEEDBACK_URL 非空时覆盖地址。 */
export function loadEndpointConfig(env = process.env) {
  const config = { ...ENDPOINT, fields: { ...ENDPOINT.fields } };
  if (env.DOUBAOYA_FEEDBACK_URL) config.url = env.DOUBAOYA_FEEDBACK_URL;
  if (config.url && !isAllowedFeedbackUrl(config.url)) {
    throw new DbyError("FEEDBACK_URL_INSECURE", `反馈端点地址必须是 https（或本机回环）：${config.url}`, {
      exit: EXIT.USAGE,
      remediation: "改成 https:// 地址，或 unset DOUBAOYA_FEEDBACK_URL 回到出厂配置（未配置 = 落本地文件）。"
    });
  }
  return config;
}

// ── prepare ────────────────────────────────────────────────────────────────────
/** 按配置的字段名拼载荷，返回**最终要发出去的那份**序列化文本（含末尾换行）。**纯函数**。 */
export function buildPayload(category, reportText, facts, installation, fields) {
  const payload = {
    [fields.category]: category,
    [fields.report]: reportText,
    [fields.machineFacts]: facts,
    [fields.installId]: installation,
    [fields.skillVersion]: userAgent()
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

/** 「退出码:命令」→ {exit, cmd}。 */
function parseCommandSpec(item) {
  const i = item.indexOf(":");
  const code = i === -1 ? item : item.slice(0, i);
  const cmd = i === -1 ? "" : item.slice(i + 1);
  if (!/^\s*[+-]?\d+\s*$/.test(code)) {
    throw new DbyError("USAGE", `--command 需要「退出码:命令」格式，拿到 ${JSON.stringify(item)}`, { exit: EXIT.USAGE });
  }
  return { exit: Number(code), cmd };
}

const readUtf8 = (file, what) => {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    throw new DbyError("FILE_UNREADABLE", `读不到${what}：${file}（${e.code ?? e.message}）`, { exit: EXIT.USAGE });
  }
};

export const defaultScopeRoot = () => process.env.HOME || os.homedir();

export function feedbackPrepare({ category, report, out, scopeRoot, agent, command, commandsFile } = {}) {
  if (!CATEGORIES.includes(category)) {
    throw new DbyError("USAGE", `--category 只认 ${CATEGORIES.join("/")}`, { exit: EXIT.USAGE });
  }
  if (!report || !out) throw new DbyError("USAGE", "缺少 --report 或 --out。", { exit: EXIT.USAGE });
  const reportText = readUtf8(report, "报告文件");
  const specs = [
    ...(Array.isArray(command) ? command : command ? [command] : []),
    ...(commandsFile ? readUtf8(commandsFile, "命令清单").split("\n").map((l) => l.trim()).filter(Boolean) : [])
  ];
  const commandsRun = specs.map(parseCommandSpec);
  const root = scopeRoot || defaultScopeRoot();
  const facts = collectMachineFacts(root, agent, commandsRun);
  const config = loadEndpointConfig();
  const serialized = buildPayload(category, reportText, facts, installId(root), config.fields);

  const hits = scanSecrets(serialized);
  if (hits.length) throw secretError(hits); // 命中时载荷不落盘
  const outPath = path.resolve(out);
  writeFileSync(outPath, serialized);
  return {
    data: {
      out: outPath,
      bytes: Buffer.byteLength(serialized),
      category,
      endpointConfigured: !!config.url,
      next: "把 out 文件全文原样给用户过目；用户明确说发，再 `dby feedback submit --file <out> --user-consented`。"
    },
    // 人读形态打的就是写进 --out 的那份，逐字节一致
    human: serialized
  };
}

// ── submit / keep ──────────────────────────────────────────────────────────────
/** 把载荷完整还原成一份人可读的 markdown——报告正文 + 机器事实，一个字不丢。**纯函数**。 */
export function fallbackMarkdown(payload, fields) {
  const facts = {
    [fields.category]: payload[fields.category] ?? null,
    [fields.machineFacts]: payload[fields.machineFacts] ?? null,
    [fields.installId]: payload[fields.installId] ?? null,
    [fields.skillVersion]: payload[fields.skillVersion] ?? null
  };
  return (
    `${payload[fields.report] ?? ""}\n\n---\n\n## 随附机器事实（白名单采集）\n\n\`\`\`json\n` +
    JSON.stringify(facts, null, 2) +
    "\n```\n"
  );
}

const utcStamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

/** 反馈落成本地 markdown，返回绝对路径。端点不通不是弄丢反馈的理由；同秒多份不许互相覆盖。 */
export function writeLocalCopy(payload, fields, scopeRoot) {
  // 比原脚本严：category 来自（可能被改过的）载荷文件，只认三类，其余一律 feedback——不让它拼出路径穿越。
  const raw = payload[fields.category];
  const category = CATEGORIES.includes(raw) ? raw : "feedback";
  const dir = path.resolve(scopeRoot, ".dby", "feedback");
  mkdirSync(dir, { recursive: true });
  const stamp = utcStamp();
  let file = path.join(dir, `${stamp}-${category}.md`);
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `${stamp}-${category}-${n}.md`);
  writeFileSync(file, fallbackMarkdown(payload, fields), { flag: "wx" });
  return file;
}

export const MANUAL_DELIVERY =
  "手动送达方式：到 GitHub 仓库 zizhanovo/doubaoya-community 开一个 issue，把这份文件的内容贴进去；GitHub 访问不畅时用 Gitee 同名仓库。";

/**
 * 读 prepare 的产物：原始文本（原样发送用）+ 解析后的对象（落本地用）。
 * 🔴 先扫凭证再解析：载荷在 prepare 之后被改坏（塞进密钥顺手破坏了 JSON）时，报的必须是
 *    「检测命中」而不是「格式不对」——后者会让人以为重新生成就行，密钥还留在文件里。
 */
function readPayload(file, fields) {
  const text = readUtf8(file, "载荷文件");
  const hits = scanSecrets(text);
  if (hits.length) throw secretError(hits);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Object.hasOwn(payload, fields.report)) {
    throw new DbyError("PAYLOAD_INVALID", `${file} 不是 \`dby feedback prepare\` 产出的载荷。`, {
      exit: EXIT.USAGE,
      remediation:
        "直接给报告：`dby feedback submit --file <报告.md>`（扩展名 .md，内部先 prepare）；或者先 " +
        "`dby feedback prepare --category bug|friction|idea --report <报告.md> --out <载荷.json>`，把载荷全文给用户过目，再 submit 那份载荷。"
    });
  }
  return { text, payload };
}

function savedFailure(code, message, exit, savedTo) {
  const err = new DbyError(code, `${message}，反馈已落本地文件（内容没丢）：${savedTo}`, {
    exit,
    remediation: MANUAL_DELIVERY
  });
  err.data = { delivered: false, savedTo };
  return err;
}

async function post(url, method, body) {
  const headers = { "Content-Type": "application/json", "User-Agent": userAgent() };
  const timeoutMs = 30_000;
  const proxy = resolveProxy(url, process.env); // 回环地址硬豁免；没有代理变量时返回 null
  return proxy
    ? requestViaProxy(proxy, url, { method, headers, body, timeoutMs })
    : fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
}

/** --file 是报告 markdown（而不是 prepare 的载荷 JSON）：按扩展名判，不猜内容。 */
export const isReportMarkdown = (file) => /\.(md|markdown)$/i.test(String(file));
export const DEFAULT_MD_CATEGORY = "bug";

export async function feedbackSubmit(ctx, { file, userConsented, scopeRoot, category, agent } = {}) {
  if (!file) throw new DbyError("USAGE", "缺少 --file（报告 .md，或 prepare 产出的载荷文件）。", { exit: EXIT.USAGE });
  const root = scopeRoot || defaultScopeRoot();
  const config = loadEndpointConfig();
  // 一步式入口（决策者 2026-09-27 裁决）：--file 给报告 .md 时，内部先走一遍 prepare（同一套白名单采集与
  // 凭证/高熵检测），把载荷落在 <报告>.payload.json，再按原流程提交那一份。两步式（prepare → 过目 → submit
  // 载荷）照旧可用，且仍是端点已配置时的推荐做法：用户过目的应当是**载荷全文**（含机器事实），不只是报告。
  let prepared = null;
  if (isReportMarkdown(file)) {
    prepared = feedbackPrepare({ category: category ?? DEFAULT_MD_CATEGORY, report: file, out: `${file}.payload.json`, scopeRoot: root, agent }).data;
    file = prepared.out;
  }
  // 双闸的机器侧在发送前再跑一遍（readPayload 里先扫后解析）：prepare 之后文件若被改过，这里是最后一道扫描。
  const { text, payload } = readPayload(file, config.fields);
  const preparedInfo = prepared ? { preparedPayload: prepared.out } : {};

  // 端点未配置：什么都不出本机 ⇒ 不需要同意，落本地、告知路径、退出码 0。
  if (!config.url) {
    const savedTo = writeLocalCopy(payload, config.fields, root);
    return {
      data: { delivered: false, reason: "endpoint_not_configured", savedTo, manualDelivery: MANUAL_DELIVERY, ...preparedInfo },
      human: `提交端点尚未配置，反馈已落本地文件（内容没丢）：\n${savedTo}\n${MANUAL_DELIVERY}`
    };
  }

  // 🔴 人工闸：没有用户的明确同意就不发送。全局 --confirm 不算——这个开关只在用户看过全文并明确说发之后传。
  if (!userConsented) {
    const err = new DbyError("USER_CONSENT_REQUIRED", "未取得用户明确同意（缺 --user-consented），不发送。", {
      exit: EXIT.CONFIRM,
      remediation:
        `把载荷全文（${file}）原样给用户过目；用户明确说发，再 \`dby feedback submit --file ${file} --user-consented\`。` +
        "拒绝或没回应就别发（想留底用 `dby feedback keep`）。"
    });
    err.data = { delivered: false, payload: file, ...preparedInfo };
    throw err;
  }

  let res;
  try {
    res = await post(config.url, config.method || "POST", text);
  } catch (e) {
    const savedTo = writeLocalCopy(payload, config.fields, root);
    throw savedFailure("FEEDBACK_UNREACHABLE", `提交失败（${e.cause?.code ?? e.code ?? e.message}）`, EXIT.NETWORK, savedTo);
  }
  let envelope = null;
  try {
    envelope = await res.json();
  } catch {
    envelope = null;
  }
  // notice 原样转达（走 stderr，stdout 留给结果）
  if (envelope && typeof envelope === "object" && envelope.notice) process.stderr.write(`[notice] ${envelope.notice}\n`);
  const httpOk = res.status >= 200 && res.status < 300;
  if (httpOk && envelope && typeof envelope === "object" && envelope.success) {
    const requestId = envelope.requestId ?? "";
    return {
      data: { delivered: true, requestId, notice: envelope.notice ?? null, ...preparedInfo },
      human: `已提交。后续追问可引用标识：${requestId}`
    };
  }
  const error = (envelope && typeof envelope === "object" && envelope.error) || {};
  const savedTo = writeLocalCopy(payload, config.fields, root);
  const why = httpOk ? `端点返回失败（${error.code ?? "UNKNOWN"}: ${error.message ?? "无消息"}）` : `端点返回 HTTP ${res.status}`;
  throw savedFailure("FEEDBACK_REJECTED", why, EXIT.GENERAL, savedTo);
}

/** 用户看过全文决定不发、但想留底：只落本地，不发任何请求。 */
export function feedbackKeep({ file, scopeRoot } = {}) {
  if (!file) throw new DbyError("USAGE", "缺少 --file（prepare 产出的载荷文件）。", { exit: EXIT.USAGE });
  const config = loadEndpointConfig();
  const { payload } = readPayload(file, config.fields);
  const savedTo = writeLocalCopy(payload, config.fields, scopeRoot || defaultScopeRoot());
  return { data: { delivered: false, savedTo }, human: savedTo };
}

export function feedbackResetId({ scopeRoot } = {}) {
  installId(scopeRoot || defaultScopeRoot(), { reset: true });
  return { data: { reset: true }, human: "安装标识已重置（旧标识即刻作废）" };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
const SCOPE_FLAG = { value: true, summary: "scope 根（默认家目录；机器事实、安装标识、本地落盘都在它下面）" };

export const commands = [
  {
    group: "feedback", name: "prepare",
    summary: "拼反馈载荷：白名单机器事实 + 报告，过凭证/高熵检测，逐字节写进 --out 供用户过目（纯本地）",
    args: [],
    flags: {
      category: { value: true, summary: "bug | friction | idea（必填）" },
      report: { value: true, summary: "agent 写好的报告 markdown（必填）" },
      out: { value: true, summary: "载荷输出路径（必填；submit 原样发送这份）" },
      "scope-root": SCOPE_FLAG,
      agent: { value: true, summary: "agent 类型，如 claude-code" },
      command: { value: true, multiple: true, summary: "本次执行过的本仓命令，格式「退出码:命令」（与 1.x 一样可多次给）" },
      "commands-file": { value: true, summary: "多条命令时用：每行一条「退出码:命令」" }
    },
    routes: [], billable: false, destructive: false, composite: false, kind: "local",
    run: (ctx, { flags }) => feedbackPrepare(flags)
  },
  {
    group: "feedback", name: "submit",
    summary: "提交反馈：--file 给报告 .md（内部先 prepare）或 prepare 的载荷；端点已配置时需 --user-consented，未配置则落本地、退出码 0",
    args: [],
    flags: {
      file: { value: true, summary: "报告 markdown（.md，一步式）或 prepare 产出的载荷文件（必填）" },
      category: { value: true, summary: `仅 .md 一步式用：bug | friction | idea（默认 ${DEFAULT_MD_CATEGORY}）` },
      agent: { value: true, summary: "仅 .md 一步式用：agent 类型，如 claude-code" },
      "user-consented": { summary: "仅当用户看过全文并明确同意后才传；拒绝或无回应都不许带（--confirm 不算）" },
      "scope-root": SCOPE_FLAG
    },
    // kind=local：不发任何 doubaoya 请求；只有端点已配置且用户同意时才打独立的反馈端点（见文件头）。
    routes: [], billable: false, destructive: false, composite: false, kind: "local",
    run: (ctx, { flags }) => feedbackSubmit(ctx, flags)
  },
  {
    group: "feedback", name: "keep",
    summary: "用户不发但要留底：载荷只落本地 markdown，零请求",
    args: [],
    flags: {
      file: { value: true, summary: "prepare 产出的载荷文件（必填）" },
      "scope-root": SCOPE_FLAG
    },
    routes: [], billable: false, destructive: false, composite: false, kind: "local",
    run: (ctx, { flags }) => feedbackKeep(flags)
  },
  {
    group: "feedback", name: "reset-id",
    summary: "重置反馈用的安装标识（假名标识符，旧标识即刻作废）",
    args: [],
    flags: { "scope-root": SCOPE_FLAG },
    routes: [], billable: false, destructive: false, composite: false, kind: "local",
    run: (ctx, { flags }) => feedbackResetId(flags)
  }
];
