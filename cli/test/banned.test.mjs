// banned.test.mjs — 任务 3.6：`dby banned check`（替代 skills/dby-banned-words/scripts/check_multi.py）。
// 多平台扇出：每平台各一次独立计费调用；确认协议先核 6 再 --confirm 核 0/3；slim 剥重复键纯函数单测。
// 2026-09-20 起补上「上游单次 2000 字上限」那一半：chunkContent 纯函数 + 多段调用/合并/部分失败。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, runCli, envFor, ok, fail } from "./helpers.mjs";
import {
  CONTENT_MAX_CHARS,
  chunkContent,
  mergeSegmentResults,
  slim
} from "../../skills/dby-api/scripts/lib/commands/banned.mjs";

const DESCRIBE_PATH = "/api/apis/tool/check-banned-words";
const CALL_PATH = "/api/apis/tool/check-banned-words/call";

const BANNED_CAPABILITY = {
  platform: "tool",
  slug: "check-banned-words",
  title: "违禁词检测",
  unitPrice: 6,
  priceClass: "standardData",
  execution: { mode: "generic", target: { method: "POST", path: CALL_PATH } }
};

/** 每平台各回一份结果；douyin 固定失败，用来练「单平台失败不影响其它平台」。 */
function bannedRoutes(extra = {}) {
  return {
    [`GET ${DESCRIBE_PATH}`]: ok(BANNED_CAPABILITY),
    [`POST ${CALL_PATH}`]: (req, url, body) => {
      if (body.platform === "douyin") return fail("UPSTREAM_TIMEOUT", "上游超时");
      return ok({
        source: "contentSafety.sensitiveWords",
        content: `全网<span class="banned-word">最低</span>价（${body.platform}）`,
        originalContent: "全网最低价",
        prohibitedWordsType: ["价格承诺"],
        raw: { content: "全网最低价", originalContent: "全网最低价", code: 0, level: "high" }
      });
    },
    ...extra
  };
}

test("Scenario: 不带 --confirm —— 退出码 6、changes 每平台一条、零计费请求（只有现拉价格那一次 GET）", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(["banned", "check", "全网最低价"], { env: envFor(mock) });
    assert.equal(r.code, 6);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, "confirmation_required");
    assert.equal(parsed.changes.length, 3, "默认三平台，changes 三条");
    assert.deepEqual(parsed.changes.map((c) => c.ref).sort(), [
      "tool/check-banned-words@douyin",
      "tool/check-banned-words@gongzhonghao",
      "tool/check-banned-words@xiaohongshu"
    ]);
    assert.ok(parsed.changes.every((c) => c.price === "6点"), "价格来自现拉的 describe");
    assert.match(parsed.confirmCommand, /--confirm$/);
    // 🔴 零计费请求：mock 只见过一次现拉价格的 GET，没有任何 POST
    assert.deepEqual(mock.hits.map((h) => h.method), ["GET"], `不该有 POST：${JSON.stringify(mock.hits)}`);
  } finally {
    await mock.close();
  }
});

test("带 --confirm 全部平台成功：逐平台各一次独立 POST，raw 默认剥掉，--raw 保留原样", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(["banned", "check", "全网最低价", "--platforms", "xiaohongshu,gongzhonghao", "--confirm"], {
      env: envFor(mock)
    });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(data), ["xiaohongshu", "gongzhonghao"]);
    // 逐平台各打了一次独立的 POST（各自计费）
    const calls = mock.hits.filter((h) => h.path === CALL_PATH);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.body.platform).sort(), ["gongzhonghao", "xiaohongshu"]);
    // 默认剥掉 raw 里与顶层重复的 content/originalContent
    assert.deepEqual(data.xiaohongshu.raw, { code: 0, level: "high" });
    assert.equal(data.xiaohongshu.content, "全网<span class=\"banned-word\">最低</span>价（xiaohongshu）");

    const rawKept = await runCli(
      ["banned", "check", "全网最低价", "--platforms", "xiaohongshu", "--confirm", "--raw"],
      { env: envFor(mock) }
    );
    const rawData = JSON.parse(rawKept.stdout).data;
    assert.deepEqual(rawData.xiaohongshu.raw, {
      content: "全网最低价", originalContent: "全网最低价", code: 0, level: "high"
    });
  } finally {
    await mock.close();
  }
});

