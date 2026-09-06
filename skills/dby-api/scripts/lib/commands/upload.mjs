// upload.mjs — `dby upload <file>`：本地图片文件转 base64 后传到图床，返回公开 url。
// 单条命令、无子命令名（design D9 六组放宽之一；单级命令形状同 doctor/routes/whoami/retro）。
// 对接主仓 apps/api/src/modules/upload/routes.ts；服务端硬顶 2MB，本地先拒同一条上限，
// 省一次注定失败的网络往返（超时红线同样适用：本地读文件失败 ≠ 联网失败，走 USAGE 不是 NETWORK）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";

const MAX_BYTES = 2 * 1024 * 1024; // 与服务端 bodyLimit 前的业务上限一致（routes.ts: MAX_BYTES）

export async function upload(ctx, filePath) {
  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch (err) {
    throw new DbyError("USAGE", `读取文件失败：${filePath}（${err.message}）`, { exit: EXIT.USAGE });
  }
  if (bytes.length > MAX_BYTES) {
    throw new DbyError(
      "USAGE",
      `文件 ${bytes.length} 字节，超过 2MB 上限，本地已拦下（服务端会原样拒收，未发送任何请求）。`,
      { exit: EXIT.USAGE }
    );
  }
  const body = { dataBase64: bytes.toString("base64"), filename: path.basename(filePath) };
  const data = await request(ctx, "POST", "/api/upload", { body });
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: null, name: "upload",
    summary: "上传本地图片（png/jpeg/webp，≤2MB）到图床，返回公开 url",
    args: [{ name: "file", required: true }], flags: {},
    routes: [{ method: "POST", path: "/api/upload" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => upload(ctx, args.file)
  }
];
