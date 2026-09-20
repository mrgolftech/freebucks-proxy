# Agent Note: 账号上线身份固定（专属出口 + 登录流程指纹隔离）

Status: implemented

## Problem

多账号部署原先有两种“身份漂移”会叠加：

1. 全局 `upstream.proxies` 虽然用账号 key 做稳定哈希，首选出口通常固定，但
   `buildFetchWithProxy()` 在连接级失败时会依次尝试池内其它代理。因此“首选固定”
   不等于“出口固定”；同一账号可能在一个登录态/会话生命周期里换公网 IP。
2. Web 登录的 `generateFingerprintId()` 只由容器宿主信息
   （hostname/platform/arch/CPU/username/MAC）生成。同一容器里发起多个账号登录时，
   得到完全相同的 `fingerprintId`。这不是账号级设备身份，而是宿主级公共身份。

账号凭据本来已经支持 `proxy` 字段，runtime 也会把显式账号代理解析成
`kind: 'single'`；但控制台只能在导入 JSON 或手工 PATCH 时利用它，首次登录的
code/status 仍走全局策略，且坏代理值还可能被底层容错静默降级为“没有专属代理”。

## Decision

**把“账号上线身份”固定在登录流程边界：专属代理从第一次 login code 请求开始绑定，
登录指纹按 flow 隔离且 flow 内稳定；保存凭据后继续复用同一代理。**

- Web 新建登录先生成 `flow.id`，再用
  `generateFingerprintId(flow.id)` 生成该流程的 fingerprint。相同 scope 的结果稳定，
  不同 flow 不共享宿主机公共 fingerprint。
- fingerprint **不是每请求随机**。login code 与后续 status polling 始终使用 flow
  创建时的同一个 `fingerprintId/fingerprintHash`；登录成功后把二者写入账号凭据。
- 登录流程可携带 `proxy`。code、status polling 和登录后账号 runtime 都使用这个
  专属代理。显式账号代理进入 single-agent 路径，连接失败直接报错，不遍历全局池。
- 新账号控制台默认推荐“当前已绑定账号数最少”的池成员，但用户可以明确选择不绑定。
  已有账号在账号表可把当前池分配出口一键冻结成专属代理，也可改绑或取消绑定。
- 账号绑定 API 对代理 URL 做严格校验：非法值返回 400，禁止“看起来已绑定、实际上
  静默回落全局池”的假成功。
- CLI `npm run login` 未传 scope 时继续保留历史宿主机稳定指纹，避免无关行为变化。
- 同一已存在账号重新登录且未指定新代理时，保留其原有专属代理，不因刷新 token 丢绑定。

## Alternatives considered

- **只保留全局代理池的稳定哈希** — 正常情况下足够稳定，但连接失败会 fallback 到其它
  池成员；用户要解决的正是这种故障路径上的 IP 漂移，所以不能把“首选”当“绑定”。
- **全局池彻底禁止 fallback** — 能保证 IP 不漂，但会把一个坏代理拖垮所有分到它的账号，
  且改变未绑定账号的历史可用性语义。专属账号严格、未绑定账号继续容错更清晰。
- **每个请求都随机 fingerprint** — 看似能避免重复，但会让同一登录/会话不断换设备身份，
  一致性更差。选择“flow 级唯一、flow 内固定”。
- **继续使用宿主机 fingerprint，只额外混入账号 email/id** — 登录 code 发出时还不知道最终
  Freebuff 账号 id/email；若中途替换 fingerprint，code/status 又会不一致。flow id 是在
  第一条请求前就可确定且生命周期恰好匹配的稳定 scope。
- **登录完成后再绑定代理** — 第一阶段 login code/status 仍可能从另一个 IP 出口完成，
  账号建立时就产生出口不一致。绑定必须前移到创建登录链接之前。
- **接受任意 proxy 字符串，由底层容错** — 会让错误配置静默变成全局池/直连，用户无法确认
  账号是否真的被固定。配置入口应 fail closed，运行时网络故障再按对应模式处理。

## Consequences

- 新增账号可以从第一条登录请求开始保持固定出口；账号表明确显示“固定 / 池分配 / 直连”。
- 已显式绑定的账号牺牲了代理故障自动切换能力，以换取出口 IP 一致性；这是有意取舍。
- 未绑定账号行为不变：仍按全局池稳定哈希选择首选代理，连接失败可回落其它池成员。
- 同一容器里连续创建多个 Web 登录流程时，`fingerprintId` 不再全部相同；同一个 flow
  的 code/status 则保持完全一致。
- 重新登录会创建新的 flow fingerprint；本决策保证的是一次账号 onboarding/login flow
  内的一致性，不声称跨重新登录永久保持同一个设备指纹。
- 凭据导出会继续包含 `fingerprintId/fingerprintHash/proxy`，迁移时可保留这些账号属性。

## Testing

- `test/smoke.mjs` 断言：
  - 无 scope 的 CLI fingerprint 在同一主机稳定；
  - 同一 flow scope 两次生成完全一致；
  - 不同 flow scope 的 fingerprint 不同，且不等于宿主机公共 fingerprint；
  - 账号 PATCH 非法代理返回 400 且不污染凭据；
  - 合法专属代理可以持久化；
  - 取消绑定后 `proxy` 回到 null。
- 既有 per-account proxy smoke 继续断言显式账号代理优先于全局池，并在 runtime 的
  `effectiveProxy` 中可见。
