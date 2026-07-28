#!/usr/bin/env node
// Mera · 第二大脑 — zero-dependency client (Node 18+)
//
// 用法:
//   node mera.mjs write    '<json>'        写入第二大脑（{content?, url?, title?}，content/url 二选一）
//   node mera.mjs status   <ingestion_id>  查一次写入的处理状态
//   node mera.mjs remember '<json>'        ⭐ 写入 + 自动退避轮询到终态（写入首选这个）
//   node mera.mjs search   "<关键词>"       在自己的笔记里做混合检索，拿原文素材
//   node mera.mjs ask      '<json>'        基于自己的笔记问答（{query_text, top_k?, conversation_id?}）
//   node mera.mjs self                     取人格内核 + 关键记忆，给回答定调
//
// 钥匙从环境变量读: DOUBAOYA_API_KEY
//   去 https://doubaoya.com → 登录 → 密钥中心 → 生成密钥
// 可选: DOUBAOYA_BASE_URL      覆盖默认 https://doubaoya.com
// 可选: MERA_POLL_BACKOFF_MS   覆盖 remember 的轮询退避（毫秒，逗号分隔；默认 1000,2000,3000,4000）
//
// 约定:
//   成功 → data 的 JSON 打到 stdout，退出码 0
//   失败 → `[error] <code>: <message>` 打到 stderr，退出码 1
//   本脚本绝不打印整条 key。

const BASE_URL = (process.env.DOUBAOYA_BASE_URL || "https://doubaoya.com").replace(/\/+$/, "");
const DEFAULT_BACKOFF_MS = [1000, 2000, 3000, 4000]; // 合计约 10s

// 不用 process.exit()：stdout 走管道时是异步的，exit 会截断已经 console.log 的 JSON。
// 改成「抛 Abort + 设 exitCode」，让事件循环自然排空后退出。
class Abort extends Error {}

function fail(code, message) {
  console.error(`[error] ${code}: ${message}`);
  process.exitCode = 1;
  throw new Abort(code);
}

function warn(code, message) {
  console.error(`[warn] ${code}: ${message}`);
}

function out(value) {
  console.log(JSON.stringify(value, null, 2));
}

function getKey() {
  const key = process.env.DOUBAOYA_API_KEY;
  if (!key) {
    fail(
      "MISSING_API_KEY",
      "未检测到环境变量 DOUBAOYA_API_KEY。去 https://doubaoya.com → 登录 → 密钥中心 → 生成密钥，" +
        '再执行 export DOUBAOYA_API_KEY="dyh_…" 后重试。'
    );
  }
  return key;
}

function pollBackoff() {
  const raw = process.env.MERA_POLL_BACKOFF_MS;
  if (!raw) return DEFAULT_BACKOFF_MS;
  const parsed = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  return parsed.length ? parsed : DEFAULT_BACKOFF_MS;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseBody(raw) {
  if (!raw) return {};
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("VALIDATION_ERROR", '入参不是合法 JSON。示例: \'{"content":"今天想到的一个点子"}\'');
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("VALIDATION_ERROR", "入参必须是一个 JSON 对象。");
  }
  return value;
}

// 统一调用：POST /api/apis/mera/<slug>/call，信封字段全部防御式读取。
async function call(slug, body) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/apis/mera/${slug}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body ?? {})
    });
  } catch (err) {
    fail("NETWORK_ERROR", `无法连接 ${BASE_URL}（${err?.message ?? err}）。检查网络后重试。`);
  }

  let raw = "";
  try {
    raw = await res.text();
  } catch {
    raw = "";
  }

  let envelope = null;
  if (raw) {
    try {
      envelope = JSON.parse(raw);
    } catch {
      envelope = null;
    }
  }
  if (!envelope || typeof envelope !== "object") {
    fail("BAD_RESPONSE", `服务端返回内容无法解析为 JSON（HTTP ${res.status}）。`);
  }

  if (envelope.success !== true) {
    const error = envelope.error && typeof envelope.error === "object" ? envelope.error : {};
    fail(error.code || `HTTP_${res.status}`, error.message || "请求未成功。");
  }

  // data 缺失 / 非对象都不许崩栈，退化成空对象。
  return envelope.data && typeof envelope.data === "object" ? envelope.data : {};
}

