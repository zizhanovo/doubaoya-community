---
name: bilibili-portfolio-search
description: B站 UP主作品集 · 按 UP主 UID 拉作品集，游标翻页，帮你复盘某个 UP主发了哪些视频、内容矩阵长啥样、选题节奏怎么排。当用户需要 B站 UP主作品、B站账号作品列表、B站作品集、UP主视频列表、B站对标账号时使用。触发词：B站 UP主作品、UP主视频列表、B站作品集、B站账号作品、对标 UP主、bilibili 作品。
---

# B站 UP主作品集 · 游标翻页（都爆鸭）

本鸭帮你按 **UP主 UID** 拉作品集（游标翻页）——一眼看清某个 UP主发了哪些视频、内容矩阵长啥样、选题节奏怎么排，做对标研究最顺手。

> 数据走 **doubaoya.com** 一条线，鉴权用你自己的口令（环境变量 `DOUBAOYA_API_KEY`，形如 `dyh_…`）。

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

零依赖，标准库即可（Python 3）。需要一个 B站 UP主的 **UID / mid**（在 UP主主页 URL 里能找到）。

```bash
# 第一页
python3 "$SKILL_PATH/scripts/fetch_user_works.py" --uid 100000

# 翻页：把上一页返回的游标传进来
python3 "$SKILL_PATH/scripts/fetch_user_works.py" --uid 100000 --cursor "下一页游标"
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--uid` | UP主 UID / mid（**必填**） | — |
| `--cursor` | 翻页游标 | 空（第一页） |

脚本把成功信封里的 `data` 以 JSON 打到 stdout。**每次只跑一次脚本**，读完整 stdout。

---

## 工作流（3 步）

1. **拿到 UID**：从 UP主主页 URL（`space.bilibili.com/<uid>`）取出 UID。
2. **调脚本拿数据**：作品在 `data.items`，每条含 `title`（标题）、`url`（链接）、`categoryName`（分区）。要更多就用返回里的游标续翻。
3. **铺作品表 + 给洞察**：铺成 Markdown 表，表后用本鸭口吻补一句——这个 UP主主攻哪些分区、选题有没有规律、哪些片子是他的爆款抓手。

| 标题 | 分区 | 链接 |
|------|------|------|
| … | … | … |

字段防御式读取（缺了留空）。

---

## 接口契约

- `POST https://doubaoya.com/api/apis/bilibili/bilibili-user-works/call`
- 鉴权头：`Authorization: Bearer $DOUBAOYA_API_KEY`
- 请求体：`{ "uid": "100000", "cursor": "" }`
- 返回信封：
  ```json
  { "success": true, "requestId": "...", "data": { "items": [ { "title": "...", "url": "...", "categoryName": "..." } ] }, "error": null }
  ```
- **先看 `success`**：为 `true` 才读 `data`；否则读 `error.code` / `error.message`。

---

## 错误码

脚本失败时向 stderr 打印 `[error] CODE: message` 并以退出码 1 结束。

| HTTP | code | 含义 | 处理 |
|------|------|------|------|
| 401 | `MISSING_API_KEY` / `UNAUTHORIZED` | 没带口令或口令无效 | 检查 `DOUBAOYA_API_KEY`，去口令中心重新生成 |
| 400 | `VALIDATION_ERROR` | 参数不合法（如 UID 为空） | 修正 `--uid` 重试 |
| 402 | `INSUFFICIENT_CREDITS` | 额度不足 | 去 doubaoya.com 充值/续额 |
| 502 | `PROVIDER_FAILED` | 上游临时故障（**已自动退款**） | 可安全重试 |

---

## 目录结构

```
bilibili-portfolio-search/
├── SKILL.md                   # 本文件
└── scripts/
    └── fetch_user_works.py    # 零依赖脚本（urllib），调用 doubaoya.com
```

---

## 常见问答

**Q：UID 在哪看？**
A：打开 UP主主页，URL `space.bilibili.com/<数字>` 里的数字就是。

**Q：怎么翻页？**
A：把上一次返回里的游标传给 `--cursor` 再跑一次。

**Q：报 `502 PROVIDER_FAILED`？**
A：上游临时抖动，系统已自动退款，直接重跑即可。
