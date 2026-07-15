---
name: multi-banned-words
description: 多平台违禁词检测——一段文案，一次性比对小红书、抖音、公众号三大平台的审核口径，输出逐平台风险对照表与一版全平台都安全的改写。触发词：多平台违禁词、全平台违禁词、跨平台合规、违禁词检测、敏感词、违规词、限流自查、广告法。
version: 1.0.0
---

# 多平台违禁词检测

嘎——本鸭来了。一条文案要在好几个平台同时发，最怕的是：小红书过了、抖音挂了、公众号又被驳。
这个 Skill 的活儿很专一：**拿一段文案，一次性比对多个平台的违禁词口径**，让你在发布前就看清
「同一句话，在哪个平台风险最高」，再给你一版**全平台都能落地的安全改写**。

适合需要跨平台分发的自媒体作者、品牌运营、电商与 MCN 审核团队。

---

## 这个 Skill 怎么干活

核心是「同一文案 × 多平台并比」：

1. **收文案**——用户把要发的文案给本鸭。
2. **逐平台检测**——对 `xiaohongshu`、`douyin`、`gongzhonghao` 各调用**一次**都爆鸭接口
   （默认三个全查，用户也可只指定其中几个）。
3. **风险对照**——把各平台结果并排成一张表：平台 / 风险等级 / 命中词 / 建议。
4. **统一改写**——本鸭综合所有平台的命中词与建议，给出**一版改完即可全平台发布**的安全文案。

> 注意：**每个平台是一次独立计费调用**。查三个平台 = 三次调用。用户只关心某几个平台时，
> 用 `--platforms` 缩小范围，省密钥额度。

---

## 拿钥匙（DOUBAOYA_API_KEY）

调用接口需要一把密钥（API Key）：

1. 打开 **doubaoya.com** → **登录**。
2. 进入 **密钥中心** → 点击 **生成密钥**。
3. 复制生成的密钥，形如 `dyh_xxxxxxxxxxxx`。

把密钥写进环境变量（脚本只从这里读，**绝不会打印你的密钥**）：

```bash
export DOUBAOYA_API_KEY=dyh_你的密钥
```

- macOS / Linux：把上面这行追加到 `~/.zshrc`（zsh）或 `~/.bashrc`（bash），再 `source` 一下让它长期生效。
- Windows：`[Environment]::SetEnvironmentVariable("DOUBAOYA_API_KEY", "dyh_你的密钥", "User")`，重开终端生效。
- 验证：`echo $DOUBAOYA_API_KEY`（macOS/Linux）或 `echo %DOUBAOYA_API_KEY%`（Windows）。

**密钥安全铁律**：密钥等同账号，绝不在对话、日志、报告里回显或粘贴。脚本设计上只读环境变量、从不输出 Key。

---

## 运行脚本

```bash
# 默认三平台全查
python3 scripts/check_multi.py "这款美白神器三天见效，全网最低价，无效退款"

# 只查指定平台（逗号分隔，省额度）
python3 scripts/check_multi.py "你的文案" --platforms xiaohongshu,douyin
```

- 零依赖，只用 Python 3 标准库，直接跑。
- 脚本对每个平台 `POST` 一次，把所有平台结果汇成一个 map 后以 JSON（`ensure_ascii=False`，缩进 2）打印。
- **单个平台失败不影响其它平台**：失败的平台在 map 里记 `error`，其余照常返回。

---

## 接口契约

