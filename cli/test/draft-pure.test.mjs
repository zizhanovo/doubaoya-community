// draft-pure.test.mjs — 稿件面纯函数的断言，从旧 skills/dby-api/scripts/doubaoya.mjs 的
// `selfcheck()` 搬过来（该函数随 doubaoya.mjs 退成转发壳一起退役，断言不能跟着丢）。
// draftLocateQuote / draftPrecheckChanges / draftChangeId 现在唯一实现在 lib/draft-core.mjs。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  draftLocateQuote,
  draftPrecheckChanges,
  draftChangeId
} from "../../skills/dby-api/scripts/lib/draft-core.mjs";

test("draftLocateQuote：唯一命中 / 零命中 / 多命中无前后文 ambiguous / 带 prefix 消歧后 located", () => {
  const body = "开头一句。中间这句要改一改。结尾一句。中间这句要改一改。再来一句。";
  assert.equal(draftLocateQuote(body, { exact: "开头一句" }).status, "located", "唯一命中 → located");
  assert.equal(draftLocateQuote(body, { exact: "不存在的句子" }).status, "unlocated", "零命中 → unlocated");
  assert.equal(
    draftLocateQuote(body, { exact: "中间这句要改一改" }).status,
    "ambiguous",
    "命中两处且无前后文 → ambiguous"
  );
  const disambiguated = draftLocateQuote(body, { exact: "中间这句要改一改", prefix: "结尾一句。" });
  assert.equal(disambiguated.status, "located", "带 prefix 消歧后应能唯一定位");
});

test("draftPrecheckChanges：干净清单无错误；查无/歧义/缺理由/重叠/重复锚点分别报对码", () => {
  const body = "开头一句。中间这句要改一改。结尾一句。中间这句要改一改。再来一句。";

  const okChanges = [{ anchor: { exact: "开头一句" }, replacement: "开场一句", reason: "更顺口" }];
  assert.equal(draftPrecheckChanges(body, okChanges).length, 0, "干净清单预检应无错误");

  const notFound = draftPrecheckChanges(body, [{ anchor: { exact: "查无此句" }, replacement: "x", reason: "y" }]);
  assert.equal(notFound.length, 1);
  assert.equal(notFound[0].code, "ANCHOR_NOT_FOUND", "零命中必须报 ANCHOR_NOT_FOUND");

  const ambiguous = draftPrecheckChanges(body, [{ anchor: { exact: "中间这句要改一改" }, replacement: "x", reason: "y" }]);
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].code, "ANCHOR_AMBIGUOUS", "命中多处且不可消歧必须报 ANCHOR_AMBIGUOUS");

  const noReason = draftPrecheckChanges(body, [{ anchor: { exact: "开头一句" }, replacement: "x" }]);
  assert.equal(noReason.length, 1);
  assert.equal(noReason[0].code, "REASON_MISSING", "缺理由必须报 REASON_MISSING");

  const overlapBody = "abcdefgh";
  const overlapping = draftPrecheckChanges(overlapBody, [
    { anchor: { exact: "abcd" }, replacement: "x", reason: "y" },
    { anchor: { exact: "cdef" }, replacement: "z", reason: "w" }
  ]);
  assert.equal(overlapping.length, 1);
  assert.equal(overlapping[0].code, "OVERLAP", "范围重叠必须报 OVERLAP");

  // 🔴 两条改动锚点 + 替换内容完全相同 → DUPLICATE，且不得静默通过（指向第二条）。
  const dup = { anchor: { exact: "开头一句" }, replacement: "开场一句", reason: "更顺口" };
  const duplicateAnchors = draftPrecheckChanges(body, [dup, { ...dup }]);
  assert.equal(duplicateAnchors.length, 1);
  assert.equal(duplicateAnchors[0].code, "DUPLICATE");
  assert.equal(duplicateAnchors[0].index, 1, "重复锚点必须指向第二条");

  assert.equal(
    draftChangeId(dup.anchor, dup.replacement),
    draftChangeId({ ...dup.anchor }, dup.replacement),
    "changeId 对同一锚点+替换必须稳定"
  );
});
