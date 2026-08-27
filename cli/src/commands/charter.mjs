// charter.mjs — `dby charter profiles|get|put`（迁移自 skills/dby-charter/scripts/charter.mjs）。
// 章程路由全部免费不扣点、不调 LLM ⇒ 不套确认协议（put 是用户自己改好文件后的主动提交）。
// 两个「每次都会踩」的坑照旧做进代码：
//   ① GET 回来的 charter 带只读投影键 `products`，原样 PUT 必 400 —— put 无论如何都再剥一次；
//   ② PUT 是**全量替换**不是增量 patch，少传的键判缺失 400。

import { readFile } from "node:fs/promises";
import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { warn } from "../output.mjs";

/** 坑①：剥掉 GET 合成的只读投影键。纯函数，返回新对象不改入参。 */
export function stripReadOnlyProjection(charter) {
  if (!charter || typeof charter !== "object") return charter;
  const { products, ...rest } = charter;
  return rest;
}

/** charter 路由的错误码 → 处置指引（旧脚本的 hint 表，原样保留）。 */
const CHARTER_HINTS = {
  NOT_FOUND: "档案不存在 / 不属于你 / 没有默认档案。先跑 `dby charter profiles` 确认 id，或先建档。",
  CHARTER_INVALID: "message 是所有校验问题拼成的完整清单，逐条改完**一次性**重 PUT，不要一条一条试。",
  DNA_TOO_LARGE: "writingDnaJson 超 32KB，精简后重试。"
};

export async function charterProfiles(ctx) {
  const { profiles = [] } = await request(ctx, "GET", "/api/ip-profiles", { hints: CHARTER_HINTS });
  if (!profiles.length) warn(ctx, "一个档案都没有。先建档再存章程。");
  const human = profiles.map((p) => `${p.id}\t${p.isDefault ? "默认" : "    "}\t${p.name ?? ""}`).join("\n");
  return { data: { profiles }, human };
}

export async function charterGet(ctx, opts) {
  const path = opts.profile ? `/api/ip-profile/${opts.profile}/charter` : "/api/ip-profile/charter";
  const d = await request(ctx, "GET", path, { hints: CHARTER_HINTS });
  if (d.charter == null) {
    throw new DbyError("NO_CHARTER", "这个档案还没有章程。", {
      exit: EXIT.BUSINESS,
      remediation: "先做定位问诊（dby-charter 的 L0 三问起步），再 put 一份上去。"
    });
  }
  const charter = opts.forEdit ? stripReadOnlyProjection(d.charter) : d.charter;
  if (opts.forEdit) {
    warn(ctx, "已剥掉只读的 products 键，可直接改完 `dby charter put` 回去（PUT 是全量替换）。");
    warn(ctx, "改产品不走这条路由，走档案：PUT /api/ip-profile/:id");
  }
  warn(ctx, `更新于 ${d.charterUpdatedAt ?? "未知"}`);
  return {
    data: { charter, charterUpdatedAt: d.charterUpdatedAt ?? null, forEdit: !!opts.forEdit },
    human: JSON.stringify(charter, null, 2)
  };
}

export async function charterPut(ctx, file, opts) {
  let doc;
  try {
    doc = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new DbyError("USAGE", `读不了 ${file}：${e.message}`, { exit: EXIT.USAGE });
  }
  let id = opts.profile;
  if (!id) {
    const { profileId } = await request(ctx, "GET", "/api/ip-profile/charter", { hints: CHARTER_HINTS });
    id = profileId;
    if (!id) {
      throw new DbyError("NO_DEFAULT_PROFILE", "拿不到默认档案 id。", {
        exit: EXIT.BUSINESS, remediation: "先跑 `dby charter profiles`，再用 --profile 指定。"
      });
    }
  }
  // 坑①再剥一次：哪怕传进来的是没过 --for-edit 的原始 GET 结果，也不让它 400。
  const payload = stripReadOnlyProjection(doc);
  const d = await request(ctx, "PUT", `/api/ip-profile/${id}/charter`, {
    body: payload, hints: CHARTER_HINTS
  });
  warn(ctx, `已全量替换，更新于 ${d.charterUpdatedAt}`);
  return {
    data: { charter: d.charter, charterUpdatedAt: d.charterUpdatedAt ?? null, profileId: id },
    human: JSON.stringify(d.charter, null, 2)
  };
}