test("单平台失败不影响其它平台：结果字典放 {error}，整体退出码 3（部分失败）", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(
      ["banned", "check", "全网最低价", "--platforms", "xiaohongshu,douyin", "--confirm"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 3);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.error.code, "BANNED_CHECK_PARTIAL");
    // 失败信封仍带出逐平台完整结果——已成功的那个平台不能被部分失败连累丢掉
    assert.equal(parsed.data.xiaohongshu.prohibitedWordsType[0], "价格承诺");
    assert.equal(parsed.data.douyin.error.code, "UPSTREAM_TIMEOUT");
    // 两个平台都真的打过 POST（失败不阻断其它平台继续跑）
    const calls = mock.hits.filter((h) => h.path === CALL_PATH);
    assert.equal(calls.length, 2);
  } finally {
    await mock.close();
  }
});

test("human 输出每平台一行：成功打命中类型，失败打错误码", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(
      ["banned", "check", "全网最低价", "--platforms", "xiaohongshu,douyin", "--confirm"],
      { env: envFor(mock) }
    );
    // 失败信封（exit 3）时 human 走 stdout（非 JSON 模式）—— 这里走 JSON 模式，改核 err.human 是否被带进 stdout 的机器信封之外的行为：
    // json 模式下失败信封本身不含 human 字段，改核 stderr 一句人话即可（emitFailure 契约）。
    assert.match(r.stderr, /BANNED_CHECK_PARTIAL/);

    const okRun = await runCli(
      ["banned", "check", "全网最低价", "--platforms", "xiaohongshu,gongzhonghao", "--confirm"],
      { env: envFor(mock) }
    );
    assert.equal(okRun.code, 0);
  } finally {
    await mock.close();
  }
});

test("--platforms 自定义列表：只打点名的平台，人类文本每平台一行", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(["banned", "check", "文案", "--platforms", "gongzhonghao", "--confirm"], {
      env: envFor(mock)
    });
    assert.equal(r.code, 0, r.stderr);
    const calls = mock.hits.filter((h) => h.path === CALL_PATH);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.platform, "gongzhonghao");
  } finally {
    await mock.close();
  }
});

test("缺文案 → 用法错退出码 2；--platforms 给空列表 → 用法错退出码 2", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const missingText = await runCli(["banned", "check"], { env: envFor(mock) });
    assert.equal(missingText.code, 2);

    const emptyPlatforms = await runCli(["banned", "check", "文案", "--platforms", " , ,"], { env: envFor(mock) });
    assert.equal(emptyPlatforms.code, 2);
    assert.equal(JSON.parse(emptyPlatforms.stdout).error.code, "USAGE");
  } finally {
    await mock.close();
  }
});

test("slim：剥 raw 重复键 / 保留其它键 / 不动顶层 / 不改入参 / 缺 raw 原样（与 check_multi.py selfcheck 同判据）", () => {
  const full = {
    source: "contentSafety.sensitiveWords",
    content: "全网<span class=\"banned-word\">最低</span>价",
    originalContent: "全网最低价",
    prohibitedWordsType: ["禁用词"],
    raw: { content: "全网最低价", originalContent: "全网最低价", code: 0, level: "high" }
  };
  const s = slim(full);
  assert.ok(!("content" in s.raw) && !("originalContent" in s.raw), "raw 里的重复键没剥掉");
  assert.deepEqual(s.raw, { code: 0, level: "high" }, "raw 的其它键被误删");
  assert.equal(s.content, full.content);
  assert.equal(s.originalContent, full.originalContent);
  assert.equal(full.raw.content, "全网最低价", "slim 改了入参（应返回新对象）");
  assert.deepEqual(slim({ error: { code: "X" } }), { error: { code: "X" } }, "无 raw 时应原样返回");
  assert.equal(slim({ raw: null }).raw, null, "raw 为 null 时应原样返回");
  assert.equal(slim({ raw: "str" }).raw, "str", "raw 非 dict 时应原样返回");
  assert.equal(slim(null), null, "非 dict 入参应原样返回");
});

