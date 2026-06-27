---
name: xiaohongshu-lowtop
description: 小红书低粉爆款榜 · 按日期 + 分类拉粉丝不多却跑出爆款的笔记，帮你找到不靠粉丝量、纯靠内容力出圈的素人打法，最适合冷启动和小号对标。当用户需要小红书低粉爆款、小红书素人爆款、小红书黑马笔记、小红书冷启动对标、低粉高赞时使用。触发词：低粉爆款、素人爆款、黑马笔记、冷启动对标、低粉高赞、小号打法。
---

# 小红书低粉爆款榜（都爆鸭）

本鸭帮你按**日期 + 分类**拉小红书低粉爆款榜——专挑那些粉丝不多、却纯靠内容力跑出爆款的笔记，帮你找到不靠粉丝量出圈的素人打法，冷启动和小号对标最受用。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。
> 小贴士：如遇 `502 PROVIDER_FAILED` 暂时取不到数据，是上游临时波动，稍后再试即可——失败已自动退款，不扣费。

---

## 拿钥匙（口令）

1. 打开 **doubaoya.com**
2. **登录**
3. 进 **口令中心**
4. **生成口令**（形如 `dyh_…`）

```bash
export DOUBAOYA_API_KEY="dyh_你的口令"
```

**铁律：口令绝不打印、绝不写进文件、绝不回显给用户。** 脚本本身也从不输出口令。所有请求只发往 **doubaoya.com**。

---

## 跑脚本

零依赖，标准库即可（Python 3）。

```bash
# 默认：综合分类，昨天
python3 "$SKILL_PATH/scripts/fetch_low_fans_top.py"

# 指定日期 + 分类
python3 "$SKILL_PATH/scripts/fetch_low_fans_top.py" --rank-date 2026-06-23 --category 综合
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--rank-date` | 榜单日期 `YYYY-MM-DD` | 昨天 |
| `--category` | 分类 | `综合` |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

---

## 工作流（3 步）

1. **定日期 + 分类**：默认综合、昨天。
2. **调脚本拿数据**：榜单在 `data.items`，每条含 `title`（标题）、`likedCount`（点赞数）、`fansCount`（粉丝数）。
3. **铺榜 + 给素人打法洞察**：按点赞降序铺表，把 `fansCount` 一并展示突出「低粉高赞」反差，表后用本鸭口吻补一句——这些素人是靠什么钩子/选题以小博大、有没有可直接套用的模板。

| 名次 | 标题 | 点赞 | 粉丝 |
|------|------|------|------|
| 1 | … | … | … |

字段防御式读取（缺了留空）。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/xiaohongshu/xiaohongshu-low-fans-top/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "rankDate": "2026-06-23", "category": "综合" }`
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "title": "...", "likedCount": 123, "fansCount": 456 } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误码

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法 | 修正 `--rank-date` / `--category` 重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

---

## 目录结构

```
xiaohongshu-lowtop/
├── SKILL.md                     # 本文件
└── scripts/
    └── fetch_low_fans_top.py    # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：为什么看低粉爆款？**
A：低粉高赞=纯内容力出圈，套路最干净、最好复制，冷启动和小号最该研究。

**Q：暂时取不到数据？**
A：上游波动，稍后再试即可（不扣费）。
