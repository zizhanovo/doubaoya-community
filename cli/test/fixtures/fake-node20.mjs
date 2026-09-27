// fake-node20.mjs — 测试预加载：把 process.versions.node 伪装成 20.x（tasks 2.2 的「注入 20.x」）。
// 生产代码里没有任何测试钩子；版本检查读的就是 process.versions.node。
Object.defineProperty(process, "versions", { value: { ...process.versions, node: "20.11.1" }, configurable: true });
