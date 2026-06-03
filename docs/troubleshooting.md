# Troubleshooting

This page covers the symptoms that come up often in dev and on first
production deploys, with the actual fix in one or two commands. If
something is broken and not listed here, check
[`docs/development.md`](development.md) and the per-feature guides
([`docs/fleet-guide.md`](fleet-guide.md),
[`docs/providers.md`](providers.md),
[`docs/security.md`](security.md)) before opening an issue.

---

## Cowork: the embedded Code Buddy engine doesn't load

**Symptoms** — startup log contains one of:

```
[Main] Code Buddy engine not present at /<path>/desktop/codebuddy-engine-adapter.js (layer=dev)
[Runtime] Using pi-coding-agent runner (engine not loaded)
[SessionManager] Using pi-coding-agent runner
```

**Diagnosis** — the file Cowork tried to import doesn't exist at the
resolved path. The startup log now prints the path + layer
(`env-override` / `packaged` / `dev-from-bundle` / `dev`) so you can
see which fallback the resolver fell through to.

**Fix** — usually one of:

1. **Rebuild the core**: at the repo root, run `npx tsc -p .`. The
   dev loop in `cowork/DEV-LINUX.md` rebuilds `cowork/dist-electron/`
   only — the parent CLI's `dist/` is a separate compilation step.
