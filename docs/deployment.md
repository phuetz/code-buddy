# Deployment Guide

How to run `buddy server` in production — systemd, Docker, Kubernetes,
reverse proxy, monitoring, and upgrades.

> **Scope.** This covers the HTTP/WebSocket API server (`buddy server`).
> For the multi-AI fleet specifics (peers, `peer.*` methods, autonomy
> daemon), see [`fleet-guide.md`](fleet-guide.md). For the API surface
> itself, see [`infrastructure.md`](infrastructure.md).

---

## What `buddy server` runs

One process, one port: an Express HTTP API plus the Gateway WebSocket
attached to the **same port** at path **`/ws`**.

```bash
buddy server --port 3000 --host 0.0.0.0        # production: JWT enforced
buddy server --port 3000 --no-auth             # ONLY behind a trusted network
```

| Flag | Default | Notes |
|:-----|:--------|:------|
| `--port <port>` | `3000` | Also settable via `PORT` |
| `--host <host>` | `0.0.0.0` | Bind to `127.0.0.1` when fronted by a local reverse proxy |
| `--no-auth` | auth on | Disables JWT. Never expose a `--no-auth` server to an untrusted network — reserve it for loopback or a private overlay (Tailscale/WireGuard) |

**Fleet convention:** the chat/API server runs on `3000` and a second
instance acting as the fleet gateway runs on `3001`. They are separate
processes of the same binary, not two listeners in one process.

---

## Production checklist

1. **`JWT_SECRET` is mandatory.** With `NODE_ENV=production` and no
   `JWT_SECRET`, the server refuses to start (fail-closed). Generate one:
   `openssl rand -hex 32`.
2. **CORS is localhost-only by default.** Set `CORS_ORIGINS` to the
   exact origins of your clients. Avoid `*` in production.
3. **Behind a proxy, configure trusted proxies explicitly** — the
   gateway is origin-hardened (GHSA-5wcw-8jjv-m286); client IPs are only
   read from `X-Forwarded-For` when the proxy is trusted.
4. **Rate limit** defaults to 100 req/min (`RATE_LIMIT_MAX`,
   `RATE_LIMIT_WINDOW` to tune).
5. **Fleet tool exposure is fail-closed.** `peer.tool.invoke` stays
   disabled until `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` is set.
6. **Optional device pairing.** `CODEBUDDY_GATEWAY_REQUIRE_PAIRING=true`
   gates unknown WebSocket devices behind an approval queue
   (`buddy gateway-pairing pending|approve|reject|revoke`).
7. **Back up before upgrading:** `buddy backup create` (verify with
   `buddy backup verify`).

---

## Environment variables

| Variable | Purpose |
|:---------|:--------|
| `NODE_ENV` | Set to `production` to enforce JWT + production behavior |
| `PORT` | Server port (overridden by `--port`) |
| `JWT_SECRET` | **Required in production.** HMAC secret for API/WS auth |
| `CORS_ORIGINS` | Comma-separated allowed origins (default: localhost only) |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | Rate limiting (default 100 req / 60 s) |
| `GROK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | Provider credentials (set only what you use) |
| `OLLAMA_HOST` / `VLLM_BASE_URL` | Local/bundled provider endpoints |
| `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` | Enables `peer.tool.invoke`; unset = disabled (fail-closed) |
| `CODEBUDDY_PEER_TOOL_ALLOWLIST` | CSV override of the default `view_file,list_directory,search` |
| `CODEBUDDY_PEER_SESSION_IDLE_MS` / `CODEBUDDY_PEER_MAX_DEPTH` / `CODEBUDDY_PEER_ROLE` | Fleet limits / anti-loop guards |
| `CODEBUDDY_FLEET_MAX_CONCURRENCY` | Peer capacity → utilization in heartbeats + backpressure |
| `CODEBUDDY_GATEWAY_REQUIRE_PAIRING` | `true` to require device pairing on the gateway WS |
| `SENTRY_DSN` / `OTEL_EXPORTER_OTLP_ENDPOINT` | Error reporting / OpenTelemetry export |
| `MAX_COST` | Session cost budget (USD) |

Keep secrets out of unit files — use an `EnvironmentFile` (systemd) or
secrets (Docker/K8s). A common layout is `~/.codebuddy/fleet.env` with
`0600` permissions.

---

## systemd

Tested in production on the Ministar fleet hub. Two variants below —
prefer the **built** one (faster boot, no toolchain at runtime).

### From a build (recommended)

```bash
cd /opt/code-buddy && npm ci && npm run build
```

```ini
# /etc/systemd/system/codebuddy.service
[Unit]
Description=Code Buddy HTTP/WebSocket API server
Documentation=https://github.com/phuetz/code-buddy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=codebuddy
WorkingDirectory=/opt/code-buddy
EnvironmentFile=-/etc/codebuddy/server.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js server --port 3000 --host 127.0.0.1
Restart=on-failure
RestartSec=10
# Daily restart helps catch slow leaks before they accumulate.
RuntimeMaxSec=86400
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codebuddy.service
journalctl -u codebuddy -f
```

### From source (tsx)

Useful on dev/staging boxes that track `main`. Note that systemd has no
inherited `PATH` — point it at your Node install explicitly:

```ini
[Service]
WorkingDirectory=/home/youruser/code-buddy
EnvironmentFile=-/home/youruser/.codebuddy/fleet.env
Environment=PATH=/home/youruser/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/youruser/.nvm/versions/node/v24.14.1/bin/npx tsx src/index.ts server --port 3001 --host 0.0.0.0
```

> The `--no-auth` flag is acceptable **only** when the listener is bound
> to a private overlay network (e.g. a Tailscale tailnet) whose ACL you
> control. Switch to JWT before adding any out-of-ACL client.

---

## Docker

The repo ships a multi-stage [`Dockerfile`](../Dockerfile) (non-root
user `codebuddy`, healthcheck on `/api/health` built in, `EXPOSE 3000`).

```bash
# Build
docker build -t codebuddy:latest --target production .

