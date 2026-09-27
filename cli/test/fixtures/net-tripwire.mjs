// net-tripwire.mjs — 测试预加载（NODE_OPTIONS=--import=<本文件>）：进程里任何出网尝试都记一笔并失败。
//
// 拦两层：全局 fetch（undici）与 net.Socket#connect（http/https/代理隧道/undici 最终都落到这里）。
// 每次被拦的尝试往 $DBY_NET_LOG 追加一行「<目标>」；测试读这个文件判「有没有联网」。
// $DBY_NET_ALLOW（逗号分隔的 host:port）列出的目标放行且不记——给「抓用户指定网址」这类
// 不打 doubaoya 的 local 命令用（例如 wechat fetch-article 指向测试里起的本地网页服务）。
// 只给测试用，不进 npm 包（package.json 的 files 不含 test/）。

import { appendFileSync } from "node:fs";
import net from "node:net";

const LOG = process.env.DBY_NET_LOG;
const ALLOW = new Set((process.env.DBY_NET_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const record = (what) => {
  if (LOG) appendFileSync(LOG, `${what}\n`);
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  try {
    const u = new URL(url);
    if (ALLOW.has(`${u.hostname}:${u.port}`)) return realFetch(input, init);
  } catch {
    // 解析不了的目标按不放行处理
  }
  record(`fetch ${url}`);
  throw new TypeError("network disabled by net-tripwire (test)");
};

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // net.connect() 内部把参数规整成 [options, cb] 数组再调本方法；直接调用时是 (options|port, host)。
  const opts = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof opts === "object" && opts ? opts.host ?? opts.path : undefined;
  const port = typeof opts === "object" && opts ? opts.port : opts;
  const target = `${host ?? "?"}:${port ?? ""}`;
  if (ALLOW.has(target) || (host === "localhost" && ALLOW.has(`127.0.0.1:${port}`))) return realConnect.apply(this, args);
  record(`connect ${target}`);
  process.nextTick(() => this.destroy(new Error("network disabled by net-tripwire (test)")));
  return this;
};
