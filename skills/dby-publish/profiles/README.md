# IP / 身份 profile 说明

一个 IP profile 是一份**声明式**的账号身份卡。流水线在最开始（第 2 步「读取身份上下文」）会**加载并回显**它，让下游的内容判断建立在正确的身份认知上——**先加载身份上下文，再做内容判断**。

`profiles/example-ip.json` 是一个**虚构的示例**（`slug: example-daily`，`displayName: 示例·日常号`），只用来演示 schema。请复制它、改成**你自己**账号的身份卡，然后在 `config.json` 的 `ipProfile` 里指向它。

```bash
cp profiles/example-ip.json profiles/my-ip.json
# 编辑 profiles/my-ip.json，然后在 config.json 里把 ipProfile 指向它
```

## 字段

| 字段 | 类型 | 作用 |
|------|------|------|
| `slug` | string | 机器可读的短标识（英文/连字符），用于日志与选路。 |
| `displayName` | string | 账号/IP 的展示名。 |
| `aliases` | string[] | 常见别名/简写。帮助识别用户口语里指的就是这个账号。 |
| `isNot` | string | **消歧句**：明确「这是账号/IP 名，不是同名的通用名词/产品品类」。 |
| `tone` | string | 语气/文风约定。 |
| `visualAnchors` | string[] | 视觉锚点（主色、图标、版式元素），供配图/封面参考。 |
| `coverStyle` | string | 封面风格约定。 |
| `useScenes` | string[] | 典型选题/使用场景。 |
| `forbiddenDrift` | string[] | 明令禁止的跑偏方向（防止内容漂移）。 |

## 为什么要有 `isNot`（消歧的通用规律）

一个账号名/IP 名很可能和某个**通用名词或产品品类**同名。如果 agent 不先加载身份上下文，就可能把这个专有名词**误读成字面意思的通用名词**，于是内容、配图、封面全跑偏。

`isNot` 就是把这条消歧规则**外化成数据**：流水线启动时先读它、回显它，明确「这是账号名，不是那个通用名词」。这是一条**通用规律**——任何账号名都可能和某个日常词/品类撞名，`isNot` 让每个用户为自己的账号写清楚这层区分，从源头堵住「专有名词被当成通用名词」这类误判。
