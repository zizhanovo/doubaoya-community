# 执行期边缘情况

> 都是低频分支，撞上时才读；正常跑一遍用不到。

## 旧版遗留副本（项目根 `agent/skills/`）

早期版本会把 skill 装进项目根 `agent/skills/` 而不是 `.claude/skills` / `.agents/skills`。
执行时只把**我方发的**（判据同三态表）移进归档目录（可复原），别人的不动，不打删除命令；`--dry-run` 只报告，不动盘。

## 跑挂在「拉取上游」

脚本已**自动把本轮归档按 manifest 移回原处**，只剩 skills CLI 的安装记录没补——**重跑同一条命令即可**，
不用手动清理。clone 报 `"Remote branch … not found"` = 发布时 tag 没打上去，这是维护者的事，找维护者。

## 本轮名单含 `dby-update` 自己

本进程跑的仍是刚才装的那份旧代码，结尾会提示再跑一次（`--json` 里 `selfUpdated: true`）——
照实转述给用户，**再跑一次 `/dby-update`** 让它用上刚刷新的自己。
