// output.mjs — 输出信封的唯一出口。stdout 只放数据；进度 / 警告 / 提示一律 stderr。
// 渲染函数是纯函数（返回字符串），emit* 才写流 —— 测试直接打纯函数。

import { paint } from "./context.mjs";

/** JSON 三态里的机器形态：单个对象、2 空格缩进、末尾换行。逐字节稳定（不看 TTY）。 */
export function renderJson(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

/** 成功：{ok:true, data}；人类模式打 humanText（由各命令渲染）。 */
export function emitSuccess(ctx, data, humanText = "", streams = process) {
  if (ctx.json) {
    streams.stdout.write(renderJson({ ok: true, data }));
    return;
  }
  if (humanText) streams.stdout.write(humanText.endsWith("\n") ? humanText : humanText + "\n");
}

/** 失败信封（纯函数）：error 三键齐全，remediation 没有也占位 null —— 键集是契约，只增不改。
 *  err.data 存在时并进信封（doctor 有项不过时仍要给逐项结果）。 */
export function failureEnvelope(err) {
  return {
    ok: false,
    ...(err.data !== undefined ? { data: err.data } : {}),
    error: { code: err.code ?? "ERROR", message: err.message, remediation: err.remediation ?? null }
  };
}

/** 失败：JSON 模式 stdout 放信封；无论哪种模式 stderr 都说一句人话（stderr 是自由通道）。 */
export function emitFailure(ctx, err, streams = process) {
  if (ctx.json) streams.stdout.write(renderJson(failureEnvelope(err)));
  else if (err.human) streams.stdout.write(err.human.endsWith("\n") ? err.human : err.human + "\n");
  streams.stderr.write(paint(ctx, "red", `[${err.code ?? "ERROR"}] ${err.message}`) + "\n");
  if (err.remediation) streams.stderr.write(`处置：${err.remediation}\n`);
}

/** 确认协议信封（纯函数）。字段名与 proposal 完全一致：status / changes / confirmCommand。 */
export function confirmationEnvelope(c) {
  return { ok: false, status: "confirmation_required", changes: c.changes, confirmCommand: c.confirmCommand };
}

export function emitConfirmation(ctx, c, streams = process) {
  if (ctx.json) {
    streams.stdout.write(renderJson(confirmationEnvelope(c)));
  } else {
    const lines = ["本次操作会产生计费或不可逆副作用，默认不执行。将要发生："];
    for (const ch of c.changes) {
      lines.push(`  · ${ch.action} ${ch.ref ?? ""}  ${ch.title ?? ""}  计费：${ch.price ?? "?"}`.trimEnd());
    }
    lines.push(`确认无误后原样重放：${c.confirmCommand}`);
    streams.stdout.write(lines.join("\n") + "\n");
  }
  streams.stderr.write("已停在 confirmation_required（退出码 6），未产生任何服务端副作用。\n");
}

/** 进度 / 警告 / 提示：永远 stderr。 */
export function warn(ctx, line, streams = process) {
  streams.stderr.write(paint(ctx, "yellow", line) + "\n");
}
