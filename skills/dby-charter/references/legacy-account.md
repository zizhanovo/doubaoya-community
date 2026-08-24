# 老号反推（有历史文章的号）

> 只在**这个号已经有历史文章**、要把「从零回答 15 问」变成「逐项校对」时读它。

把最重的输入（从零回答 15 问）变成**校对**（对错勾选）：

1. **拉素材**：
   - `dby-api` 打 `POST /api/apis/gongzhonghao/gongzhonghao-work-list/call` 拉这个号的历史发文；
   - `dby-api` 打账号诊断能力 `skill.wechat.accountAnalyzer`（若已有复盘数据，一并读进来）；
   - `dby-api` 打相似账号推荐 `skill.wechat.similarAccount` 拉同赛道对标账号——顺带完成
     `references/intake.md` 里的**「假定位体检」**
     （说得出 3 家对标账号 + 说得出自己与它们的差异点；说不出，多半是定位没落到真实市场）。
2. **反推**：从素材里反推出整份章程草案——历史选题反推 `positioning`，评论区与打开场景反推 `audience`，
   已有产品 / 广告位 / 引流动作反推 `monetization`。
3. **逐项校对**：把草案**逐字段念给用户核对**（「我从你过去 30 篇看出来的定位是 X，对吗？」），
   改完再逐节确认（红线 7），确认后 PUT 落库。
