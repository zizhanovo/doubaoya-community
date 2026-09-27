// npmmirror-sync.test.mjs — tasks 6.8：发布后同步 npmmirror 并轮询到版本与 integrity 一致。
// 全部对本机假服务（假 npmjs / 假 npmmirror / 假同步接口），不碰真实 registry。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { syncAndWait } from "../scripts/npmmirror-sync.mjs";

async function fake(handler) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const out = handler(req, hits.length);
    res.writeHead(out.status ?? 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out.json ?? {}));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) };
}

const doc = (v, integrity) => ({ json: { versions: { [v]: { dist: { integrity } } } } });

test("镜像先缺、后出现同一 integrity → 触发同步一次，轮询到一致才返回", async () => {
  const npmjs = await fake(() => doc("2.0.0", "sha512-A"));
  let polls = 0;
  const mirror = await fake(() => (++polls < 3 ? { json: { versions: {} } } : doc("2.0.0", "sha512-A")));
  const sync = await fake(() => ({ json: { ok: true, id: "x" } }));
  try {
    const env = { DBY_REGISTRY_NPMJS: npmjs.url, DBY_REGISTRY_NPMMIRROR: mirror.url, DBY_NPMMIRROR_SYNC: sync.url };
    const r = await syncAndWait({ version: "2.0.0", timeoutMin: 1, intervalS: 0.01 }, env, () => {});
    assert.deepEqual(r, { version: "2.0.0", integrity: "sha512-A" });
    assert.deepEqual(sync.hits, ["PUT /-/package/@doubaoya/cli/syncs"]);
    assert.ok(polls >= 3);
  } finally {
    await Promise.all([npmjs.close(), mirror.close(), sync.close()]);
  }
});

test("两源 integrity 不一致 → 立即失败，不继续等", async () => {
  const npmjs = await fake(() => doc("2.0.0", "sha512-A"));
  const mirror = await fake(() => doc("2.0.0", "sha512-B"));
  const sync = await fake(() => ({ json: { ok: true } }));
  try {
    const env = { DBY_REGISTRY_NPMJS: npmjs.url, DBY_REGISTRY_NPMMIRROR: mirror.url, DBY_NPMMIRROR_SYNC: sync.url };
    await assert.rejects(syncAndWait({ version: "2.0.0", timeoutMin: 1, intervalS: 0.01 }, env, () => {}), /integrity 是 sha512-B，npmjs 是 sha512-A/);
  } finally {
    await Promise.all([npmjs.close(), mirror.close(), sync.close()]);
  }
});

test("镜像一直不同步 → 超时失败并给出手动触发命令", async () => {
  const npmjs = await fake(() => doc("2.0.0", "sha512-A"));
  const mirror = await fake(() => ({ json: { versions: { "1.9.9": {} } } }));
  const sync = await fake(() => ({ json: { ok: true } }));
  try {
    const env = { DBY_REGISTRY_NPMJS: npmjs.url, DBY_REGISTRY_NPMMIRROR: mirror.url, DBY_NPMMIRROR_SYNC: sync.url };
    await assert.rejects(syncAndWait({ version: "2.0.0", timeoutMin: 0.002, intervalS: 0.02 }, env, () => {}), /没同步到 @doubaoya\/cli@2\.0\.0.*curl -X PUT/s);
  } finally {
    await Promise.all([npmjs.close(), mirror.close(), sync.close()]);
  }
});
