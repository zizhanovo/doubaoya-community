#!/usr/bin/env node
// 都爆鸭 · doubaoya — zero-dependency reference client (Node 18+)
//
// 用法:
//   node doubaoya.mjs invoke <slug> '<json-body>'   调一个操作
//   node doubaoya.mjs list                          拉全部操作清单
//   node doubaoya.mjs search <query>                按关键词搜操作
//   node doubaoya.mjs describe <slug>               看单个操作入参/出参
//
// 钥匙从环境变量读: DOUBAOYA_API_KEY
//   去 https://doubaoya.com → 登录 → 口令中心 → 生成口令
//
// 本脚本绝不打印整条 key（只在出错时露前缀）。

const BASE_URL = "https://doubaoya.com";

function getKey() {
  const key = process.env.DOUBAOYA_API_KEY;
  if (!key) {
    fail(
      "缺少 DOUBAOYA_API_KEY。去 https://doubaoya.com → 登录 → 口令中心 → 生成口令，" +
        "然后 `export DOUBAOYA_API_KEY=dyh_...`"
    );
  }
  return key;
}

function maskKey(key) {
  return key.length > 8 ? `${key.slice(0, 8)}…` : "（已隐藏）";
}

function fail(message, code = "") {
  console.error(code ? `[${code}] ${message}` : message);
  process.exit(1);
}

async function request(method, path, body) {
  const headers = { Authorization: `Bearer ${getKey()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    fail(`网络请求失败: ${err.message}`);
  }

  let env;
  try {
    env = await res.json();
  } catch {
    fail(`返回不是合法 JSON (HTTP ${res.status})`);
  }

  if (!env || env.success !== true) {
    const code = env?.error?.code ?? `HTTP_${res.status}`;
    const msg = env?.error?.message ?? "未知错误";
    if (code === "MISSING_API_KEY" || code === "UNAUTHORIZED") {
      fail(
        `${msg}（当前 key ${maskKey(getKey())}）。请在 doubaoya.com 口令中心撤销并重新生成，再更新 DOUBAOYA_API_KEY。`,
        code
      );
    }
    fail(msg, code);
  }

  return env.data;
}

function parseBody(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    fail("入参不是合法 JSON。示例: '{\"keyword\":\"美食\"}'");
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "invoke": {
      const slug = rest[0];
      if (!slug) fail("用法: node doubaoya.mjs invoke <slug> '<json-body>'");
      const data = await request("POST", `/api/skills/${slug}/invoke`, parseBody(rest[1]));
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "list": {
      const data = await request("GET", "/api/skills");
      for (const s of data.items ?? []) {
        console.log(`${s.slug.padEnd(28)} ${s.category ?? ""}\t${s.title ?? ""}`);
      }
      break;
    }
    case "search": {
      const query = rest.join(" ");
      if (!query) fail("用法: node doubaoya.mjs search <query>");
      const data = await request("GET", `/api/skills/search?query=${encodeURIComponent(query)}`);
      for (const s of data.items ?? []) {
        console.log(`${s.slug.padEnd(28)} ${s.title ?? ""}`);
      }
      break;
    }
    case "describe": {
      const slug = rest[0];
      if (!slug) fail("用法: node doubaoya.mjs describe <slug>");
      const data = await request("GET", `/api/skills/${slug}`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    default:
      console.log(
        [
          "都爆鸭 · doubaoya client",
          "",
          "  node doubaoya.mjs invoke <slug> '<json-body>'   调一个操作",
          "  node doubaoya.mjs list                          拉全部操作清单",
          "  node doubaoya.mjs search <query>                按关键词搜操作",
          "  node doubaoya.mjs describe <slug>               看单个操作入参/出参",
          "",
          "钥匙: export DOUBAOYA_API_KEY=dyh_...  (doubaoya.com → 口令中心 → 生成口令)"
        ].join("\n")
      );
      process.exit(cmd ? 1 : 0);
  }
}

main();
