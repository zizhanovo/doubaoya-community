# 号章程结构与枚举白名单

> 要把章程 PUT 回服务端、或核对某个枚举值合不合法时读它。问诊过程中不需要。

完整结构（PUT 的 body 就是这个对象本身，**不要外面再包一层**）：

```jsonc
{
  "version": 1,

  "positioning": {                    // 三级切割
    "oneLiner": "",                   // 一句话定位：读者一句话记住你什么
    "domain": "",                     // 大领域（如：职场）
    "niche": "",                      // 细分赛道（如：体制内职场）
    "tag": ""                         // 专业标签（如：体制内晋升答辩教练）
  },

  "audience": {
    "persona": "",                    // 具体画像：年龄/身份/处境，越具体越好
    "decisionScene": "",              // 读者在什么场景下会想起并打开这个号
    "payerNote": ""                   // 使用者≠付费者时标注（如：孩子看、家长付费）；一致时留空串
  },

  "monetization": {
    "path": "",                       // 八种活法档位，八选一（见下表）；未定填空串
    "practicalPaths": [],             // 实操路径，五选可多选（见下表）；未定填空数组
    "stage": "",                      // 阶段：startup 起号 / accumulation 沉淀 / monetization 商业化
    "gapNote": ""                     // 门槛差距：当前状态离所选路径的硬门槛还差什么
  },

  "northStar": {
    "metric": "",                     // 北极星指标，四选一（见下表）
    "rationale": ""                   // 为什么是这个指标而不是别的
  },

  "review": {
    "lastReviewedAt": "",             // 上次回顾日期，空串或可解析的 ISO 日期字符串
    "nextTrigger": ""                 // 下次回顾的触发条件（如：粉丝过 100 达流量主门槛时）
  }
}
```

**枚举白名单**（**英文稳定值入库**，中文只是展示语义；**空串 / 空数组 = 未定，允许存**）：

| 字段 | 白名单 |
|---|---|
| `monetization.path`（八种活法，单选） | `brand` 品牌号 / `celebrity` 明星号 / `writer` 写手号 / `channel` 渠道号 / `product` 产品号 / `membership` 会员号 / `affiliate` 联盟号 / `platform` 平台号 |
| `monetization.practicalPaths`（实操路径，多选） | `ad_revenue` 流量主广告 / `ecommerce` 带货电商 / `paid_knowledge` 知识付费 / `consulting` 咨询服务 / `private_domain` 私域成交 |
| `monetization.stage` | `startup` 起号 / `accumulation` 沉淀 / `monetization` 商业化 |
| `northStar.metric` | `read` 阅读量 / `follower_growth` 涨粉 / `private_leads` 私域引流数 / `gmv_repurchase` GMV·复购 |

`path` 与 `practicalPaths` 是**两个维度**，不要混为一谈：

- `path` 回答「**这个号是哪种活法**」——定位档位，单选；
- `practicalPaths` 回答「**钱具体从哪条渠道进来**」——可多条并行（如产品号同时走知识付费 + 私域成交）。

**长度与体积**：短字段（`oneLiner` / `domain` / `niche` / `tag`）≤ **200 字符**；长字段
（`persona` / `decisionScene` / `payerNote` / `gapNote` / `rationale` / `nextTrigger`）≤ **2000 字符**；
整份 charter 序列化后 ≤ **16KB**。超限服务端 400 `CHARTER_INVALID`。
