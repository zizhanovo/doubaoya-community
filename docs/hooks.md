# 提交钩子：一次内容改动 = 一笔提交

改任何 `skills/**` 之前，先跑一次：

```bash
git config core.hooksPath .githooks
```

**一次就够，但每个 clone 都要各配一次**（`core.hooksPath` 是本机 git config，不随 clone 走）。
本仓没有 `package.json`（零依赖是它的立身之本），所以抄不了主仓那套
`npm prepare` 自动启用 —— 只能手配。

## 它替你做什么

改 `skills/**` 并提交时，钩子把这几样**一并塞进同一笔**：

```
skills/<slug>/.version      内容哈希
versions.json               全仓版本表
known-hashes.json           历史闭集
```

在此之前这是**三笔**：内容 → 版本戳 → 闭集。两个会话在两天里各自重复了五轮以上。

## 为什么这不只是图省事

漏掉版本戳那一笔的后果是**静默的、且专打守规矩的用户**：

```
.version 停在旧哈希
   ↓  服务端从主仓同步的快照算出的是新哈希
判据是「哈希不等即提示，无新旧概念」
   ↓
用户看到「你安装的 skill 有更新」→ 听话升级 → 装到的还是停在旧戳的包
   ↓
提示不消失 —— 永远循环
```

越守规矩的人被打得越狠。而且**任何常规检查都不会因此变红**，推完看到的一切都是绿的。

## 没配也不会静默：闸是独立的

`tools/tests/test_version_stamp_consistency.py` 与钩子无关，`pytest` 与 `pre-push` 都跑得到。

- **钩子是便利** —— 让你不必记得
- **闸是保证** —— 漏了会红

只有钩子的话，没配 `hooksPath` 的人照样能提交出戳与内容不一致的东西 ——
而那正是这套机制要消灭的那种静默。**实测发生过一次**：另一个会话的机器没配，
`.githooks/pre-commit` 静默不跑，是那道闸把「戳落后于内容」抓出来的。

## 两条已知边界

**① 钩子只在 `skills/**` 被动过时才跑。** 只改 `tools/` / `docs/` 的提交零开销。

**② 多会话共用同一工作树时，它只 stage 你本次真正碰过的那几个包的戳。**
`stamp_versions.py` 盖的是全部包，所以早期版本会把**别人在途（未提交）**那些包的戳
一起塞进你的提交，把他的中间状态固化进共享生成物 —— 实测抓到过，已修。
`versions.json` 是全仓聚合物、天然带不了一部分，它含在途值时由闸的
「versions.json 与 .version 漂了」那条报出来，不会静默。

## 绕过

```bash
git commit --no-verify
```

绕过之后戳与内容不一致，上面那条假更新循环就会发生在你的用户身上。
真要绕，记得随后补 `python3 tools/stamp_versions.py && python3 tools/build_known_hashes.py`。
