# Agent Note: 通用外来工具名虚拟化与双向回译

Status: implemented

## Problem

Freebuff 的受罚信号 `foreign_tool_names` 是一个集合规则：只要 tools 中出现
`FOREIGN_HARNESS_TOOL_NAMES` 的任意名字，请求就可能被判为第三方 harness。
此前仓库只针对 Hermes 的 `delegate_task` 做单点 `spawn_subagent` 别名；这个修复能
解决 Issue #17，但无法覆盖同一列表里的 Claude Code / Cursor / Codex / OpenClaw /
OpenCode 其它名字。上游列表一旦扩展，就需要继续补特判。

trefeon/freebuff-proxy v1.11.0 的 #653/#654 已验证一种更通用的请求级 ToolMapper：
去程统一改名、回程按本请求的 map 还原，并覆盖非流式与 SSE。直接照搬其“把部分客户端
工具映射成官方语义工具”的做法在本 Node 实现里有一个不必要风险：同一客户端可能同时
声明多个不同工具并映射到同一个官方名（例如 terminal / execute_code），回程仅靠名字
无法无损判断原工具；参数 schema 也可能不同。

## Decision

仓库采用一对一 namespace virtualization，借鉴 trefeon 的 request-scoped
bidirectional mapper，但不做参数或语义猜测：

- 以本仓库镜像的 `FOREIGN_HARNESS_TOOL_NAMES` 为唯一触发集合；另外兼容未来
  `cron*` 族名字。
- 命中的客户端工具只改名字，默认 `name -> mcp__name`；参数 schema、description、
  arguments 全部原样。
- 若客户端本身已经占用该 `mcp__name`，使用
  `mcp__name__fbp2`、`__fbp3`…，保证请求内一对一、无碰撞。
- 客户端原生 `mcp__*` 工具、未知自定义工具、非受罚普通工具全部原样，不做额外重命名。
- `tools[].function.name`、结构化/字符串 `tool_choice`、历史
  assistant `tool_calls` / legacy `function_call`、role=tool 的 `name`
  统一走同一 mapper。
- 回程只按本请求实际建立的 `upstream -> client` map 精确还原；绝不盲目删除
  `mcp__` 前缀，因此客户端原生 MCP 名不会被破坏。
- 非流式 JSON 与流式 SSE 共用相同还原逻辑；只在 mapper 非空时解析响应。
- 保留 genuine signature 注入：它解决 `foreign_toolset`；ToolMapper 解决
  `foreign_tool_names`，两层职责独立。
- 响应增加 `x-freebuff-proxy-tool-map-count`；若本请求包含 `delegate_task`，
  继续保留 PR #18 的 `x-freebuff-proxy-tool-alias` 便于既有排障脚本观察。

## Alternatives considered

- **什么都不做 / 继续只保留 delegate_task 特判** — 改动最少且已经线上验证，但只能覆盖
  一个名字；同一受罚集合内的其它 harness 名仍会触发同类问题。
- **完整复制 trefeon 的 clientToOfficial 语义映射表** — 上游 wire 更接近官方工具名，
  而且 trefeon 已有较大测试矩阵。缺点是多对一映射会失去无损回译能力，且不同客户端的
  参数 schema 并不等价；本仓库已有 genuine signature，不需要靠语义映射解决
  `foreign_toolset`，因此没有必要承担这层风险。
- **把所有未知工具都强制改成 mcp__** — 最彻底，未来新规则前也更难碰撞，但会无端修改
  当前没有受罚的自定义工具，增加模型选工具和第三方 MCP 兼容的不确定性。只跟随明确的
  `FOREIGN_HARNESS_TOOL_NAMES` 更可控。
- **在 Hermes / 各客户端源码内改工具名** — 客户端侧最直观，不需要代理回译；但每个 harness
  都要维护 fork，升级会覆盖本地改动，也无法统一解决其它客户端，因此把兼容层留在代理边界。

## Consequences

- Issue #17 的 `delegate_task` 仍被修复，但它不再是特殊代码路径，而是通用 mapper 的
  一个数据项。
- 当前显式 foreign harness 名可以统一获得一对一双向回译；新增名字只需更新上游判据镜像，
  mapper 自动生效，无需继续写分支。
- 代理不会替换 tool schema/arguments，客户端看到的响应工具名与请求声明保持一致。
- mapper 非空时需要解析 SSE 的 `data:` JSON 行；无映射请求仍保持原流透传。
- 该层只处理工具名；`foreign_system_prompt`、出口网络、账号状态和其它上游规则仍是独立问题。
- 上游规则镜像若过期，本地集合也会过期；现有 foreign-client 日志仍用于发现漂移。

## Testing

`test/smoke.mjs` 覆盖：

- Claude Code / Cursor / Codex / OpenClaw / OpenCode 代表名字统一虚拟化；
- `delegate_task` 与客户端原生 `mcp__delegate_task` 同时存在时的碰撞避让；
- tools / tool_choice / 历史 tool_calls / role=tool 的 name 去程一致改写；
- 客户端原对象不被修改；
- genuine signature 注入后跑本地上游判据，必须 `signal === null` 且
  `foreignToolNames === []`；
- 非流式与 SSE 回程恢复；
- 客户端原生 MCP 名不被盲目去前缀；
- 无 foreign name 时 mapper 为 identity，保持零改写路径。

CI 继续执行 `npm test`、`npm run typecheck`、Agent Notes gates 与 image boot。
