# 安装源固定（`ref`）与发布时打 tag

只有维护者发布时需要读；用户侧对账不需要。

## 机制

- `index.json` 顶层 `ref` 是一个 release tag 名（`release-YYYYMMDD-HHMM`），由 `tools/stamp_versions.py` 写入（过渡期生成的 `versions.json` 里也有同一个值，索引拉不到时从那儿读）。
- 对账器读到它就用 `npx skills add zizhanovo/doubaoya-community#<ref>` 安装（`--json` 里 `installRef`），
  保证装到的内容就是版本表声明的那个快照；字段缺失按默认分支 `main` 安装，并在提示里标「安装源未固定」（`installRef: null`）。
- skills CLI 底层是 `git clone --depth 1 --branch <ref>`，只认 branch/tag，不认裸 commit——所以固定单位是 tag。

## 发布清单

1. `python3 tools/stamp_versions.py`——盖版本戳，同时把 `ref` 写进 `index.json`（及生成的 `versions.json`；哈希一个没变就沿用上一次的 ref，不凭空造 tag 名）。
2. 提交、push。
3. 🔴 **打 tag 并推上去**：`git tag <ref> && git push origin <ref>`（脚本在 ref 变化时会打印这条）。
   不打，用户端 `skills add …#<ref>` 会 clone 报 "Remote branch … not found"；对账器不预检 tag 是否存在，只在失败提示里点明。

回滚：删掉 `index.json`（与生成的 `versions.json`）的 `ref` 字段即退回默认分支安装。
