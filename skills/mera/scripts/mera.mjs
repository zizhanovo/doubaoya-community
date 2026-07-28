#!/usr/bin/env node
// Mera · 第二大脑 — zero-dependency client (Node 18+)
//
// 用法:
//   node mera.mjs write    '<json>'        写入第二大脑（{content?, url?, title?}，content/url 二选一）
//   node mera.mjs status   <ingestion_id>  查一次写入的处理状态
//   node mera.mjs remember '<json>'        ⭐ 写入 + 自动退避轮询到终态（写入首选这个）
//   node mera.mjs search   "<关键词>"       在自己的笔记里做混合检索，拿命中片段与位置
//   node mera.mjs read     '<json>'        ⭐ 按窗口读原文（{source_id, from?, to?} 或直接喂 search 命中的 char_start/char_end）
//   node mera.mjs ask      '<json>'        服务端问答（已降级，只在要证据分级 / 要留会话记录时用）
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

function validateWriteBody(body) {
  const hasContent = typeof body.content === "string" && body.content.trim() !== "";
  const hasUrl = typeof body.url === "string" && body.url.trim() !== "";
  if (!hasContent && !hasUrl) {
    fail("VALIDATION_ERROR", "content 与 url 至少给一个（二选一）。");
  }
  // url 模式下服务端硬用抓到的页面标题，客户端这几个字段会被静默丢掉 —— 丢之前先吭一声。
  if (hasUrl) {
    const ignored = ["title", "source_type", "origin_uri"].filter((key) => body[key] !== undefined);
    if (ignored.length) {
      warn(
        "IGNORED_FIELDS",
        `url 模式下服务端会忽略 ${ignored.join(" / ")}（标题以抓回来的页面标题为准）。别告诉用户标题按他给的存了。`
      );
    }
  }
}

// 读原文的默认窗口：命中点前留 500 字（往往交代了「这是在说什么」），后留 1500 字（结论通常在命中点之后）。
// search 的 snippet 只有 240 字，而一个 chunk 能到 2000 字，答案经常就落在片段外面——所以默认要开得比命中区间宽。
const WINDOW_BEFORE = 500;
const WINDOW_AFTER = 1500;
const WINDOW_MAX = 20000; // 服务端单窗口上限，没有任何位置线索时的兜底窗口

// from/to 一律由脚本算好并显式发出（服务端虽有 0/20000 兜底，但不依赖它）。
// 可以直接把 search 命中的 char_start / char_end 喂进来；显式给的 from / to 永远优先。
function resolveWindow(body) {
  const int = (value) => (Number.isFinite(value) && Number.isInteger(value) ? value : null);
  const charStart = int(body.char_start);
  const charEnd = int(body.char_end);

  let from = int(body.from);
  if (from === null) from = charStart === null ? 0 : Math.max(0, charStart - WINDOW_BEFORE);

  let to = int(body.to);
  if (to === null) to = charEnd === null ? WINDOW_MAX : charEnd + WINDOW_AFTER;

  if (from < 0) fail("VALIDATION_ERROR", "from 不能是负数。");
  if (to <= from) fail("VALIDATION_ERROR", `窗口是空的（from=${from}, to=${to}），to 必须大于 from。`);
  return { from, to };
}

const NO_EVIDENCE_NOTICE = "你的笔记里没有能支撑这个问题的内容。";
// Mera 在无证据时返回的英文硬编码占位句（不是回答内容）。
const UNSUPPORTED_ANSWER_EN = /^I could not find any supported evidence/i;

// evidence_level === "none" ⟺ has_evidence === false ⟺ citations 为空（Mera 侧三者恒等价）。
// 注意：别拿 evidence.grade === "待核实" 当判据 —— reference 级（确实检索到了用户原文）也是这个 grade。
function markNoEvidence(data) {
  const citations = Array.isArray(data.citations) ? data.citations : null;
  const noEvidence =
    data.evidence_level === "none" || data.has_evidence === false || (citations !== null && citations.length === 0);
  if (!noEvidence) return data;

  const result = {
    ...data,
    no_evidence: true,
    answer_notice: `${NO_EVIDENCE_NOTICE}要明说这一点，再决定要不要用你自己的常识补一句（补了必须标明那是你的判断）。`
  };
  // ponytail: 只在命中那句英文占位符时替换 answer —— 它是占位符不是内容，原样转述等于甩一句英文给中文用户。
  // 天花板：Mera 改了文案就匹配不中；届时 answer 原样保留，但 no_evidence / answer_notice / stderr 照常报，agent 不会漏。
  //
  // 🔒 不再把上游原句抄进 answer_upstream。读 stdout 的是 LLM agent，JSON 里**任何一个字符串**它都可能
  // 转述给用户，一句「这是排查用的原件、不转述」的注释拦不住 —— 唯一可靠的做法是那句英文**根本不出现在
  // stdout 里**。而它是个常量，留着也零排查价值：no_evidence:true + stderr 的 [warn] NO_EVIDENCE 已经
  // 把「走的是无证据分支」记全了；没命中占位符时 answer 本就原样未改，副本纯属重复。
  if (typeof data.answer === "string" && UNSUPPORTED_ANSWER_EN.test(data.answer.trim())) {
    result.answer = NO_EVIDENCE_NOTICE;
  }
  warn(
    "NO_EVIDENCE",
    `${NO_EVIDENCE_NOTICE}这次问答没有任何 citation，别把 answer 当成用户的观点转述，也别编出处。`
  );
  return result;
}

