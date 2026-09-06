# @doubaoya/cli — 开发夹具（design D3）

`dby` 的真正实现已经搬到 [`skills/dby-api/scripts/`](../skills/dby-api/scripts/)（入口 `dby.mjs` +
`lib/`）——那才是随 skill 一起装进用户机器、随时可达的那份代码。

**本目录不发 npm、不是安装单元**，只剩两样东西：

- `test/` —— 针对 `../skills/dby-api/scripts/lib/**` 的测试（`node --test`）；import 路径
  直接指向 skill 目录，不指本目录（本目录已经没有 `src/` 了）。
- `bin/dby.mjs` —— 一层薄转发，`npm link` 后本地得到 `dby` 命令，方便不装 skill 也能手测；
  它转发到 `../skills/dby-api/scripts/lib/cli.mjs` 的 `runCli`，不经过 `dby.mjs` 自己的入口
  守卫（那道守卫是为了防软链误判，本文件的调用路径不涉及软链，用不上）。

## 跑测试

```bash
cd cli && node --test   # 零依赖，不需要 npm install
```

## 改代码去哪

命令实现、参数解析、命令表都在 `../skills/dby-api/scripts/lib/`：

- `argv.mjs` —— 手写参数解析器（无 commander 依赖）
- `registry.mjs` —— 命令表汇总，同一份表驱动解析 / `--help` / `dby routes --json`
- `commands/*.mjs` —— 按资源分组的命令实现，新增命令去对应组的文件里加一条即可
- `context.mjs` / `errors.mjs` / `http.mjs` / `output.mjs` / `confirm.mjs` —— 输出信封 /
  退出码 / 请求层 / 确认协议这几条契约的唯一实现

`skills/dby-api/scripts/doubaoya.mjs` 是上一代入口的转发壳（弃用中，下一个 major 删除），
不要在那里加新逻辑。
