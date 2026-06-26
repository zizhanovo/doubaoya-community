---
name: xiaohongshu-hot-notes
description: 都爆鸭 · 小红书爆款笔记发现。输入一个话题或赛道关键词（如「减脂早餐」「通勤穿搭」），搜索小红书笔记并按互动量（点赞＋评论）排出热度榜单，把当下最火的爆款笔记冒泡到顶部，再给出可落地的选题建议。触发词：小红书爆款、小红书热门笔记、小红书榜单、小红书热榜、爆款笔记发现、找对标笔记、看赛道热门内容、选题灵感。
---

# 小红书爆款笔记发现 🦆

> 都爆鸭出品。本鸭帮你把一个赛道里当下最能打的笔记捞出来排个座次——谁点赞高、谁评论旺，一眼看穿；再顺手给你拆几条选题思路，让你下一篇也往「爆」里写。

## 一句话定位

给本鸭一个**话题 / 赛道关键词**，本鸭就去小红书搜一圈笔记，按**互动热度（点赞 + 评论）**从高到低排出一张榜单，把最热门的爆款顶到最前面，最后送你一份**选题 takeaways**。

适合内容创作者、品牌运营、MCN、增长团队——任何需要「快速摸清某个赛道当下什么内容在爆」的场景。

> 小提示：我们的接口走的是「搜索笔记 + 互动量排序」来逼近热榜效果，所以榜单反映的是**该关键词下被搜到的高互动笔记**，而非平台官方实时热榜。词选得越准，榜越贴脸。

---

## 工作流程（Agent 必读）

当用户说「查 XX 的小红书爆款」「XX 赛道有什么热门笔记」「帮我找对标爆款」这类需求时：

1. **确定关键词**：从用户话里提炼一个赛道 / 话题关键词（如「减脂早餐」「早 C 晚 A」「露营装备」）。关键词越具体，榜单越精准。用户给得模糊时可主动收敛一个更聚焦的词。
2. **跑脚本搜索 + 排序**：调用 `scripts/fetch_hot_notes.py`，传入关键词。需要更大样本时加 `--pages 2` 或 `--pages 3`（默认 1 页，最多 3 页）。脚本会翻页搜集笔记、按「点赞 + 评论」降序排好，输出 JSON。
3. **呈现排行榜**：把脚本输出渲染成一张排好序的 Markdown 表格（见下方模板），按热度从 1 名往下排。
4. **给选题 takeaways**：基于榜单头部笔记，提炼 2-4 条可复用的选题 / 标题 / 呈现形式规律，帮用户落地下一篇。

> 真实性铁律：表格里的标题、点赞、评论、作者只能来自脚本返回，**禁止幻觉补齐**排名或互动数。脚本没返回的字段，表格里留空或写「—」。

### 排行榜模板

| 排名 | 标题 | 点赞 | 评论 | 作者 | 发布时间 |
| --- | --- | --- | --- | --- | --- |
| 🥇 1 | …… | 12.3k | 856 | …… | …… |
| 🥈 2 | …… | …… | …… | …… | …… |
| 🥉 3 | …… | …… | …… | …… | …… |

字段对应脚本返回的 `title` / `likeCount` / `commentCount` / `authorName` / `publishTime`，部分字段可能缺失，缺了就留「—」。

### 选题 takeaways 模板

> 🦆 本鸭拆榜：
> - **选题方向**：头部笔记普遍在做「……」，说明这个角度当下吃香。
> - **标题套路**：高赞标题多用「……」结构（数字 / 痛点 / 反差 / 悬念）。
> - **呈现形式**：……（清单体 / 教程 / 测评 / 第一人称故事）。
> - **可抄作业的点**：你下一篇可以试「……」。

---

## 拿钥匙（配置口令）🔑

本技能用一把**口令**（API Key）来调用都爆鸭接口。

**怎么拿口令：**

