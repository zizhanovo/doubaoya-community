# 上手：配置 + 身份 profile

> 只在**第一次用本包**（还没有 `config.json` / 身份卡）时读它。

```bash
# 1. 复制配置模板，填你自己的值（见 config.example.README.md 逐字段说明）
cp config.example.json config.json

# 2. 复制身份 profile 模板，改成你自己账号的身份卡
cp profiles/example-ip.json profiles/my-ip.json
#   再在 config.json 里把 ipProfile 指向 profiles/my-ip.json
```

`config.json` 关键字段：`targetAccount`（多 key 时挑账号）、`appid` / `publicAccountName`（选/校验公众号）、
`ipProfile`（身份卡路径）、`coverFallback`（兜底封面标记）。`null` = 自动探测。**`config.json` 属于你个人，别提交到公共仓库。**

> 找不到 `config.json` 时（本包原名 wechat-article-pipeline，早前跑 `/dby-update` 对账时若对账器
> 还不认识改名表，会把整个老目录连同你自建的 `config.json` / `profiles/` 一起归档），
> `pipeline.mjs` 会自动去 `.doubaoya/archive/` 里探一探，探到了就在 stderr 打印归档路径与
> 可直接粘贴的 `cp` 恢复命令；探不到什么都不打印，不影响现有行为。

### 身份上下文优先（通用规律，不是某个人的故事）

一个账号名 / IP 名很可能和某个**通用名词或产品品类同名**。若不先加载身份上下文，agent 可能把这个
**专有名词误读成字面意思的通用名词**，导致选题、配图、封面全跑偏。profile 里的 **`isNot`** 就是把这条
消歧规则**外化成数据**：流水线第 2 步先读它、回显它，明确「这是账号名，不是那个通用名词」。
示例 profile（`profiles/example-ip.json`，虚构的 `示例·日常号`）演示了 schema——请照它写**你自己**账号的身份卡。
详见 [`profiles/README.md`](../profiles/README.md)。
