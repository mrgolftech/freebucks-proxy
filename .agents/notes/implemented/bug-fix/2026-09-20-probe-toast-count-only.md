# Agent Note: 「检测该账号」的提示只报可用与模型数量

Status: implemented

## Problem

账号行「检测」按钮的 toast 里拼了**全部模型明细**：

```js
const models = Object.entries(limits)
  .map(([id, info]) => `${shortModel(id)} ${fmtNum(info?.recentCount)}/${info?.limit ?? '?'}`)
  .join(' · ')
toast(`✅ ${a.email} 可用 · ${modelCount} 个模型${models ? '：' + models : ''}`)
```

后果：一行 toast 塞进十几个「模型名 已用/上限」，在窄屏直接被截断成半句；
更糟的是这条 toast 会**盖住其它提示**（检测的同时账号卡在刷新，报错信息排在它后面
就看不见了）。而这个清单本身在「模型管理」页是完整表格，在 toast 里重复一遍没有增量信息。

## Decision

检测成功的提示只保留两个信息：**是否可用** + **模型数量**：

```js
toast(`✅ ${a.email} 可用 · ${modelCount} 个模型`)
```

`modelCount` 的口径不变，仍是 `availableModelIds`（与 `/v1` 白名单同源）的长度——
即"这个号此刻真能被代理放行的模型数"，不是只数次数限流表。要拆解构成（次数额度
多少、钱包计费多少、哪个模型用了多少）去「模型管理」页看。

## Alternatives considered

- **保留完整清单**：就是被否掉的现状，窄屏截断 + 遮挡其它提示。
- **把清单放进悬停提示**：toast 是自动消失的浮层，没有可悬停的目标，做不了。
- **改成弹窗展示明细**：一次只读检测要用户再关一个弹窗，成本大于收益；
  真要看明细的人本来就会去模型管理页。

## Consequences

- 检测的反馈变短，信息密度下降：想知道"哪个模型还有额度"要转到模型管理页。
- 数量口径没变（仍是 `availableModelIds` 长度），所以与 1.16.4 修好的
  「可用 10 个模型（次数额度 5 · 钱包计费 10）」是同一个数，只是不再展开分项。
- 检测失败的分支（`⚠️ … 检测异常：<原因>`）保持不变，仍带原因说明。

## Testing

- `npm test`：新增 dashboard 源码级断言，要求成功 toast 只能是
  `✅ <email> 可用 · N 个模型`，并禁止旧的次数额度/钱包计费明细回流。
- `npm run typecheck`、`verify-all.ts --base HEAD`。
- 隔离实例上重放 `probeAccount()` 的取数逻辑，确认 toast 文案为
  `✅ <email> 可用 · 10 个模型`，且不再包含模型 id 列表。
