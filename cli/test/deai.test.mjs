// deai.test.mjs — `dby deai`：deai.py --selfcheck 的 25 条断言逐条移植 + 「不给分数」闸 + 输入输出形态。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan, makeBaseline, parseExempt, pyRound, deaiScan, deaiBaseline, commands } from "../src/commands/deai.mjs";

const FIX = fileURLToPath(new URL("./fixtures/deai/", import.meta.url));
const MODULE = fileURLToPath(new URL("../src/commands/deai.mjs", import.meta.url));

const SLOP =
  "在当今这个信息爆炸的时代，人工智能无疑是具有里程碑意义的技术。\n\n" +
  "值得注意的是，它不是一个简单的工具，而是一种全新的生产力。" +
  "首先，它能够赋能千行百业；其次，它重塑了底层逻辑；此外，它还带来了深远影响。" +
  "从教育到医疗，从制造到金融，无不受到它的冲击。\n\n" +
  "总之，未来可期，让我们拭目以待。";
const HUMAN =
  "上周三下午，我在公司楼下等了 40 分钟。\n\n" +
  "那台咖啡机坏了。修的人说主板烧了，换一块 380 块。我说算了。" +
  "回工位路上想起去年也是这台机器，那次是水泵。\n\n" +
  "后来我们买了挂耳。";

test("selfcheck 移植：AI 稿命中、人稿不误判（deai.py 的 25 条断言）", () => {
  const bad = scan(SLOP);
  const good = scan(HUMAN);
  assert.ok(bad.套话连接词.length, "套话连接词该命中");
  assert.ok(bad.通胀大词.length, "通胀大词该命中");
  assert.ok(bad.否定式对比.length, "「不是A而是B」该命中");
  assert.ok(bad.虚假范围.length, "「从X到Y无不」该命中");
  assert.ok(scan("需要三种能力：洞察力、表达力和执行力。").三段式并列.length, "「A、B和C」该算三段式");
  assert.deepEqual(scan("# 标题\n\n在当今这个时代。").公式化开头, ["在当今"], "标题行把首句挡住了");
  assert.deepEqual(bad.公式化开头, ["在当今"]);
  assert.ok(bad.结尾升华.includes("未来可期"));
  assert.ok(bad.每千字.套话连接词 > good.每千字.套话连接词);
  assert.deepEqual(good.套话连接词, []);
  assert.deepEqual(good.否定式对比, []);
  assert.ok(good.具体度.数字字符 > bad.具体度.数字字符);
  assert.deepEqual(scan("行吧。知道了。走吧。").连续同长句, [], "短对话被误判为句长均匀");
  assert.deepEqual(bad.首段预告, []);
  assert.deepEqual(scan("本文将从三个方面展开。").首段预告, ["本文"]);
  assert.ok(scan("他每周三更，一更就是两年，中间搬过一次家也没断。因此，坚持本身就是一种能力。").每段收束.length);
  assert.ok(scan("## 不是钱的问题\n\n## 不是人的问题\n\n## 不是时间的问题\n").对称小标题.length);
  assert.deepEqual(scan("## 开头\n\n## 正文\n").对称小标题, []);
  assert.ok(bad.空洞候选段.length);
  assert.deepEqual(good.空洞候选段, []);
  assert.ok(scan("如果说 A 验证了这一点，那么 B 就是佐证。").程式化过渡.length);
  assert.deepEqual(scan("首先，这很重要。", new Set(["首先"])).套话连接词, [], "豁免词没生效");
  assert.equal(scan("首先，这很重要。", new Set(["首先"])).已豁免, 1);
  const line = makeBaseline([good, scan(HUMAN)]);
  assert.ok(line.样本篇数 === 2 && line.总字数 > 0 && "套话连接词" in line.每千字);
  assert.equal(scan("见 https://x.com/a%E4%BD%A0 这篇。").具体度.百分比, 0, "URL 里的 % 被算进百分比了");
  const empty = scan("");
  assert.equal(empty.字数, 0);
  assert.equal(empty.句长.均值, 0);
});

