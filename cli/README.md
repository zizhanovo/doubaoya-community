# @doubaoya/cli

都爆鸭工具箱的统一命令入口 `dby`。主要给 AI agent 消费（非 TTY 默认 JSON 信封、退出码分流、计费命令协议化确认），人也能直接用。

- 需 Node ≥20（commander 14 的下限）；各 skill 的旧 `scripts/` 仍支持 Node ≥18，未装 CLI 时作兜底。
- 鉴权：环境变量 `DOUBAOYA_API_KEY`（doubaoya.com 密钥中心生成）。
- 契约：stdout 只放数据；`{ok, data?, error?{code,message,remediation}}`；退出码 0 成功 / 1 一般 / 2 用法 / 3 业务态 / 4 鉴权 / 5 网络超时 / 6 需确认。已发布字段与退出码只增不改，破坏性变更走 major。
- 计费命令默认不执行：返回 `status: "confirmation_required"` + `changes` + 可原样重放的 `confirmCommand`，加 `--confirm` 才真跑。超时不自动重试计费请求——先核实是否已扣点。

## 开发与发布（维护者）

```bash
cd cli && npm install && node --test   # 全绿才许发布
npm version <patch|minor|major>        # 契约破坏必须 major
npm publish --access public            # 手动发布，不进 CI
```
发布后在 skills/dby-api|dby-write|dby-charter 的 SKILL.md 里核对"CLI ≥ x.y"的最低版本声明。
