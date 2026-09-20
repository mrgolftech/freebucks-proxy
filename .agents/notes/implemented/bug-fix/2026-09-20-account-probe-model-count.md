# Agent Note: 单账号「检测」要把「可用模型数」建立在派生字段上

Status: implemented

## Problem

控制台账号行的「检测」按钮，无论账号状态如何，toast 恒定显示「可用 · **0 个模型**」。

根因是**快照形状**与**消费方假设**不一致，两处叠加：

1. `src/session-manager.js` 的 `_apply()` 用**白名单**重建 `this.session`——只保留
   `status/instanceId/model/admittedAt/expiresAt/remainingMs/accessTier/raw`。上游回包里的
   `rateLimitsByModel` 与 `freebucks` 被拆到 `this.quota.byModel` / `this.freebucks`，
   原文只留在 `session.raw`。
2. `dashboard/app.js` 的 `probeAccount()` 直接读 `sess.rateLimitsByModel`
   （`Object.keys(...).length`），而 `POST /api/accounts/<key>/probe` 回包的 `session`
   正是 `rt.sessions.refresh()` 返回的**本地快照** → 该字段永远 undefined → 计数恒为 0。

实测（线上 1.16.3，4 个账号全部如此）：`session.rateLimitsByModel` 为空，
`account.quota.byModel` 有 5 个键。即「检测成功但报 0 个模型」，把可用的号显示成疑似不可用。
同一原因还让回包里的 `session.freebucks` 读不到（余额/日池显示为空）。

顺带确认：批量探测 `POST /api/accounts/probe` 读的是 `getSnapshot()?.quota?.byModel`
（`api.js:864`），口径正确——只有单账号探测这条路把原始快照直接丢给了前端。

## Decision

**回包显式给出派生字段，消费方不再猜快照形状**（`POST /api/accounts/<key>/probe`）：

- `rateLimitsByModel`：`getSnapshot().quota.byModel`，回落 `session.raw.rateLimitsByModel`。
- `freebucks`：`getSnapshot().freebucks`，回落 `session.raw.freebucks`。
- `availableModelIds`：`modelIdsFromSession(session.raw)`——**与 `/v1` 白名单、
  `/api/models/upstream` 同一个函数**（限流表 ∪ `limitedModelOffers` ∪ 当前 model ∪
  freebucks 价格表）。控制台报的「可用」必须等于代理真正会放行的集合。
- `modelCounts`：`{ available, rateLimited, walletBilled }` 三个数一次给全。

前端 `probeAccount()` 改为读这些具名字段，并按 `r.rateLimitsByModel → account.quota.byModel
→ sess.raw.*` 逐级兜底（兼容未升级的后端）；toast 文案分两本账报：
「可用 N 个模型（次数额度 X · 钱包计费 Y）」。

## Alternatives considered

- **前端改读 `sess.raw.rateLimitsByModel`**：能立刻修好，但把「快照白名单里没有上游字段」
  这个隐含契约又固化成前端对 `raw` 的依赖；下次白名单调整（或 `raw` 不再透传）会再次静默坏掉，
  且每个消费方都要各自记得这件事。
- **给 `getSnapshot()` 加 `rateLimitsByModel` 别名**：单账号探测返回的是 `refresh()` 的
  `this.session` 而不是 `getSnapshot()`，加别名这条路本身不生效；就算改成返回快照，也会让同一份
  数据在快照里出现两个名字，正是本次混乱的来源。
- **把「可用」继续定义为「只数限流表」**：与 `/v1` 白名单口径不一致——10 个钱包计费模型
  （`glm-5.3-flash`/`mimo-v2.5`/`deepseek-v4-flash`…）不在限流表里，却真能调用；控制台报 5
  而代理放行 10，是把「显示与能力不一致」换个方向重演。

## Consequences

- 回包**新增**字段（`session` 原样保留），向后兼容；旧前端仍能用 `availableModelIds` 缺失时的兜底分支。
- 数字语义变了：同一账号由「0 个模型」变成「10 个模型（次数额度 5 · 钱包计费 10）」。
  两个分项**会重叠**（如 `openai/gpt-5.6-luna` 同时在限流表与价格表），文案里已写明是两本账，
  不是三个独立计数。
- 批量探测的 `modelCount`（每账号一行）仍是「只数限流表」的旧口径，本次未动；前端没展示它，
  但改口径前需要先想清楚那里想表达什么。
- `_apply()` 的白名单仍是「上游字段默认不入快照」的机制，新增字段时要么进白名单、要么在 API 层派生。

## Testing

- `npm test`（smoke，含 dashboard 语法门禁）、`npm run typecheck`、`verify-all.ts --base HEAD`。
- 隔离实例实测（独立端口 + data 副本、会话表清空）：`POST /api/accounts/<key>/probe` 回包
  `rateLimitsByModel` 5 个键、`availableModelIds` 10 个、`modelCounts = {available:10,
  rateLimited:5, walletBilled:10}`；并用回包重放前端取数逻辑，确认 toast 得到 10 而非 0。
