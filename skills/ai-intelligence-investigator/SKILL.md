---
name: ai-intelligence-investigator
description: "基于17个搜索引擎的深度情报调查工具，自动编排搜索策略、多源交叉验证消除偏差、生成结构化调查报告。覆盖竞品调查、舆情调查、人物背景调查、信息核实四大场景，全程本地运行、无需任何 API Key。当用户需要做情报调查、竞品调查、舆情调查、信息核实、深度调查、背景调查、产出调查报告时使用。触发词：情报调查、竞品调查、舆情调查、信息核实、深度调查、背景调查、调查报告、多源验证、信息溯源。"
---

# 情报调查员（本地版）

本鸭来当你的情报参谋——基于 17 个搜索引擎的深度情报调查工具，自动编排搜索策略，多源交叉验证，生成结构化调查报告。全程在本地完成，本鸭只负责搜、比、写，不联任何外部平台、不需要任何 API Key。

## 📝 简介

遵循三大原则：**多源必证**（关键信息至少 2 个独立来源确认）、**引擎适配**（根据调查目标自动选择最优引擎组合）、**偏差消除**（对比不同引擎/地区结果，识别信息偏差）。覆盖竞品产品、舆情事件、人物背景、信息真实性四大调查场景，帮你在信息爆炸时代高效拿到可信情报。

## ✨ 功能特性

| 功能模块 | 能力描述 | 核心价值 |
|---------|---------|----------|
| 竞品情报调查 | 多引擎搜索竞品产品功能、用户口碑、市场表现 | 全面了解竞争对手 |
| 舆情事件调查 | 事件还原、多视角收集、时间线重建 | 追踪热点事件真相 |
| 人物背景调查 | 基本信息核实、专业验证、信誉排查 | 商务合作前风险评估 |
| 信息交叉验证 | 信息溯源、多源比对、权威验证 | 确认信息真实性 |
| 引擎自动编排 | 根据调查目标智能匹配最优搜索引擎组合 | 消除单一引擎偏差 |
| 可信度分级 | ABCD 四级信源分级 + 多源确认标注 | 量化信息可信度 |

## 🔄 工作流程

1. **需求确认**：明确调查目标、范围、时间约束
2. **策略编排**：根据目标选择引擎组合与搜索轮次（详见 [engine-strategy.md](references/engine-strategy.md)）
3. **广域扫描**（第1轮）：广泛关键词搜索，建立全景认知
4. **深度挖掘**（第2轮）：细分关键词，挖掘真实反馈
5. **交叉验证**（第3轮）：多源比对，确认关键数据可信度
6. **报告生成**：输出/保存结构化调查报告（本地），带可信度标注，直接交给用户

> 本鸭全程本地运行：调查、比对、写报告都在本地完成，不向任何外部平台上传或持久化数据，也不需要配置任何密钥。

## 🔍 调查模式

| 模式 | 调查目标 | 搜索策略与输出模板 |
|------|---------|------------------|
| 竞品情报调查 | 分析竞品产品、市场策略、用户口碑 | [investigation-modes.md](references/investigation-modes.md) |
| 舆情事件调查 | 热点事件追踪、舆论走向分析、危机监测 | [investigation-modes.md](references/investigation-modes.md) |
| 人物背景调查 | 商务合作前的背景调查、行业人物了解 | [investigation-modes.md](references/investigation-modes.md) |
| 信息交叉验证 | 验证信息真实性、对比不同来源说法 | [investigation-modes.md](references/investigation-modes.md) |

## 🌐 引擎选择策略

### 按调查目标选引擎

| 调查目标 | 首选引擎 | 备选引擎 |
|---------|---------|---------|
| 中文舆情 | Baidu + WeChat + Toutiao | Sogou, 360 |
| 国际视野 | Google + Brave + Yahoo | Bing INT, Ecosia |
| 隐私敏感 | DuckDuckGo + Startpage | Brave, Qwant |
| 学术验证 | Google Scholar + WolframAlpha | Google |
| 技术调查 | DuckDuckGo(!gh !so) + Google | Brave |
| 交叉验证 | 多引擎同时搜索 | 全引擎 |

### 按地区选引擎

| 地区视角 | 引擎 |
|---------|------|
| 中国大陆 | Baidu, Sogou, 360, WeChat, Toutiao |
| 国际视角 | Google, Bing INT, Yahoo, Brave |
| 隐私保护 | DuckDuckGo, Startpage, Qwant |
| 知识计算 | WolframAlpha |

详细引擎能力与高级搜索策略详见 [engine-strategy.md](references/engine-strategy.md)。

## ⚠️ 可信度标注规范

| 标识 | 含义 | 判定标准 |
|------|------|---------|
| ✅ 已确认 | 信息可靠 | 2+个独立来源一致 |
| ⚠️ 待确认 | 有争议 | 来源说法矛盾 |
| ❌ 已否定 | 信息不实 | 权威信源反驳 |
| 🔍 单一来源 | 仅1个来源 | 需进一步验证 |

**信息源分级**：

| 级别 | 类型 | 示例 |
|------|------|------|
| A级 | 官方/政府/权威媒体 | gov.cn, reuters.com, xinhua.net |
| B级 | 行业媒体/专业平台 | 36kr, techcrunch.com |
| C级 | 社交媒体/自媒体 | weibo, zhihu, reddit |
| D级 | 匿名/未验证来源 | 贴吧, 4chan, 匿名帖 |

## 💡 使用示例

### 竞品产品调查

```text
用户：帮我调查一下 Notion 这个产品

执行：
1. 广域扫描 → Baidu/Google/Bing INT 搜索产品功能与对比
2. 深度挖掘 → WeChat/Toutiao/DuckDuckGo 搜索测评与用户反馈
3. 交叉验证 → Google/Brave 验证融资数据与市场份额
输出：结构化竞品调查报告（本地）
```

### 舆情事件调查

```text
用户：帮我追踪最近 XX 事件的舆论走向

执行：
1. 事件还原 → Baidu/Google(tbs=qdr:d)/Toutiao 抓最新报道
2. 多视角收集 → WeChat/Sogou/DuckDuckGo 收集评论与论坛观点
3. 时间线重建 → Google(tbs=qdr:w)/Bing INT 追溯事件脉络
输出：结构化舆情调查报告（本地）
```

### 信息验证

```text
用户：验证"XX公司获得10亿融资"是否属实

执行：
1. 信息溯源 → Google/Baidu 精确匹配搜索
2. 多源比对 → DuckDuckGo/Brave/Startpage 跨引擎比对
3. 权威验证 → site:crunchbase.com / site:bloomberg.com
输出：信息验证报告（确认/否定/待确认）
```

## 📚 参考文档

- [investigation-modes.md](references/investigation-modes.md) — 四种调查模式的搜索策略编排与输出模板
- [engine-strategy.md](references/engine-strategy.md) — 引擎选择策略、独有能力与高级搜索方法
- [investigation-templates.md](references/investigation-templates.md) — 调查报告完整模板集