test("🔴 不给分数：任何样稿的输出里都没有分数 / AI 率 / 及格判定类字段", () => {
  const FORBIDDEN = /score|分数|得分|评分|ai.?率|ai.?rate|概率|probab|及格|合格|pass|verdict|判定|等级|grade|level|risk/i;
  const walk = (v, at, out) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`, out));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN.test(k)) out.push(`${at}.${k}`);
        walk(x, `${at}.${k}`, out);
      }
    }
    return out;
  };
  const files = readdirSync(FIX).filter((f) => /^\d\d-.*\.md$/.test(f));
  assert.ok(files.length >= 6);
  for (const f of files) {
    const { data, human } = deaiScan({ file: path.join(FIX, f), profile: path.join(FIX, "profile-exempt.md") });
    assert.deepEqual(walk(data, "data", []), [], `${f} 输出里出现分数类字段`);
    assert.doesNotMatch(human, /(AI\s*率|分数|得分)\s*[:：]?\s*\d/, `${f} 的 human 文本里出现了分数`);
  }
  // 破坏演练：判据本身不是恒假
  assert.deepEqual(walk({ a: { aiScore: 1 } }, "x", []), ["x.a.aiScore"]);
});

test("pyRound 照 Python：精确平局五成双，非平局按精确值", () => {
  assert.equal(pyRound(0.25, 1), 0.2);
  assert.equal(pyRound(0.35, 1), 0.3); // 0.35 的精确值略小于 .35
  assert.equal(pyRound(2.675, 2), 2.67);
  assert.equal(pyRound(0.125, 2), 0.12);
  assert.equal(pyRound(0.375, 2), 0.38);
  assert.equal(pyRound(30.15, 1), 30.1);
});

test("长度按码点算：emoji 算一个字（Python len 语义）", () => {
  assert.equal(scan("🦆🦆🦆").字数, 3);
});

test("全角数字算数字（Python 3 的 \\d 认 Unicode Nd）", () => {
  assert.equal(scan("增长了２０％。").具体度.数字字符, 2);
});

test("换行归一：CRLF 稿与 LF 稿结果相同", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "deai-crlf-"));
  const lf = path.join(dir, "lf.md");
  const crlf = path.join(dir, "crlf.md");
  writeFileSync(lf, SLOP);
  writeFileSync(crlf, SLOP.replace(/\n/g, "\r\n"));
  assert.deepEqual(deaiScan({ file: crlf }).data, deaiScan({ file: lf }).data);
});

test("--profile：只读「## 豁免」一节，去掉「」与反引号，下一节不算", () => {
  const set = parseExempt(readFileSync(path.join(FIX, "profile-exempt.md"), "utf8"));
  assert.deepEqual([...set].sort(), ["因此", "未来可期", "此外", "首先"].sort());
  assert.deepEqual([...parseExempt("# 无豁免节\n- 首先\n")], []);
});

test("baseline --out 落裸基线；scan --baseline 既认裸基线也认整份 --json 信封", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "deai-base-"));
  const out = path.join(dir, "基线.json");
  const files = ["04-human-control.md", "06-contrast-heavy.md"].map((f) => path.join(FIX, f));
  const r = deaiBaseline(files, { out });
  assert.equal(r.data.out, out);
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), r.data.baseline);
  const draft = path.join(FIX, "01-slop-classic.md");
  const a = deaiScan({ file: draft, baseline: out });
  assert.deepEqual(a.data.基线, r.data.baseline);
  assert.match(a.human, /### 对照作者基线（2 篇/);
  const envelope = path.join(dir, "envelope.json");
  writeFileSync(envelope, JSON.stringify({ ok: true, data: r.data }));
  assert.deepEqual(deaiScan({ file: draft, baseline: envelope }).data, a.data);
});

test("缺 --file / 读不到文件 / 坏基线 → USAGE（退出码 2）", () => {
  assert.throws(() => deaiScan({}), (e) => e.exit === 2);
  assert.throws(() => deaiScan({ file: path.join(FIX, "不存在.md") }), (e) => e.exit === 2 && e.code === "FILE_UNREADABLE");
  const dir = mkdtempSync(path.join(tmpdir(), "deai-bad-"));
  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, "{\"x\":1}");
  assert.throws(() => deaiScan({ file: path.join(FIX, "04-human-control.md"), baseline: bad }), (e) => e.code === "BASELINE_INVALID");
});

test("--file - 从 stdin 读", () => {
  const script = `import(${JSON.stringify(MODULE)}).then((m) => process.stdout.write(JSON.stringify(m.deaiScan({ file: "-" }).data.字数)))`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { input: "你好，世界。", encoding: "utf8" });
  assert.equal(out, "6"); // 「你好，世界。」去空白后 6 个码点
});

test("命令表：两条都是 local、零路由、非计费", () => {
  assert.deepEqual(commands.map((c) => `${c.group} ${c.name}`), ["deai scan", "deai baseline"]);
  for (const c of commands) {
    assert.equal(c.kind, "local");
    assert.deepEqual(c.routes, []);
    assert.equal(c.billable, false);
  }
});