2. **Pull / merge artifacts mismatch**: if the dist/ files are
   present but stale (`git status` lists changes under `src/desktop/`
   that haven't been compiled), rerun `npx tsc -p .`.
3. **Manual electron launch from outside `npm run dev` / `buddy gui`**:
   force the path via the env override.
   ```bash
   CODEBUDDY_ENGINE_PATH=/path/to/code-buddy/dist \
     ./cowork/node_modules/electron/dist/electron \
     --no-sandbox --disable-gpu \
     ./cowork/dist-electron/main/index.js
   ```
   The `dev-from-bundle` layer normally handles this without an env
   var, but a custom launcher that strips environment variables (some
   IDEs do this) might need the explicit override.

See [`cowork/DEV-LINUX.md`](../cowork/DEV-LINUX.md) for the full set
of layers and what each one trades off.

---

## `usearch` native binding fails to load

**Symptoms** — error like `Cannot find module 'usearch'` or
`usearch_<platform>.node not found` when running tests or starting
the agent.

**Diagnosis** — the prebuilt native binding for your platform wasn't
downloaded during `npm install` (offline machine, mirror blocked,
proxy, etc.).

**Fix** —

1. Remove the package + cache: `rm -rf node_modules/usearch && rm -rf ~/.npm/_cacache`.
2. Reinstall with verbose logs: `npm install usearch --verbose`. Look
   for a "downloading prebuilt binary" line — if it 404s, you need
   network access to the prebuilt host (currently GitHub releases).
3. If you can't reach the prebuilt host, build from source:
   `npm install usearch --build-from-source` (requires a working
   C++ toolchain).

---

## `JWT_SECRET` errors at server startup

**Symptoms** — `/api/health` returns 500, or the WS Gateway refuses
connections with `auth: invalid token`.

**Diagnosis** — the server requires `JWT_SECRET` (≥ 32 chars) in
production. In dev a short-lived random secret is minted at boot
(`ServerBridge.start mints runtime JWT_SECRET (single-user fallback)`),
which is fine for local use but **not** for any deployment that
expects clients to authenticate across restarts.

**Fix** —

1. Generate a real secret: `openssl rand -hex 32`.
2. Pass it via env: `JWT_SECRET=<hex> buddy serve` or set it in your
   deployment's secret store.
3. Restart the server. Existing client tokens minted under the random
   dev secret will be invalidated — clients need to re-auth.

---

## Peer connectivity (`/fleet listen` fails or times out)

**Symptoms** —

```
Fleet listener connect failed: handshake timeout (10s)
```

or

```
WS error: 401 Unauthorized
```

**Diagnosis** — three common roots:

1. **No network path** — your Tailscale / local network isn't routing
   to the peer's IP. Confirm with `tailscale status` or `nc -zv
   <peer-ip> 3000`.
2. **Missing scope on the API key** — the peer's apiKey hasn't been
   granted `fleet:listen` (and `peer:invoke` if you intend to call
   `/fleet send`). Add the scope on the peer's side and re-issue the
   key.
3. **Origin / CORS** — the peer's `corsOrigins` defaults to
   localhost-only; a remote listener needs the listening host's
   origin to be allow-listed. Set `CODEBUDDY_FLEET_CORS_ORIGINS` on
   the peer.

**Fix** —

```bash
# 1. Reachability
tailscale ping <peer-hostname>
nc -zv <peer-ip> 3000

# 2. Key + scopes (on the peer)
# Create or re-issue a Code Buddy API key with:
#   fleet:listen          for /fleet listen
#   peer:invoke           for /fleet send, /fleet chat, /fleet tool
#   fleet:listen,peer:invoke for both observe + invoke workflows
CODEBUDDY_FLEET_API_KEY=<redacted>

# 3. CORS (on the peer)
CODEBUDDY_FLEET_CORS_ORIGINS=http://<listener-host>:* buddy serve
```

See [`docs/fleet-guide.md`](fleet-guide.md) for the full scope
matrix and the rationale behind `peer:invoke` vs `fleet:listen`.

---

## Ollama is installed but Code Buddy doesn't see it

**Symptoms** — `/fleet describe` shows `peerChatProvider: null` even
though `ollama list` returns models on the same host.

**Diagnosis** —

- `OLLAMA_HOST` isn't set, or points at a different daemon than the
  one you ran `ollama serve` on.
- The Ollama daemon isn't listening on `127.0.0.1:11434` (e.g.
  Docker container with internal-only network).

**Fix** —

```bash
# 1. Confirm the daemon is up + which port it bound to.
curl -s http://127.0.0.1:11434/api/tags | jq .

# 2. Restart Code Buddy with OLLAMA_HOST set if non-default.
OLLAMA_HOST=http://10.0.0.5:11434 buddy serve

# 3. Verify peer.chat is wired.
buddy
> /fleet send self peer.describe
# Look for `peerChatProvider: { provider: 'ollama', model: '...', isLocal: true }`
```

If the provider shows up but `peer.chat` times out, the Ollama model
may be loading on the first request (cold start). Send a `/fleet
ping` first to warm the daemon, or pre-pull the model with
`ollama run <model> "noop"`.

---

## `peer.chat-session.*` returns `SESSION_NOT_FOUND` after a restart

**Symptoms** — you restart `buddy serve` on a peer that had open
chat sessions, then the next `peer.chat-session.continue` returns:

```
SESSION_NOT_FOUND: no session with id "sess_..."
```

**Diagnosis** — the session idled out during the restart window. V1.2-
saga (Phase d.22) persists sessions to
`~/.codebuddy/peer-sessions/<sessionId>.json` and re-hydrates them at
boot, but **only** if `now - lastUsedAt < CODEBUDDY_PEER_SESSION_IDLE_MS`
(default 30 min) — older entries are purged at boot.

**Fix** — pick one:

- For longer downtimes, raise the idle window:
  `CODEBUDDY_PEER_SESSION_IDLE_MS=$((4*60*60*1000)) buddy serve`
  (4 h example).
- For development where you restart often, leave the default and use
  `/fleet chat start` to open a fresh session after each restart.
  V1.2.1's `/fleet chat` slash helper hides the sessionId-copy ritual
  either way.

See [`docs/fleet-guide.md`](fleet-guide.md) sections "Persistence
(V1.2-saga)" and "Limitations".

---

## `CI / GitHub Actions billing` failures

**Symptoms** — every workflow run fails within 3-11 s with an
annotation like `spending limit reached`.

**Diagnosis** — the GitHub org's monthly Actions budget is exhausted.
The repo's tests still run locally fine; nothing is broken about the
code.

**Fix** — go to
<https://github.com/settings/billing/spending_limit> and raise the
limit, or migrate the offending workflows to self-hosted runners.

---

## When in doubt

- Re-run `npm run validate` — lint + typecheck + tests in one go.
- Check `CLAUDE.md` and the per-area guides under `docs/` for
  conventions the agent should follow when you ask it to fix
  something automatically.
- The `/fleet status --with-sessions` and `/fleet history --json`
  commands are designed to be greppable; pipe them through `jq` when
  you're trying to figure out which peer is doing what.
