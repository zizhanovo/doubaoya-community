---
name: dby-update
description: >-
  都爆鸭（doubaoya / 本鸭）skill 对账更新器：把本机这套本鸭 skill 对账成官方仓库的当前全集——归档上游已下架的、
  装上新增的、刷新落后的，最后自检。按内容哈希认包，别人家的和用户自己改过的一个字不动；下架的移进归档目录而不是删除。
  Reconciles the installed doubaoya skills to the upstream set, then self-checks.
  触发方式：/dby-update、更新本鸭、更新都爆鸭、升级 doubaoya skill、检查本鸭更新、把本鸭更新到最新版。
version: 2.0.0
changelog: 随 @doubaoya/cli 2.0.0 统一发版，要点见 CHANGELOG.md
compatibility: >-
  只需要 Node ≥22（经 `dby` 命令运行：全局安装的 dby 或 npx 拉取确切版本 @doubaoya/cli，零依赖）。
  `dby skills update` 查正式版本要能访问 doubaoya.com 与 npmjs（或 npmmirror）；install / status / migrate 不联网。
---

# dby-update：把本鸭更新到当前版

本鸭 2.x 起只有一个安装器：npm 包 `@doubaoya/cli` 自带全部 dby-* skills，由 `dby skills install` 一类命令写进宿主目录。
本包只做指引：装好（或用 npx 拉到）确切版本的 dby，然后跑下面其中一条。不下载文件、不拼路径、不跑任何包内脚本。

## 调用 dby

1. 先跑 `node -v`：没有 Node 或主版本低于 22 就停下，请用户先装 Node 22+；此时不跑任何 npm / npx。
2. `dby --version` 输出正好是 `2.0.0` 时，直接 `dby <组> <命令>`。
3. 否则 `npx -y --fetch-timeout=15000 @doubaoya/cli@2.0.0 <组> <命令>`；registry 不可达就加 `--registry=https://registry.npmmirror.com` 重试同一版本，仍失败就停下报告，不换版本。
4. 退出码 4（没有凭证）→ 请用户跑 `dby login`；计费命令超时不重试。

## 先看清单，再动手

🔴 **每次都显式给 scope**：项目里装的（`.claude/skills` / `.agents/skills` 在项目目录下）用 `--scope project`
（不在当前目录就加 `--dir <项目目录>`）；装在用户目录的用 `--scope user`。不确定就两个都看一眼。

```bash
dby skills status --scope project --json    # 只读：每个包装没装、哪一版、改没改过、是不是 1.x 旧装法
```

把清单原样转述给用户（尤其「改过的」「1.x 旧装法」两栏），用户认可后再执行下面**其中一条**：

| 清单里有 | 跑 | 做什么 |
| --- | --- | --- |
| `legacy`（1.x 用 `npx skills add` / 旧 dby-update 装的，包里带 `scripts/`） | `dby skills migrate --scope <同上>` | 旧目录整体移进 `.dby-archive/`，换入当前版，逐包复核，不过的从归档还原 |
| 其余（`outdated` / `missing` / `current`） | `dby skills update --scope <同上>` | 先查正式版本，再装入当前 dby 随包的那一版 |

- 用户只问「有没有更新 / 现在什么版本」→ 只跑 `status`，**先回答，不执行**。
- `modified`（用户自己改过）默认一个字不动；用户明确要覆盖才加 `--force`（覆盖前自动备份进 `.dby-archive/`）。
- 还装着 1.x 的 `scripts/reconcile.mjs` 也**别再跑它**——它只服务 1.x 到 2.x 的最后一跳，之后一律走 `dby skills update` 或 `dby skills migrate`。

## 结果怎么读

| 退出码 / 错误码 | 意思 | 怎么说 |
| --- | --- | --- |
| 0 | 完成 | 按下节回复 |
| 5 `RELEASE_QUERY_FAILED` / `RELEASE_UNKNOWN` / `REGISTRY_UNREACHABLE` | 查不到正式版本或两个源都连不上；本地一个文件没动 | 「网络不通，稍后再试」；急用可先 `dby skills install` 装当前 dby 随包的版本 |
| 3 `VERSION_NOT_SYNCED` / `INTEGRITY_MISMATCH` | 镜像还没同步这一版 / 两个源内容对不上；没装任何东西 | 「刚发布，镜像还在同步，稍后再试」。🔴 **别改装别的版本** |
| 1 `SKILLS_WRITE_FAILED` | 个别包写盘失败，失败的包已保持原样，其余已更新 | 说是哪几个包、`data.results[].error` 的原因，修好权限或空间后重跑同一条 |

`update` 发现有更新的正式版时会给出升级命令（`npm i -g @doubaoya/cli@<版本>`，没有全局权限用 `npm i -D`）：
dby 不自我升级，把命令转述给用户，由用户决定是否执行；升级后再跑一次 `dby skills update`。

## 回复用户（普通人能看懂）

只说三件事：**结果一句话 → 这次变了什么 → 下一步**。一切正常时不提路径、哈希、scope、`.agents/skills`。

```
更新好了，本鸭现在是 2.x 的同一个版本。
- 旧的 1.x 安装已经整体收进归档（要找回告诉我一声）。
- 你自己改过的 dby-write 没动。
新开一个对话就能用上新版。
```

- 归档了 → 说放在哪、要恢复就说一声；用户改过而跳过的 → 点名；有新版未升级 → 给升级命令。
- 问某个包的版本 → 看 `status` 里的 `installedVersion`（来自包内 `.dby/origin.json`）。

## 边界

- 只碰本鸭发的 dby-* 包；别人家的、用户改过的一个字都不动；下架的移进归档，不删除。
- 不创建后台任务、定时任务或 Agent Hook；不改用户的项目数据与配置。
