// write-parity.test.mjs — 任务 2.2：`dby write` 对拍 write.mjs（同一 mock、同一 fixture，
// 旧脚本子进程真跑）。契约差异点也在这里钉住：warnings 走 stderr、业务态退出码 3。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startMock, runCli, runNode, writeRoutes, envFor, ok,
  OLD_WRITE, FIXTURE_REVIEW_ARTICLES
} from "./helpers.mjs";
import { prepHuman, reviewHuman } from "../../skills/dby-api/scripts/lib/commands/write.mjs";
import { classify } from "../../skills/dby-api/scripts/lib/write-core.mjs";

test("write prep 对拍：CLI 的 data 与旧脚本 `prep --json` 的输出逐字段一致", async () => {
  const mock = await startMock(writeRoutes());
  try {
    const old = await runNode(OLD_WRITE, ["prep", "--json"], { env: envFor(mock) });
    assert.equal(old.code, 0, old.stderr);
    const oldOut = JSON.parse(old.stdout);

    const now = await runCli(["write", "prep"], { env: envFor(mock) });
    assert.equal(now.code, 0, now.stderr);
    const { data } = JSON.parse(now.stdout);

    // 🔴 最强对拍：整个 out 对象逐字段深比（profileId/charter/samples/voice/taboos/warnings…）
    assert.deepEqual(data, oldOut);
  } finally {
    await mock.close();
  }
});

test("write prep：档案为空 → NO_PROFILE，退出码 3（旧脚本同为 3）", async () => {
  const mock = await startMock({ "GET /api/ip-profile": ok({ profile: null }) });
  try {
    const old = await runNode(OLD_WRITE, ["prep"], { env: envFor(mock) });
    assert.equal(old.code, 3, "旧脚本基线：空档案退出码 3");
    const now = await runCli(["write", "prep"], { env: envFor(mock) });
    assert.equal(now.code, 3);
    const parsed = JSON.parse(now.stdout);
    assert.equal(parsed.error.code, "NO_PROFILE");
    assert.match(parsed.error.remediation, /dby-charter/);
  } finally {
    await mock.close();
  }
});

test("write prep 人类文本：warnings 只进 stderr 行，正文含硬约束整节与口吻基准", () => {
  const data = {
    profileId: "p1", profileName: "测试号", hasCharter: true,
    charter: { positioning: { oneLiner: "一句话" }, audience: {}, monetization: {}, northStar: {} },
    persona: null, products: [], sampleCount: 1,
    samples: [{ id: "s1", title: "范文一", sourceUrl: null, wordCount: 10, content: "x" }],
    voiceSystemPrompt: "多用短句", taboos: ["赋能"],
    writingSpec: { spec: "## 硬约束\n- 别把标题写进正文\n## 其他\n- x" },
    materials: [], reviewConclusions: [],
    warnings: ["范文只有 1 篇（少于 3）—— 补几篇"]
  };
  const { out, warnLines } = prepHuman(data, { materials: [], reviewConclusions: [] });
  assert.ok(!out.includes("范文只有 1 篇"), "警告不进 stdout 正文");
  assert.ok(warnLines.some((l) => l.includes("范文只有 1 篇")), "警告在 stderr 行里");
  assert.ok(out.includes("## 硬约束") && out.includes("别把标题写进正文"), "硬约束整节在正文");
  assert.ok(!out.includes("## 其他"), "硬约束节没切过头");
  assert.ok(out.includes("多用短句") && out.includes("  - 赋能"), "口吻基准与禁用清单在正文");
});

test("write topics 对拍：data.topics 与旧脚本打出的候选一致；notice 走 stderr", async () => {
  const mock = await startMock(writeRoutes());
  try {
    const old = await runNode(OLD_WRITE, ["topics", "AI"], { env: envFor(mock) });
    assert.equal(old.code, 0, old.stderr);
    assert.match(old.stdout, /选题一/);

    const now = await runCli(["write", "topics", "AI"], { env: envFor(mock) });
    assert.equal(now.code, 0);
    const { data } = JSON.parse(now.stdout);
    assert.equal(data.topics.length, 1);
    assert.equal(data.topics[0].title, "选题一");
    assert.equal(data.notice, "按赛道取的候选");
    assert.match(now.stderr, /\[提示\] 按赛道取的候选/);
    // 两边打到服务端的 query 一致
    const qs = mock.hits.filter((h) => h.path === "/api/wechat/topics").map((h) => h.query);
    assert.deepEqual(qs, ["?niche=AI", "?niche=AI"]);
  } finally {
    await mock.close();
  }
});

