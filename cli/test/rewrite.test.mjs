// rewrite.test.mjs — `dby rewrite rules`：平台集合与别名 ↔ `rewrite.py list` 对拍（有 python3 时）
// + 一份不依赖 Python 的冻结期望 + references 路径三种运行形态 + rewrite.py --selfcheck 的断言移植。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLATFORM_ALIAS, SUPPORTED_PLATFORMS, PLATFORM_FILE, ALL_KEYWORDS,
  resolvePlatforms, resolveReferencesDir, referencesCandidates, rewriteRules, aliasesOf, commands
} from "../src/commands/rewrite.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PY = path.join(REPO_ROOT, "skills/dby-rewrite/scripts/rewrite.py");
const REFS = path.join(REPO_ROOT, "skills/dby-rewrite/references");
// 🔴 pack 测试（exports.test.mjs）跑 prepack 时会临时生成 cli/skills/（npm 包形态），与本文件并行时
//    默认解析会合法地先命中它——两处内容同源，所以「默认解析」只断言落在这两处之一。
const PACKED_REFS = path.join(REPO_ROOT, "cli/skills/dby-rewrite/references");
const DEFAULT_REFS = [REFS, PACKED_REFS];

function pythonUnavailable() {
  if (!existsSync(PY)) return `找不到 ${PY}（Python 已删，改由下面的冻结期望兜底）`;
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return null;
  } catch {
    return "本机没有 python3";
  }
}

// 冻结期望：不依赖 Python。改平台表必须同时改这里——这是有意的第二处签字。
const FROZEN = {
  公众号: ["公众号", "微信公众号"],
  视频号: ["视频号", "微信视频号"],
  抖音: ["抖音", "dy"],
  快手: ["快手", "ks"],
  "哔站（B站）": ["哔站", "b站", "bilibili", "哔哩哔哩"],
  小红书: ["小红书", "红书", "xhs"],
  知乎: ["知乎", "zhihu"]
};

test("冻结期望：平台集合、顺序与别名", () => {
  assert.deepEqual([...SUPPORTED_PLATFORMS], Object.keys(FROZEN));
  for (const p of SUPPORTED_PLATFORMS) assert.deepEqual(aliasesOf(p), FROZEN[p], `${p} 的别名漂了`);
  assert.deepEqual([...ALL_KEYWORDS].sort(), ["all", "全部", "所有"].sort());
});

test("对拍：平台集合与别名 == `python3 rewrite.py list`", (t) => {
  const why = pythonUnavailable();
  if (why) {
    t.diagnostic(`跳过：${why}`);
    process.stderr.write(`[rewrite 对拍跳过] ${why}\n`);
    return t.skip(why);
  }
  const out = execFileSync("python3", [PY, "list"], { encoding: "utf8" });
  const rows = out
    .split("\n")
    .filter((l) => l.includes(" | ") && !l.startsWith("平台名称"))
    .map((l) => l.split(" | ").map((s) => s.trim()));
  const pyMap = Object.fromEntries(rows.map(([p, a]) => [p, a.split(", ")]));
  assert.equal(rows.length, 7, "rewrite.py list 的行数不对（解析坏了）");
  assert.deepEqual(pyMap, Object.fromEntries(SUPPORTED_PLATFORMS.map((p) => [p, aliasesOf(p)])));
  assert.deepEqual(Object.keys(pyMap), [...SUPPORTED_PLATFORMS], "平台顺序与 Python 不同");
});

test("对拍：resolve_platforms 在同一批输入上结果相同（有 python3 时）", (t) => {
  const why = pythonUnavailable();
  if (why) return t.skip(why);
  const inputs = [["抖音,知乎"], ["抖音", "小红书", "知乎"], ["all"], ["全部"], ["XHS", "B站"], ["dy,dy,抖音"], ["BILIBILI"], ["微信公众号", "ks"]];
  const code = `import json,sys; sys.path.insert(0, ${JSON.stringify(path.dirname(PY))}); import rewrite; print(json.dumps([rewrite.resolve_platforms(x) for x in json.loads(sys.argv[1])], ensure_ascii=False))`;
  const py = JSON.parse(execFileSync("python3", ["-c", code, JSON.stringify(inputs)], { encoding: "utf8" }));
  assert.deepEqual(inputs.map((x) => resolvePlatforms(x).platforms), py);
});

