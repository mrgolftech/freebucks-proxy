# Agent Note: 手工启停账号作为独立调度闸门

Status: implemented

## Problem

账号池此前只有“凭据存在 / 冷却 / 封禁 / 额度不足”等自动状态，没有一个明确的
**人工调度开关**。用户如果只想让部分账号工作，只能删除账号、改凭据，或者人为制造
冷却；这些办法都会混淆“账号本身有故障”和“我主动不想用它”。

同时，账号 runtime 是懒创建的，控制台探测、凭据导出、代理修改等管理动作又需要能够
访问一个不参与自动调度的账号。因此“停用”不能等价于删除凭据，也不能简单让
`get(key)` 对停用账号直接报错。

还有一个启动边界：如果所有账号都被停用，Web 控制台必须仍能启动，否则用户没有入口
把账号重新启用。原来的 `buildAppContext()` 只要检测到存在凭据就会调用 `getAny()`，
如果 `getAny()` 改成只选启用账号而不处理“全停用”，就会让服务启动失败。

## Decision

**账号凭据增加 `enabled` 字段，缺省为 true；自动调度只使用启用账号，管理面仍可访问
停用账号。**

- `coerceUser()` 把 `enabled !== false` 视为启用，保证旧凭据无感升级。
- `listAccounts()` / `runtimes.list()` 显式返回 `enabled`；停用账号
  `available=false`、`status='disabled'`，与封禁/冷却区分。
- 新增 `enabledKeys()` / `isEnabled()`。自动选号 `candidateKeys()`、
  `acquireForModel()`、`getAny()` 只从启用账号中选择。
- `get(key)` **不禁止**读取停用账号：单账号探测、查看凭据、改代理、重新启用仍然需要它。
- 请求执行期间如果用户停用当前账号，当前在途流允许自然结束；后续重试/重新 admit
  检查 `isEnabled()` 后绕开该账号。
- 控制台 PATCH 是真正的部分更新：只改 `enabled` 时不改变 `proxy`，反之亦然。
- 停用时 invalidate 当前 runtime：新请求立刻看不到它；旧 session 通过
  `releaseWhenIdle` 在在途回复结束后再释放，不硬切 SSE。
- 如果全部账号停用，`buildAppContext()` 返回“无当前上游”的正常上下文，让控制台继续
  提供服务；chat 调度返回明确的 `no_enabled_account`。
- 重新登录已有账号只刷新 token/指纹，保留其原有 `enabled` 状态，不能把手工停用的账号
  偷偷重新打开。

## Alternatives considered

- **删除账号来达到停用效果** — 控制最彻底，但会丢失凭据关联、专属代理设置和管理体验；
  用户想要的是可逆的“暂时不用”，不是生命周期删除。
- **用一个很长的 cooldown 表示停用** — 会把人工意图和上游故障混在一起，冷却到期还会
  自动恢复，不符合“由我决定什么时候重新启用”。
- **让 `get(key)` 也拒绝停用账号** — 调度语义简单，但控制台无法探测、查看或修改一个
  已停用账号，甚至重新启用都要绕开正常 runtime/API 链路。
- **停用时立即 DELETE / 强制断流** — 能最快停止使用，但会打断正在输出的 SSE。选择
  “新请求立即摘除 + 当前回复自然结束后释放”更符合管理操作的预期。
- **禁止停用最后一个账号** — 可以避免无可用账号，但用户明确需要完全手工控制；
  “全部停用”是合法的维护模式，只要错误信息和重新启用入口清晰即可。

## Consequences

- 用户可以把账号池缩成任意一个或几个启用账号，实现显式人工选池。
- 停用状态随账号凭据导出/迁移保留；旧凭据默认启用，不破坏升级兼容。
- 停用不改变账号的封禁、冷却、额度、代理和历史统计；重新启用后继续使用原配置。
- 所有账号停用时服务保持在线，模型探测可能回落静态目录，而 chat 请求会返回
  `no_enabled_account`，直到至少一个账号重新启用。
- 控制台新增独立“手工停用”分区与启用开关，避免把人为状态误读成上游故障。

## Testing

- `test/smoke.mjs` 覆盖：
  - `enabled:false` 持久化；旧凭据缺字段默认启用；
  - 停用账号不进入 `candidateKeys()`；
  - `list()` 返回 `available=false/status=disabled`；
  - 全部停用时 `buildAppContext()` 仍成功，`acquireForModel()` 返回
    `no_enabled_account`；
  - Web PATCH 只改 enabled 时保留专属 proxy；
  - enabled 非 boolean 时返回 400；
  - 停用后重新启用可正常恢复。
