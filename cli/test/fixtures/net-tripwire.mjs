// net-tripwire.mjs — 测试预加载（NODE_OPTIONS=--import=<本文件>）：进程里任何出网尝试都记一笔并失败。
//
// 拦两层：全局 fetch（undici）与 net.Socket#connect（http/https/代理隧道/undici 最终都落到这里）。
// 每次尝试往 $DBY_NET_LOG 追加一行「<目标>」；测试读这个文件判「有没有联网」。
// 只给测试用，不进 npm 包（package.json 的 files 不含 test/）。

import { appendFileSync } from "node:fs";
import net from "node:net";

const LOG = process.env.DBY_NET_LOG;
const record = (what) => {
  if (LOG) appendFileSync(LOG, `${what}\n`);
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  record(`fetch ${typeof input === "string" ? input : input?.url ?? String(input)}`);
  throw new TypeError("network disabled by net-tripwire (test)");
};
void realFetch;

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const opts = args[0];
  const target = typeof opts === "object" && opts ? `${opts.host ?? opts.path ?? "?"}:${opts.port ?? ""}` : String(opts);
  record(`connect ${target}`);
  process.nextTick(() => this.destroy(new Error("network disabled by net-tripwire (test)")));
  return this;
};
void realConnect;