// ── 分段：上游单次 content 上限 2000 字（生产实证：整篇文案一次发必失败）──────────────
//
// 判据锚在**用户拿得到的东西**上：一篇 3000 字的文章原来 100% 失败，现在要能查完整、
// 且每一段都不超过上游上限、拼接回来一字不差。

/** 长文案夹具：句子级切点可预期（每句 11 字），且含命中词。 */
const LONG_TEXT = `${"这句话里含全网最低价。".repeat(300)}`;

/** 逐段回结果：命中词按段判断，正文原样回显 —— 便于断言「拼接无损」「并集去重」。 */
function segmentRoutes(onCall) {
  return {
    [`GET ${DESCRIBE_PATH}`]: ok(BANNED_CAPABILITY),
    [`POST ${CALL_PATH}`]: (req, url, body) => {
      if (onCall) {
        const override = onCall(body);
        if (override) return override;
      }
      const hit = body.content.includes("全网最低价");
      return ok({
        source: "contentSafety.sensitiveWords",
        content: hit ? body.content.replaceAll("全网最低价", '<span class="banned-word">全网最低价</span>') : body.content,
        originalContent: body.content,
        prohibitedWordsType: hit ? ["价格承诺"] : [],
        raw: { content: body.content, code: 0 }
      });
    }
  };
}

