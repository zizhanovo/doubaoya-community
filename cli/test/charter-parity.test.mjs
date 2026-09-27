// charter-parity.test.mjs — 任务 2.3：`dby charter` 对拍 charter.mjs（旧脚本子进程真跑）。
// 两个坑的行为逐一钉住：products 只读投影必被剥、PUT 全量替换。
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  startMock, runCli, runNode, charterRoutes, envFor, ok,
  OLD_CHARTER, FIXTURE_CHARTER
} from "./helpers.mjs";
import { stripReadOnlyProjection } from "../src/commands/charter.mjs";

test("charter profiles 对拍：data.profiles 与旧脚本打出的行一致", async () => {
  const mock = await startMock(charterRoutes());
  try {
    const old = await runNode(OLD_CHARTER, ["profiles"], { env: envFor(mock) });
    assert.equal(old.code, 0, old.stderr);
    assert.match(old.stdout, /^p1\t默认\t默认号$/m);

    const now = await runCli(["charter", "profiles"], { env: envFor(mock) });
    assert.equal(now.code, 0);
    const { data } = JSON.parse(now.stdout);
    assert.deepEqual(data.profiles, [{ id: "p1", isDefault: true, name: "默认号" }]);
  } finally {
    await mock.close();
  }
});

test("charter get 对拍：原样形态与旧脚本 stdout 的 JSON 深比一致（含 products）", async () => {
  const mock = await startMock(charterRoutes());
  try {
    const old = await runNode(OLD_CHARTER, ["get"], { env: envFor(mock) });
    assert.equal(old.code, 0, old.stderr);
    const oldCharter = JSON.parse(old.stdout);

    const now = await runCli(["charter", "get"], { env: envFor(mock) });
    const { data } = JSON.parse(now.stdout);
    assert.deepEqual(data.charter, oldCharter);
    assert.ok("products" in data.charter, "不带 --for-edit 时原样保留 products");
    assert.equal(data.charterUpdatedAt, "2026-08-01T00:00:00.000Z");
  } finally {
    await mock.close();
  }
});

test("charter get --for-edit 对拍：两边都剥掉 products、其余键原样", async () => {
  const mock = await startMock(charterRoutes());
  try {
    const old = await runNode(OLD_CHARTER, ["get", "--for-edit"], { env: envFor(mock) });
    const oldEdit = JSON.parse(old.stdout);
    assert.ok(!("products" in oldEdit), "旧脚本基线：--for-edit 剥 products");

    const now = await runCli(["charter", "get", "--for-edit"], { env: envFor(mock) });
    const { data } = JSON.parse(now.stdout);
    assert.deepEqual(data.charter, oldEdit);
    assert.match(now.stderr, /已剥掉只读的 products 键/);
  } finally {
    await mock.close();
  }
});

test("charter put 对拍：两边发到服务端的 body 一致，且都不含 products（坑①）", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dby-charter-"));
  const file = path.join(dir, "c.json");
  await writeFile(file, JSON.stringify(FIXTURE_CHARTER)); // 故意带着 products 传进去

  const mockOld = await startMock(charterRoutes());
  const mockNew = await startMock(charterRoutes());
  try {
    const old = await runNode(OLD_CHARTER, ["put", file], { env: envFor(mockOld) });
    assert.equal(old.code, 0, old.stderr);
    const now = await runCli(["charter", "put", file], { env: envFor(mockNew) });
    assert.equal(now.code, 0, now.stderr);

    const oldPut = mockOld.hits.find((h) => h.method === "PUT");
    const newPut = mockNew.hits.find((h) => h.method === "PUT");
    assert.ok(oldPut && newPut, "两边都真的 PUT 了");
    assert.ok(!("products" in oldPut.body) && !("products" in newPut.body), "products 必须被剥掉");
    assert.deepEqual(newPut.body, oldPut.body, "全量替换的 payload 逐字段一致");

    const { data } = JSON.parse(now.stdout);
    assert.deepEqual(data.charter, stripReadOnlyProjection(FIXTURE_CHARTER), "服务端回显＝已剥投影的全量");
    assert.equal(data.profileId, "p1");
  } finally {
    await mockOld.close();
    await mockNew.close();
  }
});

test("charter get：还没有章程 → NO_CHARTER，退出码 3（与旧脚本一致）", async () => {
  const routes = {
    "GET /api/ip-profile/charter": ok({ profileId: "p1", charter: null, charterUpdatedAt: null })
  };
  const mockOld = await startMock(routes);
  const mockNew = await startMock(routes);
  try {
    const old = await runNode(OLD_CHARTER, ["get"], { env: envFor(mockOld) });
    assert.equal(old.code, 3, "旧脚本基线：无章程退出码 3");
    const now = await runCli(["charter", "get"], { env: envFor(mockNew) });
    assert.equal(now.code, 3);
    assert.equal(JSON.parse(now.stdout).error.code, "NO_CHARTER");
  } finally {
    await mockOld.close();
    await mockNew.close();
  }
});

test("stripReadOnlyProjection：剥 products / 不误伤 / 不就地改（与旧脚本注释同判据）", () => {
  const withProjection = { version: 1, positioning: { oneLiner: "x" }, products: [{ name: "投影" }] };
  const stripped = stripReadOnlyProjection(withProjection);
  assert.ok(!("products" in stripped));
  assert.ok("positioning" in stripped && "version" in stripped);
  assert.ok("products" in withProjection, "不就地改入参");
  const clean = { version: 1, positioning: { oneLiner: "x" } };
  assert.deepEqual(stripReadOnlyProjection(clean), clean);
});

test("CHARTER_INVALID：message 原样透传、remediation 给「一次性重 PUT」指引，业务态退出码 3", async () => {
  const mock = await startMock(charterRoutes({
    "PUT /api/ip-profile/p1/charter": { status: 400, json: { success: false, error: { code: "CHARTER_INVALID", message: "缺 audience；缺 northStar" } } }
  }));
  const dir = await mkdtemp(path.join(tmpdir(), "dby-charter-"));
  const file = path.join(dir, "c.json");
  await writeFile(file, JSON.stringify({ version: 1 }));
  try {
    const r = await runCli(["charter", "put", file], { env: envFor(mock) });
    assert.equal(r.code, 3);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.error.code, "CHARTER_INVALID");
    assert.match(parsed.error.message, /缺 audience；缺 northStar/);
    assert.match(parsed.error.remediation, /一次性/);
  } finally {
    await mock.close();
  }
});
