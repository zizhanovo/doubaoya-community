---
name: dby-update
description: |
  都爆鸭（doubaoya / 本鸭）skill 更新器。用户说「更新本鸭」「升级 doubaoya skill」「把本鸭更新到最新版」
  「检查本鸭更新」或输入 /dby-update 时使用。只同步官方仓库 zizhanovo/doubaoya-community，
  不更新你安装的其他 skill，也不动你本地的 config.json / 创作 DNA / 产出文件。
  Updater for the doubaoya (本鸭) skills. Use when the user asks to update, upgrade, or check updates for doubaoya skills.
  Trigger: /dby-update, 更新本鸭, 升级 doubaoya skill, 检查本鸭更新.
version: 1.0.0
---

# dby-update：更新本鸭 skill

用户已明确要求更新都爆鸭（本鸭）skill。直接执行更新，不再做第二次文字确认；宿主若要 Shell 权限，由用户在宿主权限窗口里决定。

## 更新范围

- **只更新官方仓库** `zizhanovo/doubaoya-community` 里的 skill。
- **不更新**你安装的其他来源的 skill。
- **不动你的本地数据 / 配置**：`wechat-article-pipeline` 的 `config.json`、`ip-profile` 的创作 DNA、封面 / 草稿等产出文件都不受影响——更新只覆盖 skill 自身的代码与说明。
- 不创建后台任务、定时任务或 Agent Hook。

## 执行步骤

1. 运行以下命令，把官方 doubaoya-community 的全部 skill 同步到已支持的 Agent：

   ```bash
   npx -y skills add zizhanovo/doubaoya-community -g --all
   ```

   - `add zizhanovo/doubaoya-community`：**只从我们这个仓库拉**，天然不碰别的仓库 / 别的 skill。
   - `--all`：等价于 `--skill '*' --agent '*' -y`，覆盖式拉齐本仓库的全部 skill、免逐个确认。
   - `-g`：更新全局（user-level）那一份。**当初带 `-g` 装的必须带 `-g` 更**，否则更新不到全局那份。若当初是项目级安装，去掉 `-g` 在项目目录里跑。

   > 不要用无参数的 `npx skills update`——它会更新你安装的**所有** skill（包括别人的），超出本鸭范围。要按仓库精确更新就用上面的 `add … --all`。

2. 命令成功后，告诉用户更新完成。当前 Agent 若没立即重读 skill，**提醒用户新建一次对话**再用新能力。

3. 命令失败时，用一句话说清失败原因和用户要处理的权限 / 网络问题；除非用户要，别把完整终端日志贴出来。

## 回复格式

成功：

> 本鸭 skill 已更新完成，你的 `config.json` / 创作 DNA / 本地产出都没动。当前对话如果还没读到新能力，新建一次对话即可使用。

失败：

> 本鸭没更新完成：{简短原因}。处理完 {权限或网络问题} 后，再说一次「更新本鸭」。

## 边界

- 用户只问「有什么更新 / 现在什么版本 / 要不要更」→ **先回答，不执行命令**（可参考仓库 README / CHANGELOG）。明确要实际同步时才跑命令。
- 只想更新某一个 skill 时，可用 `npx -y skills update <skill 名> -g`（如 `wechat-article-pipeline`），只碰点名那个。
- 更新前若担心本地 `config.json` 被覆盖：它属于用户个人、按约定本就不进公共仓库，`add … --all` 也只覆盖 skill 目录内的受版本管理文件；仍不放心可先 `cp config.json config.json.bak` 备份。

## 语言

- 用户用中文就用中文回复，用英文就用英文回复。
