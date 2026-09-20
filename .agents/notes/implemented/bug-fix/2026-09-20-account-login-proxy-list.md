# Agent Note: 新账号代理列表不能把读取失败当成空配置

Status: implemented

## Problem

“添加 Freebuff 账号（浏览器登录）”弹窗打开时会请求 `/api/proxy`，原实现存在三层
误判：

1. 弹窗只使用响应里的 `proxies`（控制台保存的全局代理池），忽略
   `effective`（config 单代理 / 环境代理）以及已有账号的 `proxy/effectiveProxy`。
   因此代理设置卡片里明明显示“当前生效代理”，新增账号下拉框仍可能看不到。
2. `/api/proxy` 任意一次瞬时失败都会被空 `catch` 吞掉，然后代码把列表置为空，
   UI 继续显示“当前没有代理池”。网络失败与“确实没配置代理”被错误合并成同一种状态。
3. 代理设置卡片曾用 `Promise.all([/api/proxy, /api/settings])`。只要 settings 请求失败，
   即使 proxy 请求成功，也会整体进入 fallback 并把 `state.proxies` 清空，导致弹窗失去
   可用于容错的上一轮代理缓存。

## Decision

- 控制台 API 请求默认 `cache: 'no-store'`，动态代理/账号状态不复用浏览器陈旧缓存。
- 新账号弹窗通过 `collectAvailableProxies()` 合并：
  - 全局代理池 `proxies`；
  - 当前生效代理 `effective`；
  - 已有账号绑定/实际出口 `proxy/effectiveProxy`；
  - 页面上一轮成功读取的 `state.proxies` 作为瞬时失败兜底。
- 实时请求失败时不再伪装成“没有代理”：
  - 有缓存则明确提示“实时读取失败，正在使用缓存”，仍允许继续；
  - 无缓存则禁用“生成登录链接”，提供“重试读取代理”按钮，避免用户在未知出口状态下误建账号。
- `renderProxySettings()` 将 `/api/proxy` 与 `/api/settings` 独立容错，settings 故障
  不再清空代理状态。
- 保存代理池成功后立即把服务端返回值写回 `state.proxies`，使后续弹窗即使遇到一次
  GET 瞬时失败仍有最新缓存可用。

## Consequences

- “已经设置/正在生效”的代理会稳定出现在新增账号选择器里，而不局限于全局 pool。
- 短暂网络抖动或某个无关设置接口失败不会再造成“代理池看起来随机消失”。
- 真正没有任何代理时仍显示空列表；读取失败则显示为错误状态，两种情况不再混淆。
- 新账号仍然是显式绑定单代理；这里没有改变运行时的账号调度或代理故障回落语义。

## Testing

- `dashboard/app.js` 可通过 `new Function()` 语法编译。
- 现有 smoke test 会继续执行 dashboard JS 语法门禁。
- CI 需继续通过 `npm test`、`npm run typecheck` 与 Docker `image-boot`。
