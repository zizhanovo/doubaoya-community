// api-extra.test.mjs — `api validate` / `api recommend`（dby-cli-unification 3.1）。本地 mock，不上网。
import test from "node:test";
import assert from "node:assert/strict";
import { startMock, runNode, ok, fail, CLI_BIN } from "./helpers.mjs";

const env = (mock) => ({ DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: "dyh_test" });
const skill = { slug: "content-safety-check", operationKey: "tool.contentSafety.checkWords", title: "x", execution: { mode: "dedicated", target: { method: "POST", path: "/api/skills/content-safety-check/invoke" } } };

test("api validate：裸 slug 解析到 operationKey 后打 validate，体面转述 valid/issues", async () => {
  const mock = await startMock({
    "GET /api/skills/content-safety-check": ok(skill),
    "POST /api/capabilities/tool.contentSafety.checkWords/validate": (req, url, body) => {
      assert.deepEqual(body, { input: { topic: "a" } });
      return ok({ valid: false, issues: [{ path: "title", message: "必填" }], normalizedInput: {} });
    }
  });
  try {
    const r = await runNode(CLI_BIN, ["api", "validate", "content-safety-check", '{"topic":"a"}'], { env: env(mock) });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.data.valid, false);
    assert.equal(mock.hits.filter((h) => h.path.endsWith("/validate")).length, 1);
  } finally { await mock.close(); }
});

test("api validate：422 不可预检 → 业务态 3，remediation 指回 describe", async () => {
  const mock = await startMock({
    "GET /api/skills/content-safety-check": ok(skill),
    "POST /api/capabilities/tool.contentSafety.checkWords/validate": { status: 422, json: fail("CAPABILITY_VALIDATION_UNSUPPORTED", "no schema") }
  });
  try {
    const r = await runNode(CLI_BIN, ["api", "validate", "content-safety-check"], { env: env(mock) });
    assert.equal(r.code, 3, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error.code, "CAPABILITY_VALIDATION_UNSUPPORTED");
    assert.match(out.error.remediation ?? "", /describe/);
  } finally { await mock.close(); }
});

test("api validate：body 不是 JSON → 用法错 2，零请求打到 validate", async () => {
  const mock = await startMock({ "GET /api/skills/content-safety-check": ok(skill) });
  try {
    const r = await runNode(CLI_BIN, ["api", "validate", "content-safety-check", "{oops"], { env: env(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.filter((h) => h.path.endsWith("/validate")).length, 0);
  } finally { await mock.close(); }
});

test("api recommend：query 拼成一句，category/limit 透传，免 key 也能跑", async () => {
  const mock = await startMock({
    "POST /api/skills/recommend": (req, url, body) => {
      assert.deepEqual(body, { query: "写 公众号", category: "write", limit: 3 });
      return ok({ primary: { slug: "content-safety-check", title: "写爆文" }, candidates: [], decisionSummary: "ok" });
    }
  });
  try {
    const r = await runNode(CLI_BIN, ["api", "recommend", "写", "公众号", "--category", "write", "--limit", "3"], { env: { DOUBAOYA_BASE_URL: mock.url } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).data.primary.slug, "content-safety-check");
  } finally { await mock.close(); }
});
