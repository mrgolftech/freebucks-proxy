# Agent Note: strict tools、tier/offer 状态与 smart probe

Status: implemented

## Problem

当前代理已经具备通用 ToolMapper、Freebucks/session_units 双闸门和账号粘性调度，
但与已验证参考实现相比仍有三处明确缺口：

1. OpenAI `strict:true` function tool 没有入口校验，坏 schema 会一路送到上游；
2. session 已返回 `subscription.tierId`、`limitedModelOffers`、
   `limitedOfferReason`，但本地没有完整保存，`/v1/models` 也无法说明
   `plan_required / offer_unavailable / trial_used / withdrawn`；
3. quota/Freebucks 已携带 `resetAt`，但 session-less 额度刷新仍主要依赖固定轮询
   或人工刷新，没有利用成功请求、429 与 reset instant 做去重的智能探测。

这些缺口分别已经在 trefeon/freebuff-proxy #636、#665、#644 中实现并带测试，
本分支只迁移与本项目 Node 架构直接对应的部分，不引入 #666 全局 FIFO，也不扩展
任何客户端身份伪装逻辑。

## Decision

### 1. strict tools 独立入口校验

新增 `src/strict-tools.js`，只校验 `function.strict === true` 的工具：

- `parameters.type === 'object'`
- `required` 覆盖全部顶层 `properties`
- `additionalProperties === false`
- 兼容 Roo 已验证形态：`strict` 可在 tool 顶层，`required/additionalProperties` 可位于 function 层

失败统一返回 400 `strict_violation`；loose tools 保持原行为。该层放在
ToolMapper 之前，不修改 ToolMapper 的名字映射和 schema。

### 2. 保存服务器授权状态并给模型目录加 advisory 状态

SessionManager 新增 `entitlements` 快照，保存：

- `accessTier`
- `subscription.tierId/status/blockedBy`
- `limitedModelOffers`
- `limitedOfferReason`

账号账本持久化并在重启后回灌。模型目录按 trefeon #665 已生成并测试的 tier
事实增加：

- `tiers`
- `admissible`
- `status`
- `offer`
- `withdrawn`
- `replacement`

状态词保持参考实现：`plan_required`、`offer_unavailable`、
`trial_used`、`withdrawn`、`region_limited`、`available`。

已有的 `available:true` 目录可见性语义保留，不重新按一次 limited 探测过滤
模型，避免复发“模型列表只剩一个”的旧回归。

同时保存官方当前 Freebucks wire 中的 `claimableGrantFreebucks`、
`listPrices`、`firstTabDiscount`、`priceNotices`、`offPeak`、
`priceChanges`。Admission 余额按官方当前口径使用
`balance + claimableGrantFreebucks`；已被官方标为 deprecated 的 legacy
`monthly` 只保留展示/兼容，不再作为本地 admission 硬闸门。

### 3. session-less smart probe

在现有 SessionManager 上增加一个去重的只读探测调度器：

- 请求完成后触发，但至少 60s 一次；
- quota / Freebucks `resetAt` 到点后触发；
- 429 / free-mode rate limit 使用指数退避，最高 30m；
- 在途 chat 时不 probe，避免与活跃会话竞争；
- smart probe 使用无 `instanceId` 的 GET，只更新 quota/freebucks/entitlements，
  **绝不覆盖当前 live session/instanceId**；
- 普通 refresh 成功会取消更晚的重复 smart timer，再按 resetAt 重新布置。

现有 live-session poll 保留，smart probe 是对 parked/session-less 状态的补充，
不是新的 admission 路径。

### 4. 控制台同步展示

后端状态不能只停留在 API。控制台同步增加：

- 账号表“授权”列：显示 access tier、subscription tier、limited offer 数量和最近只读探测时间；
- 模型管理“准入”列：显示可准入、需订阅、Offer 暂停、Trial 已用、Tier 不匹配、已下线及 replacement；
- 模型管理同时读取 `/api/models` 的 entitlement-aware 目录与 `/api/models/upstream` 的实时价格/额度，不在前端重新推导准入规则；
- smart probe 不提供关闭开关，只展示它刷新后的授权/额度结果，避免用户关闭后重新使用陈旧 quota。

## Alternatives considered

- **把 strict 校验塞进 ToolMapper** — 拒绝。名字虚拟化与 schema 契约是两个独立
  问题，混合后容易让工具转换层开始修改参数语义。
- **恢复按 accessTier 过滤 /v1/models** — 拒绝。仓库已经有真实回归证明这种做法会
  让 limited 账号只看到一个模型；因此只新增 advisory status。
- **smart probe 直接调用现有 _apply()** — 拒绝。只读探测返回账号状态时可能没有
  instanceId，覆盖 live session 会再次造成句柄丢失。
- **迁移 trefeon #666 全局 per-model FIFO** — 暂不做。当前没有本项目队列异常的
  压测证据，不属于本轮三个已确认缺口。

## Consequences

- strict schema 错误在本地明确 400，不再消耗一次上游请求。
- 模型存在性与当前可准入状态解耦；客户端/控制台可解释“为什么现在不能用”。
- quota/Freebucks 在 reset 或活动后更快刷新，同时 session-less GET 被去重和退避。
- account-state.json 新增 entitlement 快照字段，旧账本无该字段时无感兼容。
- 本轮没有改变 ToolMapper 映射规则、账号代理绑定、sticky/spread 调度策略或
  session admission 本身。

## Testing

`test/smoke.mjs` 新增覆盖：

- strict schema 合法/缺 type/缺 required/additionalProperties/loose tool；
- Roo 的顶层 `strict` + function sibling `required/additionalProperties`；
- paid tier 的 `plan_required` 与订阅放行；
- limited offer 的 `offer_unavailable / trial_used / joinable`；
- withdrawn + replacement；
- smart probe 必须 session-less，且不能覆盖 live `instanceId`；
- smart probe 更新 quota/freebucks/entitlements；
- `claimableGrantFreebucks` 参与可支付余额；
- deprecated monthly 快照不再误拦当前报价允许的 admission。