// remember = write + 退避轮询 status 到终态。
// 写入是异步的：只调 write 拿到 202 就说「已保存」= 撒谎，所以把轮询包进脚本，别让 agent 自己编排。
async function remember(body) {
  validateWriteBody(body);

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
  "  node mera.mjs search   \"<关键词>\"       检索，拿命中片段与位置（char_start/char_end）",
  "  node mera.mjs read     '<json>'        ⭐ 按窗口读原文（{source_id, from?, to?}，或直接喂 char_start/char_end）",
  "  node mera.mjs ask      '<json>'        服务端问答（已降级：只在要证据分级 / 要留会话记录时用）",
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
      validateWriteBody(body);
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

    case "read": {
      const body = parseBody(rest[0]);
      const sourceId = body.source_id;
      if (typeof sourceId !== "string" || !sourceId.trim()) {
        fail("VALIDATION_ERROR", 'read 需要 source_id（用 search 结果里的 id）。示例: \'{"source_id":"…","char_start":120,"char_end":400}\'');
      }
      const { from, to } = resolveWindow(body);
      const data = await call("source-read", { source_id: sourceId, from, to });
      // 按 id 直读是唯一能读到已归档来源的路径（列表和检索都排除它们）。不拦截，但绝不静默。
      if (data.archived_at !== null && data.archived_at !== undefined) {
        warn(
          "ARCHIVED",
          `这条来源已归档（archived_at=${data.archived_at}），用户可能已经把它删了。` +
            "引用之前先跟用户说明这一点，别把它当成还在用的笔记。"
        );
      }
      // 别静默截断：窗口没读完时说清楚全文有多长、下一个窗口从哪开始。
      //
      // 续读起点必须用「本次 from + 实际读到的长度」推进。
      // 响应里的 to 是请求原样回显、不是实际窗口终点：截断时实际窗口只到 from+20000，
      // 按回显的 to 续读会跳空中间一大段 —— 那正是 truncated 本该防住的数据丢失。
      if (data.truncated === true) {
        const readLength = typeof data.content === "string" ? data.content.length : null;
        const howToContinue =
          readLength === null
            ? "要接着读就把窗口调小一点再读一次。"
            : `要接着读就再开一个窗口：from=${from + readLength}（＝本次 from ＋ 实际读到的长度；` +
              "别拿响应里的 to 当续读起点，那是请求的原样回显)。";
        warn(
          "TRUNCATED",
          `这个窗口被服务端 20000 字上限截断了，后面还有内容（全文共 ${data.content_length ?? "未知"} 字）。` +
            `${howToContinue}别把这一窗当成全文。`
        );
      }
      out(data);
      break;
    }

    case "ask": {
      const body = parseBody(rest[0]);
      if (typeof body.query_text !== "string" || !body.query_text.trim()) {
        fail("VALIDATION_ERROR", 'ask 需要 query_text。示例: \'{"query_text":"我对远程办公怎么看"}\'');
      }
      out(markNoEvidence(await call("ask", body)));
      break;
    }

    case "self": {
      const data = await call("self", {});
      const core = data.core && typeof data.core === "object" ? data.core : {};
      // persona_core 为 null 是正常状态（从没跑过整理），不是错误 —— 但绝不许 agent 就此脑补用户是什么样的人。
      if (core.persona_core === null || core.persona_core === undefined) {
        warn(
          "NO_PERSONA_CORE",
          "这个账号还没有人格内核（从没跑过整理）。别脑补他是什么样的人：如实告诉他去 https://mera.doubaoya.com 跑一次整理，" +
            "这一轮就先只用 memories 里的关键记忆。"
        );
      }
      out(data);
      break;
    }

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
