// locate-dby.mjs（CLI 包版）— 与 skills/*/scripts/lib/locate-dby.mjs 同名同签名，但不用「找」：
// 流水线已搬进 @doubaoya/cli（dby-cli-rebuild design D4「原样搬家」），请求层就在同一个包的 src/ 下。
// 保留这个接口是为了让 pipeline.mjs / preprocess-and-publish.mjs / account-verify.mjs 的调用点
// 一个字不改——搬家后的行为与 1.x 相同，只是找库的方式从「向上找 dby-api 目录」变成相对路径。
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function locateDbyLib() {
  return SRC_DIR;
}

export async function importDbyLib(_fromUrl, mod) {
  return import(pathToFileURL(path.join(SRC_DIR, mod)).href);
}
