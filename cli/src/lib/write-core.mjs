// write-core.mjs — 写作主干的纯函数层，逐函数移植自 skills/dby-write/scripts/write.mjs
//（迁移期两边并存；对拍测试钉住行为一致）。分类是算术不是判断，判断仍归 agent。

export const MIN_SAMPLES = 3;   // 范文少于这个数，成稿像不像要如实说
export const MIN_BASELINE = 5;  // 少于这个数，中位数基准不可靠

/**
 * 中位数。**不用算术均值**——公众号阅读数是典型长尾分布，一篇爆款就能把均值拉到
 * 绝大多数文章之上，让其余全部被判「低量」；中位数对单个异常值免疫。
 */
export function median(nums) {
  const xs = [...nums].sort((a, b) => a - b);
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * 四象限分类。x 轴 = 阅读数；y 轴 = 点赞率。基准 = **这个账号自己的历史中位数**，
 * 绝不引入行业平均值（二手孤证、跨算法时代）。
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
 * 从档案行里取口吻基准与禁用词。形状按最宽处理：蒸馏产物来自用户自己的模型，
 * 字段可能缺、类型可能漂移，任何一种都只降级成「没有」，不炸链。
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
 * 从写作规范正文里切出「平台硬约束」那一节。只认标题里带「硬约束」的那一节，
 * 取到下一个同级或更高级标题为止；找不到返回 null。
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