test("write review 对拍：四象限判定与旧脚本一致（同一 fixture 同一四篇）", async () => {
  const mock = await startMock(writeRoutes());
  try {
    const old = await runNode(OLD_WRITE, ["review"], { env: envFor(mock) });
    assert.equal(old.code, 0, old.stderr);

    const now = await runCli(["write", "review"], { env: envFor(mock) });
    assert.equal(now.code, 0);
    const { data } = JSON.parse(now.stdout);
    assert.equal(data.metricTier, "proxy");
    const quad = Object.fromEntries(data.items.map((i) => [i.title, i.quadrant]));
    // 期望象限是 fixture 的既定事实（与 write.mjs selfcheck 同一组）
    assert.match(quad.A, /^高·高/);
    assert.match(quad.B, /^低量·高共鸣/);
    assert.match(quad.C, /^高量·低共鸣/);
    assert.match(quad.D, /^低·低/);
    // 旧脚本的人类输出里必须能找到同样的「标题↔象限」配对
    for (const [title, q] of Object.entries(quad)) {
      const line = old.stdout.split("\n").find((l) => l.trimEnd().endsWith(`  ${title}`));
      assert.ok(line, `旧脚本输出里有 ${title} 那一行`);
      assert.ok(line.includes(q), `旧脚本把《${title}》也判为 ${q}：${line}`);
    }
    // 基准数值对拍：中位数出现在旧脚本的基准行里
    assert.ok(old.stdout.includes(`阅读 ${data.baseline.medianRead}，点赞率 ${data.baseline.medianRatePct}%`));
    assert.equal(data.reliable, false, "4 篇 < 5，基准不可靠");
    assert.match(now.stderr, /只给一处修复动作/);
  } finally {
    await mock.close();
  }
});

test("write review：no_account / no_articles → 退出码 3（与旧脚本一致），error.code 可判", async () => {
  for (const [state, code] of [["no_account", "NO_ACCOUNT"], ["no_articles", "NO_ARTICLES"]]) {
    const mock = await startMock({ "GET /api/wechat/review": ok({ state, account: { nickname: "x" } }) });
    try {
      const old = await runNode(OLD_WRITE, ["review"], { env: envFor(mock) });
      assert.equal(old.code, 3, `旧脚本 ${state} 基线`);
      const now = await runCli(["write", "review"], { env: envFor(mock) });
      assert.equal(now.code, 3);
      assert.equal(JSON.parse(now.stdout).error.code, code);
    } finally {
      await mock.close();
    }
  }
});

test("classify 纯函数：长尾偏斜下用中位数不用均值（一篇爆款不把其余打成低量）", () => {
  const longTail = [
    ...Array.from({ length: 9 }, (_, i) => ({ title: `T${i}`, readCount: 500, likeCount: 25 })),
    { title: "BOOM", readCount: 50000, likeCount: 2500 }
  ];
  const lt = classify(longTail);
  // 与旧脚本 selfcheck 同判据：低量至多 1 篇（用均值时会是 9 篇——那正是要防的坑）
  assert.ok(lt.items.filter((i) => i.quadrant.startsWith("低")).length <= 1, "一篇爆款不该把其余全部打成低量");
  // readCount 全空拒判
  assert.equal(classify([{ title: "X", readCount: null, likeCount: 50 }]).items.length, 0);
  // 可靠性门槛两侧
  assert.equal(classify(FIXTURE_REVIEW_ARTICLES).reliable, false);
  assert.equal(classify([...FIXTURE_REVIEW_ARTICLES, { title: "E", readCount: 500, likeCount: 50 }]).reliable, true);
});

test("reviewHuman：指标档声明永远在第一行（代理档不许被说成打开率×分享率）", () => {
  const text = reviewHuman({ metricTier: "proxy", reliable: false, baseline: { medianRead: 1, medianRatePct: 1, n: 1 }, items: [] , reason: "没数"});
  assert.match(text.split("\n")[0], /代理档/);
  assert.ok(!text.includes("打开率 × 分享率"));
});

// ── articles 对拍（任务 3.6）：appid 从 /api/wechat/review 现拉，正文从 wechat-history 取 ──────
const HIST_ARTICLES = [
  { articleId: "a1", title: "打开率复盘", url: "https://mp.weixin.qq.com/s/a1", publishedAt: "2026-08-01T00:00:00.000Z", text: "关于打开率的思考" },
  { articleId: "a2", title: "降权应对", url: "https://mp.weixin.qq.com/s/a2", publishedAt: "2026-08-02T00:00:00.000Z", content: "<p>关于降权的经验</p>" }
];

