// routes-contract.test.mjs — `dby routes --json` 在进主仓对账闸之前，本仓先守住的三件事
// （dby-cli-rebuild D8 / spec「子命令分三类并由对账闸核对」；闸本体在主仓 apps/api/src/cli-route-parity.test.ts）：
//   1. alias 的路由与主命令逐条相同，且主命令存在、本身不是 alias；
//   2. 输出里同一路由至多一条 route 命令（alias 不单列，挂在主命令的 aliases 上）；
//   3. composite 名单 == 主仓 COMPOSITE_COMMANDS 的镜像（下面的常量）。改名/增删组合命令要两边一起改。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_COMMANDS } from "../src/registry.mjs";
import { runCli } from "./helpers.mjs";

const nameOf = (c) => (c.group ? `${c.group} ${c.name}` : c.name);
const routeKeys = (c) => (c.routes ?? []).map((r) => `${r.method} ${r.path}`);

// 主仓 apps/api/src/lib/cli-route-parity.ts 的 COMPOSITE_COMMANDS（2026-09-27 对齐）。
// 「skills update」（tasks 6.1）：composite，路由只有 GET /api/cli/release（主仓把该路由列在排除清单里，
// 理由正是「消费方是 install.sh 与 dby skills update（composite，只要求路径存在）」）。
const MAIN_REPO_COMPOSITES = [
  "api list", "api search", "api describe", "api invoke", "api validate",
  "write prep", "write articles", "charter get", "doctor", "draft precheck", "banned check",
  "login", "image gen", "wechat pipeline", "skills update"
];

test("alias：主命令存在、不是 alias，路由逐条相同", () => {
  const byName = new Map(ALL_COMMANDS.map((c) => [nameOf(c), c]));
  const aliases = ALL_COMMANDS.filter((c) => c.kind === "alias");
  assert.ok(aliases.length >= 3, "元断言：至少那三对同义命令应该是 alias");
  for (const a of aliases) {
    const primary = byName.get(a.aliasOf);
    assert.ok(primary, `${nameOf(a)} 的 aliasOf=${a.aliasOf} 不存在`);
    assert.notEqual(primary.kind, "alias", `${nameOf(a)} 指向的 ${a.aliasOf} 本身也是 alias（不许链式）`);
    assert.deepEqual(routeKeys(a), routeKeys(primary), `${nameOf(a)} 与 ${a.aliasOf} 的路由不同，不能算 alias`);
  }
});

test("dby routes --json：同一路由至多一条 route 命令，alias 挂在主命令上，composite 名单与主仓一致", async () => {
  const r = await runCli(["routes", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const cmds = JSON.parse(r.stdout).data.commands;
  assert.ok(cmds.length > 30);
  assert.ok(cmds.every((c) => ["route", "composite", "local"].includes(c.kind)), "输出里只许三类（alias 不单列）");

  const owners = new Map();
  for (const c of cmds.filter((c) => c.kind === "route")) {
    for (const k of routeKeys(c)) owners.set(k, [...(owners.get(k) ?? []), c.name]);
  }
  const dups = [...owners].filter(([, v]) => v.length > 1);
  assert.deepEqual(dups, [], "同一路由被多条 route 命令覆盖");

  const listedAliases = cmds.flatMap((c) => c.aliases ?? []).sort();
  assert.deepEqual(listedAliases, ALL_COMMANDS.filter((c) => c.kind === "alias").map(nameOf).sort());

  const composites = cmds.filter((c) => c.kind === "composite").map((c) => c.name).sort();
  assert.deepEqual(composites, [...MAIN_REPO_COMPOSITES].sort());

  const logout = cmds.find((c) => c.name === "logout");
  assert.equal(logout.kind, "route");
  assert.deepEqual(logout.routes, [{ method: "POST", path: "/api/cli/logout" }]);
});
