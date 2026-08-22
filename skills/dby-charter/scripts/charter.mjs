#!/usr/bin/env node
// charter.mjs — 都爆鸭 · 号章程读写
// -----------------------------------------------------------------------------
// 章程路由有两个坑，都不是「小心一点就能避开」那种，是**每次都会踩**那种：
//
//   ① GET 回来的 charter 带一个合成的 `products` 键（档案 productsJson 的只读投影），
//      原样 PUT 回去必 400。走「GET → 改 → PUT」时必须先剥掉它。
//   ② PUT 是**全量替换**不是增量 patch。只改一个字段也得把整份传回去，少传的键判缺失 400。
//
// 这两条以前是正文里的红字叮嘱。现在做成代码：
//   `get --for-edit` 吐的就是已剥 products、可直接改的全量 JSON；
//   `put` 无论如何都会再剥一次 products。⇒ 调用方物理上踩不到。
//
// env:  DOUBAOYA_API_KEY（必填，**绝不打印**）  DOUBAOYA_BASE_URL（可选）
// 零依赖（Node ≥18）。章程与档案路由全部免费，不调 LLM、不扣点。
//
// 用法:
//   node scripts/charter.mjs profiles                 列出我的档案
//   node scripts/charter.mjs get                      读默认档案的章程（原样，含 products）
//   node scripts/charter.mjs get --for-edit > c.json  读成「可直接改再 PUT」的形态
//   node scripts/charter.mjs put c.json               全量替换（自动剥 products）
//   node scripts/charter.mjs selfcheck                离线自检，不联网不需要 key
// -----------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import process from "node:process";

const BASE = process.env.DOUBAOYA_BASE_URL || "https://doubaoya.com";

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

/** 坑①：剥掉 GET 合成的只读投影键。纯函数，selfcheck 直接打它。 */
export function stripReadOnlyProjection(charter) {
  if (!charter || typeof charter !== "object") return charter;
  const { products, ...rest } = charter;
  return rest;
}

async function api(path, { method = "GET", body, key } = {}) {
  const headers = { Authorization: `Bearer ${key}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (e) {
    die(`请求失败：${e.message}`);
  }
  const env = await res.json().catch(() => null);
  if (!env) die(`${res.status} 返回不是 JSON`);
  if (!env.success) {
    const { code, message } = env.error || {};
    // CHARTER_INVALID 的 message 是所有校验问题用「；」拼成的完整清单 ——
    // 原样透传，逐条改完一次性重 PUT，别一条一条试。
    const hint = {
      UNAUTHORIZED: "检查 DOUBAOYA_API_KEY，或去密钥中心重新生成。",
      NOT_FOUND: "档案不存在 / 不属于你 / 没有默认档案。先跑 `profiles` 确认 id，或先建档。",
      CHARTER_INVALID: "上面是完整清单，逐条改完**一次性**重 PUT，不要一条一条试。",
      DNA_TOO_LARGE: "writingDnaJson 超 32KB，精简后重试。"
    }[code];
    die(`[${res.status} ${code}] ${message}${hint ? `\n${hint}` : ""}`);
  }
  return env.data;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "selfcheck") return selfcheck();

  const key = process.env.DOUBAOYA_API_KEY;
  if (!key) die("缺 DOUBAOYA_API_KEY。doubaoya.com → 登录 → 密钥中心 → 生成，export 后再跑。");

  const pi = rest.indexOf("--profile");
  const profileId = pi >= 0 ? rest[pi + 1] : null;
  const forEdit = rest.includes("--for-edit");

  if (cmd === "profiles") {
    const { profiles = [] } = await api("/api/ip-profiles", { key });
    if (!profiles.length) return console.error("一个档案都没有。先建档再存章程。");
    for (const p of profiles) {
      console.log(`${p.id}\t${p.isDefault ? "默认" : "    "}\t${p.name ?? ""}`);
    }
    return;
  }

  if (cmd === "get") {
    const path = profileId ? `/api/ip-profile/${profileId}/charter` : "/api/ip-profile/charter";
    const data = await api(path, { key });
    if (data.charter == null) {
      console.error("这个档案还没有章程。先做定位问诊，再 put 一份上去。");
      return process.exit(3);
    }
    const out = forEdit ? stripReadOnlyProjection(data.charter) : data.charter;
    console.log(JSON.stringify(out, null, 2));
    if (forEdit) {
      console.error("↑ 已剥掉只读的 products 键，可直接改完 `put` 回去（PUT 是全量替换）。");
      console.error("  改产品不走这条路由，走档案：PUT /api/ip-profile/:id");
    }
    console.error(`更新于 ${data.charterUpdatedAt ?? "未知"}`);
    return;
  }

  if (cmd === "put") {
    const file = rest.find((a) => !a.startsWith("--") && a !== profileId);
    if (!file) die("用法：node scripts/charter.mjs put <章程.json> [--profile <id>]");
    let doc;
    try {
      doc = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      die(`读不了 ${file}：${e.message}`);
    }
    let id = profileId;
    if (!id) {
      const { profileId: pid } = await api("/api/ip-profile/charter", { key });
      id = pid;
      if (!id) die("拿不到默认档案 id。先跑 `profiles`，再用 --profile 指定。");
    }
    // 坑①再剥一次：哪怕调用方传进来的是没过 --for-edit 的原始 GET 结果，也不让它 400。
    const payload = stripReadOnlyProjection(doc);
    const data = await api(`/api/ip-profile/${id}/charter`, { method: "PUT", body: payload, key });
    console.error(`✅ 已全量替换，更新于 ${data.charterUpdatedAt}`);
    console.log(JSON.stringify(data.charter, null, 2));
    return;
  }

  die(
    "用法：\n" +
      "  node scripts/charter.mjs profiles\n" +
      "  node scripts/charter.mjs get [--profile <id>] [--for-edit]\n" +
      "  node scripts/charter.mjs put <章程.json> [--profile <id>]\n" +
      "  node scripts/charter.mjs selfcheck"
  );
}

/** 离线自检：不联网、不需要 key。退出码即结论。 */
function selfcheck() {
  const withProjection = {
    version: 1,
    positioning: { oneLiner: "x" },
    products: [{ name: "只读投影，PUT 回去会 400" }]
  };
  const stripped = stripReadOnlyProjection(withProjection);

  if ("products" in stripped) die("🔴 products 没被剥掉 —— GET→PUT 回环会 400");
  if (!("positioning" in stripped) || !("version" in stripped))
    die("🔴 剥过头了：别的键被一起删掉，PUT 会因缺键 400");
  if ("products" in withProjection === false) die("🔴 原对象被就地改了，应当返回新对象");

  // 反向：没有 products 的输入必须原样通过（否则 put 会悄悄改内容）
  const clean = { version: 1, positioning: { oneLiner: "x" } };
  if (JSON.stringify(stripReadOnlyProjection(clean)) !== JSON.stringify(clean))
    die("🔴 干净输入被改动了");

  // 破坏演练：证明这个断言不是恒真的
  const fake = (c) => c; // 一个「什么都不剥」的坏实现
  const bad = fake(withProjection);
  if (!("products" in bad)) die("🔴 破坏演练本身失效：坏实现居然也剥掉了");

  console.log("selfcheck ok: stripReadOnlyProjection（剥 products / 不误伤其他键 / 不就地改 / 反向可红）");
}

main().catch((e) => die(`未预期的错误：${e.stack || e.message}`));
