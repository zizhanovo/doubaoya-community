# 删一个 Skill 之前必须走完的 checklist

> 给**维护者**看的，不随包分发。删包的动作本身很简单（`git rm -r skills/<slug>`），
> 难的是删完之后**能力还在、但没人找得到**——这是我们已经踩过的坑，不是假想。

## 为什么需要这份 checklist

删包时最容易漏的判断是：**「能力还在架」不等于「用户还够得着」**。

判据只有一条，且已被实测钉死：

> **`description` 是每一轮白送进上下文的；其他任何东西都要 agent 自己主动去取。**
> 一个平庸但**在场**的 description，永远赢过一个完美但要**现取**的 summary。

两条支撑这条判据的实测（2026-08-18）：

- **`llms.txt` 完全不顶用**：全仓 grep，43 个包的 SKILL.md 与 references 提到 `llms.txt`
  的次数是 **0**。装了全家桶的 agent 没有任何一处会告诉它去 fetch 它。
  所以「能力条目还留在 llms.txt 里」**不构成**能力仍可发现的证据。
- **网关的能力索引也不顶用**：`doubaoya-gateway/references/capability-index.md` 是
  **references**，只有 agent 已经决定要读网关之后才会被加载。而选 skill 那一刻，
  它不在场。索引在场是**必要条件，不是充分条件**。

真实后果举例：删掉 `wechat-channels-ai-feed` 后，全仓 description 里带「视频号」的只剩
两个包，其中一个是 `multi-rewrite`（一个**文案改写工具**）。用户说「视频号最近什么在爆」，
词面上最可能被勾中的是那个改写工具——路没断死，但从「一跳命中」退化成了多跳链，每跳都可能掉。

## Checklist（五步，缺一不可）

1. **列出待删包 `description` 里的全部触发词**（连同 `Trigger words:` 那一行）。
2. **逐词在存活包的 `description` 里 grep**——口径就是 `description`，别拿正文、
   README、references、llms.txt 充数。
3. **零命中的词必须迁**：
   - 迁进一个**意图对得上**的存活包的 `description`（通常是 `doubaoya`）；
   - 🔴 **同时**在该包正文的意图路由表里**加一行完整调用路径**（「用户这么说 → 打哪条路径」）。
     光能被匹配上不够，agent 还得知道**怎么调**。
   - 🔴 **不要**往 `doubaoya-gateway` 的 `description` 里塞业务话术——它明确声明自己
     不接业务意图（"它**不**负责「帮我写文章 / 挖选题 / 做封面 / 查违禁词」这类活"），
     塞进去会让它自相矛盾，并把业务意图误导进一个基础设施 Skill。
4. **迁完再 grep 一遍确认零漏**。
   ⚠️ **按「意图」核，别按「包」核。** 已经栽过一次：同一条 `api.xhs.cozeData` 上抢回了
   「笔记分析」一个词，却漏掉「笔记拆解 / 笔记对标 / 对标分析 / 选题拆解 / 爆款结构」五个——
   因为人是按*包*想的，而用户的话术是按*意图*来的。**一个端点补回一个词不算完成。**
5. **才允许删**。删完还要过 `tools/validate_community.py` 的
   `validate_retired_discoverability`（已下架包当年打的端点必须仍在能力索引里），
   以及 `validate_routing_skill_pointers`（路由表不许指向已删的包）。

## 例外：真删除的能力不要补词

如果删的是**能力本身**（不只是壳），就**不该**迁词——迁了等于承诺一个不存在的能力。
已知两例：

- `wechat-mp-exporter`：本地扫码归档工具，vendored 第三方 + Snyk Critical，能力随包一起没了。
- `celebrity-slice`：它指向的 `/api/apis/media/asr` **在生产上根本不存在**（全库 84 个端点里
  没有 `platform=media`，任何调用直接 404、连日志都不落），从建站起就是死壳。

这类包应登记进 `RETIRED_WITH_CAPABILITY`（判据是**发现接口里也确实没有了**，不是
「我们不想要了」），那张豁免表会自动清账：能力哪天回到索引里，闸会反过来要求把豁免删掉。

## 还没做、但迟早要做的

把第 2、4 步做成脚本（触发词倒排：**每个在架端点至少要有 N 个意图词覆盖**）。

🔴 判据必须是 **N 个而不是 1 个**——见第 4 步那条教训：抢回一个词就能骗过「至少 1 个」的闸。

⚠️ 这道闸当下**立不起来**，因为它会立刻打红：`gzh-search` ≡ `gongzhonghao-search`、
`xiaohongshu-hot-notes` / `xiaohongshu-search` 存在同端点抢词。**闸绿的前提是先合并同名能力**，
那是另一趟车。在它建起来之前，这份 checklist 就是唯一的防线——请老老实实手工走完。
