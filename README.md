# freebucks-proxy

一个轻量级的 AI API 网关，用于统一模型接入、账号与会话管理、调度、配额状态观察和 Web 管理。

项目向下游提供常见的 API 兼容接口，将上游连接、账号池、会话生命周期、重试、限流和运行状态统一收敛到一个服务中。

## 主要功能

- OpenAI 兼容的 `/v1/chat/completions` 与 `/v1/models`
- 支持流式与非流式响应
- 多账号池、粘性调度与故障切换
- 会话生命周期与空闲释放
- 配额、Tier、Offer 与冷却状态观察
- 账号绑定代理与连通性检测
- 模型级限流记忆与重试处理
- Web 控制台管理账号、用户、API Key、模型和运行状态
- Docker 部署与本地数据持久化
- 健康检查与运行诊断

## 快速开始

```bash
git clone https://github.com/mrgolftech/freebucks-proxy.git
cd freebucks-proxy

cp .env.example .env
# 按需编辑 .env，建议设置 ADMIN_PASSWORD

docker compose up -d
```

启动后访问：

```text
http://<宿主机IP>:<PORT>
```

账号、API Key、代理、模型和运行状态均可通过 Web 控制台管理。

常用命令：

```bash
docker compose ps
docker compose logs -f
docker compose restart
docker compose pull
docker compose up -d
docker compose down
```

运行数据保存在配置的数据目录中，正常更新容器不会要求重新创建账号状态。

## API

主要兼容接口：

| 接口 | 用途 |
|---|---|
| `POST /v1/chat/completions` | 对话请求 |
| `GET /v1/models` | 模型目录与可用状态 |
| `GET /healthz` | 服务健康检查 |

下游通常只需要配置：

```text
base_url + api_key + model
```

示例：

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-id>",
    "stream": true,
    "messages": [{"role":"user","content":"Hello"}]
  }'
```

## 账号与会话管理

网关统一维护账号状态、活动会话、配额快照、冷却窗口和路由信息。

调度遵循几个基本原则：

- 优先复用已有可用会话；
- 尽量保持账号粘性，避免无意义轮换；
- 跳过暂时不可用的账号或模型通道；
- 尊重上游返回的明确重试与重置时间；
- 尽量把模型级故障限制在对应模型，不影响同账号其他模型；
- 在不创建额外会话的前提下刷新配额与授权状态。

这些状态都会在 Web 控制台中展示，方便定位实际调度行为。

## 模型状态

模型可用性根据当前上游会话和目录状态动态生成，而不是依赖永久固定列表。

控制台可能显示：

- 可用
- 需要订阅
- Offer 暂不可用
- Trial 已用完
- 临时限流
- 已下线或存在替代模型

最终可用性、配额、价格与准入结果仍以上游实时返回为准。

## 代理与网络

支持显式代理配置和账号绑定出口，可用于需要稳定出口或不同账号使用独立网络路径的部署环境。

详见 [代理支持](docs/proxy.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [部署与运维](docs/deployment.md) | Docker、持久化、备份与 CI 镜像 |
| [Web 控制台](docs/web-console.md) | 账号、用户、API Key 与管理操作 |
| [多账号池与调度](docs/scheduling.md) | 账号池、会话、配额保护与调度 |
| [连接治理](docs/connection-health.md) | 连接清理、重连与重启策略 |
| [代理支持](docs/proxy.md) | 出口代理与连通性检测 |
| [多模态输入](docs/multimodal-image-input.md) | 图片输入兼容说明 |
| [API 接入](docs/api.md) | API 行为与集成说明 |
| [本地开发](docs/development.md) | 本地启动、命令与测试 |
| [配置参考](docs/configuration.md) | 配置项说明 |

## 本地开发

环境要求：

- Node.js 20+
- npm
- Docker（需要验证容器时）

常用命令：

```bash
npm ci
npm test
npm run typecheck
npm start
```

发布前 CI 会同时验证测试、类型检查和容器启动路径。

## 说明

- 本项目是独立的兼容接入网关，与任何上游服务提供方均无隶属关系。
- 鉴权、可用性、配额、价格、区域限制和限流最终由所配置的上游服务决定。
- 本项目不保证无限使用，也不绕过上游访问控制。
- 请按照对应上游账号与部署环境适用的条款和策略使用。

## License

MIT License，详见 [LICENSE](./LICENSE)。
