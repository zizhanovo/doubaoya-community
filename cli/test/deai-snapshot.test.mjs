// deai-snapshot.test.mjs — `dby deai scan` 的冻结快照（design D5：对拍通过后冻结 Node 快照，再删 Python）。
//
// 期望文件由 cli/scripts/parity/deai-parity.mjs --write-snapshots 生成，生成前该脚本已把 Node 与
// skills/dby-deai/scripts/deai.py 逐字段（JSON 含键序）+ 逐字（human 文本）对拍到差异 0。
// Python 删掉之后，这里就是唯一的尺子：改词表 / 改算法导致输出变了，这里必须红，
// 确认是有意为之再重跑冻结（那时没有 Python，只能凭评审判断）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deaiScan, deaiBaseline } from "../src/commands/deai.mjs";

const FIX = fileURLToPath(new URL("./fixtures/deai/", import.meta.url));
const EXPECTED = path.join(FIX, "expected");
const PROFILE = path.join(FIX, "profile-exempt.md");
const samples = readdirSync(FIX).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();

test("样稿与快照一一对应，且至少 6 篇（含真人对照稿）", () => {
  assert.ok(samples.length >= 6, `样稿只有 ${samples.length} 篇`);
  assert.ok(samples.some((f) => f.includes("human")), "缺真人味对照稿");
  for (const f of samples) {
    for (const v of ["plain", "profile"]) {
      const base = `${f.replace(/\.md$/, "")}.${v}`;
      assert.ok(readdirSync(EXPECTED).includes(`${base}.json`), `缺快照 ${base}.json`);
    }
  }
});

for (const f of samples) {
  for (const [variant, opts] of [["plain", {}], ["profile", { profile: PROFILE }]]) {
    test(`快照：${f} · ${variant}`, () => {
      const base = path.join(EXPECTED, `${f.replace(/\.md$/, "")}.${variant}`);
      const got = deaiScan({ file: path.join(FIX, f), ...opts });
      // 用序列化比，键序也算在内（与 Python json 的键序逐一对过）
      assert.equal(JSON.stringify(got.data, null, 2) + "\n", readFileSync(`${base}.json`, "utf8"));
      assert.equal(got.human + "\n", readFileSync(`${base}.txt`, "utf8"));
    });
  }
}

test("快照：make-baseline（全部样稿）", () => {
  const got = deaiBaseline(samples.map((f) => path.join(FIX, f))).data.baseline;
  assert.equal(JSON.stringify(got, null, 2) + "\n", readFileSync(path.join(EXPECTED, "make-baseline.json"), "utf8"));
});

test("快照不是空壳：病灶类别在样稿集里都至少命中一次，真人稿一条词族都不命中", () => {
  const reports = Object.fromEntries(samples.map((f) => [f, deaiScan({ file: path.join(FIX, f) }).data]));
  const lists = ["连续同长句", "套话连接词", "公文腔", "通胀大词", "否定式对比", "三段式并列", "虚假范围",
    "程式化过渡", "每段收束", "对称小标题", "空洞候选段", "首段预告", "公式化开头", "结尾升华"];
  for (const key of lists) {
    assert.ok(Object.values(reports).some((r) => r[key].length > 0), `样稿集里没有一篇命中「${key}」——快照覆盖不到这一类`);
  }
  const human = reports[samples.find((f) => f.includes("human"))];
  for (const key of ["套话连接词", "公文腔", "通胀大词", "否定式对比", "程式化过渡", "结尾升华", "空洞候选段"]) {
    assert.deepEqual(human[key], [], `真人稿被判出「${key}」`);
  }
});
