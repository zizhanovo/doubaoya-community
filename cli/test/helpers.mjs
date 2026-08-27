// helpers.mjs — 测试公共层：本地 mock 服务（loopback，不上网）、CLI/旧脚本子进程跑法、fixtures。
// 对拍原则：同一个 mock、同一份 fixture，新 CLI 与旧脚本各跑一遍，断言关键数据字段一致。

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const CLI_BIN = fileURLToPath(new URL("../bin/dby.mjs", import.meta.url));
export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const OLD_WRITE = path.join(REPO_ROOT, "skills/dby-write/scripts/write.mjs");
export const OLD_CHARTER = path.join(REPO_ROOT, "skills/dby-charter/scripts/charter.mjs");
export const OLD_DOUBAOYA = path.join(REPO_ROOT, "skills/dby-api/scripts/doubaoya.mjs");

/** doubaoya 信封。 */
export const ok = (data, extra = {}) => ({ success: true, data, ...extra });
export const fail = (code, message) => ({ success: false, error: { code, message } });

/**
 * 起一个本地 mock 服务。routes: { "GET /api/skills": handler | 信封对象 }。
 * handler(req, url, body) 可返回 { status, json } 或直接信封对象；返回 "HANG" 则永不响应（超时用）。
 * 记录全部命中到 hits：{ method, path, body }。
 */
export async function startMock(routes) {
  const hits = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost");
      const body = raw ? JSON.parse(raw) : undefined;
      hits.push({ method: req.method, path: url.pathname, query: url.search, body });
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify(fail("NOT_FOUND", `mock 无此路由：${req.method} ${url.pathname}`)));
        return;
      }
      const result = typeof route === "function" ? route(req, url, body) : route;
      if (result === "HANG") return; // 挂起不回：模拟超时
      const status = result.status ?? 200;
      const json = result.json ?? result;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  // HANG 路由会留着半开连接；close 时强拆，免得 server.close 等不到而挂住测试。
  const sockets = new Set();
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(r); })
  };
}

/** 跑一个 node 脚本子进程（天然非 TTY），返回 { code, stdout, stderr }。 */
export function runNode(script, args, { env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [script, ...args],
      {
        env: {
          PATH: process.env.PATH, // 只带 PATH，不继承真实 key，环境全由用例显式给
          ...env
        },
        timeout: 30_000
      },
      (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr })
    );
    if (input != null) child.stdin.end(input);
  });
}

export const runCli = (args, opts) => runNode(CLI_BIN, args, opts);

// ── fixtures ─────────────────────────────────────────────────────────────────

export const FIXTURE_SKILL_ITEMS = [
  {
    slug: "content-safety-check",
    operationKey: "tool.contentSafety.checkWords",
    title: "违禁词检测",
    summary: "多平台违禁词",
    unitPrice: 0,
    priceClass: "free",
    execution: { mode: "generic", target: { method: "POST", path: "/api/skills/content-safety-check/invoke" } }
  }
];

// 🔴 fixture 里点名的调用路径必须真实存在于主仓 catalog（validate_community 的调用路由闸
//    扫全仓文本，cli/test 也在内）——所以这里全部用真实 slug，行为仍由本地 mock 决定。
export const FIXTURE_API_ITEMS = [
  {
    platform: "trend",
    slug: "trending-hub-keyword",
    operationKey: "api.trend.hotSpotKeyword",
    title: "综合热点直取",
    summary: "全网热点关键词",
    tags: ["热点"],
    unitPrice: 3,
    priceClass: "standardData",
    execution: { mode: "generic", target: { method: "POST", path: "/api/apis/trend/trending-hub-keyword/call" } }
  }
];

// 真实存在且免费的 skill 能力（免费 ⇒ invoke 不套确认协议）
export const FIXTURE_FREE_SKILL = {
  slug: "wechat-render",
  operationKey: "skill.wechat.render",
  title: "公众号排版",
  summary: "免费排版",
  unitPrice: 0,
  priceClass: "free",
  execution: { mode: "generic", target: { method: "POST", path: "/api/skills/wechat-render/invoke" } }
};

export const FIXTURE_INVOKE_RESULT = { total: 1, items: [{ id: 1, title: "热点A" }], raw: { upstream: "原样回包" } };

