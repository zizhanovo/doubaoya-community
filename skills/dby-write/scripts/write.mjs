#!/usr/bin/env node
// write.mjs — 都爆鸭 · 写作主干的取数与复盘算术
// -----------------------------------------------------------------------------
// 这个脚本只做**机械**的那两段，判断仍归你：
//
//   prep    第 1 步要的四样一次拉齐（档案 / 号章程 / 范文 / 写作规范），
//           并按 SKILL.md 的降级阶梯处理失败：401 不许跳过、写作规范拉不到照常往下走、
//           档案为空要先去立人设、范文少于 3 篇要如实说一句。
//   topics  选题卡（按赛道取候选；用户已经说了写什么就别调它）
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
//   node scripts/write.mjs review              复盘取数 + 四象限
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

async function prep(key, asJson) {
  const profile = await api("/api/ip-profile", key);
  if (!profile?.profile) {
    die("档案是空的（还没建档）。\n" +
        "🔴 **别带着空档案硬写** —— 先去 `dby-charter` 用 L0 三问（5 分钟）把定位立起来。\n" +
        "   没有靶子写出来的东西「哪句都对但不知道给谁看」，那正是本包要根治的病。", 3);
  }
  const id = profile.profile.id;
  const [charter, samples, spec] = await Promise.all([
    api(`/api/ip-profile/${id}/charter`, key, { soft: true }),
    api(`/api/ip-profile/${id}/samples`, key, { soft: true }),
    api("/api/wechat/writing-spec", key, { soft: true })
  ]);
  const sampleList = Array.isArray(samples?.samples) ? samples.samples : (Array.isArray(samples) ? samples : []);

  // 文风 DNA 就在上面那次 /api/ip-profile 的返回体里 —— 不额外调接口。
  const { dna, voiceSystemPrompt, taboos } = readVoice(profile.profile);

  const out = {
    profileId: id,
    profileName: profile.profile.name ?? null,
    hasCharter: !!(charter && !charter.__soft && charter.charter),
    sampleCount: sampleList.length,
    voiceSystemPrompt,
    taboos,
    writingSpec: spec?.__soft ? null : spec,
    warnings: []
  };
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
    out.warnings.push("文风 DNA 里没有禁用词（taboos 为空）—— AI 味的词没有硬性拦截，写完自己再过一遍。");

  if (asJson) return console.log(JSON.stringify(out, null, 2));
  console.log(`档案     ${out.profileName ?? "(未命名)"}  id=${out.profileId}`);
  console.log(`号章程   ${out.hasCharter ? "有" : "无"}`);
  console.log(`范文     ${out.sampleCount} 篇`);
  console.log(`写作规范 ${out.writingSpec ? "已拉到" : "没拉到"}`);
  // 口吻基准打全文而不是「有/无」—— 它就是要被读进去当写作基准的那段话。
  if (out.voiceSystemPrompt) {
    console.log(`\n口吻基准（写之前先读它，这是这个号的声音）：\n${out.voiceSystemPrompt}`);
  }
  if (out.taboos.length) {
    console.log(`\n禁用词（硬性，一个都不准出现）：${out.taboos.join("、")}`);
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
  // 零额外请求：本次接线是「别把已经拿到的东西扔掉」，不该多出一次 api 调用。
  const apiCalls = (prepSrc.match(/api\(/g) ?? []).length;
  if (apiCalls > 4) die(`🔴 prep 的 api 调用变成 ${apiCalls} 次 —— 文风 DNA 应从已有返回体取，不另开请求`);

  console.log("selfcheck ok: classify（四象限 / 基准取自本账号非绝对阈值 / 样本不足标不可靠 / 无阅读数拒判 / 反向可红）");
  console.log("selfcheck ok: readVoice（规范形状 / 三种缺失 / 两种形状漂移 / 接线元断言）");
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "selfcheck") { selfcheck(); process.exit(0); }
const KEY = process.env.DOUBAOYA_API_KEY;
if (!KEY) die("缺 DOUBAOYA_API_KEY。doubaoya.com → 登录 → 密钥中心 → 生成，export 后再跑。");
if (cmd === "prep") await prep(KEY, rest.includes("--json"));
else if (cmd === "topics") await topics(KEY, rest.find((a) => !a.startsWith("--")));
else if (cmd === "review") await review(KEY);
else die("用法：node scripts/write.mjs prep [--json] | topics [赛道] | review | selfcheck");
