#!/usr/bin/env node
// write.mjs — 都爆鸭 · 写作主干的取数与复盘算术
// ponytail: prep / topics / review 三个子命令与仓内 cli/src/commands/write.mjs（`dby write …`）重复，
//   天花板 = 两份实现要同步改、同一个坑要修两次（对拍测试 cli/test/write-parity.test.mjs 只保证当下一致）。
//   升级路径 = @doubaoya/cli 发布到 npm 且 SKILL.md 改为只走 CLI 后，删掉这三个子命令，本脚本只留
//   articles / material / selfcheck；在那之前本脚本是唯一能跑的取数路径（CLI 尚未发布，npx 会 404）。
// -----------------------------------------------------------------------------
// 这个脚本只做**机械**的那两段，判断仍归你：
//
//   prep    第 1 步要的四样一次拉齐（档案 / 号章程 / 范文 / 写作规范）。文本版打章程关键字段、
//           范文清单、口吻基准、禁用清单与规范里的**硬约束整节**；--json 另带章程全文与范文正文。
//           并按 SKILL.md 的降级阶梯处理失败：401 不许跳过、写作规范拉不到照常往下走、
//           档案为空要先去立人设、范文少于 3 篇要如实说一句。
//   topics  选题卡（按赛道取候选；用户已经说了写什么就别调它）
//   articles 第 4 步收素材：自己往期已发文章（授权公众号最近 20 篇，免费）。--q 按关键词筛，--id 取单篇正文。
//   review  复盘取数 + **四象限分类**。分类是算术不是判断：
//           两轴的基准取**这个账号自己的历史中位数**，绝不引入行业平均值
//           （那些数字是二手孤证、跨了算法时代，拿来当基准会错得很自信）。
//
// 🔴 脚本不替你做的事：写正文、选标题、决定该改哪一处。四象限只告诉你每篇落在哪一格，
//    「只给一处修复动作」仍然是你的活。
//
// env:  DOUBAOYA_API_KEY（必填，**绝不打印**）  DOUBAOYA_BASE_URL（可选）
// 零依赖（Node ≥18）。本包用到的路由**全部免费**，不扣点。
//
// 用法:
//   node scripts/write.mjs prep                第 1 步四样一次拉齐
//   node scripts/write.mjs prep --json         同上，输出机器可读的 JSON
//   node scripts/write.mjs topics [赛道]       选题候选（不传赛道则用档案里的）
//   node scripts/write.mjs articles [--q 关键词] [--id 序号或文章id]   往期文章清单 / 单篇正文
//   node scripts/write.mjs review              复盘取数 + 四象限
//   node scripts/write.mjs material list                 素材卡索引（proof 一行一条）
//   node scripts/write.mjs material get <id>             单卡全文
//   node scripts/write.mjs material save '<json>'        存卡（先给用户看卡面、确认后才调；也可 --stdin）
//   node scripts/write.mjs material del <id>             删卡（硬删）
//   node scripts/write.mjs selfcheck           离线自检，不联网不需要 key
// -----------------------------------------------------------------------------

import process from "node:process";

const BASE = process.env.DOUBAOYA_BASE_URL || "https://doubaoya.com";
const MIN_SAMPLES = 3;   // 少于这个数，成稿像不像要如实说
const MIN_BASELINE = 5;  // 少于这个数，中位数同样不稳，基准不可靠

function die(msg, code = 1) { console.error(msg); process.exit(code); }

/**
 * 一次调用。**不给无 body 的请求加 Content-Type** ——
 * 服务端对带该头却空 body 的请求直接 BAD_REQUEST 拒收，而它看起来很像「没权限」。
 */
async function api(path, key, { soft = false } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60_000)
    });
  } catch (e) {
    if (soft) return { __soft: `网络错误：${e.message}` };
    die(`请求失败：${e.message}`);
  }
  const env = await res.json().catch(() => null);
  if (!env) {
    if (soft) return { __soft: `${res.status} 返回不是 JSON` };
    die(`${res.status} 返回不是 JSON`);
  }
  // 🔴 信封层的 notice = 「你安装的 skill 有更新」，与 data 里的业务 notice **不是一回事**。
  //    走 stderr，别污染 stdout 的 JSON。
  if (env.notice) console.error(`[notice] ${env.notice}`);
  if (!env.success) {
    const { code, message } = env.error || {};
    if (res.status === 401) {
      die(`[401 ${code}] ${message}\n🔴 密钥无效或缺失。让用户去密钥中心检查——**别跳过这一步**，跳过等于蒙着写。`);
    }
    if (soft) return { __soft: `[${res.status} ${code}] ${message}` };
    die(`[${res.status} ${code}] ${message}`);
  }
  return env.data;
}

