// write.mjs — `dby write prep|topics|review`（迁移自 skills/dby-write/scripts/write.mjs）。
// 本组路由**全部免费**不扣点（以旧脚本为准），全部只读 ⇒ 不套确认协议。
// 与旧脚本的两点契约级差异：warnings 走 stderr（数据里保留副本）；no_account/no_articles → 退出码 3。

import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { warn } from "../output.mjs";
import { classify, readVoice, extractHardConstraints, MIN_SAMPLES, MIN_BASELINE } from "../lib/write-core.mjs";

/** 章程关键字段一行一个；空串照打「(空)」，让 agent 看见哪里没填而不是猜。纯函数。 */
export function charterLines(c) {
  const v = (x) => (typeof x === "string" && x.trim()) ? x.trim() : "(空)";
  return [
    `  一句话定位  ${v(c.positioning?.oneLiner)}`,
    `  赛道/标签   ${v(c.positioning?.niche)} / ${v(c.positioning?.tag)}`,
    `  写给谁看    ${v(c.audience?.persona)}`,
    `  变现路径    ${v(c.monetization?.path)}`,
    `  北极星      ${v(c.northStar?.metric)}`
  ];
}

/** 素材库索引行。三态必须可区分：有卡 / 空库 / 拉取失败（坏被当成空会被忽略）。纯函数。 */
export function materialLines(matData) {
  if (matData?.__soft) return [`素材库   没拉到（${matData.__soft}）：跳过这一层照常写，别重试刷屏。`];
  const cards = Array.isArray(matData?.materials) ? matData.materials : [];
  const rcs = Array.isArray(matData?.reviewConclusions) ? matData.reviewConclusions : [];
  const lines = [];
  if (!cards.length) lines.push("素材库   是空的（写完这篇若收到真经历，交付后可提议存卡）");
  else {
    lines.push(`素材库   ${cards.length} 张卡（A 组缺锚点先查这里；用前向用户核实还作数吗）`);
    for (const c of cards) lines.push(`  · [${c.kind === "feedback" ? "反馈" : "素材"}] ${c.proof}（适用：${(c.forms ?? []).join("/") || "?"}）#${c.id}`);
  }
  for (const r of rcs) lines.push(`  · [复盘快照] ${r.title}`);
  return lines;
}

/** prep 的人类文本（纯函数，可测）：返回 { out, warnLines }，warnings 只进 warnLines（stderr）。 */
export function prepHuman(data, materialsRaw) {
  const lines = [];
  lines.push(`档案     ${data.profileName ?? "(未命名)"}  id=${data.profileId}`);
  lines.push(`号章程   ${data.hasCharter ? "有" : "无"}`);
  if (data.charter) lines.push(...charterLines(data.charter));
  lines.push(`个人产品 ${data.products.length ? data.products.map((p) => `${p?.name ?? "?"}${p?.ctaScript ? "（有 ctaScript）" : "（无 ctaScript）"}`).join("、") : "(空)"}`);
  lines.push(`范文     ${data.sampleCount} 篇${data.sampleCount ? "（正文用 --json 取 samples[].content）" : ""}`);
  for (const x of data.samples) lines.push(`  · ${x.title ?? "(无标题)"}  ${x.wordCount ?? "?"} 字`);
  lines.push(`写作规范 ${data.writingSpec ? "已拉到" : "没拉到"}`);
  lines.push(...materialLines(materialsRaw));
  // 硬约束整段打出来：违反会整篇发布失败或内容静默丢失，「已拉到」不等于「进了上下文」。
  const hard = extractHardConstraints(data.writingSpec?.spec);
  if (hard) lines.push("", hard);
  else if (data.writingSpec) lines.push("", "⚠️ 规范里没找到「硬约束」标题的那一节 —— 用 --json 读 writingSpec.spec 全文。");
  if (data.voiceSystemPrompt) lines.push("", `口吻基准（写之前先读它，这是这个号的声音）：`, data.voiceSystemPrompt);
  if (data.taboos.length) lines.push("", "禁用清单（词或规则，硬性）：", ...data.taboos.map((t) => `  - ${t}`));
  const warnLines = data.warnings.map((w) => `⚠️ ${w}`);
  warnLines.push("下一步：几样都在手了再动笔。硬约束那一节不是建议 —— 违反了会整篇发布失败或内容被静默丢掉。");
  return { out: lines.join("\n"), warnLines };
}