# Run the server
docker run -d --name codebuddy \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e GROK_API_KEY="$GROK_API_KEY" \
  -e CORS_ORIGINS="https://app.example.com" \
  -v codebuddy-data:/home/codebuddy/.codebuddy \
  codebuddy:latest server --port 3000 --host 0.0.0.0
```

Persist `/home/codebuddy/.codebuddy` — it holds the SQLite database,
sessions, memory, and peer-session state. Schema migrations run
automatically at startup (see Upgrades below).

Or use Compose — [`docker-compose.yml`](../docker-compose.yml) at the repo
root runs exactly this as a single `codebuddy` **server** service
(`restart: unless-stopped`, named volume on `/home/codebuddy/.codebuddy`,
`JWT_SECRET` required):

```bash
cp .env.example .env          # set JWT_SECRET + a provider key
docker compose up -d
```

See [`install.md`](install.md) for the full one-command / Docker / npm
install paths.

---

## Kubernetes

Ready-to-adapt manifests live in
[`deploy/kubernetes/`](../deploy/kubernetes/):

| File | Purpose |
|:-----|:--------|
| `deployment.yaml` | Single-replica Deployment, ports 3000/3001, env from ConfigMap + Secret |
| `service.yaml` | ClusterIP service |
| `ingress.yaml` | Ingress (adapt host + TLS) |
| `configmap.yaml` | Non-secret configuration |
| `secret.yaml` | `JWT_SECRET`, provider API keys |
| `rbac.yaml` | ServiceAccount |
| `kind-setup.sh` | Local kind cluster bootstrap for testing |

```bash
kubectl apply -f deploy/kubernetes/
kubectl rollout status deployment/codebuddy
```

Notes:

- Fill real values into `secret.yaml` (or replace with
  ExternalSecrets/SealedSecrets) before applying.
- Keep `replicas: 1` unless you externalize state: the SQLite database
  and peer-session files are per-instance. Use a PVC mounted on
  `/home/codebuddy/.codebuddy`.
- Wire liveness/readiness probes to `GET /api/health`.

---

## Reverse proxy (nginx)

WebSocket upgrade must be forwarded for `/ws`:

```nginx
server {
  listen 443 ssl;
  server_name buddy.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;   # long-lived gateway connections
  }
}
```

Remember to declare the proxy as trusted (see checklist §3) so client
IPs and origins are evaluated correctly.

---

## Health & monitoring

| Endpoint | Purpose |
|:---------|:--------|
| `GET /api/health` | Liveness + `apiHeartbeat` (30 s provider probe loop) |
| `GET /api/metrics` | Prometheus metrics |
| `GET /api/heartbeat/status` | Heartbeat detail (`?format=report` for Cowork-ready JSON) |
| `GET /api/daemon/status` | Autonomy daemon status (`?format=report`) |

Observability backends: set `SENTRY_DSN` (errors) and/or
`OTEL_EXPORTER_OTLP_ENDPOINT` (traces). `buddy doctor` diagnoses a
misbehaving install (`--fix` applies auto-migrations).

---

## Upgrades

1. `buddy backup create` (and `buddy backup verify`).
2. Deploy the new version (rebuild image / `git pull && npm ci && npm
   run build` / `buddy update`).
3. Restart the service. **SQLite schema migrations run automatically at
   startup** — the manager walks `schema_version` up to the current
   `SCHEMA_VERSION` (covered end-to-end by
   `tests/database/migration-e2e.test.ts`).
4. Legacy JSON installs (pre-SQLite `~/.codebuddy/*.json`) are imported
   by the JSON→SQLite migration; `buddy doctor --fix` triggers it if
   needed.
5. If anything goes wrong: stop the service, `buddy backup restore`,
   redeploy the previous version.
