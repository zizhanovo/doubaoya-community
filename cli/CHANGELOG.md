# Changelog — @doubaoya/cli

CLI 与随包分发的 dby-* skills 共用这一个版本号（dby-cli-rebuild design D10）。每个发布版本一节。

## 2.0.0-next.0（未发布）

- CLI 独立成 npm 包 `@doubaoya/cli`（bin `dby`），零运行时依赖，需要 Node ≥22；低于 22 时退出码 3，不联网、不写文件。
- `exports` 只暴露 bin 与 package.json，内部模块不可被外部 import。
- 请求带 `User-Agent: doubaoya-cli/<版本>`；`dby --version --json` 输出 `{ok,data:{version}}`。
- 命令表每条命令标注 `kind: route|composite|local`（`dby routes --json` 多一个字段，旧字段不变）。
