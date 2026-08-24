// draft-limits.mjs —— 微信 draft/add 官方字段上限的前置校验（花钱之前拦住）。
// 依据：developers.weixin.qq.com「新增草稿」文档（docs/research/dby-publish/01）：
//   title  ≤ 32 字（后台编辑器放宽到 64 字符 → 32~64 只警告，>64 硬错）
//   digest ≤ 120 字（仅单图文有摘要；不填默认抓正文前 54 字）
//   content 必须少于 2 万字符、小于 1M
// 用法：const { errors, warnings } = checkDraftLimits({ title, digest, contentHtml })
// ponytail: 只算 code point 数（Array.from），微信侧「字」的口径未公开；升级路径 = 服务端报错码回传后按它改。

export const LIMITS = Object.freeze({
  TITLE_API: 32,
  TITLE_EDITOR: 64,
  DIGEST: 120,
  CONTENT_CHARS: 20000,
  CONTENT_BYTES: 1024 * 1024,
});

const len = (s) => Array.from(String(s)).length;

export function checkDraftLimits({ title, digest, contentHtml } = {}) {
  const errors = [];
  const warnings = [];
  if (title != null) {
    const n = len(title);
    if (n > LIMITS.TITLE_EDITOR) errors.push(`标题 ${n} 字，超过公众号上限 ${LIMITS.TITLE_EDITOR} 字符。`);
    else if (n > LIMITS.TITLE_API) warnings.push(`标题 ${n} 字，超过 draft/add 文档写的 ${LIMITS.TITLE_API} 字（后台编辑器放到 64），可能被拒。`);
  }
  if (digest != null) {
    const n = len(digest);
    if (n > LIMITS.DIGEST) errors.push(`摘要 ${n} 字，超过公众号上限 ${LIMITS.DIGEST} 字（不填则默认抓正文前 54 字）。`);
  }
  if (contentHtml != null) {
    const n = len(contentHtml);
    const bytes = Buffer.byteLength(String(contentHtml), "utf8");
    if (n >= LIMITS.CONTENT_CHARS) errors.push(`正文 ${n} 字符，公众号要求少于 ${LIMITS.CONTENT_CHARS} 字符。`);
    if (bytes >= LIMITS.CONTENT_BYTES) errors.push(`正文 ${(bytes / 1024 / 1024).toFixed(2)}MB，公众号要求小于 1MB。`);
  }
  return { errors, warnings };
}
