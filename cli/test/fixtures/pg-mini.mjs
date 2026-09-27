// pg-mini.mjs — 只给 login.contract.test 用的最小 Postgres 客户端（简单查询协议）。
//
// 为什么不装 pg：cli/ 零依赖（dependencies 与 devDependencies 都空，spec「零运行时依赖」），
// 契约测试又只需要「造用户会话、改过期时间、读一两个字段」这几条 SQL，不值得为此开 devDependency。
// 本文件不进 npm 包（files 只含 bin/src/skills）。
//
// 支持：trust / cleartext / md5 / SCRAM-SHA-256 四种认证（postgres:16 默认 scram）；只做简单查询，
// 结果按文本返回 rows（以列名为键的对象）。不做 SSL、不做扩展查询、不做参数绑定——调用方只拼测试自己生成的值。
//
// ponytail: 天花板 = 单连接串行、无 SSL、无参数化；升级路径 = 真要更多 SQL 时给 cli 开一个 pg devDependency。

import net from "node:net";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const cstr = (s) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const msg = (type, payload) => Buffer.concat([Buffer.from(type), i32(payload.length + 4), payload]);

function parseError(body) {
  const fields = {};
  let i = 0;
  while (i < body.length && body[i] !== 0) {
    const code = String.fromCharCode(body[i]);
    const end = body.indexOf(0, i + 1);
    fields[code] = body.subarray(i + 1, end).toString("utf8");
    i = end + 1;
  }
  return new Error(`Postgres ${fields.C ?? "?"}: ${fields.M ?? "unknown error"}`);
}

export async function connect(url) {
  const u = new URL(url);
  const user = decodeURIComponent(u.username || "postgres");
  const password = decodeURIComponent(u.password || "");
  const database = decodeURIComponent(u.pathname.replace(/^\//, "") || user);
  const sock = net.connect(Number(u.port || 5432), u.hostname);
  await new Promise((resolve, reject) => { sock.once("connect", resolve); sock.once("error", reject); });

  let buf = Buffer.alloc(0);
  const waiters = [];
  let sockErr = null;
  const pump = () => {
    while (waiters.length && buf.length >= 5) {
      const len = buf.readInt32BE(1);
      if (buf.length < len + 1) return;
      const m = { type: String.fromCharCode(buf[0]), body: buf.subarray(5, len + 1) };
      buf = buf.subarray(len + 1);
      waiters.shift().resolve(m);
    }
  };
  sock.on("data", (d) => { buf = Buffer.concat([buf, d]); pump(); });
  sock.on("error", (e) => { sockErr = e; while (waiters.length) waiters.shift().reject(e); });
  const next = () => new Promise((resolve, reject) => {
    if (sockErr) return reject(sockErr);
    waiters.push({ resolve, reject });
    pump();
  });

  const startup = Buffer.concat([i32(196608), cstr("user"), cstr(user), cstr("database"), cstr(database), Buffer.from([0])]);
  sock.write(Buffer.concat([i32(startup.length + 4), startup]));

  // 认证握手
  let scram = null;
  for (;;) {
    const m = await next();
    if (m.type === "E") throw parseError(m.body);
    if (m.type !== "R") {
      if (m.type === "Z") break;
      continue; // S（ParameterStatus）/ K（BackendKeyData）
    }
    const code = m.body.readInt32BE(0);
    if (code === 0) continue;
    if (code === 3) sock.write(msg("p", cstr(password)));
    else if (code === 5) {
      const salt = m.body.subarray(4, 8);
      const inner = createHash("md5").update(password + user).digest("hex");
      const outer = createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
      sock.write(msg("p", cstr(`md5${outer}`)));
    } else if (code === 10) {
      const nonce = randomBytes(18).toString("base64");
      const firstBare = `n=,r=${nonce}`;
      const first = Buffer.from(`n,,${firstBare}`);
      scram = { nonce, firstBare };
      sock.write(msg("p", Buffer.concat([cstr("SCRAM-SHA-256"), i32(first.length), first])));
    } else if (code === 11) {
      const serverFirst = m.body.subarray(4).toString("utf8");
      const attrs = Object.fromEntries(serverFirst.split(",").map((kv) => [kv[0], kv.slice(2)]));
      if (!attrs.r?.startsWith(scram.nonce)) throw new Error("SCRAM：服务端 nonce 不以客户端 nonce 开头");
      const salted = pbkdf2Sync(password, Buffer.from(attrs.s, "base64"), Number(attrs.i), 32, "sha256");
      const clientKey = createHmac("sha256", salted).update("Client Key").digest();
      const storedKey = createHash("sha256").update(clientKey).digest();
      const finalNoProof = `c=biws,r=${attrs.r}`;
      const authMessage = `${scram.firstBare},${serverFirst},${finalNoProof}`;
      const sig = createHmac("sha256", storedKey).update(authMessage).digest();
      const proof = Buffer.from(clientKey.map((b, i) => b ^ sig[i]));
      sock.write(msg("p", Buffer.from(`${finalNoProof},p=${proof.toString("base64")}`)));
    } else if (code === 12) {
      continue; // SASLFinal：服务端签名，这里不校验（只连测试自己起的容器）
    } else {
      throw new Error(`不支持的 Postgres 认证方式 ${code}`);
    }
  }

  let chain = Promise.resolve();
  /** 跑一条（或分号分隔的多条）SQL，返回最后一条语句的 rows：[{ 列名: 文本值 | null }]。 */
  function query(sql) {
    const run = async () => {
      sock.write(msg("Q", cstr(sql)));
      let rows = [];
      let names = [];
      let error = null;
      for (;;) {
        const m = await next();
        if (m.type === "T") {
          rows = [];
          names = [];
          let off = 2;
          for (let c = 0; c < m.body.readInt16BE(0); c += 1) {
            const end = m.body.indexOf(0, off);
            names.push(m.body.subarray(off, end).toString("utf8"));
            off = end + 1 + 18; // 名字之后是 表OID(4) 列号(2) 类型OID(4) 长度(2) 修饰(4) 格式(2)
          }
        } else if (m.type === "D") {
          const n = m.body.readInt16BE(0);
          const row = [];
          let off = 2;
          for (let c = 0; c < n; c += 1) {
            const len = m.body.readInt32BE(off);
            off += 4;
            if (len === -1) row.push(null);
            else { row.push(m.body.subarray(off, off + len).toString("utf8")); off += len; }
          }
          rows.push(Object.fromEntries(names.map((name, c) => [name, row[c]])));
        } else if (m.type === "E") error = parseError(m.body);
        else if (m.type === "Z") break;
      }
      if (error) throw error;
      return rows;
    };
    const p = chain.then(run);
    chain = p.catch(() => {});
    return p;
  }

  return {
    query,
    close: () => new Promise((resolve) => { sock.end(msg("X", Buffer.alloc(0)), resolve); })
  };
}

/** 单引号字面量转义（只用于测试自己生成的值）。 */
export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
