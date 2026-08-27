// doctor.mjs — `dby doctor`：key 在不在、服务通不通、key 能不能用。
// 全过退出码 0，有项不过退出码 3（spec:「版本与自诊断」）。检查失败不抛——逐项收进结果。

import { request } from "../http.mjs";
import { EXIT, DbyError } from "../errors.mjs";

export async function doctor(ctx, version) {
  const checks = [];

  // 1) key 配没配。🔴 只说「设没设」，密钥内容一个字符都不进输出。
  checks.push({
    name: "api_key",
    ok: !!ctx.key,
    detail: ctx.key ? "DOUBAOYA_API_KEY 已设置" : "DOUBAOYA_API_KEY 没设置（doubaoya.com → 密钥中心生成后 export）"
  });

  // 2) 服务连通性（免鉴权免费的发现端点）。
  try {
    const d = await request(ctx, "GET", "/api/skills", { auth: "none" });
    checks.push({ name: "service", ok: true, detail: `doubaoya.com 可连通（能力清单 ${d.total ?? (d.items ?? []).length} 条）` });
  } catch (e) {
    checks.push({ name: "service", ok: false, detail: `连不上：[${e.code}] ${e.message}` });
  }

  // 3) key 是否可用（免费的档案读取路由；档案为空也算 key 有效）。没 key 就没得测。
  if (ctx.key) {
    try {
      await request(ctx, "GET", "/api/ip-profile", {});
      checks.push({ name: "auth", ok: true, detail: "密钥可用（鉴权路由返回成功）" });
    } catch (e) {
      // 鉴权失败 = 密钥确实无效；业务态（如还没建档的非 401 报错）不算密钥问题；网络错就是没验成。
      const authOk = e.exit === EXIT.BUSINESS;
      checks.push({
        name: "auth",
        ok: authOk,
        detail: e.exit === EXIT.AUTH
          ? "密钥无效：去密钥中心撤销并重新生成"
          : authOk ? `密钥可用（业务态返回 [${e.code}]）` : `没验成：[${e.code}] ${e.message}`
      });
    }
  } else {
    checks.push({ name: "auth", ok: false, detail: "没 key，验不了" });
  }

  const allOk = checks.every((c) => c.ok);
  const data = { version, baseUrl: ctx.baseUrl, checks };
  const human = [
    `dby ${version}  →  ${ctx.baseUrl}`,
    ...checks.map((c) => `  ${c.ok ? "✓" : "✗"} ${c.name.padEnd(8)} ${c.detail}`)
  ].join("\n");

  if (!allOk) {
    // 有项不过：以业务态收场（退出码 3），但 data 仍完整给出逐项结果。
    const err = new DbyError("DOCTOR_FAILED", "自诊断有项不过。", {
      exit: EXIT.BUSINESS,
      remediation: checks.filter((c) => !c.ok).map((c) => c.detail).join("；")
    });
    err.data = data; // 主流程把逐项结果并进失败信封的 data
    err.human = human;
    throw err;
  }
  return { data, human };
}
