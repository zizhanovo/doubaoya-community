# Changelog — @doubaoya/cli

CLI 与随包分发的 dby-* skills 共用这一个版本号（dby-cli-rebuild design D10）。每个发布版本一节。

## 2.0.0-next.0 - 2026-09-27

- CLI 独立成 npm 包 `@doubaoya/cli`（bin `dby`），零运行时依赖，需要 Node ≥22；低于 22 时退出码 3，不联网、不写文件。
- `exports` 只暴露 bin 与 package.json，内部模块不可被外部 import。
- 请求带 `User-Agent: doubaoya-cli/<版本>`；`dby --version --json` 输出 `{ok,data:{version}}`。
- 命令表每条命令标注 `kind: route|composite|local`（`dby routes --json` 多一个字段，旧字段不变）。
- 凭证只有两层：环境变量 `DOUBAOYA_API_KEY` 优先，其次 `~/.doubaoya/credentials`（0600，宽于 0600 时 stderr 警告）；`whoami` 回报 `keySource` 与 key 前缀，任何输出都不含完整 key。
- 新增 `dby login`（设备码：屏幕给码，在已登录网页手动输入并批准；非交互环境约 100 秒返回 pending，`dby login --continue` 续跑）与 `dby logout`（请服务端吊销凭证文件里的那把 key 再删文件；离线时照删并以退出码 5 提示去网页撤销）。
- 生图、流水线、抓参考文章改走子命令（design D4）：`dby image gen|edit`（composite，计费，要 `--confirm`，超时绝不重试）、`dby image plan|crops`（本地）、`dby wechat pipeline`（1.x 的 pipeline.mjs 与 preprocess-and-publish.mjs 原样搬入；真发布要 `--confirm`，`--dry-run` / `--render-only` 不需要）、`dby wechat fetch-article`（本地）。
- 新增 `dby render` / `dby preview`：调服务端渲染路由（免费），只写 HTML 文件（preview 另写 375px 预览页），JSON 不带 HTML；离线退出码 5、无凭证退出码 4，不回退任何本地渲染。
- 值类 flag 支持重复给出（如 `--ref a.png --ref b.png`）。
- 单一运行时（design D5）：`dby deai scan|baseline`、`dby rewrite rules`、`dby feedback prepare|submit|keep|reset-id` 取代三份 Python 脚本，全部本地命令；deai 与 Python 逐字段对拍一致后冻结快照，输出不含任何分数字段。
- 单一版本号（design D10）：CLI 与随包的 13 个 dby-* skill 共用 npm 包版本；`cli/scripts/release.mjs` 以 package.json 为源派生 SKILL.md 的 `version:`、调用约定里的确切版本、CHANGELOG 一节，2.x 期间同时生成兼容视图（index.json / versions.json / known-hashes.json，版本字段取包版本），3.0.0 起停止生成；`cli/scripts/prepublish-check.mjs` 在发布前核对零依赖、exports、frontmatter 版本、调用约定版本、镜像哈希、兼容视图版本、版本递增与 CHANGELOG。
- 新增 `dby skills install|update|status|migrate`（design D11）：把随包 skills 写进 `.claude/skills` / `.agents/skills`（项目级或用户级），逐包原子替换、任一包失败只回滚该包，每包写 `.dby/origin.json`；用户改过的包默认不覆盖（`--force` 先备份进 `.dby-archive/`）；软链写真实路径；本 CLI 装过、随包已不再有的包移进归档。`update` 先以 `GET /api/cli/release` 公布的正式版本到 npmjs 与 npmmirror 查同一确切版本（两源一致才算数，绝不改装源上可见的其他版本），查询失败退出码 5 且不写盘；装入的永远是正在运行的 CLI 随包的那一份，有新版时只提示升级命令。`migrate` 把 1.x 渠道装的目录整体归档后换入薄层，逐包复核，不过的从归档还原。
- dby-update 改薄：只指引装好确切版本的 dby 后跑 `dby skills status` 看清单，再 `dby skills migrate`（1.x 旧装法）或 `dby skills update`；不再调用包内对账脚本（1.x 的 reconcile.mjs 只服务最后一跳，随第 5 组删除）。
- 发布走 `.github/workflows/publish-npm.yml`（只能手动触发，OIDC Trusted Publishing + provenance，参数为 dist-tag）：全量测试 → 发布前检查 → `npm publish` → 触发 npmmirror 同步并轮询到版本与 integrity 一致才算发布完成；`publishConfig.registry` 钉死 npmjs（本机 npmrc 指向 npmmirror 时也不会发错地方）。
- ClawHub 上架改为从 npm 包内容生成（`tools/clawhub_publish.py` 默认先隔离 pack 再取包内 `skills/<slug>`，或 `--package` 指定解包目录）：每个 skill 的 `--version` 都等于包版本，包内 SKILL.md 版本漂移直接拒绝。
- 新增 `dby image describe`（`api describe` 的 alias，同一组路由）：现拉生图能力的入参规格与单价，并把字段与可选模型跟 CLI 的认知对账，对不上退出码 3（`CONTRACT_DRIFT`），恢复 1.x `gen.mjs --describe` 的自动对账。
- 新增 `dby draft rename <id> <标题>`（PATCH /api/drafts/:id 的一对一命令）：只改标题、不产生新版本；空标题本地退 2 不发请求，长度上限归服务端。
- `dby login` 在交互终端 best-effort 自动打开确认页（`BROWSER` 环境变量可覆盖，darwin `open` / win32 `cmd /c start` / 其它 `xdg-open`）：打开的还是**不带码**的固定页（D9 防钓鱼口径不变），拉不起来自动退回「手动打开」；非 TTY（agent 调用）不拉。
- `dby banned check` 支持长文案：上游单次 `content` 上限 2000 字，超出时按段落 / 句末标点无损分段后逐段调用，计费 = 平台数 × 段数（确认态逐段列明），多段结果合并成一个平台条目（`segments` 逐段给出）；某段失败时该平台条目带 `BANNED_SEGMENT_FAILED` 且 `content` 为 null，不能当通过；≤2000 字的老用法一字不变。

