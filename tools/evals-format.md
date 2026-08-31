# 执行层判据格式：`cases.jsonl`

判据分**三层**（design.md D10），本文件只定义第三层的格式：

| 层 | 测什么 | 放哪 | 判定器 | 成本 |
|---|---|---|---|---|
| 脚本层 | 各包脚本自身的确定性行为（违禁词透传、限额校验、主题安全、渲染保真…） | `tools/tests/` 的 pytest + 包内 `scripts/*.selfcheck.mjs` | pytest / node | 免费、秒级、零抖动 |
| 触发层 | 这句话该不该命中本包 | `skills/<slug>/evals/triggers.jsonl` | `trigger_bench.py` | 短 prompt，便宜 |
| agent 执行层 | **只测需要 agent 才测得出的**：选没选对脚本、参数拼没拼对、结果解释对不对 | `skills/<slug>/evals/cases.jsonl` | `case_bench.py` | 贵（3 轮沙箱 agent 会话），所以要少 |

🔴 **硬规则：能在脚本层测的，不许拿到 agent 层测。** 理由（design.md D10，
2026-08-31 第二轮真跑的账）：拿 3 轮沙箱 agent 会话去测一个确定性脚本的行为，
是用最贵、最抖的手段测最确定的东西——那次真跑 5/5 全抖，一条都定不下来。
agent 执行层不再声称覆盖包的全部行为，它只覆盖**编排正确性**；全面性由脚本层承担。

三层与触发层**并存、互不替代**：触发层回答「这句话该不该命中本包」，
执行层回答「本包被调起之后干得对不对」。一个包触发层通过，绝不等于执行层也通过。
行为契约见 `openspec/changes/skill-quality-gate/specs/skill-quality-gate/spec.md`。

## 每行一条用例

一行一个 JSON 对象（JSONL），字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | str | 包内唯一，报告与基线用它归因，起个能读懂的名字 |
| `prompt` | str | 交给 agent 执行的用户话术。🔴 **必须显式调起本包**（点名 slug，如「用 dby-banned-words 检查：…」），理由见下节 |
| `costly` | bool | 会真实产生外部费用或不可逆副作用（真出图、真扣费）标 `true`。可省略，默认 `false`。标了的用例**默认不跑**，只有 `--include-costly` 才跑，被跳过时会列进报告的「已跳过」一节 |
| `assertions` | array | 非空。逐条独立判定，报告逐条给结果，不许只给整条用例的总体成败 |

## 断言只有两种形态

**`check` —— 脚本可判，按退出码判定，0 为成立：**

```json
{"kind": "check", "cmd": "grep -q '全网最低价' tools.txt"}
```

🔴 **check 打 `tools.txt`（工具结果）或产物文件，不打 `output.txt`（agent 摘要）。**
理由（design.md D10 实测）：同一采样里最终文本 267 字符是摘要、工具结果 2851 字符
才是脚本真实输出；原短语「全网最低价」在工具结果里**有**、最终文本里**没有**——
agent 的表格把命中词按脚本的 span 粒度写成「全网、最低」，措辞每轮都变。
grep 摘要 = 钉沙子，实测 5/5 全抖。

**`assert` —— 模型可判，一句可独立判定成立与否的自然语言陈述：**

```json
{"kind": "assert", "text": "输出对每个命中的违禁词都给出了安全改写建议，而不是只说有风险"}
```

## 🔴 硬规则：凡是能写成 `check` 的，不许写成 `assert`

理由（design.md D1）：模型判定慢、要钱、会抖；产物文件是否存在、HTML 能否解析、
退出码是不是 2、输出里有没有某个词——这些脚本判又快又确定，交给模型是浪费且引入噪声。
`assert` 只留给脚本写不出来的自然语言质量判断（「逐条给出了三平台的比对结果」这类）。

写 `assert` 时锚定**具体的领域细节**，不写「输出合理」「结果正确」这种——
那是 ACE 论文点名的简洁偏见失效模式，grader 只会回 `unclear`。
`unclear` 的语义是**断言本身写得不可判定**：它是用例的缺陷，不是包的缺陷，
报告里与 `fail` 分开计数。收到 `unclear`，改断言，不是改包。

## 🔴 硬规则：执行层 prompt 必须显式调起本包 skill

每条 `prompt` 都要点名本包（`用 dby-banned-words 检查：…` 或 `/dby-banned-words …`
这类），**不许写成靠模型自己路由过来的隐式话术**。

