# 实拉响应片段（2026-08-18）

> 只在你想核对信封长什么样、或要解释 `SKILL_NOT_FOUND` / `ENDPOINT_NOT_FOUND` / `CSRF_FORBIDDEN` / `DEDICATED_ROUTE` 时读它。日常调用不需要。

## 5. 本文档里的响应片段都是实拉的

2026-08-18 对 `https://doubaoya.com` 的免费只读端点实拉，原样摘录：

```jsonc
// GET /api/health
{ "success": true, "requestId": "1b4a97bf-…", "data": { "status": "ok" }, "error": null }

// GET /api/skills/<slug> —— 拿「平台数据能力」那一半的 slug 去打 Skill 详情端点（走错集合）
// HTTP 404
{ "success": false, "requestId": "ee693f75-…", "data": null,
  "error": { "code": "SKILL_NOT_FOUND", "message": "Skill not found" } }

// GET /api/apis/<platform>/<slug> —— 一个根本不存在的 slug
// HTTP 404
{ "success": false, "requestId": "4c60e7ae-…", "data": null,
  "error": { "code": "ENDPOINT_NOT_FOUND", "message": "Endpoint not found" } }

// POST /api/skills/recommend 不带 Authorization 头 —— HTTP 403，被 CSRF 闸拦在鉴权之前
{ "success": false, "requestId": "5cf9584d-…", "data": null,
  "error": { "code": "CSRF_FORBIDDEN", "message": "Origin not allowed" } }

// POST /api/wechat/publish 带合法 Bearer —— 同样是 HTTP 403，但这是**套餐权益到顶**，不是鉴权/CSRF：
// 认 code 不认状态码。extra 四件套原样念给用户，同一入参不重试，指向 helpUrl 升级套餐。
{ "success": false, "requestId": "9b1d2f30-…", "data": null,
  "error": { "code": "PLAN_LIMIT_EXCEEDED",
             "message": "本月存草稿次数已达免费档上限。已有内容不受影响，可以照常查看与删除；要放开这一项请在账户页升级套餐：https://doubaoya.com/dashboard/billing#plan",
             "extra": { "dimension": "…（配额维度名，逐能力不同，原样念给用户别自己猜）",
                        "plan": "free", "used": 5,
                        "helpUrl": "https://doubaoya.com/dashboard/billing#plan" } } }
// ⚠️ 真实响应的 extra 里还有一个「上限」数值字段与 used 成对（用来念「已用 5 / 上限 5」）。
// 这里刻意不写出那个键名：它与分页入参同名，写进本层会让协议词表不得不收下它，
// 而那个词表一宽，整道「网关层不许出现能力字段」的闸就跟着松一格。以实时响应为准。

// POST /api/skills/wechat-render/invoke —— 专用路由能力打到通用代理（2026-08-24 实拉）
// HTTP 400
{ "success": false, "requestId": "831a9765-…", "data": null,
  "error": { "code": "DEDICATED_ROUTE", "message": "公众号排版渲染请直接调用 POST /api/wechat/render，不走通用调用代理" } }
```

`requestId` 每次都不同，上面只留了前缀。**报障时把 `requestId` 一起给用户**，
它是服务端定位这一次调用的唯一线索。

## 6. `inputContract` 投影（详情端点上的可辨识联合）

```jsonc
// kind 为 json-schema：有真规格
{
  "kind": "json-schema",
  "jsonSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": { "…": "🔴 这一坨才是入参规格。本文档故意不展开——展开就等于把契约烤进分发物" },
    "required": [ "…" ],
    "additionalProperties": false
  },
  "route": { "method": "POST", "path": "/api/wechat/publish" }
}

// kind 为 no-schema：**没有**机器可读的规格，别自己编
{ "kind": "no-schema", "note": "…（说明为什么没有）", "route": { "method": "POST", "path": "…" } }
```

怎么判读见 `protocol.md` 第 2 条。
