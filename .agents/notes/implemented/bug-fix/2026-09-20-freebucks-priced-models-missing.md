# Agent Note: 模型管理列表要同时呈现限流表与 Freebucks 价格表

Status: implemented

## Problem

控制台「模型管理」的「额度（今日 · FB/h）」列对一部分模型显示 `—`，而这些模型在上游
是**有明确单价、可以花钱买**的。核对实时响应后，根因是数据源少了一本账：

- `/api/models/upstream`（`src/web/api.js`）的 `models` 数组由
  `session.rateLimitsByModel` 生成，单价 `freebucks.prices[id]` 只在那个循环里挂到
  已经存在的行上。
- 上游把「钱包计费模型」和「次数限流模型」记在**两本互不相交的账**里：
  `freebucks.prices`（FB/小时，按会话占用时长扣）与 `rateLimitsByModel`
  （premium/daily 的今日次数）。2026-09-20 实测：限流表 5 个、价格表 10 个。

于是控制台看到的是**残缺的半个上游目录**：`z-ai/glm-5.3-flash`(5)、`mimo/mimo-v2.5`(10)、
`deepseek/deepseek-v4-flash`(10) 三个内置目录模型明明有价却显示 `—`；
`upstage/solar-pro4`(10)、`meta/muse-spark-1.3-contributor`(15) 有价且不在内置目录里，
**整行都不出现**——用户根本不知道它们存在。

## Decision

`/api/models/upstream` 的 `models` 从「限流表」改成「**限流表 ∪ 价格表**」：

- 价格表有、限流表没有的 id 补一行：`limit`/`recentCount = null`（确实没有次数额度）、
  `freebucksPerHour` = 单价、`pool = 'freebucks'`、`freebucksBilled = true`、
  `resetAt`/`resetTimeZone = null`。
- 限流表来的行一律补 `freebucksBilled = Number.isFinite(prices[id])`，让前端有一个
  显式判据，而不用层层 `Number.isFinite`。
- 新增响应字段 `freebucksModelIds`（价格表的全部 id）。`upstreamModelIds` 口径**不变**，
  仍是限流表的 key。
- `poolLabel` 对补出来的行**故意留空**：`syncUpstreamModels()` 用
  `existing.displayName || um.displayName || um.poolLabel` 兜底显示名，填中文标签
  会把「Freebucks 计费」写成模型名。
- 控制台把 `pool === 'freebucks'` 显示为「计费」徽章（ok 色）。调度与白名单只判断
  `pool === 'premium'`（`src/model.js`），新 pool 值不改变任何路由行为。

## Alternatives considered

- **前端自己合并**（页面拿到 `freebucks.prices` 后补行）— 控制台这张表的所有数据来源
  都应该是同一个 API；前端各自合并后，第二个消费者（如 `bin/pricing.js`、模型列表
  标注）出现时逻辑必然漂移，两个地方对同一个模型给出不同单价的风险很高，因此否决。
- **把 `upstreamModelIds` 扩成含计费 id** — 该字段的语义是「上游此刻**确实给了额度**」
  （`dashboard/app.js` 用它给模型打 ✅ 并排在最前）。钱包计费模型没有次数配额，
  扩进去会把它们误标成有额度，因此否决；另开 `freebucksModelIds` 才不打架。
- **用 `limit = 0` 表示「没有次数额度」** — `0` 在 UI 与 `quotaBadgeClass()` 里表达的是
  「已用完」，会让本来能买的模型显示成限制状态，因此否决，改为 `null`。
- **就地改前端 `fmtModelPrice()` 显示推断** — 只治显示，`/v1/models`、同步上游模型、
  CLI 定价等其它消费者依旧看不到这 5 个模型，属于把数据源缺陷按显示层补丁处理，因此否决。

## Consequences

- 表内去重后共 18 行，其中 **10 行**带单价（原来：5 行显示单价 + 3 行有价却显示 `—` +
  2 行完全缺失）。
- 新的 pool 值 `freebucks` 会经「同步上游模型」写进自定义模型条目（`um.pool` 直接落盘），
  并在编辑器的池下拉里以「计费」出现——下拉选项已同步补上该值，不再出现"值在选项之外"
  的空白显示。
- 价格表是这 5 行的**唯一**来源：上游清空 `prices` 时它们立刻从表里消失，不留残余行。
- 计费模型没有 `resetAt`，因此「重置时刻」对这些行为空，不会显示误导性的重置倒计时。

## Testing

- `npm test`（smoke 含 `dashboard/app.js` 语法门禁）与 `npm run typecheck` 通过。
- 用真实上游响应快照重放合并逻辑：行数 `5 → 10`，`freebucks.prices` 的 10 个 id
  全部有价、无缺失（重放脚本只读本地快照，不联网、不创建会话）。
- 表内行数核对：内置目录 15 ∪ 上游 5 ∪ 价格表 10 → 去重 18 行，其中 10 行有价。
- CI 的 `image-boot` 仍负责真实镜像 + 真实 `/data` 的启动门禁。

## Backlinks

- `src/web/api.js` — `/api/models/upstream` 的并集合并与 `freebucksModelIds`。
- `dashboard/app.js` — `poolBadgeClass()` / `POOL_LABELS` 的 `freebucks` 分支。
