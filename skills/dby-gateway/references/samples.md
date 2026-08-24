# 实拉响应片段（2026-08-18）

> 只在你想核对信封长什么样、或要给用户解释某个报错时读它。日常调用不需要。

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