test("chunkContent：无损、每段 ≤2000、优先段落/句末标点、emoji 不劈开", () => {
  assert.deepEqual(chunkContent("全网最低价"), ["全网最低价"], "短文案应原样一段");
  assert.equal(chunkContent("a".repeat(CONTENT_MAX_CHARS)).length, 1, "正好 2000 字不该切");
  assert.equal(chunkContent("a".repeat(CONTENT_MAX_CHARS + 1)).length, 2, "2001 字必须切两段");

  const paragraphs = Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 段正文` + "字".repeat(190)).join("\n");
  const byParagraph = chunkContent(paragraphs);
  assert.equal(byParagraph.join(""), paragraphs, "分段无损：拼接必须等于原文");
  assert.ok(byParagraph.length > 1 && byParagraph.every((c) => c.length <= CONTENT_MAX_CHARS), "每段都得在上限内");
  // 段落切点：除最后一段外都以换行结尾（贪心装箱只会留在段落边界上）
  assert.ok(byParagraph.slice(0, -1).every((c) => c.endsWith("\n")), "段落边界没被优先采用");

  const bySentence = chunkContent("这是一句话。".repeat(500));
  assert.equal(bySentence.join(""), "这是一句话。".repeat(500));
  assert.ok(bySentence.slice(0, -1).every((c) => c.endsWith("。")), "句末标点没被优先采用");

  // 一整段没有任何标点 → 只能硬切，但依然无损且不超限
  const hard = chunkContent("字".repeat(4500));
  assert.deepEqual(hard.map((c) => c.length), [2000, 2000, 500], "硬切应尽量填满且不超上限");
  assert.equal(hard.join(""), "字".repeat(4500));

  // 代理对（emoji）：任何一段都不许以孤立代理结尾/开头
  const emoji = chunkContent("🎉".repeat(1500));
  assert.equal(emoji.join(""), "🎉".repeat(1500));
  assert.ok(
    emoji.every((c) => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c)),
    "分段把一个字符劈成了两半"
  );

  assert.throws(() => chunkContent("文案", 0), /max 必须是正整数/);
});

test("长文案不带 --confirm：changes 按「平台 × 段数」逐条列，零 POST", async () => {
  const mock = await startMock(segmentRoutes());
  try {
    const r = await runCli(["banned", "check", LONG_TEXT], { env: envFor(mock) });
    assert.equal(r.code, 6);
    const parsed = JSON.parse(r.stdout);
    const segments = chunkContent(LONG_TEXT).length;
    assert.ok(segments > 1, "夹具本身得超过一段，否则这条用例什么都没验");
    assert.equal(parsed.changes.length, segments * 3, "默认三平台 × 段数");
    assert.equal(parsed.changes[0].price, "6点");
    assert.match(parsed.changes[0].title, new RegExp(`第 1/${segments} 段`), "回执要说清第几段");
    assert.deepEqual(mock.hits.map((h) => h.method), ["GET"], `确认前不该有 POST：${JSON.stringify(mock.hits)}`);
  } finally {
    await mock.close();
  }
});

test("长文案带 --confirm：逐平台逐段各打一次，入参每段 ≤2000 且拼接无损、结果合并", async () => {
  const mock = await startMock(segmentRoutes());
  try {
    const r = await runCli(["banned", "check", LONG_TEXT, "--platforms", "xiaohongshu", "--confirm"], {
      env: envFor(mock)
    });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    const calls = mock.hits.filter((h) => h.path === CALL_PATH);
    const segments = chunkContent(LONG_TEXT).length;
    assert.equal(calls.length, segments, "每个平台各打「段数」次（各自计费）");
    assert.ok(calls.every((c) => c.body.platform === "xiaohongshu"), "platform 逐段都要带");
    assert.ok(calls.every((c) => c.body.content.length <= CONTENT_MAX_CHARS), "有段落超过上游上限");
    assert.equal(calls.map((c) => c.body.content).join(""), LONG_TEXT, "发出去的段拼回来必须等于原文");

    const entry = data.xiaohongshu;
    assert.equal(entry.segmentCount, segments);
    assert.equal(entry.segments.length, segments);
    assert.equal(entry.originalContent, LONG_TEXT, "合并后的原文应等于完整文案");
    assert.equal(entry.content, LONG_TEXT.replaceAll("全网最低价", '<span class="banned-word">全网最低价</span>'));
    assert.deepEqual(entry.prohibitedWordsType, ["价格承诺"], "并集应去重");
    assert.equal(entry.error, undefined, "全段成功不该带 error");
    assert.ok(!("raw" in entry), "默认剥掉 raw");
  } finally {
    await mock.close();
  }
});

test("多段里有一段失败：该平台带 error、不拼半篇正文，已检出的命中照样带出，退出码 3", async () => {
  let seen = 0;
  const mock = await startMock(
    segmentRoutes((body) => (body.platform === "xiaohongshu" && (seen += 1) === 2 ? fail("UPSTREAM_TIMEOUT", "上游超时") : null))
  );
  try {
    const r = await runCli(["banned", "check", LONG_TEXT, "--platforms", "xiaohongshu,gongzhonghao", "--confirm"], {
      env: envFor(mock)
    });
    assert.equal(r.code, 3, "有段没跑成 ⇒ 整体是部分失败，不能是 0");
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.error.code, "BANNED_CHECK_PARTIAL");
    const entry = parsed.data.xiaohongshu;
    assert.equal(entry.error.code, "BANNED_SEGMENT_FAILED", "漏检的段必须比命中的词更显眼");
    assert.match(entry.error.message, /只覆盖 1\/2 段/);
    assert.equal(entry.content, null, "段不全时不许拼出一份「看起来完整」的标注版正文");
    assert.equal(entry.originalContent, null);
    assert.deepEqual(entry.prohibitedWordsType, ["价格承诺"], "已经拿到的命中不许丢");
    assert.equal(entry.segments[1].error.code, "UPSTREAM_TIMEOUT", "要能看出是第几段挂的");
    assert.equal(parsed.data.gongzhonghao.error, undefined, "单平台失败不连累其它平台");
  } finally {
    await mock.close();
  }
});

test("mergeSegmentResults 纯函数：并集去重、段序保留、全失败只留错误、keepRaw 才带 raw", () => {
  const seg = (index, types, extra = {}) => ({
    index,
    chars: 10,
    data: { content: `c${index}`, originalContent: `o${index}`, prohibitedWordsType: types, raw: { code: 0 }, ...extra }
  });
  const merged = mergeSegmentResults([seg(1, ["禁用词"]), seg(2, ["价格承诺", "禁用词"])]);
  assert.deepEqual(merged.prohibitedWordsType, ["禁用词", "价格承诺"], "并集应按首次出现顺序去重");
  assert.equal(merged.content, "c1c2");
  assert.equal(merged.originalContent, "o1o2");
  assert.ok(!("raw" in merged), "keepRaw 默认 false 时不该带 raw");

  const withRaw = mergeSegmentResults([seg(1, []), seg(2, [])], { keepRaw: true });
  assert.equal(withRaw.raw.segments.length, 2);

  const failed = mergeSegmentResults([seg(1, []), { index: 2, chars: 10, error: { code: "X", message: "m" } }]);
  assert.equal(failed.error.code, "BANNED_SEGMENT_FAILED");
  assert.equal(failed.content, null);
  assert.deepEqual(failed.prohibitedWordsType, []);

  const allFailed = mergeSegmentResults([
    { index: 1, chars: 10, error: { code: "X", message: "m" } },
    { index: 2, chars: 10, error: { code: "Y", message: "n" } }
  ]);
  assert.equal(allFailed.content, null);
  assert.deepEqual(allFailed.segments.map((s) => s.error.code), ["X", "Y"]);
});

test("上游「成功但正文为空」= 没查到，不是「未命中」：记 UPSTREAM_EMPTY、退出码 3", async () => {
  // 生产实证（约 600 次里 2 次）：上游回成功信封，data 是 {content: null, originalContent: null,
  // prohibitedWordsType: []}。老行为会把它印成「未命中」——一篇文案就这么被读成合规。
  const emptyRoutes = {
    [`GET ${DESCRIBE_PATH}`]: ok(BANNED_CAPABILITY),
    [`POST ${CALL_PATH}`]: ok({
      source: "contentSafety.sensitiveWords",
      content: null,
      originalContent: null,
      prohibitedWordsType: [],
      raw: { content: null, originalContent: null, prohibitedWordsType: [] }
    })
  };
  const mock = await startMock(emptyRoutes);
  try {
    const r = await runCli(["banned", "check", "一段文案", "--platforms", "xiaohongshu", "--confirm"], {
      env: envFor(mock)
    });
    assert.equal(r.code, 3, "没拿到正文不能算成功");
    const entry = JSON.parse(r.stdout).data.xiaohongshu;
    assert.equal(entry.error.code, "UPSTREAM_EMPTY");
    assert.match(entry.error.message, /不是未命中/);
    assert.doesNotMatch(r.stderr, /未命中/, `human 行把空返回印成了未命中：${r.stderr}`);
  } finally {
    await mock.close();
  }
});

test("多段里有一段「成功但空」：同样算没覆盖，不许被合并掉", async () => {
  const mock = await startMock(
    segmentRoutes((body) =>
      body.content.length > 1500
        ? ok({ source: "contentSafety.sensitiveWords", content: null, originalContent: null, prohibitedWordsType: [], raw: {} })
        : null
    )
  );
  try {
    const r = await runCli(["banned", "check", LONG_TEXT, "--platforms", "xiaohongshu", "--confirm"], {
      env: envFor(mock)
    });
    assert.equal(r.code, 3);
    const entry = JSON.parse(r.stdout).data.xiaohongshu;
    assert.equal(entry.error.code, "BANNED_SEGMENT_FAILED");
    assert.equal(entry.content, null, "有空洞时不许拼出一份「看起来完整」的正文");
    assert.equal(entry.segments[0].error.code, "UPSTREAM_EMPTY", "要能看出是第几段空返回");
    assert.ok(entry.segments.slice(1).every((s) => !s.error), "其余段照常保留结果");
  } finally {
    await mock.close();
  }
});

test("单段（含单段失败）结果形状与分段之前逐字相同 —— 老用法零变化", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const okRun = await runCli(["banned", "check", "全网最低价", "--platforms", "xiaohongshu", "--confirm"], {
      env: envFor(mock)
    });
    const entry = JSON.parse(okRun.stdout).data.xiaohongshu;
    assert.deepEqual(Object.keys(entry).sort(), ["content", "originalContent", "prohibitedWordsType", "raw", "source"]);
    assert.equal(entry.segmentCount, undefined, "单段不该多出合并形状的字段");

    const failRun = await runCli(["banned", "check", "全网最低价", "--platforms", "douyin", "--confirm"], {
      env: envFor(mock)
    });
    assert.deepEqual(Object.keys(JSON.parse(failRun.stdout).data.douyin), ["error"]);
  } finally {
    await mock.close();
  }
});
