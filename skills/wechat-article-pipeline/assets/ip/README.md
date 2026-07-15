# assets/ip/ — 你的卡通 IP 形象图放这里

把你的**卡通 IP 形象图**（一张即可，如吉祥物/主播形象）放进本目录，例如：

```
assets/ip/benya.png
```

然后在 `config.json` 里把 `ipImage` 指向它（相对本 skill 目录）：

```json
{ "ipImage": "assets/ip/benya.png" }
```

## 它是干什么的

设计工作台（`scripts/design-studio.mjs`）与生图脚本（`scripts/gen-image.mjs`）会把这张图作为
**参考图条件化生成**封面与配图——生成的图会**保留这张 IP 里的形象**（同一只鸭/同一个吉祥物），
让全篇视觉统一。走 doubaoya 密钥接口的 `operation:"edit"` + `referenceImage`。

- 工作台顶部会显示「当前 IP」缩略图；也可在页面里直接**上传一张 IP 图**，会存进本目录并写进当次
  `design-config.json` 的 `ip.path`。
- 不注册 IP（`ipImage` 为空、本目录为空）时，封面/配图退回**文生图**，行为与旧版一致。

## 建议

- 用背景干净、形象清晰的单主体图（PNG/JPG 均可）。
- 这是你自己的素材，属于你个人；本目录**不应**提交到公共仓库（仓库只保留本说明）。