/**
 * 中位数。**不用算术均值**——公众号阅读数是典型长尾分布，一篇爆款就能把均值拉到
 * 绝大多数文章之上，于是它们全部落进「低量」，而「低·低」的处方是
 * 「选题就错了，回到选题层重做」⇒ 一篇爆款让这个号其余所有文章都被建议推翻重做，
 * 越活跃的号被坑得越狠。中位数对单个异常值免疫，这正是这里要的性质。
 * 偶数个取中间两个的平均，与统计学定义一致。
 */
/** 带 body 的写请求（POST/DELETE）。与 api() 同一信封纪律。 */
async function apiWrite(path, key, { method = "POST", body = undefined, soft = false } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000)
    });
  } catch (e) {
    if (soft) return { __soft: `网络错误：${e.message}` };
    die(`请求失败：${e.message}`);
  }
  const env = await res.json().catch(() => null);
  if (!env) { if (soft) return { __soft: `${res.status} 返回不是 JSON` }; die(`${res.status} 返回不是 JSON`); }
  if (env.notice) console.error(`\n⚠️ ${env.notice}\n`);
  if (!env.success) {
    const msg = `${env.error?.code ?? res.status}：${env.error?.message ?? "未知错误"}`;
    if (soft) return { __soft: msg };
    die(msg, res.status === 401 ? 2 : 1);
  }
  return env.data;
}

function median(nums) {
  const xs = [...nums].sort((a, b) => a - b);
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * 四象限分类。**纯函数**，selfcheck 直接打它。
 * x 轴 = 阅读数；y 轴 = 点赞率（点赞 ÷ 阅读）。基准 = 这个账号自己在这两轴上的**中位数**。
 * 返回 { tier, baseline, reliable, items[] }；readCount 全空时 items 为空且 reason 说明原因。
 */
export function classify(articles) {
  const usable = (articles || []).filter(
    (a) => typeof a.readCount === "number" && a.readCount > 0
  );
  if (!usable.length) {
    return { reliable: false, reason: "readCount 全为空（公开数据查不到），拿不到指标", items: [] };
  }
  const rate = (a) => (typeof a.likeCount === "number" ? a.likeCount : 0) / a.readCount;
  const midRead = median(usable.map((a) => a.readCount));
  const midRate = median(usable.map(rate));
  const QUAD = {
    "hi-hi": { name: "高·高 成功范式", fix: "沉淀成模板，复制它" },
    "lo-hi": { name: "低量·高共鸣", fix: "**只修标题，正文一个字别动**" },
    "hi-lo": { name: "高量·低共鸣", fix: "修正文，标题别动" },
    "lo-lo": { name: "低·低", fix: "选题就错了，回到选题层重做" }
  };
  const items = usable.map((a) => {
    const k = `${a.readCount >= midRead ? "hi" : "lo"}-${rate(a) >= midRate ? "hi" : "lo"}`;
    return {
      title: a.title ?? "(无标题)",
      readCount: a.readCount,
      likeCount: a.likeCount ?? 0,
      rate: +(rate(a) * 100).toFixed(2),
      quadrant: QUAD[k].name,
      fix: QUAD[k].fix
    };
  });
  return {
    reliable: usable.length >= MIN_BASELINE,
    baseline: { medianRead: Math.round(midRead), medianRatePct: +(midRate * 100).toFixed(2), n: usable.length },
    items
  };
}

/**
 * 从档案行里取口吻基准与禁用词。**纯函数**，selfcheck 直接打它。
 *
 * 🔴 给**正文**而不是布尔：charter 只报 hasCharter、范文只报 sampleCount，正文都要
 * agent 自己再取一次 —— 而「要现取的东西大概率取不到」在这个仓已经反复应验。
 * 口吻基准与禁用词必须在场，否则等于没存：这两项在本次接线之前**一次都没被读过**。
 *
 * 形状按最宽处理：蒸馏产物来自用户自己的模型，字段可能缺、可能类型漂移，
 * 任何一种都只该降级成「没有」，不该让整条写作链炸掉。
 */
export function readVoice(profileRow) {
  const dna = profileRow?.writingDnaJson ?? null;
  const voiceSystemPrompt =
    typeof dna?.voiceSystemPrompt === "string" && dna.voiceSystemPrompt.trim()
      ? dna.voiceSystemPrompt.trim()
      : null;
  const taboos = Array.isArray(dna?.taboos)
    ? dna.taboos.filter((t) => typeof t === "string" && t.trim())
    : [];
  return { dna, voiceSystemPrompt, taboos };
}

/**
 * 从写作规范正文里切出「平台硬约束」那一节（§1.2 或等价标题）。**纯函数**，selfcheck 直接打它。
 * 只认标题里带「硬约束」的那一节，取到下一个同级或更高级标题为止；找不到返回 null。
 * 🔴 这一节违反了会整篇发布失败或内容静默丢失，所以文本版 prep 必须把它整段打出来，
 *    而不是只报一句「已拉到」—— 「已拉到」不等于「进了上下文」。
 */
export function extractHardConstraints(specText) {
  if (typeof specText !== "string") return null;
  const lines = specText.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s.*硬约束/.test(l));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join("\n").trim();
}

