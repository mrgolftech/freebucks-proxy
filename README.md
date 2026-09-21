# freebucks-proxy

A lightweight OpenAI-compatible API gateway for unified model access, account/session management, scheduling, quota awareness, and web administration.

The project exposes a familiar API surface to downstream tools while centralizing upstream connectivity, session lifecycle, account pooling, retries, quota state, and operational controls in one service.

## Features

- OpenAI-compatible `/v1/chat/completions` and `/v1/models`
- Streaming and non-streaming responses
- Multi-account pool with sticky scheduling and failover
- Session lifecycle and idle-release management
- Quota, tier, offer, and cooldown visibility
- Per-account proxy binding and connection checks
- Model-level rate-limit memory and retry handling
- Web console for accounts, users, API keys, models, and diagnostics
- Docker deployment with persistent local data
- Health checks and operational status endpoints

## Quick start

```bash
git clone https://github.com/mrgolftech/freebucks-proxy.git
cd freebucks-proxy

cp .env.example .env
# Edit .env as needed. Setting ADMIN_PASSWORD is recommended.

docker compose up -d
```

After startup, open:

```text
http://<host>:<PORT>
```

The default port is defined by the project configuration. Account credentials, API keys, proxy settings, and model state can be managed from the Web console.

Common operations:

```bash
docker compose ps
docker compose logs -f
docker compose restart
docker compose pull
docker compose up -d
docker compose down
```

Persistent runtime data is stored under the configured data directory, so normal container updates do not require re-creating account state.

## API

The main compatibility endpoints are:

| Endpoint | Purpose |
|---|---|
| `POST /v1/chat/completions` | Chat completion endpoint |
| `GET /v1/models` | Model catalog and availability state |
| `GET /healthz` | Service health check |

Downstream clients typically only need:

```text
base_url + api_key + model
```

Example:

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

## Account and session management

The gateway keeps account state, active sessions, quota snapshots, cooldowns, and routing information in one place.

Scheduling is designed around a few practical rules:

- Prefer an already usable session when possible.
- Keep requests sticky instead of rotating accounts unnecessarily.
- Avoid accounts or model lanes that are temporarily unavailable.
- Respect explicit retry/reset windows returned by the upstream service.
- Keep model-scoped failures isolated from unrelated models when possible.
- Refresh quota and entitlement state without creating unnecessary sessions.

The Web console surfaces these states so routing decisions can be inspected instead of being hidden inside the scheduler.

## Model availability

Model availability is derived from the current upstream session/catalog state rather than treated as a permanently static list.

Depending on the account and upstream state, the console may show conditions such as:

- available
- subscription required
- limited offer unavailable
- trial exhausted
- temporarily rate-limited
- withdrawn or replaced

These states are observational. Final availability, pricing, quota, and admission decisions remain controlled by the upstream service.

## Proxy and network

The service supports explicit proxy configuration and account-bound egress selection. This is useful when deployments need stable outbound routing or separate network paths for different accounts.

See [Proxy support](docs/proxy.md) for the configuration details.

## Configuration

Most day-to-day configuration can be managed from the Web console. File/environment configuration remains available for deployment and bootstrap settings.

Useful references:

| Document | Content |
|---|---|
| [Deployment](docs/deployment.md) | Docker deployment, persistence, backup, CI images |
| [Web console](docs/web-console.md) | Accounts, users, API keys, and administration |
| [Scheduling](docs/scheduling.md) | Account pool, sessions, quota protection, routing |
| [Connection health](docs/connection-health.md) | Connection cleanup, reconnect, restart behavior |
| [Proxy support](docs/proxy.md) | Egress proxies and connectivity checks |
| [Multimodal input](docs/multimodal-image-input.md) | Image-input compatibility notes |
| [API integration](docs/api.md) | API behavior and integration details |
| [Development](docs/development.md) | Local development, commands, and tests |
| [Configuration reference](docs/configuration.md) | Configuration options |

## Development

Requirements:

- Node.js 20+
- npm
- Docker, if container validation is required

Common commands:

```bash
npm ci
npm test
npm run typecheck
npm start
```

The repository CI also validates the container image boot path before release.

## Notes

- This project is an independent compatibility gateway and is not affiliated with any upstream service provider.
- Authentication, availability, quota, pricing, regional restrictions, and rate limits are ultimately determined by the configured upstream service.
- The project does not guarantee unlimited usage or bypass upstream access controls.
- Use the service in accordance with the terms and policies that apply to your upstream account and deployment environment.

## License

MIT License. See [LICENSE](./LICENSE).
