# Agent Note: 官方 session admission 与 run 恢复语义

Status: implemented

## Problem

官方 Freebuff 的 session admission POST 是会改变 active instance 的 takeover 操作。
当 POST 已到达服务端但客户端只看到 timeout、连接断开或模糊 5xx 时，不能判断
admission 是否已经成功；直接重放 POST 可能再次旋转 instance。与此同时，上游也可能
返回 `400 runId Not Running`，这种错误只表示当前 agent run 已失效，不应释放或
重新购买仍然有效的 Freebuff session。

本项目还需要持续跟踪 CodebuffAI/freebuff 的 session、run、fingerprint 和
model/price 源文件变化，避免协议漂移长期未被发现。

## Decision

- POST `/api/v1/freebuff/session/admission` 不再回退 legacy POST `/session`。
- admission 的 timeout / transport failure / 模糊 5xx 标记为
  `session_admission_unknown`；先 GET `/session` 对账。GET 返回目标模型 active
  时接管该 instance；明确 none 时才允许再 POST；GET 仍不确定则停止。
- 明确 408/429/503 按官方分类允许有界重试；typed 429 保留既有业务状态处理。
- `400 runId Not Running` 只创建一个 fresh run，并轮换 run-scoped client_id；
  同一请求最多重试一次，不 re-admit、不 release、不冷却账号。
- 增加 watched-source drift workflow。CodebuffAI/freebuff 是事实源；
  trefeon/freebucks-proxy 只作为实现/监控设计参考，检测到语义变化后人工审查，
  不自动迁移。

## Alternatives considered

- admission 失败后由通用 same-account retry 直接再 POST：实现简单，但无法区分
  “服务端未执行”和“服务端已执行、响应丢失”，存在重复 takeover 风险。
- 所有 admission 失败都禁止重试：安全但会把官方明确可重试的 408/429/503 也变成
  不必要失败。
- run invalid 时释放 session 后重新 admit：会扩大故障域，并可能重复产生 Freebucks
  会话成本；run 与 session 生命周期应分离。
- 自动把官方 drift 直接同步进代理：风险过高；协议变化必须先读官方源码与测试。

## Consequences

正常热 session 路径没有新增 GET，也不改变账号到出口代理的绑定。只有 admission
结果未知时增加一次只读 reconciliation。run invalid 恢复继续使用相同
`freebuff_instance_id`，只替换 `run_id` 与 `client_id`。

drift workflow 每日检查受关注的官方源文件；命中 watched drift 时失败并要求人工
审查，不会自动修改生产行为。

## Testing

- admission 404/405：只请求官方 admission endpoint，一次后停止。
- unknown + GET active：只发生一次 POST，恢复服务器已有 instance。
- unknown + GET none：允许且仅允许一次新的 POST。
- unknown + GET failure：保持 unknown，不重放 POST。
- run invalid：同一 Freebuff instance 下 START 两个 run、chat 仅重试一次，
  run_id/client_id 必须变化，session 不 DELETE/re-admit。
- CI 继续执行 smoke、typecheck、image boot 和 agent-note coverage。