1. 打开 [doubaoya.com](https://doubaoya.com)
2. **登录** 你的账号
3. 进入 **口令中心**
4. 点击 **生成口令**，复制出来（口令形如 `dyh_…`）

**配置到环境变量** `DOUBAOYA_API_KEY`：

- **macOS / Linux**：
  ```bash
  echo 'export DOUBAOYA_API_KEY=<你的口令>' >> ~/.zshrc
  source ~/.zshrc
  ```
- **Windows（PowerShell）**：
  ```powershell
  [Environment]::SetEnvironmentVariable("DOUBAOYA_API_KEY", "<你的口令>", "User")
  ```

**验证**：`echo $DOUBAOYA_API_KEY`（macOS/Linux）或 `echo %DOUBAOYA_API_KEY%`（Windows），能打印出 `dyh_…` 开头的串即生效。改完环境变量记得重开终端。

> 🔒 **口令安全铁律**：口令是私密凭证，**绝不**打印到对话、日志或截图里，也别提交进公开仓库。脚本只从环境变量读取，本鸭也不会把它回显给你。

---

## 跑脚本

脚本零依赖（纯 Python 3 标准库），不用装任何包。

```bash
# 默认搜 1 页，按互动量排序
python3 scripts/fetch_hot_notes.py "减脂早餐"

# 多翻几页拿更大样本（最多 3 页）
python3 scripts/fetch_hot_notes.py "通勤穿搭" --pages 3
```

脚本会：

1. 从 `DOUBAOYA_API_KEY` 读口令（没配会报错并提示去拿钥匙，不打印口令）；
2. 逐页 `POST https://doubaoya.com/api/apis/xiaohongshu/search-note/call`，请求体 `{"keyword": "...", "page": N}`；
3. 汇总各页 `data.items`，按 `likeCount + commentCount` 降序排序；
4. 把排好序的笔记列表以 JSON 打印到标准输出。

---

## 接口与返回信封

- **接口**：`POST https://doubaoya.com/api/apis/xiaohongshu/search-note/call`
- **鉴权头**：`Authorization: Bearer $DOUBAOYA_API_KEY`
- **请求体**（仅这两个字段）：
  ```json
  { "keyword": "减脂早餐", "page": 1 }
  ```
  - `keyword`（string，必填）：话题 / 赛道关键词
  - `page`（int，可选）：页码
- **返回信封**：
  ```json
  {
    "success": true,
    "requestId": "…",
    "data": { "items": [ { "title": "…", "authorName": "…", "likeCount": 1234, "commentCount": 56, "publishTime": "…" } ] },
    "error": null
  }
  ```
  先判 `success`：为 `true` 才读 `data.items`；笔记字段做防御式读取（可能缺 `title` / `authorName` / `likeCount` / `commentCount` / `publishTime`）。

---

## 错误处理

脚本已内置处理，遇到下列情况会把 `[error] code: message` 打到 stderr 并以退出码 1 结束：

| 状态 | code | 含义与处置 |
| --- | --- | --- |
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没配口令或口令无效。去 doubaoya.com 口令中心重新生成，重配 `DOUBAOYA_API_KEY`。 |
| 400 | `VALIDATION_ERROR` | 请求参数不合法（如 keyword 为空）。换个关键词重试。 |
| 402 | `INSUFFICIENT_CREDITS` | 余额 / 积分不足。到 doubaoya.com 充值后再试。 |
| 502 | `PROVIDER_FAILED` | 上游临时故障，**已自动退款，可安全重试**。稍后重跑即可。 |

网络异常（连不上、超时）会报 `NETWORK_ERROR`，检查网络后重试。

---

## 目录结构

```
xiaohongshu-hot-notes/
├── SKILL.md                      # 本文件：定位、工作流、拿钥匙、接口与错误处理
└── scripts/
    └── fetch_hot_notes.py        # 搜索笔记 + 按互动量排序，输出排好序的 JSON
```

---

## 注意事项

- **数据真实性**：榜单只认脚本返回，禁止编造排名或互动数。
- **口令永不外泄**：不打印、不入库、不进截图。
- **榜单口径**：基于「关键词搜索 + 互动量排序」，反映该词下的高互动笔记，非平台官方实时热榜；关键词越精准越贴脸。
- **翻页克制**：默认 1 页通常够用，最多 3 页，别无脑拉满浪费额度。
- **合规**：跳转原文、二次使用须遵守小红书平台规则与版权要求。