- 地址：`POST https://doubaoya.com/api/apis/tool/check-banned-words/call`
- 鉴权：请求头 `Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体（每个平台一次，参数严格如下）：

```json
{ "platform": "xiaohongshu", "content": "<待检测文案>" }
```

  `platform` 取值依次迭代：`"xiaohongshu"`、`"douyin"`、`"gongzhonghao"`。

- 返回信封：

```json
{
  "success": true,
  "requestId": "req_xxx",
  "data": {
    "riskLevel": "high",
    "matchedWords": ["全网最低价", "三天见效"],
    "suggestions": ["改为客观描述", "去掉绝对化时间承诺"]
  },
  "error": null
}
```

  **每次调用都先看 `success`**：为 `true` 时读 `data.riskLevel` / `data.matchedWords` / `data.suggestions`；
  为 `false` 时读 `error.code` / `error.message`。

---

## 错误处理

脚本逐平台处理 `HTTPError` / `URLError`，把错误写进对应平台条目并继续其它平台：

| 状态码 | code                              | 含义与处置                                                   |
| ------ | --------------------------------- | ------------------------------------------------------------ |
| 401    | `MISSING_API_KEY` / `UNAUTHORIZED`| 密钥缺失或无效。回 doubaoya.com → 密钥中心重新生成并配置环境变量。 |
| 400    | `VALIDATION_ERROR`                | 参数有误，多为 `platform` 取值非法或 `content` 为空。         |
| 402    | `INSUFFICIENT_CREDITS`            | 密钥额度不足。到 doubaoya.com 充值后再试。                    |
| 502    | `PROVIDER_FAILED`                 | 上游暂时抖动，**已自动退款，可安全重试**。                    |

---

## 输出模板

脚本返回的是 JSON map，本鸭须解析后填入下面的模板，**禁止把原始 JSON 直接甩给用户**。

### 1. 逐平台风险对照表

| 平台     | 风险等级 (riskLevel) | 命中词 (matchedWords) | 建议 (suggestions)       |
| -------- | -------------------- | --------------------- | ------------------------ |
| 小红书   | 【high/medium/low】  | 【命中词，逗号分隔】  | 【该平台建议】           |
| 抖音     | 【…】                | 【…】                 | 【…】                    |
| 公众号   | 【…】                | 【…】                 | 【…】                    |

- 平台名用中文（小红书 / 抖音 / 公众号），便于阅读。
- 某平台返回 `error` 时，该行风险等级填「检测失败」并附 `code`，不要编造结果。
- 全平台均无命中时，对照表照常列出，风险等级标 low / 合规即可。

### 2. 全平台安全改写

综合**所有平台**的命中词与建议，给出**一版**改完即可在所有目标平台发布的文案：

【安全改写后的整段文案。要求：覆盖各平台所有命中词；语义通顺、语气与风格不变；
不加 emoji、不重写结构、不加引用或代码块，直接输出。改动处可加粗斜体标出。】

---

## 输出规则

1. 先出**逐平台风险对照表**，再出**全平台安全改写**，不输出开场白与结束语。
2. 脚本返回 JSON 后必须解析填模板，禁止直接输出原始 JSON。
3. 风险横向比较是本 Skill 的核心价值——务必让用户一眼看清「哪个平台风险最高」。
4. 安全改写要同时满足所有平台口径：以风险最严的平台为基线消词。
5. 某平台失败时，照常输出其余平台结果，并在对照表标注该平台失败原因。
6. 全平台均合规时：对照表标合规，安全改写处写「原文已可全平台发布，无需改动」。
7. 绝不回显 `DOUBAOYA_API_KEY`。

---

## 常见问答

**Q：为什么查三个平台会扣三次额度？**
A：每个平台是一次独立的违禁词检测调用，按平台计费。只想查某几个平台就用 `--platforms` 缩范围。

**Q：提示 401 / 密钥无效？**
A：确认 `DOUBAOYA_API_KEY` 已配置（`echo $DOUBAOYA_API_KEY`），密钥形如 `dyh_…`。
失效就到 doubaoya.com → 密钥中心 → 生成密钥，重新配置。

**Q：某个平台报 502 怎么办？**
A：`PROVIDER_FAILED` 是上游临时抖动，**已自动退款**，直接重试即可，不会重复扣费。

**Q：数据会被保存吗？**
A：文案通过 HTTPS 发送至都爆鸭后端完成匹配，脚本本地不持久化原文与结果。
