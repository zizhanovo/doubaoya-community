// skill-lib-mirror.test.mjs — cli/src 是事实源，skills/dby-api/scripts/lib 必须是它的逐字节镜像
// （1.x 过渡期，见 cli/scripts/sync-skill-lib.mjs 顶部的取舍说明）。漂了就红，指出文件。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mirrorDiff } from "../scripts/sync-skill-lib.mjs";

test("skills/dby-api/scripts/lib 与 cli/src 逐字节一致", () => {
  const problems = mirrorDiff();
  assert.deepEqual(
    problems,
    [],
    "镜像漂了——改代码只改 cli/src，然后 `node cli/scripts/sync-skill-lib.mjs`：\n" +
      problems.map((p) => `  ${p.file}：${p.problem}`).join("\n")
  );
});