/** 能力目录相关的标准路由（api 组测试与确认协议测试共用）。 */
export function catalogRoutes(extra = {}) {
  return {
    "GET /api/skills": ok({ total: FIXTURE_SKILL_ITEMS.length, items: FIXTURE_SKILL_ITEMS }),
    "GET /api/skills/search": ok({ items: FIXTURE_SKILL_ITEMS }),
    "GET /api/skills/wechat-render": ok(FIXTURE_FREE_SKILL),
    "GET /api/apis": ok({ total: FIXTURE_API_ITEMS.length, items: FIXTURE_API_ITEMS }),
    "GET /api/apis/trend/trending-hub-keyword": ok(FIXTURE_API_ITEMS[0]),
    "POST /api/apis/trend/trending-hub-keyword/call": ok(FIXTURE_INVOKE_RESULT),
    "POST /api/skills/wechat-render/invoke": ok(FIXTURE_INVOKE_RESULT),
    ...extra
  };
}

export const FIXTURE_PROFILE = {
  profile: {
    id: "p1",
    name: "测试号",
    personaJson: { tone: "工程师" },
    productsJson: [{ name: "小课", ctaScript: "扫码找我" }],
    writingDnaJson: { version: 1, voiceSystemPrompt: "多用短句，少用感叹号。", taboos: ["赋能", "在当今时代"] }
  }
};

export const FIXTURE_CHARTER = {
  version: 1,
  positioning: { oneLiner: "帮工程师把副业写成资产", niche: "技术成长", tag: "写作" },
  audience: { persona: "有输出欲的后端工程师" },
  monetization: { path: "课程" },
  northStar: { metric: "关注→私聊转化" },
  products: [{ name: "只读投影，PUT 回去会 400" }]
};

export const FIXTURE_SAMPLES = [
  { id: "s1", title: "范文一", sourceUrl: null, wordCount: 1200, content: "范文正文一" },
  { id: "s2", title: "范文二", sourceUrl: "https://x", wordCount: 900, content: "范文正文二" }
];

export const FIXTURE_SPEC = {
  spec: [
    "# 写作规范", "## 一、结构建议", "### 1.1 结构", "- 引用块",
    "### 1.2 平台硬约束（违反会整篇发布失败）", "- 🔴 标题不要写进正文。", "- 表格最多 3~4 列。",
    "### 1.3 文章级结构", "- front matter"
  ].join("\n")
};

export const FIXTURE_MATERIALS = {
  materials: [{ id: "ki_1", proof: "被拒 37 次仍能成单", kind: "material", forms: ["带转折的真实经历"] }],
  reviewConclusions: [{ title: "上周表现最佳《X》" }]
};

// 与 write.mjs selfcheck 同款四篇：A 高·高 / B 低量·高共鸣 / C 高量·低共鸣 / D 低·低
export const FIXTURE_REVIEW_ARTICLES = [
  { title: "A", readCount: 1000, likeCount: 100 },
  { title: "B", readCount: 100, likeCount: 20 },
  { title: "C", readCount: 1000, likeCount: 10 },
  { title: "D", readCount: 100, likeCount: 1 }
];

/** write 组的标准路由。 */
export function writeRoutes(extra = {}) {
  return {
    "GET /api/ip-profile": ok(FIXTURE_PROFILE),
    "GET /api/ip-profile/p1/charter": ok({ charter: FIXTURE_CHARTER, charterUpdatedAt: "2026-08-01T00:00:00.000Z" }),
    "GET /api/ip-profile/p1/samples": ok({ samples: FIXTURE_SAMPLES }),
    "GET /api/wechat/writing-spec": ok(FIXTURE_SPEC),
    "GET /api/materials": ok(FIXTURE_MATERIALS),
    "GET /api/wechat/topics": ok({
      topics: [{ title: "选题一", angle: "切角A", why: "正在热", refs: [1, 2] }],
      notice: "按赛道取的候选"
    }),
    "GET /api/wechat/review": ok({
      account: { nickname: "测试号", appid: "wx1" },
      lastWeek: { articles: FIXTURE_REVIEW_ARTICLES }
    }),
    ...extra
  };
}

/** charter 组的标准路由。PUT 处理器回显收到的 body（用来断言 products 被剥掉）。 */
export function charterRoutes(extra = {}) {
  return {
    "GET /api/ip-profiles": ok({ profiles: [{ id: "p1", isDefault: true, name: "默认号" }] }),
    "GET /api/ip-profile/charter": ok({
      profileId: "p1", charter: FIXTURE_CHARTER, charterUpdatedAt: "2026-08-01T00:00:00.000Z"
    }),
    "PUT /api/ip-profile/p1/charter": (req, url, body) =>
      ok({ charter: body, charterUpdatedAt: "2026-08-02T00:00:00.000Z" }),
    ...extra
  };
}

export const TEST_KEY = "dyh_test_key_never_real";

/** 常用环境：指向 mock、带测试 key。 */
export function envFor(mock, extra = {}) {
  return { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: TEST_KEY, ...extra };
}
