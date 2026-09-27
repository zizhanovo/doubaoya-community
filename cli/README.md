# @doubaoya/cli — `dby`

都爆鸭命令行。零运行时依赖，只需 Node ≥22。

```bash
npm i -g @doubaoya/cli     # 没有全局写权限：npm i -D @doubaoya/cli && npx dby …
dby login                  # 设备码登录：在已登录的 doubaoya.com 确认页手动输入屏幕上的码
dby skills install         # 把随包的 dby-* skills 写进当前项目的 .claude/skills（--scope user 写到 HOME 下）
dby skills migrate         # 从 1.x（npx skills add / dby-update 装的）迁过来：旧目录进 .dby-archive/，换入薄层
dby whoami --json
dby --help
```

凭证只有两层：环境变量 `DOUBAOYA_API_KEY` 优先，其次 `~/.doubaoya/credentials`（0600）。
任何输出都不含完整 key，只显示前缀与来源。

## 开发

- 源码：`src/`（事实源）。`bin/dby.mjs` 是唯一入口，第一件事是 Node 版本检查。
- 测试：`cd cli && node --test`（零依赖，不需要 npm install）。
- 1.x 过渡期：`skills/dby-api/scripts/lib/` 是 `src/` 的逐字节镜像（1.x 用户经 skill 目录里的
  `dby.mjs` 用到的就是这份），改代码只改 `src/`，然后 `node scripts/sync-skill-lib.mjs`；
  `test/skill-lib-mirror.test.mjs` 钉住两边一致。tasks 5.1 把那边改成转发壳后镜像删除。
- 打包：`npm pack` 时 `prepack` 把仓库根 `skills/*/{SKILL.md,references/**}` 与 LICENSE 拷进包，`postpack` 清掉。
- 发版：`node scripts/release.mjs <版本>` 以 package.json 为源派生 13 个 SKILL.md 的版本、调用约定与
  CHANGELOG 一节（先 `--dry-run` 看清单）；发布前 `node scripts/prepublish-check.mjs` 必须全绿。