理由（design.md D9，2026-08-31 首轮真跑的实测教训）：分层本来就该这么切——
**触发层管「这句话会不会路由到这个包」，执行层管「包被调起来之后干得对不对」**。
执行层再隐式测一遍路由既冗余又不可控：用户机器上装了多少仓外 skill 决定了候选集
大小，实测在 145 个 skill 的候选集里模型没挑中本包，跑出来的是裸模型散文；
而 prompt 自带平台词的用例靠模型复述问题就能让 `grep` 全绿——绿的是假绿。

### 「skill 未被调用 ⇒ unusable」是自动判据，用例作者不用自己写

判定器以 `claude -p --verbose --output-format stream-json` 运行 executor，
从事件流里读**实际发生的工具调用**（Skill 工具带 `input.skill == 本包`，或任一
工具调用的 input 里出现 `skills/<slug>/` 路径段）。本包 skill 未被调起的那一轮
自动判 `unusable`，绝不走到「断言通过」——所以**不需要**（也无法）在 assertions
里写「skill 被调用了」这类断言；工具调用是机器事实，不靠输出措辞判断。

## 执行环境契约

- 每条用例在**一次性临时目录**里执行，绝不写用户真实工作区。
- 判定器在该目录落两个文件（design.md D10）：
  - `output.txt` —— agent 的**最终文本**（摘要，措辞会变，check 别打它）；
  - `tools.txt` —— 事件流里的**工具结果**（脚本真实 stdout 等机器事实，check 打它）。
- 用例产出的文件（如 rendered.html、plan.json）也落在该目录，check 可直接打产物文件。
- `check` 的 `cmd` 以该临时目录为 cwd 执行——所以 `grep -q ... tools.txt`
  和检查产物文件的相对路径都直接可用。
- `assert` 的陈述交 grader 模型判定，判卷材料**同时含**工具结果与最终回答两段：
  锚在机器事实上的陈述（「命中词与脚本输出一致」）与解释类陈述（「结论解释得对」）
  各取所需。
- 判定默认 3 轮，只有每轮一致的用例计入判定；跨轮不一致的列为「抖动」，
  不计入通过也不计入失败。单轮结果不构成放行依据。

## 完整示例条目（可直接复制改写）

```json
{"id": "banned-orchestration-e2e", "prompt": "用 dby-banned-words 帮我检查这段文案能不能发，我想同时看小红书、抖音、公众号三个平台：全网最低价，无效全额退款", "costly": false, "assertions": [{"kind": "check", "cmd": "grep -q '\"xiaohongshu\": {' tools.txt && grep -q '\"douyin\": {' tools.txt && grep -q '\"gongzhonghao\": {' tools.txt"}, {"kind": "check", "cmd": "grep -q '全网最低价' tools.txt"}, {"kind": "assert", "text": "最终回答对三个平台分别给出判定结论，且命中词与工具结果里脚本报出的 span 粒度一致，没有编造脚本输出里不存在的命中词"}, {"kind": "assert", "text": "最终回答给出了一版具体的全平台安全改写文案，而不是只说存在风险"}]}
```

逐条对着三层分工读这个示例：

- prompt 显式点名了本包（上一节的硬规则）。
- 第一条 check 打 `tools.txt` 里脚本输出的**平台键**（`"xiaohongshu": {`）——
  证明三平台扇出真的发生了（选对脚本 + 参数拼对）。不能只 grep 平台中文名：
  prompt 自带平台词时，裸模型复述问题就能让摘要 grep 变绿（D9 实测的假绿）。
- 第二条 check 打 `tools.txt` 里的 `originalContent`——证明 agent 把用户文案
  **原样**传给了脚本。注意它打的是工具结果不是摘要：这句话在摘要里实测**不存在**。
- 两条 assert 判「解释对不对」与「改写给没给」——脚本层测不了 agent 的解释与改写
  （接口不返回改写建议），这正是 agent 执行层存在的理由。
- 「违禁词透传保真 / 命中词 span 粒度 / 无语境过滤」这些确定性判据**不在这里**——
  它们在脚本层 `tools/tests/test_check_multi.py`（mock HTTP，免费零抖动），
  在 agent 层再写一遍就违反「能在脚本层测的不许拿到 agent 层测」。
- 「skill 被调用了」不用写——判定器从事件流自动验证，未调用整轮判 `unusable`。