test("write articles 对拍：往期文章清单与旧脚本一致，appid 取自 review 再打 wechat-history", async () => {
  const mock = await startMock(writeRoutes({
    "GET /api/ip-profile/wechat-history": ok({ articles: HIST_ARTICLES })
  }));
  try {
    const old = await runNode(OLD_WRITE, ["articles"], { env: envFor(mock) });
    assert.equal(old.code, 0, old.stderr);
    assert.match(old.stdout, /打开率复盘/);
    assert.match(old.stdout, /降权应对/);

    const now = await runCli(["write", "articles"], { env: envFor(mock) });
    assert.equal(now.code, 0, now.stderr);
    const { data } = JSON.parse(now.stdout);
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].title, "打开率复盘");
    assert.equal(data.items[1].title, "降权应对");
    // 正文里的 HTML 标签要被去掉（老脚本同一份 filterArticles 逻辑）
    assert.equal(data.items[1].text, "关于降权的经验");

    // 两边都先打 review 拿 appid=wx1，再打 wechat-history?authorizerAppid=wx1&count=20
    const hist = mock.hits.filter((h) => h.path === "/api/ip-profile/wechat-history");
    assert.equal(hist.length, 2, "新旧各打一次");
    for (const h of hist) assert.equal(h.query, "?authorizerAppid=wx1&count=20");
  } finally {
    await mock.close();
  }
});

test("write articles --q 按关键词筛：标题/正文命中，两边一致", async () => {
  const mock = await startMock(writeRoutes({
    "GET /api/ip-profile/wechat-history": ok({ articles: HIST_ARTICLES })
  }));
  try {
    const old = await runNode(OLD_WRITE, ["articles", "--q", "降权"], { env: envFor(mock) });
    assert.equal(old.code, 0, old.stderr);
    assert.match(old.stdout, /降权应对/);
    assert.ok(!old.stdout.includes("打开率复盘"));

    const now = await runCli(["write", "articles", "--q", "降权"], { env: envFor(mock) });
    assert.equal(now.code, 0, now.stderr);
    const { data } = JSON.parse(now.stdout);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].title, "降权应对");
  } finally {
    await mock.close();
  }
});

test("write articles --id 取单篇正文：两边一致；序号越界 → 退出码 3（与旧脚本一致）", async () => {
  const mock = await startMock(writeRoutes({
    "GET /api/ip-profile/wechat-history": ok({ articles: HIST_ARTICLES })
  }));
  try {
    const old = await runNode(OLD_WRITE, ["articles", "--id", "1"], { env: envFor(mock) });
    assert.equal(old.code, 0, old.stderr);
    assert.match(old.stdout, /打开率复盘/);
    assert.match(old.stdout, /关于打开率的思考/);

    const now = await runCli(["write", "articles", "--id", "1"], { env: envFor(mock) });
    assert.equal(now.code, 0, now.stderr);
    const { data } = JSON.parse(now.stdout);
    assert.equal(data.article.title, "打开率复盘");
    assert.equal(data.article.text, "关于打开率的思考");

    const oldMiss = await runNode(OLD_WRITE, ["articles", "--id", "99"], { env: envFor(mock) });
    assert.equal(oldMiss.code, 3, "旧脚本基线：序号越界退出码 3");
    const nowMiss = await runCli(["write", "articles", "--id", "99"], { env: envFor(mock) });
    assert.equal(nowMiss.code, 3);
    assert.equal(JSON.parse(nowMiss.stdout).error.code, "ARTICLE_NOT_FOUND");
  } finally {
    await mock.close();
  }
});

test("write articles：账号未绑定 → 退出码 3（与旧脚本一致）", async () => {
  const mock = await startMock({ "GET /api/wechat/review": ok({ state: "no_account" }) });
  try {
    const old = await runNode(OLD_WRITE, ["articles"], { env: envFor(mock) });
    assert.equal(old.code, 3, old.stderr);
    const now = await runCli(["write", "articles"], { env: envFor(mock) });
    assert.equal(now.code, 3);
    assert.equal(JSON.parse(now.stdout).error.code, "NO_ACCOUNT");
  } finally {
    await mock.close();
  }
});