export async function writePrep(ctx) {
  const profile = await request(ctx, "GET", "/api/ip-profile", {});
  if (!profile?.profile) {
    throw new DbyError("NO_PROFILE", "档案是空的（还没建档）。别带着空档案硬写。", {
      exit: EXIT.BUSINESS,
      remediation: "先去 dby-charter 用 L0 三问（5 分钟）把定位立起来，再回来跑 dby write prep。"
    });
  }
  const id = profile.profile.id;
  const [charter, samples, spec, materials] = await Promise.all([
    request(ctx, "GET", `/api/ip-profile/${id}/charter`, { soft: true }),
    request(ctx, "GET", `/api/ip-profile/${id}/samples`, { soft: true }),
    request(ctx, "GET", "/api/wechat/writing-spec", { soft: true }),
    request(ctx, "GET", "/api/materials", { soft: true })
  ]);
  const sampleList = Array.isArray(samples?.samples) ? samples.samples : (Array.isArray(samples) ? samples : []);
  // 文风 DNA / 人设 / 个人产品就在 /api/ip-profile 的返回体里 —— 不另开请求。
  const { dna, voiceSystemPrompt, taboos } = readVoice(profile.profile);

  const out = {
    profileId: id,
    profileName: profile.profile.name ?? null,
    hasCharter: !!(charter && !charter.__soft && charter.charter),
    // 给正文不给布尔：hasCharter=true 却不给章程，agent 还得再取一次——要现取的东西大概率取不到。
    charter: (charter && !charter.__soft && charter.charter) ? charter.charter : null,
    persona: profile.profile.personaJson ?? null,
    products: Array.isArray(profile.profile.productsJson) ? profile.profile.productsJson : [],
    sampleCount: sampleList.length,
    samples: sampleList.map((x) => ({
      id: x.id ?? null, title: x.title ?? null, sourceUrl: x.sourceUrl ?? null,
      wordCount: x.wordCount ?? null, content: x.content ?? ""
    })),
    voiceSystemPrompt,
    taboos,
    writingSpec: spec?.__soft ? null : spec,
    materials: materials?.__soft ? [] : (materials?.materials ?? []),
    reviewConclusions: materials?.__soft ? [] : (materials?.reviewConclusions ?? []),
    warnings: []
  };
  if (materials?.__soft) out.warnings.push(`素材索引没拉到（${materials.__soft}）：这一层跳过照常写，别重试刷屏。`);
  if (charter?.__soft) out.warnings.push(`号章程没拉到：${charter.__soft}`);
  else if (!out.hasCharter) out.warnings.push("这个档案还没有号章程 —— 定位不清，建议先去 dby-charter 立一份。");
  if (spec?.__soft) out.warnings.push(`写作规范没拉到（${spec.__soft}）：按通用 markdown 写，照常往下走，别重试刷屏。`);
  if (out.sampleCount < MIN_SAMPLES)
    out.warnings.push(`范文只有 ${out.sampleCount} 篇（少于 ${MIN_SAMPLES}）—— 跟用户说一句实话：补几篇最像你的旧文，成稿会像得多。少不是不能写，是别假装写得像。`);
  if (!dna)
    out.warnings.push("这个档案还没蒸过文风 DNA —— 成稿会是通用口吻。想写得像本人，去 dby-charter 用范文蒸一份。");
  else if (!voiceSystemPrompt)
    out.warnings.push("文风 DNA 里没有 voiceSystemPrompt —— 口吻只能靠范文和章程推，比蒸好的基准弱一档。");
  if (dna && taboos.length === 0)
    out.warnings.push("文风 DNA 里没有禁用清单（taboos 为空）—— AI 味的词没有硬性拦截，写完自己再过一遍。");

  // 🔴 契约：warnings 走 stderr（两种模式都发；JSON 的 data 里保留副本，agent 不用抓 stderr）。
  const { out: human, warnLines } = prepHuman(out, materials);
  for (const w of warnLines) warn(ctx, w);
  return { data: out, human };
}

