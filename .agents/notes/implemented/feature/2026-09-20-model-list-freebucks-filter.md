# Agent Note: 模型管理列表加「只看 Freebucks 计费模型」开关

Status: implemented

## Problem

限流表与价格表取并集后（见 `2026-09-20-freebucks-priced-models-missing.md`），
「模型管理」表去重后共 18 行，其中 8 行在当前账号下**既没有次数额度也没有单价**
（`claude-fable-5`、`deepseek-v4-pro`/-max、`gpt-5.6-luna-max`、`glm-5.2`、`minimax-m3`、
`ox-alpha` 等）。用户在这张表里挑模型的真实问题是「我买得起、且此刻真能用的是哪些」，
18 行混排会让 10 行可买的计费模型被淹没。

## Decision

- 新增持久化设置项 `modelListOnlyFreebucks`（默认 `false` = 全显示）：
  `src/web/settings-store.js` 的 `DEFAULT_SETTINGS` + `load()` + `save()` 三处，
  以及 `src/web/api.js` 的 `GET /api/settings` 回读与 `POST /api/settings` 的
  布尔校验（非 admin 的 POST 仍被 403 拦下）。
- `dashboard/app.js` 的 `renderModelSettings()` 在与「屏蔽收费模型」同一区块渲染第二个
  开关，`saveOnlyFreebucksSetting()` 保存后回读并 `refreshModelSettingsCard()`
  局部重渲染；非 admin 时开关可见但禁用，与既有 `block-premium` 一致。
- 过滤判据 `isFreebucksRow = (m) => m.freebucksBilled === true ||
  Number.isFinite(m.freebucksPerHour)`，即后端给的显式标记优先、单价存在性兜底
  （自定义/内置行没有 `freebucksBilled`，只要挂了单价也算计费模型）。
- 作用域**仅限这张表**：`/v1/models`、模型白名单、账号调度、`/api/models/custom`
  的自定义条目一律不动。文字里明写「仅影响本表显示，不改 /v1/models 与调度」。
- 开关说明行显示总数与当前折叠数（如「共 10 个 …… 已隐藏 8 个」）；过滤后为空时渲染
  一行空状态（`colspan` 按是否 admin 取 8/7），避免出现无解释的空白表。

## Alternatives considered

- **只用页面内的 `state` 变量（不持久化）** — 一行代码就能做完，但刷新即丢。这是用户挑
  模型的固定习惯，不是一次性操作，因此否决。
- **存 `localStorage`** — 控制台的持久化设置一律走 `/api/settings`
  （`localStorage` 目前只用于主题 `fb-theme`），且该偏好需要被服务端其它消费者读取时
  才有意义；放浏览器侧会形成第二套设置真源，因此否决。
- **用 `pool === 'freebucks'` 作判据** — 只有从上游补出来的行才是这个 pool；内置目录与
  自定义行的 pool 由各自来源决定（可能是 `daily` 或用户手填），会有价却过滤掉，因此否决。
- **直接隐藏无价行、不给开关** — 被折叠的 8 行里有 daily/premium 等确实需要看到的信息
  （排障时要确认某个模型是否存在），把不可见性写死会让人以为目录少了一半，因此否决。

## Consequences

- 开关 ON：18 行 → 10 行；OFF 保持 18 行。过滤只发生在渲染阶段，`known` 合并与
  「来源/agent」列的数据不变。
- `settings.json` 缺少该键时回落 `false`，升级后行为与改动前完全一致。
- 非 admin 无法持久化该偏好（沿用 `block-premium` 的权限模型），开关呈禁用态。

## Testing

- `npm test`（smoke 含 `dashboard/app.js` 语法门禁）与 `npm run typecheck` 通过。
- 用真实上游响应快照核对过滤效果：有价行 10、无价行 8（`claude-fable-5`、
  `deepseek-v4-pro`/-max、`gpt-5.6-luna-max`、`glm-5.2`、`minimax-m3`、`ox-alpha`、
  `deepseek-v4-flash-max`）。
- 设置项契约：`POST /api/settings {modelListOnlyFreebucks:false}` 后
  `GET /api/settings` 回读同值，开关状态与文字标签一致。

## Backlinks

- `src/web/settings-store.js` — `modelListOnlyFreebucks` 的默认值/装载/保存。
- `src/web/api.js` — `/api/settings` 的读写与校验。
- `dashboard/app.js` — `renderModelSettings()` 的开关与 `saveOnlyFreebucksSetting()`。
