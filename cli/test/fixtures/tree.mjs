// tree.mjs — 目录树快照（测试用）：每个条目的类型、权限、大小、mtime、内容哈希、软链目标——任何写入都会让它变。
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";

export function treeSnapshot(root) {
  const out = [];
  const walk = (abs, rel) => {
    const st = lstatSync(abs);
    let extra = "";
    if (st.isSymbolicLink()) extra = `->${readlinkSync(abs)}`;
    else if (st.isFile()) extra = createHash("sha256").update(readFileSync(abs)).digest("hex");
    out.push(`${rel}|${st.isDirectory() ? "d" : st.isSymbolicLink() ? "l" : "f"}|${st.mode}|${st.isDirectory() ? "" : st.size}|${st.mtimeMs}|${extra}`);
    if (st.isDirectory()) for (const name of readdirSync(abs).sort()) walk(path.join(abs, name), `${rel}/${name}`);
  };
  if (existsSync(root)) walk(root, ".");
  return createHash("sha256").update(out.join("\n")).digest("hex");
}