export async function writeTopics(ctx, niche) {
  const q = niche ? `?niche=${encodeURIComponent(niche)}` : "";
  const d = await request(ctx, "GET", `/api/wechat/topics${q}`, {});
  const list = d.topics ?? [];
  // data 层的 notice 是业务提示（如「请先填写关键词或设置赛道」），与信封层「skill 有更新」不是一回事。
  if (d.notice) warn(ctx, `[提示] ${d.notice}`);
  const lines = [];
  if (!list.length) lines.push("没有候选选题。换个赛道关键词，或去档案里把赛道设上。");
  for (const t of list) {
    lines.push(`· ${t.title ?? "(无标题)"}`);
    if (t.angle) lines.push(`  切角：${t.angle}`);
    if (t.why) lines.push(`  为什么现在：${t.why}`);
    if (Array.isArray(t.refs) && t.refs.length) lines.push(`  参考：${t.refs.length} 条`);
  }
  warn(ctx, "🔴 用户已经说了写什么的话，别调这条 —— 直接用他说的。");
  return { data: { topics: list, notice: d.notice ?? null }, human: lines.join("\n") };
}

/** review 的人类文本（纯函数，可测）。 */
export function reviewHuman(data) {
  const lines = [
    "指标档：**代理档**（横轴=阅读数，纵轴=点赞÷阅读）。",
    "真实的打开率与分享率在微信数据统计里、需额外授权，这个接口拿不到。",
    "阅读数受推荐流影响、不等于粉丝打开；点赞率反映共鸣，跟分享率相关但不等价。",
    ""
  ];
  if (!data.items.length) {
    lines.push(`拿不到指标：${data.reason}。如实告诉用户，别用点赞数单独硬凑一个象限判定。`);
    return lines.join("\n");
  }
  lines.push(`基准（这个号自己的历史**中位数**，n=${data.baseline.n}）：阅读 ${data.baseline.medianRead}，点赞率 ${data.baseline.medianRatePct}%`);
  if (!data.reliable)
    lines.push(`⚠️ 只有 ${data.baseline.n} 篇（少于 ${MIN_BASELINE}），**样本太少、基准不可靠，本次仅供参考** —— 不许照常给结论。`);
  lines.push("");
  for (const it of data.items)
    lines.push(`  ${it.quadrant.padEnd(14)} ${String(it.readCount).padStart(7)} 阅 / ${it.rate}%  ${it.title}\n${" ".repeat(18)}→ ${it.fix}`);
  return lines.join("\n");
}

export async function writeReview(ctx) {
  const d = await request(ctx, "GET", "/api/wechat/review", {});
  // 业务态走退出码 3（spec:「退出码按失败模式分流」）；旧脚本同为 exit 3，语义不变。
  if (d.state === "no_account") {
    throw new DbyError("NO_ACCOUNT", "这个账号还没绑公众号，复盘拿不到数据。", {
      exit: EXIT.BUSINESS, remediation: "去 doubaoya.com 绑定公众号后再跑复盘。"
    });
  }
  if (d.state === "no_articles") {
    throw new DbyError("NO_ARTICLES", `公众号「${d.account?.nickname ?? "?"}」绑了但还没发过文章，没有可复盘的对象。`, {
      exit: EXIT.BUSINESS, remediation: "发过文章之后再来复盘。"
    });
  }
  const arts = d.lastWeek?.articles ?? [];
  const r = classify(arts);
  const data = {
    metricTier: "proxy", // 🔴 代理档绝不能被说成「打开率 × 分享率」——每次输出都写明用的是哪一档。
    account: d.account ?? null,
    reliable: r.reliable,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.baseline ? { baseline: r.baseline } : {}),
    items: r.items
  };
  warn(ctx, "🔴 只给一处修复动作。四象限的全部价值就在于把修改面收敛到一处，别对同一篇同时给多个方向。");
  warn(ctx, "升级路径：让用户去公众号后台「内容分析 → 单篇文章」拿真实打开率与分享率贴回来，按真值档重跑。");
  return { data, human: reviewHuman(data) };
}
