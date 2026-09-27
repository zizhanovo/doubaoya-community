## 调用 dby

1. 先跑 `node -v`：没有 Node 或主版本低于 22 就停下，请用户先装 Node 22+；此时不跑任何 npm / npx。
2. `dby --version` 输出正好是 `{{CLI_VERSION}}` 时，直接 `dby <组> <命令>`。
3. 否则 `npx -y --fetch-timeout=15000 @doubaoya/cli@{{CLI_VERSION}} <组> <命令>`；registry 不可达就加 `--registry=https://registry.npmmirror.com` 重试同一版本，仍失败就停下报告，不换版本。
4. 退出码 4（没有凭证）→ 请用户跑 `dby login`；计费命令超时不重试。
