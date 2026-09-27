# Changelog — @doubaoya/cli

CLI 与随包分发的 dby-* skills 共用这一个版本号（dby-cli-rebuild design D10）。每个发布版本一节。

## 2.0.0-next.0（未发布）

- CLI 独立成 npm 包 `@doubaoya/cli`（bin `dby`），零运行时依赖，需要 Node ≥22；低于 22 时退出码 3，不联网、不写文件。
- `exports` 只暴露 bin 与 package.json，内部模块不可被外部 import。
- 请求带 `User-Agent: doubaoya-cli/<版本>`；`dby --version --json` 输出 `{ok,data:{version}}`。
- 命令表每条命令标注 `kind: route|composite|local`（`dby routes --json` 多一个字段，旧字段不变）。
- 凭证只有两层：环境变量 `DOUBAOYA_API_KEY` 优先，其次 `~/.doubaoya/credentials`（0600，宽于 0600 时 stderr 警告）；`whoami` 回报 `keySource` 与 key 前缀，任何输出都不含完整 key。
- 新增 `dby login`（设备码：屏幕给码，在已登录网页手动输入并批准；非交互环境约 100 秒返回 pending，`dby login --continue` 续跑）与 `dby logout`（请服务端吊销凭证文件里的那把 key 再删文件；离线时照删并以退出码 5 提示去网页撤销）。