function requireContentOrUrl(body) {
  const hasContent = typeof body.content === "string" && body.content.trim() !== "";
  const hasUrl = typeof body.url === "string" && body.url.trim() !== "";
  if (!hasContent && !hasUrl) {
    fail("VALIDATION_ERROR", "content 与 url 至少给一个（二选一）。");
  }
}

// remember = write + 退避轮询 status 到终态。
// 写入是异步的：只调 write 拿到 202 就说「已保存」= 撒谎，所以把轮询包进脚本，别让 agent 自己编排。
async function remember(body) {
  requireContentOrUrl(body);

  const written = await call("note-write", body);
  const ingestionId = written.ingestion_id;
  if (typeof ingestionId !== "string" || !ingestionId) {
    fail("BAD_RESPONSE", "note-write 没返回 ingestion_id，无法确认是否真的写进去了。请稍后用 search 自查。");
  }

  const backoff = pollBackoff();
  let last = { ingestion_id: ingestionId, status: written.status ?? "queued" };

  for (const delay of backoff) {
    await sleep(delay);
    const snapshot = await call("note-status", { ingestion_id: ingestionId });
    last = { ...snapshot, ingestion_id: snapshot.ingestion_id ?? ingestionId };

    if (last.status === "done") {
      out({ ...last, remember_result: "done" });
      return;
    }
    if (last.status === "failed") {
      out({ ...last, remember_result: "failed" });
      fail("INGESTION_FAILED", String(last.error ?? "第二大脑处理失败，原因未知。"));
    }
  }

  const waited = backoff.reduce((sum, ms) => sum + ms, 0);
  out({
    ...last,
    remember_result: "pending",
    remember_note: `已入队但尚未确认完成（等了约 ${Math.round(waited / 1000)} 秒，当前 status=${last.status ?? "unknown"}）。`
  });
  warn(
    "PENDING",
    `写入已入队但尚未确认完成。请稍后用 \`node scripts/mera.mjs status ${ingestionId}\` 复查，` +
      "在拿到 done 之前不要告诉用户「已保存」。"
  );
}

const USAGE = [
  "Mera · 第二大脑 client",
  "",
  "  node mera.mjs remember '<json>'        ⭐ 写入并轮询到终态（{content?, url?, title?}）",
  "  node mera.mjs write    '<json>'        只写入（异步，返回 ingestion_id，需自行轮询）",
  "  node mera.mjs status   <ingestion_id>  查一次处理状态",
  "  node mera.mjs search   \"<关键词>\"       在自己的笔记里检索原文素材",
  "  node mera.mjs ask      '<json>'        基于自己的笔记问答（{query_text, top_k?, conversation_id?}）",
  "  node mera.mjs self                     取人格内核 + 关键记忆",
  "",
  "钥匙: export DOUBAOYA_API_KEY=dyh_...  (doubaoya.com → 密钥中心 → 生成密钥)"
].join("\n");

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "remember":
      await remember(parseBody(rest[0]));
      break;

    case "write": {
      const body = parseBody(rest[0]);
      requireContentOrUrl(body);
      out(await call("note-write", body));
      break;
    }

    case "status": {
      const ingestionId = rest[0];
      if (!ingestionId) fail("VALIDATION_ERROR", "用法: node mera.mjs status <ingestion_id>");
      out(await call("note-status", { ingestion_id: ingestionId }));
      break;
    }

    case "search": {
      const q = rest.join(" ").trim();
      if (!q) fail("VALIDATION_ERROR", '用法: node mera.mjs search "<关键词>"');
      out(await call("note-search", { q }));
      break;
    }

    case "ask": {
      const body = parseBody(rest[0]);
      if (typeof body.query_text !== "string" || !body.query_text.trim()) {
        fail("VALIDATION_ERROR", 'ask 需要 query_text。示例: \'{"query_text":"我对远程办公怎么看"}\'');
      }
      out(await call("ask", body));
      break;
    }

    case "self":
      out(await call("self", {}));
      break;

    default:
      console.log(USAGE);
      if (cmd) process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err instanceof Abort) return;
  console.error(`[error] UNEXPECTED: ${err?.message ?? err}`);
  process.exitCode = 1;
});
