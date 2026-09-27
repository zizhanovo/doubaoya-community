// image.test.mjs — tasks 2.10：生图迁成 `dby image gen|edit`（composite，套确认协议）。
// 覆盖 gen.mjs 做成代码的那几条纪律：确认前零请求、本地白名单挡模型名、参考图 >3 张 USAGE、
// edit 至少一张参考图、落盘并量真实宽高、法定标识转达、超时不重试（服务端只被打一次）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, startMock, ok } from "./helpers.mjs";
import { solidPng } from "./fixtures/png.mjs";

const KEY = "dyh_test_key_never_real";
const dir = () => mkdtempSync(path.join(tmpdir(), "dby-image-"));

async function imageMock(result) {
  const hits = [];
  const mock = await startMock({
    "POST /api/skills/gpt-image-gen/invoke": (req, url, body) => {
      hits.push(body);
      return result ?? ok({ images: [{ b64: solidPng(320, 180).toString("base64"), mime: "image/png" }] }, { aigc: { generated: true, label: "本内容由人工智能生成" } });
    }
  });
  return { mock, hits };
}

test("不带 --confirm：停在 confirmation_required（退出码 6），一个请求都不发", async () => {
  const { mock, hits } = await imageMock();
  try {
    const r = await runCli(["image", "gen", "一只鸭子在写稿", "--json"], { env: { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: KEY } });
    assert.equal(r.code, 6, r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.status, "confirmation_required");
    assert.match(env.confirmCommand, /--confirm$/);
    assert.equal(hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("--confirm：只发 prompt/modelName，落盘 png 并回报实测宽高与法定标识", async () => {
  const { mock, hits } = await imageMock();
  try {
    const out = path.join(dir(), "duck.png");
    const r = await runCli(["image", "gen", "一只鸭子", "在写稿", "--model", "gpt-image-2", "--out", out, "--confirm", "--json"], {
      env: { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: KEY }
    });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.file, out);
    assert.equal(data.width, 320);
    assert.equal(data.height, 180);
    assert.equal(data.aigcLabel, "本内容由人工智能生成");
    assert.ok(existsSync(out));
    assert.deepEqual(hits, [{ prompt: "一只鸭子 在写稿", modelName: "gpt-image-2" }], "只许发 prompt 与 modelName");
    assert.ok(!r.stdout.includes("base64"), "stdout 不回灌图像数据");
    assert.ok(r.stdout.length < 2048);
  } finally {
    await mock.close();
  }
});

test("本地参考图转 data: URI；两张走 images 字段", async () => {
  const { mock, hits } = await imageMock();
  try {
    const d = dir();
    const a = path.join(d, "a.png");
    const b = path.join(d, "b.png");
    writeFileSync(a, solidPng(8, 8));
    writeFileSync(b, solidPng(8, 8, [0, 0, 0]));
    const r = await runCli(["image", "edit", "合成", "--ref", a, "--ref", b, "--out", path.join(d, "o.png"), "--confirm", "--json"], {
      env: { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: KEY }
    });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(hits[0].images.length, 2);
    assert.ok(hits[0].images.every((s) => s.startsWith("data:image/png;base64,")));
  } finally {
    await mock.close();
  }
});

test("本地先拦：模型名拼错、参考图 >3 张、edit 没有参考图——都是 USAGE(2) 且零请求", async () => {
  const { mock, hits } = await imageMock();
  try {
    const env = { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: KEY };
    const d = dir();
    const refs = [1, 2, 3, 4].flatMap((i) => {
      const f = path.join(d, `${i}.png`);
      writeFileSync(f, solidPng(4, 4));
      return ["--ref", f];
    });
    for (const argv of [
      ["image", "gen", "x", "--model", "gpt-image-9", "--confirm", "--json"],
      ["image", "gen", "x", ...refs, "--confirm", "--json"],
      ["image", "edit", "x", "--confirm", "--json"]
    ]) {
      const r = await runCli(argv, { env });
      assert.equal(r.code, 2, `${argv.join(" ")} → ${r.code} ${r.stderr}`);
    }
    assert.equal(hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("超时：退出码 5，服务端只被打了一次（绝不重试），remediation 叮嘱不要重试", async () => {
  let calls = 0;
  const mock = await startMock({ "POST /api/skills/gpt-image-gen/invoke": () => { calls += 1; return "HANG"; } });
  try {
    const r = await runCli(["image", "gen", "x", "--confirm", "--json"], {
      env: { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: KEY, DOUBAOYA_TIMEOUT_MS: "300" }
    });
    assert.equal(r.code, 5, r.stderr);
    const e = JSON.parse(r.stdout).error;
    assert.equal(e.code, "TIMEOUT");
    assert.match(e.remediation, /不要重试/);
    assert.equal(calls, 1);
  } finally {
    await mock.close();
  }
});

test("image plan：确定性规划，只读文件不改文件", async () => {
  const d = dir();
  const md = path.join(d, "a.md");
  const text = `# 标题\n\n## 长小节\n\n${"这是一句正文。".repeat(40)}\n\n## 短小节\n\n太短。\n`;
  writeFileSync(md, text);
  const r = await runCli(["image", "plan", "--md", md, "--json"], { env: {} });
  assert.equal(r.code, 0, r.stderr);
  const { data } = JSON.parse(r.stdout);
  assert.equal(data.figures.length, 1);
  assert.equal(data.figures[0].anchor.value, "长小节");
  assert.equal(readFileSync(md, "utf8"), text);
});

// ── image describe（恢复 1.x `gen.mjs --describe` 的参数对账）──────────────────
import { IMAGE_EXPECTED_FIELDS, IMAGE_MODELS } from "../src/commands/image.mjs";

function describeMock(properties) {
  const detail = {
    slug: "gpt-image-gen", operationKey: "skill.ai.imageGen", unitPrice: 15,
    execution: { mode: "generic", target: { method: "POST", path: "/api/skills/gpt-image-gen/invoke" } },
    inputContract: { kind: "json-schema", jsonSchema: { type: "object", required: ["prompt"], properties } }
  };
  return startMock({ "GET /api/skills/gpt-image-gen": ok(detail) });
}
const props = (fields, extra = {}) => ({ ...Object.fromEntries(fields.map((f) => [f, { type: "string" }])), ...extra });

test("image describe：生产字段与认知一致 → 退出码 0，免 key，只打详情这一条", async () => {
  const mock = await describeMock(props(IMAGE_EXPECTED_FIELDS, { modelName: { type: "string", enum: [...IMAGE_MODELS] } }));
  try {
    const r = await runCli(["image", "describe", "--json"], { env: { DOUBAOYA_BASE_URL: mock.url } });
    assert.equal(r.code, 0, r.stderr);
    const d = JSON.parse(r.stdout).data;
    assert.equal(d.consistent, true);
    assert.equal(d.unitPrice, 15);
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.models.gone, []);
    assert.deepEqual(mock.hits.map((h) => `${h.method} ${h.path}`), ["GET /api/skills/gpt-image-gen"]);
  } finally {
    await mock.close();
  }
});

test("image describe：生产多出字段 / 少了字段 / 模型对不上 → 退出码 3 CONTRACT_DRIFT，data 列出差异", async () => {
  const fields = IMAGE_EXPECTED_FIELDS.filter((f) => f !== "quality");
  const mock = await describeMock(props([...fields, "aspectRatio"], { modelName: { type: "string", enum: ["gpt-image-2.5-flare", "gpt-image-3"] } }));
  try {
    const r = await runCli(["image", "describe", "--json"], { env: { DOUBAOYA_BASE_URL: mock.url } });
    assert.equal(r.code, 3, r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.error.code, "CONTRACT_DRIFT");
    assert.deepEqual(env.data.added, ["aspectRatio"]);
    assert.deepEqual(env.data.gone, ["quality"]);
    assert.deepEqual(env.data.models.added, ["gpt-image-3"]);
    assert.ok(env.data.models.gone.includes("gpt-image-2"));
  } finally {
    await mock.close();
  }
});

test("image describe：生产没有 json-schema 规格 → 退出码 3 NO_INPUT_CONTRACT，不编一份", async () => {
  const mock = await startMock({ "GET /api/skills/gpt-image-gen": ok({ slug: "gpt-image-gen", inputContract: { kind: "no-schema", route: "x" } }) });
  try {
    const r = await runCli(["image", "describe", "--json"], { env: { DOUBAOYA_BASE_URL: mock.url } });
    assert.equal(r.code, 3, r.stderr);
    assert.equal(JSON.parse(r.stdout).error.code, "NO_INPUT_CONTRACT");
  } finally {
    await mock.close();
  }
});
