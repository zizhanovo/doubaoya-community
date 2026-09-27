// node-version.test.mjs — tasks 2.2 / spec「Node 版本过低」：
// 在（伪装的）Node 20 上跑任意子命令 → 退出码 3、stderr 指出要求与当前版本、零出网、HOME 下零写入。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, startMock } from "./helpers.mjs";

const FAKE20 = fileURLToPath(new URL("./fixtures/fake-node20.mjs", import.meta.url));
const TRIPWIRE = fileURLToPath(new URL("./fixtures/net-tripwire.mjs", import.meta.url));

function tree(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) out.push(path.join(e.parentPath ?? e.path, e.name));
  return out.sort();
}

for (const argv of [["whoami"], ["login"], ["draft", "list", "--json"], ["--version"]]) {
  test(`Node 20 上 dby ${argv.join(" ")}：退出码 3，不联网，不写文件`, async () => {
    const hits = [];
    const mock = await startMock(new Proxy({}, { get: () => (req, url) => { hits.push(url.pathname); return { success: true, data: {} }; } }));
    const home = mkdtempSync(path.join(tmpdir(), "dby-node20-home-"));
    const log = path.join(mkdtempSync(path.join(tmpdir(), "dby-node20-net-")), "net.log");
    writeFileSync(log, "");
    try {
      const before = tree(home);
      const r = await runCli(argv, {
        env: {
          HOME: home,
          DOUBAOYA_BASE_URL: mock.url,
          DOUBAOYA_API_KEY: "dyh_test_key_never_real",
          DBY_NET_LOG: log,
          // 先伪装版本，再装绊线：两者都是预加载，业务代码一行都不该跑到。
          NODE_OPTIONS: `--import=${FAKE20} --import=${TRIPWIRE}`
        }
      });
      assert.equal(r.code, 3, r.stderr);
      assert.match(r.stderr, /需要 Node ≥22，当前 20\.11\.1/);
      assert.match(r.stderr, /升级/);
      assert.equal(r.stdout, "", "版本不满足时 stdout 不输出任何东西");
      assert.equal(readFileSync(log, "utf8"), "", "发生了出网尝试");
      assert.deepEqual(hits, [], "桩服务收到了请求");
      assert.deepEqual(tree(home), before, "HOME 下出现了新文件（~/.doubaoya 不许被写）");
    } finally {
      await mock.close();
    }
  });
}