test("selfcheck 移植：平台表 ↔ references/ 一一对应，每份都有 Role 段", () => {
  const onDisk = new Set(readdirSync(REFS).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)));
  assert.deepEqual(onDisk, new Set(Object.values(PLATFORM_FILE)));
  assert.deepEqual(new Set(Object.values(PLATFORM_ALIAS)), new Set(SUPPORTED_PLATFORMS), "别名表指到了平台表之外");
  for (const p of SUPPORTED_PLATFORMS) {
    assert.match(readFileSync(path.join(REFS, `${PLATFORM_FILE[p]}.md`), "utf8"), /# Role:/, `${p} 缺 Role 段`);
  }
});

test("全平台关键词不带文案也能跑；逗号与空格混用；去重；大小写", () => {
  for (const kw of ALL_KEYWORDS) assert.deepEqual(resolvePlatforms([kw]).platforms, [...SUPPORTED_PLATFORMS]);
  assert.deepEqual(resolvePlatforms(["抖音,知乎", "抖音", "XHS"]).platforms, ["抖音", "知乎", "小红书"]);
  const r = rewriteRules(["all"]);
  assert.equal(r.data.platforms.length, 7);
});

test("rules：JSON 只给路径与摘要，不回灌规则全文；人读形态打全文", () => {
  const r = rewriteRules(["小红书"]);
  assert.ok(DEFAULT_REFS.includes(r.data.referencesDir), r.data.referencesDir);
  assert.equal(r.data.platforms.length, 1);
  const e = r.data.platforms[0];
  assert.equal(e.path, path.join(r.data.referencesDir, "小红书.md"));
  assert.ok(e.role && e.bytes > 0);
  const full = readFileSync(e.path, "utf8");
  assert.ok(!JSON.stringify(r.data).includes(full.split("\n").slice(3, 6).join("\n")), "JSON 里回灌了规则正文");
  assert.ok(r.human.includes(full.trim()), "人读形态该打出规则全文");
});

test("不给平台 = list：七个平台带别名与路径", () => {
  const r = rewriteRules([]);
  assert.deepEqual(r.data.platforms.map((p) => p.platform), [...SUPPORTED_PLATFORMS]);
  for (const p of r.data.platforms) assert.ok(existsSync(p.path));
  assert.match(r.human, /bilibili/);
});

test("认不出的平台 → USAGE（退出码 2）并列出支持的平台；不再把它当文案吞掉", () => {
  for (const tokens of [["微博"], ["抖音", "微博"], [","]]) {
    assert.throws(() => rewriteRules(tokens), (e) => e.exit === 2 && e.code === "UNKNOWN_PLATFORM" && /支持的平台/.test(e.remediation));
  }
});

test("references 路径适配三种运行形态（npm 包 / 社区仓开发 / 1.x skill 镜像）", () => {
  const root = mkdtempSync(path.join(tmpdir(), "dby-rewrite-refs-"));
  const plant = (dir) => {
    mkdirSync(dir, { recursive: true });
    for (const f of Object.values(PLATFORM_FILE)) writeFileSync(path.join(dir, `${f}.md`), "# x\n\n# Role: 测试\n");
    return dir;
  };
  const shapes = {
    npm: [path.join(root, "npm/node_modules/@doubaoya/cli/src"), path.join(root, "npm/node_modules/@doubaoya/cli/skills/dby-rewrite/references")],
    repo: [path.join(root, "repo/cli/src"), path.join(root, "repo/skills/dby-rewrite/references")],
    mirror: [path.join(root, "mirror/skills/dby-api/scripts/lib"), path.join(root, "mirror/skills/dby-rewrite/references")]
  };
  for (const [name, [src, refs]] of Object.entries(shapes)) {
    mkdirSync(src, { recursive: true });
    plant(refs);
    assert.equal(resolveReferencesDir(src), refs, `${name} 形态解析错了`);
    assert.ok(referencesCandidates(src).includes(refs));
    assert.equal(rewriteRules(["知乎"], { srcDir: src }).data.platforms[0].path, path.join(refs, "知乎.md"));
  }
  // 真实仓库里默认解析到社区仓开发形态（pack 测试并行时可能是临时的 npm 包形态，见文件头）
  assert.ok(DEFAULT_REFS.includes(resolveReferencesDir()));
  // 缺文件 → 一般错误（包装坏了），不是 USAGE
  const broken = path.join(root, "broken/cli/src");
  mkdirSync(broken, { recursive: true });
  mkdirSync(path.join(root, "broken/skills/dby-rewrite/references"), { recursive: true });
  assert.throws(() => resolveReferencesDir(broken), (e) => e.code === "REWRITE_RULES_MISSING" && e.exit === 1);
});

test("命令表：local、零路由、非计费", () => {
  assert.deepEqual(commands.map((c) => `${c.group} ${c.name}`), ["rewrite rules"]);
  assert.equal(commands[0].kind, "local");
  assert.deepEqual(commands[0].routes, []);
});