/** 章程关键字段一行一个；空串照打「(空)」，让 agent 看见哪里没填而不是猜。 */
function charterLines(c) {
  const v = (x) => (typeof x === "string" && x.trim()) ? x.trim() : "(空)";
  return [
    `  一句话定位  ${v(c.positioning?.oneLiner)}`,
    `  赛道/标签   ${v(c.positioning?.niche)} / ${v(c.positioning?.tag)}`,
    `  写给谁看    ${v(c.audience?.persona)}`,
    `  变现路径    ${v(c.monetization?.path)}`,
    `  北极星      ${v(c.northStar?.metric)}`
  ];
}

/**
 * 素材库索引的文本行。**纯函数**，selfcheck 直接打它。
 * 🔴 三态必须可区分：有卡打清单；空库明说「是空的」并给存法；拉取失败降级说一句、
 *    不阻断写作（同写作规范的降级纪律）——「空」与「坏」外部长得一样时，坏会被当成空忽略。
 */
function materialLines(matData) {
  if (matData?.__soft) return [`素材库   没拉到（${matData.__soft}）：跳过这一层照常写，别重试刷屏。`];
  const cards = Array.isArray(matData?.materials) ? matData.materials : [];
  const rcs = Array.isArray(matData?.reviewConclusions) ? matData.reviewConclusions : [];
  const lines = [];
  if (!cards.length) lines.push("素材库   是空的（写完这篇若收到真经历，交付后可提议存卡：material save）");
  else {
    lines.push(`素材库   ${cards.length} 张卡（A 组缺锚点先查这里；全文 material get <id>，用前向用户核实还作数吗）`);
    for (const c of cards) lines.push(`  · [${c.kind === "feedback" ? "反馈" : "素材"}] ${c.proof}（适用：${(c.forms ?? []).join("/") || "?"}）#${c.id}`);
  }
  for (const r of rcs) lines.push(`  · [复盘快照] ${r.title}`);
  return lines;
}

