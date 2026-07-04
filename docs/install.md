# Install Code Buddy

Three ways in, fastest first. All of them land you at the same next step:
**`buddy onboard`** (guided setup) and **`buddy login`** (sign in with a ChatGPT
Plus/Pro subscription — OAuth, `$0` marginal cost, no API key).

| Path | Best for | One line |
|:-----|:---------|:---------|
| [1. One command](#1-one-command-curl--sh) | A laptop / workstation | `curl -fsSL https://raw.githubusercontent.com/phuetz/code-buddy/main/install.sh \| sh` |
| [2. Docker / VPS](#2-docker--vps-247) | A server that runs 24/7 | `docker compose up -d` |
| [3. npm](#3-npm) | You already have Node ≥ 20 | `npm install -g @phuetz/code-buddy` |

---

## 1. One command (`curl | sh`)

```sh
curl -fsSL https://raw.githubusercontent.com/phuetz/code-buddy/main/install.sh | sh
```

The installer ([`install.sh`](../install.sh)) is POSIX `sh`, idempotent, and
**never-destructive**:

- Detects your OS/arch (Linux/macOS, x64/arm64).
- Ensures **Node.js ≥ 20** — it uses your Node if it is new enough, otherwise it
  downloads an official Node build into `~/.codebuddy/node` (checksum-verified,
  **no sudo**). It never replaces or removes an existing Node.
- Installs the `@phuetz/code-buddy` package globally, falling back to a
  user-local npm prefix when the global one would need root — so it **never runs
  `sudo` behind your back**.

Prefer to read before you run? Inspect the script first:

```sh
curl -fsSL https://raw.githubusercontent.com/phuetz/code-buddy/main/install.sh -o install.sh
less install.sh          # review
sh install.sh            # run
```

Useful overrides (all optional):

| Variable | Default | Purpose |
|:---------|:--------|:--------|
| `CODEBUDDY_NODE_VERSION` | `20.18.1` | Node version fetched when a private copy is needed |
| `CODEBUDDY_HOME` | `~/.codebuddy` | Where a private Node / npm prefix is placed |
| `CODEBUDDY_MIN_NODE_MAJOR` | `20` | Minimum acceptable system Node major |

> **Windows:** use **WSL2** (then follow the Linux path above), or the [npm path](#3-npm).

Then:

```sh
buddy onboard     # guided setup — pick a model, keys optional
buddy login       # ChatGPT Plus/Pro OAuth, $0 marginal cost   (or: buddy login xai)
buddy             # start chatting
```

---

## 2. Docker / VPS (24/7)

The isolated, always-on path — ideal for a VPS. Runs `buddy server` (HTTP API +
WebSocket gateway) as a **non-root** container with a persistent volume for your
config, credentials, and memory, and restarts on reboot.

### Compose (recommended)

```sh
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy

cp .env.example .env
# Edit .env: set JWT_SECRET (openssl rand -hex 32) and at least one provider key.

docker compose up -d          # build + start, restart:unless-stopped
docker compose logs -f        # follow logs
curl http://localhost:3000/api/health
```

`docker-compose.yml` defines a single `codebuddy` service:

- **Non-root** user `codebuddy` (see [`Dockerfile`](../Dockerfile)).
- Port **3000** — HTTP API + WebSocket on the same port (path `/ws`).
- Named volume **`codebuddy-data`** mounted at `/home/codebuddy/.codebuddy` —
  holds the SQLite DB, sessions, memory, credentials, peer-session state.
  It survives `docker compose down`.
- `JWT_SECRET` is **required** (the server refuses to start in production
  without it — compose errors out early with a clear message).
- Secrets come from `.env` / the environment — **never baked into the image**.

### Plain `docker run`

```sh
docker build -t codebuddy:latest --target production .

docker run -d --name codebuddy \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e GROK_API_KEY="$GROK_API_KEY" \
  -e CORS_ORIGINS="https://app.example.com" \
  -v codebuddy-data:/home/codebuddy/.codebuddy \
  codebuddy:latest server --port 3000 --host 0.0.0.0
```

One-off CLI in a container (no server):

```sh
docker run --rm -it \
  -v codebuddy-data:/home/codebuddy/.codebuddy \
  codebuddy:latest --prompt "explain this repo" 
```

> **Security note.** Expose the server behind a reverse proxy with TLS; keep
> `JWT_SECRET` set, lock `CORS_ORIGINS` to your real client origins (never `*`),
> and never run `--no-auth` on a public network. Full production checklist:
> [`deployment.md`](deployment.md).

To use the `$0` ChatGPT login inside the container, run `buddy login` in an
interactive shell (`docker compose exec codebuddy buddy login`) — the OAuth
tokens persist in the mounted volume.

---

## 3. npm

If you already have **Node.js ≥ 20** (`node --version`):

```sh
npm install -g @phuetz/code-buddy
buddy onboard
```

From source (newest features):

```sh
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy
npm install
npm run build
npm link            # exposes `buddy` globally
```

> **Requirements:** Node.js **≥ 20** for the CLI. The **Cowork desktop app needs
> Node ≥ 22** plus a C++ toolchain for native modules (`better-sqlite3`).
> Run **`buddy doctor`** anytime to check your environment (`--fix` to remediate).

---

## First run

Whichever path you took:

```sh
buddy login          # ChatGPT Plus/Pro OAuth → $0 marginal cost, no API key
# …or a free, fully local brain:
export CODEBUDDY_PROVIDER=ollama
buddy                # start chatting

buddy --prompt "analyze the codebase structure"   # one-shot / headless
```

See [Getting Started](getting-started.md) for headless mode, sessions, and
typical workflows, and [Deployment](deployment.md) for running the server in
production.
