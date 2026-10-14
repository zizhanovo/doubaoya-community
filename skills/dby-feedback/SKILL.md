---
name: dby-feedback
description: >-
  给都爆鸭（本鸭）提反馈：用户想报 bug、提建议、吐槽体验时，agent 当场把本次会话里真实发生的经过写成一份完整反馈，
  用户过目全文后提交给维护者；端点不通就落本地文件。触发词：报个bug、报bug、反馈、提个建议、提需求、提意见、
  吐槽、用不了、坏了吧、这里好烦、太难用、用着别扭、能不能改改、给作者/维护者/开发者说一声。
  不做：违禁词检测走 dby-banned-words；更新本鸭走 dby-update；改文案走 dby-rewrite。
version: 2.0.0
changelog: 随 @doubaoya/cli 2.0.0 统一发版，要点见 CHANGELOG.md
compatibility: >-
  只需要 Node ≥22（经 `dby` 命令运行：全局安装的 dby 或 npx 拉取确切版本 @doubaoya/cli，零依赖）。
  提交时需要对反馈端点的 HTTPS 出网；端点未配置或不通时纯本地落盘，不需要凭证。
---

# dby-feedback：现场写好反馈，用户过目后提交

用户遇到问题或想提改进建议时，你（agent）当场把经过写成完整反馈——你在现场，
复现步骤、原始错误文本、实际 vs 期望这三样你天然拿得到，而它们恰恰是用户最难提供的。

## 调用 dby

1. 先跑 `node -v`：没有 Node 或主版本低于 22 就停下，请用户先装 Node 22+；此时不跑任何 npm / npx。
2. `dby --version` 输出正好是 `2.0.0` 时，直接 `dby <组> <命令>`。
3. 否则 `npx -y --fetch-timeout=15000 @doubaoya/cli@2.0.0 <组> <命令>`；registry 不可达就加 `--registry=https://registry.npmmirror.com` 重试同一版本，仍失败就停下报告，不换版本。
4. 退出码 4（没有凭证）→ 请用户跑 `dby login`；计费命令超时不重试。

## 什么时候动

- **用户自然抱怨**（「怎么又失败了」「这里好烦」「这个不对吧」「能不能改改」）→ 提议记一笔反馈：
  **一句话**，不打断他正在做的事，不要求用户先学任何命令。例：「这个问题我可以当场写成反馈提交给维护者，要吗？」
- 提议**可忽略**：用户没回应就继续原任务；同一问题在同一会话内**不再提**第二次（同一错误再次出现也不提）。
- **用户直接点名**（「给作者提个反馈」「报个 bug」）→ 直接进流程，不需要先制造一次失败。
- 🔴 **绝不自动发送**。发送永远发生在用户看过全文并明确同意之后。

## 流程

### 1. 分类并成文

先判定 `bug`（做了某事没得到该有的结果）/ `friction`（结果对了但过程别扭）/ `idea`
（希望多做点什么）三类之一，然后**读 `references/report-protocol.md`**，按该类分支的提问自查成文
（三支问的不是同一套东西；报告骨架固定、节内自由写）。写完按协议做真实性拦截：
**每个细节必须对应本次会话真实发生过的工具调用**，对不上的删掉或标「未核实」；观察与推测分开；
正文只取三类素材（本次会话的动作 / 错误与返回 / 白名单机器事实），绝不引用用户正文与资料。

报告存成一个临时 markdown 文件（如 `feedback-report.md`）。

### 2. 拼载荷（机器事实由 `dby feedback prepare` 按白名单采集）

```bash
dby feedback prepare --category bug \
  --report feedback-report.md --out feedback-payload.json \
  --agent claude-code --command "3:dby write articles"
```

`--command` 是本次会话里执行过的**本仓**命令与退出码（格式「退出码:命令」，可多次）。
机器事实只采白名单：各包 `.dby/origin.json` 的 slug/version/hash/ref/installedAt、scope 根 lock、
Node 版本、操作系统、agent 类型、上述命令。**白名单之外一律不采**——绝不采集
DOUBAOYA_API_KEY 或任何凭证、appid、author、publicAccountName、targetAccount、ipProfile、
用户文章正文、号章程、创作 DNA。别自己动手读配置文件“补充环境信息”，采集只走 `dby feedback prepare`。

`prepare` 与 `submit` 都会对全部待发送内容（含你写的正文）跑凭证与高熵检测：**命中则不发**，按它指出的位置
处理后重新 prepare。

### 3. 用户过目全文

把 `--out` 载荷文件的**全文原样**呈现给用户——这就是将要发出去的那份，
不是摘要、不是改写。呈现后明确问一句「确认提交吗？」。

### 4. 只在明确同意后发送

- 用户明确说发 → `dby feedback submit --file feedback-payload.json --user-consented`
- 用户拒绝或没回应 → **不发**。想留底就 `dby feedback keep --file feedback-payload.json`（只落本地，零请求）；
  不想留就删掉载荷与报告文件。`--user-consented` 只在用户明确同意后才许传。
- 一步式 `dby feedback submit --file feedback-report.md [--category bug|friction|idea]`（内部先 prepare，载荷落在
  `feedback-report.md.payload.json`）只适合**端点未配置、只想落本地**的场景；端点已配置时它同样要 `--user-consented`，
  没带就报错并给出载荷路径——主流程仍是上面的两步式，让用户过目的永远是**载荷全文**。

### 5. 交代结果

- 成功：告诉用户已提交，并给出返回的 requestId（后续追问可引用）。响应里出现 `notice` 字段就原样转达。
- 端点未配置：反馈落成本地 markdown（退出码 0）；端点不通（退出码 5）/ 返回失败（退出码 1）同样落本地。
  把输出里的**绝对路径与手动送达方式**原样告诉用户——反馈已写好，不会因为端点不通而丢。

## 安装标识（对用户怎么说）

随反馈发送一个**本地随机生成的安装标识**：不含用户的任何身份信息（不从机器名/用户名/邮箱/密钥派生），
用户可随时 `dby feedback reset-id` 重置。用户问起时照这句说，
**别用「匿名」二字**——措辞红线见 `references/maintainer-loop.md`（维护者侧的消费路径也在那里）。

## 出岔子了怎么办

- **本机没有 Node / dby** → 报告 markdown 已经写好了，直接给用户留存，并告诉他手动送达方式
  （GitHub 仓库 zizhanovo/doubaoya-community 开 issue 贴入内容）。
- **端点长期不通** → 每次都会落本地文件，如实告诉用户目前只能手动送达，别反复重试刷失败。
- **用户中途改主意** → 立刻停下；已生成的本地文件按用户意愿保留或删除。