async function prep(key, asJson) {
  const profile = await api("/api/ip-profile", key);
  if (!profile?.profile) {
    die("档案是空的（还没建档）。\n" +
        "🔴 **别带着空档案硬写** —— 先去 `dby-charter` 用 L0 三问（5 分钟）把定位立起来。\n" +
        "   没有靶子写出来的东西「哪句都对但不知道给谁看」，那正是本包要根治的病。", 3);
  }
  const id = profile.profile.id;
  const [charter, samples, spec, materials] = await Promise.all([
    api(`/api/ip-profile/${id}/charter`, key, { soft: true }),
    api(`/api/ip-profile/${id}/samples`, key, { soft: true }),
    api("/api/wechat/writing-spec", key, { soft: true }),
    api("/api/materials", key, { soft: true })   // 第五样：素材卡索引（免费）
  ]);
  const sampleList = Array.isArray(samples?.samples) ? samples.samples : (Array.isArray(samples) ? samples : []);

  // 文风 DNA 就在上面那次 /api/ip-profile 的返回体里 —— 不额外调接口。
  const { dna, voiceSystemPrompt, taboos } = readVoice(profile.profile);

  const out = {
    profileId: id,
    profileName: profile.profile.name ?? null,
    hasCharter: !!(charter && !charter.__soft && charter.charter),
    // 🔴 给正文不给布尔：hasCharter=true 却不给章程，agent 还得再取一次 —— 而「要现取的东西
    //    大概率取不到」在这个仓已经反复应验。范文同理，正文就是红线一唯一合法的细节来源。
    charter: (charter && !charter.__soft && charter.charter) ? charter.charter : null,
    // 人设与个人产品（含 ctaScript）就在 /api/ip-profile 的返回体里，直接带出，不另开请求。
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
  // 文风 DNA 的三种缺失分开说：没蒸过 / 蒸过但这一项空 / 禁用词空。
  // 都不是错误，但都要让用户知道成稿会「不像他」，别默默按通用口吻写完交差。
  if (!dna)
    out.warnings.push("这个档案还没蒸过文风 DNA —— 成稿会是通用口吻。想写得像本人，去 dby-charter 用范文蒸一份。");
  else if (!voiceSystemPrompt)
    out.warnings.push("文风 DNA 里没有 voiceSystemPrompt —— 口吻只能靠范文和章程推，比蒸好的基准弱一档。");
  if (dna && taboos.length === 0)
    out.warnings.push("文风 DNA 里没有禁用清单（taboos 为空）—— AI 味的词没有硬性拦截，写完自己再过一遍。");

  if (asJson) return console.log(JSON.stringify(out, null, 2));
  console.log(`档案     ${out.profileName ?? "(未命名)"}  id=${out.profileId}`);
  console.log(`号章程   ${out.hasCharter ? "有" : "无"}`);
  if (out.charter) for (const l of charterLines(out.charter)) console.log(l);
  console.log(`个人产品 ${out.products.length ? out.products.map((p) => `${p?.name ?? "?"}${p?.ctaScript ? "（有 ctaScript）" : "（无 ctaScript）"}`).join("、") : "(空)"}`);
  console.log(`范文     ${out.sampleCount} 篇${out.sampleCount ? "（正文用 --json 取 samples[].content）" : ""}`);
  for (const x of out.samples) console.log(`  · ${x.title ?? "(无标题)"}  ${x.wordCount ?? "?"} 字`);
  console.log(`写作规范 ${out.writingSpec ? "已拉到" : "没拉到"}`);
  for (const l of materialLines(materials)) console.log(l);
  // 硬约束整段打出来：违反会整篇发布失败或内容静默丢失，「已拉到」不等于「进了上下文」。
  const hard = extractHardConstraints(out.writingSpec?.spec);
  if (hard) console.log(`\n${hard}`);
  else if (out.writingSpec) console.log("\n⚠️ 规范里没找到「硬约束」标题的那一节 —— 用 --json 读 writingSpec.spec 全文。");
  // 口吻基准打全文而不是「有/无」—— 它就是要被读进去当写作基准的那段话。
  if (out.voiceSystemPrompt) {
    console.log(`\n口吻基准（写之前先读它，这是这个号的声音）：\n${out.voiceSystemPrompt}`);
  }
  if (out.taboos.length) {
    console.log(`\n禁用清单（词或规则，硬性）：\n${out.taboos.map((t) => `  - ${t}`).join("\n")}`);
  }
  if (out.warnings.length) {
    console.log("\n注意：");
    for (const w of out.warnings) console.log(`  ⚠️ ${w}`);
  }
  console.error("\n下一步：四样都在手了再动笔。硬约束那一节不是建议 —— 违反了会整篇发布失败或内容被静默丢掉。");
}

async function topics(key, niche) {
  const q = niche ? `?niche=${encodeURIComponent(niche)}` : "";
  const d = await api(`/api/wechat/topics${q}`, key);
  const list = d.topics ?? [];
  // data 层的 notice 是**业务提示**（例如「请先填写关键词或设置赛道」），
  // 与信封层那个「skill 有更新」不是一回事 —— 两个都要转达，但别混为一谈。
  if (d.notice) console.error(`[提示] ${d.notice}`);
  if (!list.length) return console.log("没有候选选题。换个赛道关键词，或去档案里把赛道设上。");
  for (const t of list) {
    console.log(`· ${t.title ?? "(无标题)"}`);
    if (t.angle) console.log(`  切角：${t.angle}`);
    if (t.why) console.log(`  为什么现在：${t.why}`);
    if (Array.isArray(t.refs) && t.refs.length) console.log(`  参考：${t.refs.length} 条`);
  }
  console.error("\n🔴 用户已经说了写什么的话，别调这条 —— 直接用他说的。");
}

async function review(key) {
  const d = await api("/api/wechat/review", key);
  if (d.state === "no_account") die("这个账号还没绑公众号，复盘拿不到数据。", 3);
  if (d.state === "no_articles") die(`公众号「${d.account?.nickname ?? "?"}」绑了但还没发过文章，没有可复盘的对象。`, 3);
  const arts = d.lastWeek?.articles ?? [];
  const r = classify(arts);

  // 🔴 每次输出都要写明用的是哪一档 —— 代理档绝不能被说成「打开率 × 分享率」。
  console.log("指标档：**代理档**（横轴=阅读数，纵轴=点赞÷阅读）。");
  console.log("真实的打开率与分享率在微信数据统计里、需额外授权，这个接口拿不到。");
  console.log("阅读数受推荐流影响、不等于粉丝打开；点赞率反映共鸣，跟分享率相关但不等价。\n");

  if (!r.items.length) return console.log(`拿不到指标：${r.reason}。如实告诉用户，别用点赞数单独硬凑一个象限判定。`);
  console.log(`基准（这个号自己的历史**中位数**，n=${r.baseline.n}）：阅读 ${r.baseline.medianRead}，点赞率 ${r.baseline.medianRatePct}%`);
  if (!r.reliable)
    console.log(`⚠️ 只有 ${r.baseline.n} 篇（少于 ${MIN_BASELINE}），**样本太少、基准不可靠，本次仅供参考** —— 不许照常给结论。`);
  console.log();
  for (const it of r.items)
    console.log(`  ${it.quadrant.padEnd(14)} ${String(it.readCount).padStart(7)} 阅 / ${it.rate}%  ${it.title}\n${" ".repeat(18)}→ ${it.fix}`);
  console.error("\n🔴 只给一处修复动作。四象限的全部价值就在于把修改面收敛到一处，别对同一篇同时给多个方向。");
  console.error("升级路径：让用户去公众号后台「内容分析 → 单篇文章」拿真实打开率与分享率贴回来，按真值档重跑。");
}

/**
 * 往期文章按关键词筛（标题或正文命中即算，大小写不敏感；不传关键词则全给）。**纯函数**，selfcheck 直接打它。
 * 服务端已给 `text`（去标签正文）；老返回体只有 `content` 时就地去一次标签。
 */
export function filterArticles(list, q) {
  const kw = String(q ?? "").trim().toLowerCase();
  const items = (Array.isArray(list) ? list : []).map((a, i) => ({
    idx: i + 1,
    id: a?.articleId ?? null,
    title: a?.title ?? "",
    url: a?.url ?? null,
    publishedAt: a?.publishedAt ?? null,
    text: typeof a?.text === "string" && a.text
      ? a.text
      : String(a?.content ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
  }));
  if (!kw) return items;
  return items.filter((a) => a.title.toLowerCase().includes(kw) || a.text.toLowerCase().includes(kw));
}

/**
 * 第 4 步收素材 · 自己的往期文章。
 * 🔴 走 /api/ip-profile/wechat-history（密钥可用、免费），**不走 /api/articles** ——
 *    那条只认登录态，拿密钥调必回 UNAUTHORIZED（2026-08-24 实测）。
 * ponytail: 天花板 = 上游一次最多 20 篇，--q 只在最近 20 篇里筛；升级路径 = 服务端给 /api/articles 开密钥鉴权后换过去。
 */
async function articles(key, { q, id }) {
  const r = await api("/api/wechat/review", key);
  const appid = r?.account?.appid;
  if (r?.state === "no_account" || !appid) die("这个账号还没绑公众号，拉不到往期文章 —— 素材阶梯里这一层跳过，别停下来问。", 3);
  const d = await api(`/api/ip-profile/wechat-history?authorizerAppid=${encodeURIComponent(appid)}&count=20`, key);
  const items = filterArticles(d?.articles, id ? "" : q);
  if (id) {
    const a = items.find((x) => x.id === id || String(x.idx) === String(id));
    if (!a) die(`最近 20 篇里没有序号 / id 为 ${id} 的文章。`, 3);
    console.log(`# ${a.title}\n出处：${a.url ?? "(无链接)"}  发布：${a.publishedAt ?? "?"}\n\n${a.text}`);
    return;
  }
  if (!items.length) return console.log(q ? `最近 20 篇里没有命中「${q}」的。` : `公众号「${r.account?.nickname ?? "?"}」还没有已发文章。`);
  for (const a of items) console.log(`${a.idx}. ${a.title}  ${String(a.publishedAt ?? "?").slice(0, 10)}  ${a.url ?? ""}`);
  console.error("\n取正文：node scripts/write.mjs articles --id <序号>。写进素材单时出处写「往期文章《标题》+ 链接」。");
}

async function material(key, args) {
  const [sub, ...rest2] = args;
  if (sub === "list") {
    const d = await api("/api/materials", key);
    for (const l of materialLines(d)) console.log(l);
    return;
  }
  if (sub === "get") {
    const id = rest2[0] || die("用法：material get <id>");
    const d = await api(`/api/materials/${encodeURIComponent(id)}`, key);
    const c = d.card;
    console.log(`proof   ${c.proof}\nkind    ${c.kind}\n时间    ${c.event?.time ?? "?"}\n地点    ${c.event?.place ?? "?"}\n后果    ${c.event?.outcome ?? "?"}\n出处    ${c.evidence ?? "?"}\n适用    ${(c.forms ?? []).join("/")}${c.label ? `\n标签    ${c.label.pattern} → ${c.label.quadrant}` : ""}\n更新    ${c.updatedAt}`);
    console.error("\n⚠️ 卡是写入那刻的快照 —— 用前向用户核实「这卡还作数吗」；写进正文要进素材单（出处写「素材卡 #id」）。");
    return;
  }
  if (sub === "save") {
    // 🔴 只在用户确认卡面之后调用。stdin 或参数收卡面 JSON，agent 侧先蒸馏。
    let raw = rest2.find((x) => !x.startsWith("--"));
    if (!raw && rest2.includes("--stdin")) raw = await new Promise((r) => { let b = ""; process.stdin.on("data", (d) => b += d); process.stdin.on("end", () => r(b)); });
    if (!raw) die("用法：material save '<卡面JSON>' 或 material save --stdin（字段：proof/event{time,place,outcome}/evidence/forms[]；feedback 另需 kind/label/articleId）");
    let body; try { body = JSON.parse(raw); } catch (e) { die(`卡面不是合法 JSON：${e.message}`); }
    const d = await apiWrite("/api/materials", key, { body });
    console.log(d.created ? `已存：${d.card.proof}  #${d.card.id}` : `已存在（幂等命中，未重复写入）：#${d.card.id}`);
    return;
  }
  if (sub === "del") {
    const id = rest2[0] || die("用法：material del <id>");
    await apiWrite(`/api/materials/${encodeURIComponent(id)}`, key, { method: "DELETE" });
    console.log(`已删除 #${id}（硬删，索引即时不含）`);
    return;
  }
  die("用法：material list | get <id> | save '<json>'|--stdin | del <id>");
}

function selfcheck() {
  // 基准必须来自入参本身，不许有任何外部/行业常数
  const arts = [
    { title: "A", readCount: 1000, likeCount: 100 }, // 高量 高共鸣(10%)
    { title: "B", readCount: 100,  likeCount: 20  }, // 低量 高共鸣(20%)
    { title: "C", readCount: 1000, likeCount: 10  }, // 高量 低共鸣(1%)
    { title: "D", readCount: 100,  likeCount: 1   }  // 低量 低共鸣(1%)
  ];
  const r = classify(arts);
  const q = Object.fromEntries(r.items.map((i) => [i.title, i.quadrant]));
  if (!q.A.startsWith("高·高")) die(`🔴 A 应为高·高，实为 ${q.A}`);
  if (!q.B.startsWith("低量·高共鸣")) die(`🔴 B 应为低量·高共鸣，实为 ${q.B}`);
  if (!q.C.startsWith("高量·低共鸣")) die(`🔴 C 应为高量·低共鸣，实为 ${q.C}`);
  if (!q.D.startsWith("低·低")) die(`🔴 D 应为低·低，实为 ${q.D}`);
  if (r.items.find((i) => i.title === "B").fix.indexOf("只修标题") < 0)
    die("🔴 低量·高共鸣的处方必须是「只修标题」");

  // 🔴 长尾偏斜：一篇爆款不许把其余全部打成「低量」。
  //
  // 这条抓的是上面那条「放大 10 倍」**抓不到**的东西 —— 等比放大时均值与中位数一起放大，
  // 分类当然不变，所以那条只证明了「没有绝对阈值」，证明不了「基准选得对」。
  // 而公众号阅读数是典型长尾：9 篇 500 + 1 篇 50000 时
  //   算术均值 = 5450  ⇒ 那 9 篇全部 < 基准 ⇒ 全判「低量」
  //   中位数   = 500   ⇒ 那 9 篇全部 >= 基准 ⇒ 判「高量」
  // 而「低·低」的处方是「选题就错了，回到选题层重做」——
  // 用均值等于**让一篇爆款把这个号其余所有文章都判成选题错误**，越活跃的号被坑得越狠。
  const longTail = [
    ...Array.from({ length: 9 }, (_, i) => ({ title: `T${i}`, readCount: 500, likeCount: 25 })),
    { title: "BOOM", readCount: 50000, likeCount: 2500 }   // 点赞率与其余持平，只有阅读量是异常值
  ];
  const lt = classify(longTail);
  const lowVolume = lt.items.filter((i) => i.quadrant.startsWith("低")).length;
  if (lowVolume > 1)
    die(
      `🔴 长尾偏斜：10 篇里有 ${lowVolume} 篇被判「低量」——` +
      `一篇爆款不该把其余全部打成低量。基准多半用了算术均值而不是中位数。`
    );

  // 基准取自本账号：整体放大 10 倍，分类结果必须完全不变（说明没有绝对阈值）
  const scaled = arts.map((a) => ({ ...a, readCount: a.readCount * 10 }));
  const q2 = Object.fromEntries(classify(scaled).items.map((i) => [i.title, i.quadrant]));
  if (JSON.stringify(q) !== JSON.stringify(q2))
    die("🔴 放大 10 倍后分类变了 —— 说明用了绝对阈值而不是这个号自己的中位数");

  // 基准可靠性：门槛两侧都要测，否则测不出门槛在不在
  if (classify(arts.slice(0, 3)).reliable) die("🔴 只有 3 篇却判基准可靠");
  if (r.reliable) die(`🔴 只有 ${arts.length} 篇（<${MIN_BASELINE}）却判基准可靠`);
  const five = [...arts, { title: "E", readCount: 500, likeCount: 50 }];
  if (!classify(five).reliable) die(`🔴 ${five.length} 篇（>=${MIN_BASELINE}）却判基准不可靠`);

  // readCount 全空必须拒绝分类，而不是用点赞硬凑
  const blind = classify([{ title: "X", readCount: null, likeCount: 50 }]);
  if (blind.items.length) die("🔴 readCount 全空时仍给出了象限判定");

  // 破坏演练：证明上面的断言不是恒真
  const bad = { items: [{ title: "A", quadrant: "低·低" }] };
  if (bad.items[0].quadrant.startsWith("高·高")) die("🔴 破坏演练失效");

  // ── readVoice：口吻基准与禁用词的取用 ────────────────────────────────────────
  // 这两项在接线之前一次都没被读过，所以这一组断言的作用是「防止它再次掉线」。
  const canonical = {
    writingDnaJson: {
      version: 1,
      language: { highFreqWords: ["说白了"] },
      taboos: ["赋能", "在当今时代"],
      voiceSystemPrompt: "你现在以一位十年后端的口吻写作：多用短句，少用感叹号。"
    }
  };
  const v = readVoice(canonical);
  if (v.voiceSystemPrompt !== canonical.writingDnaJson.voiceSystemPrompt)
    die("🔴 规范形状的 voiceSystemPrompt 没被取出来");
  if (v.taboos.join() !== "赋能,在当今时代") die("🔴 规范形状的 taboos 没被取出来");

  // 三种缺失都只该降级成「没有」，不该抛
  if (readVoice({ writingDnaJson: null }).voiceSystemPrompt !== null) die("🔴 没蒸过 DNA 时应为 null");
  if (readVoice({}).taboos.length) die("🔴 老档案无该字段时 taboos 应为空");
  if (readVoice({ writingDnaJson: { voiceSystemPrompt: "   " } }).voiceSystemPrompt !== null)
    die("🔴 空白串必须当没有 —— 否则会把一段空白当成口吻基准");

  // 形状漂移：蒸馏产物来自用户自己的模型，类型不对只能降级，不能炸
  if (readVoice({ writingDnaJson: { taboos: "赋能" } }).taboos.length)
    die("🔴 taboos 非数组时必须降级成空，不能让 join 炸掉整条写作链");
  if (readVoice({ writingDnaJson: { taboos: ["赋能", "", "  ", 42, null] } }).taboos.join() !== "赋能")
    die("🔴 taboos 里的空串与非字符串没被滤掉");

  // 🔴 接线元断言：prep 的输出里必须真的带上这两项。
  // 光有 readVoice 正确没用 —— 它不被 prep 输出就等于没接线，而那正是这次要修的病。
  // 读 prep 自己的源码（函数对象自带 toString，不必读文件、不引依赖）。
  const prepSrc = prep.toString();
  if (!/voiceSystemPrompt,/.test(prepSrc) || !/taboos,/.test(prepSrc))
    die("🔴 prep 的 out 里没有 voiceSystemPrompt / taboos —— 接线掉了");
  if (!prepSrc.includes("readVoice(")) die("🔴 prep 没有调用 readVoice");
  // 请求数上限：文风 DNA / persona / products 必须从已有返回体取（那次接线的原判据），
  // 素材索引（material-bank）是**新的第五样**、有自己的路由，合法占一次 ⇒ 上限 4 → 5。
  // 🔴 这个数不是「随手加」：每抬一次都要能指出新请求对应哪一样必备物，否则就是在偷懒开请求。
  const apiCalls = (prepSrc.match(/api\(/g) ?? []).length;
  if (!/persona:/.test(prepSrc) || !/products:/.test(prepSrc)) die("🔴 prep 的 out 里没有 persona / products —— ctaScript 取不到");
  if (apiCalls > 5) die(`🔴 prep 的 api 调用变成 ${apiCalls} 次 —— 已有返回体里的东西不许另开请求（5 = 档案+章程+范文+规范+素材索引）`);

  // ── extractHardConstraints：硬约束节必须被整段切出来 ────────────────────────
  const spec = [
    "# 写作规范", "## 一、结构建议", "### 1.1 什么内容写成什么结构", "- 引用块",
    "### 1.2 平台硬约束（违反会整篇发布失败）", "- 🔴 标题不要写进正文。", "- 表格最多 3~4 列。",
    "### 1.3 文章级结构", "- front matter", "## 二、本主题的呈现"
  ].join("\n");
  const hard = extractHardConstraints(spec);
  if (!hard || !hard.startsWith("### 1.2")) die("🔴 没切到硬约束节");
  if (!hard.includes("表格最多 3~4 列")) die("🔴 硬约束节被截短了");
  if (hard.includes("1.3") || hard.includes("front matter")) die("🔴 硬约束节切过头，混进了下一节");
  if (extractHardConstraints("# 无此节\n- 内容") !== null) die("🔴 没有硬约束节时应返回 null");
  if (extractHardConstraints(null) !== null) die("🔴 非字符串应返回 null");
  // prep 接线：--json 必须带 charter 与 samples 正文，文本版必须打硬约束
  if (!/charter:/.test(prepSrc) || !/samples:/.test(prepSrc) || !/content:/.test(prepSrc))
    die("🔴 prep 的 out 里没有 charter / samples[].content —— 接线掉了");
  if (!prepSrc.includes("extractHardConstraints(")) die("🔴 prep 文本版没打硬约束节");

  // ── filterArticles：第 4 步收素材的关键词筛 ────────────────────────────────
  const hist = [
    { articleId: "a1", title: "公众号打开率怎么算", content: "<p>会话&nbsp;阅读÷送达</p>", url: "https://mp.weixin.qq.com/s/1", publishedAt: "2026-08-01T00:00:00.000Z" },
    { articleId: "a2", title: "选题", text: "标题党会被降权", url: null, publishedAt: null }
  ];
  const all = filterArticles(hist, "");
  if (all.length !== 2 || all[0].idx !== 1 || all[1].idx !== 2) die("🔴 不传关键词时应全给且序号从 1 起");
  if (all[0].text !== "会话 阅读÷送达") die(`🔴 老返回体只有 content 时应去标签得纯文本，实为 ${JSON.stringify(all[0].text)}`);
  if (all[1].text !== "标题党会被降权") die("🔴 服务端已给 text 时应原样用");
  if (filterArticles(hist, "打开率").map((a) => a.id).join() !== "a1") die("🔴 标题命中应筛出 a1");
  if (filterArticles(hist, "降权").map((a) => a.id).join() !== "a2") die("🔴 正文命中应筛出 a2");
  if (filterArticles(hist, "不存在的词").length) die("🔴 无命中应为空");
  if (filterArticles(null, "x").length || filterArticles(undefined, "").length) die("🔴 非数组输入应降级成空，不能炸");
  // 🔴 接线元断言：articles 必须走 wechat-history，绝不能走只认登录态的 /api/articles。
  const artSrc = articles.toString();
  if (!artSrc.includes("/api/ip-profile/wechat-history")) die("🔴 articles 没走 wechat-history");
  if (/api\(`\/api\/articles/.test(artSrc) || /api\("\/api\/articles/.test(artSrc)) die("🔴 articles 走了 /api/articles —— 密钥调它必回 UNAUTHORIZED");

  console.log("selfcheck ok: classify（四象限 / 基准取自本账号非绝对阈值 / 样本不足标不可靠 / 无阅读数拒判 / 反向可红）");
  console.log("selfcheck ok: extractHardConstraints（切到 / 不截短 / 不过头 / 缺节为 null / prep 接线）");
  console.log("selfcheck ok: readVoice（规范形状 / 三种缺失 / 两种形状漂移 / 接线元断言）");
  console.log("selfcheck ok: filterArticles（全给 / 标题命中 / 正文命中 / 无命中 / 去标签 / 非数组降级 / 走 wechat-history 不走 /api/articles）");

  // ── materialLines：素材库索引的三态（material-bank 2.1/2.3）────────────────
  // 🔴 三态必须可区分：空库、拉取失败、有卡各有各的话——「空」与「坏」长一样时，
  //    坏会被当成空忽略（执行者不可观测的老毛病）。
  const withCards = materialLines({
    materials: [{ id: "ki_1", proof: "被拒 37 次仍能成单", kind: "material", forms: ["带转折的真实经历"] }],
    reviewConclusions: [{ title: "上周表现最佳《X》" }]
  });
  if (!withCards.some((l) => l.includes("被拒 37 次仍能成单") && l.includes("#ki_1")))
    die("🔴 有卡时索引行没打 proof 与 id");
  if (!withCards.some((l) => l.includes("[复盘快照]") && l.includes("《X》")))
    die("🔴 review_conclusion 行没带出 —— 它的第一个读取端又掉线了");
  if (!withCards.some((l) => l.includes("还作数吗")))
    die("🔴 索引没提醒「卡是快照、用前核实」");
  const empty = materialLines({ materials: [], reviewConclusions: [] });
  if (!empty.some((l) => l.includes("是空的"))) die("🔴 空库必须明说「是空的」");
  if (empty.some((l) => l.includes("没拉到"))) die("🔴 空库与拉取失败混成一态了");
  const soft = materialLines({ __soft: "网络错误：boom" });
  if (!soft.some((l) => l.includes("没拉到") && l.includes("照常写"))) die("🔴 拉取失败必须降级说一句、不阻断写作");
  if (soft.some((l) => l.includes("是空的"))) die("🔴 拉取失败与空库混成一态了");
  // 🔴 接线元断言：prep 必须真调 materialLines 与 /api/materials，material 子命令必须已注册。
  //    没有这两条，上面全绿也可能是「函数对但没人调」（写了等于没写）。
  if (!prepSrc.includes("materialLines(") || !prepSrc.includes("/api/materials"))
    die("🔴 prep 没接素材索引 —— 第五样掉线");
  if (!/materials:/.test(prepSrc)) die("🔴 prep 的 --json 没带 materials[]");
  const matSrc = material.toString();
  if (!matSrc.includes("/api/materials") || !matSrc.includes("DELETE")) die("🔴 material 子命令没打真路由");
  console.log("selfcheck ok: materialLines（有卡 / 空库 / 拉取失败三态可区分 + prep 与 material 子命令接线元断言）");
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "selfcheck") { selfcheck(); process.exit(0); }
const KEY = process.env.DOUBAOYA_API_KEY;
if (!KEY) die("缺 DOUBAOYA_API_KEY。doubaoya.com → 登录 → 密钥中心 → 生成，export 后再跑。");
if (cmd === "prep") await prep(KEY, rest.includes("--json"));
else if (cmd === "topics") await topics(KEY, rest.find((a) => !a.startsWith("--")));
else if (cmd === "review") await review(KEY);
else if (cmd === "material") await material(KEY, rest);
else if (cmd === "articles") {
  const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  await articles(KEY, { q: opt("--q"), id: opt("--id") });
}
else die("用法：node scripts/write.mjs prep [--json] | topics [赛道] | articles [--q 关键词] [--id 序号] | material <list|get|save|del> | review | selfcheck");
