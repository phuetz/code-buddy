# Hermes memory providers — connectors & self-hosting

Date: 2026-06-04

> **Living reference** for the memory-provider connectors and self-hosting. For the overall Hermes/OpenClaw parity
> state, see [`hermes-openclaw-parity.md`](hermes-openclaw-parity.md) (`memory-providers` is one of its tracked features).

Code Buddy maps Hermes' 8 external memory providers onto native TypeScript
**connector adapters**. Each adapter is a thin pipe: it shuttles
`remember`/`recall`/`search` across the provider's network or CLI boundary and
**falls back to the built-in local memory** when the provider is not configured.
The clever part (fact extraction, dialectic reasoning, tiered retrieval) lives
in the service, not in the adapter — so this is connector parity, not a
re-implementation.

> Honest scope: 6 of 8 providers have a real network/CLI boundary and are
> adapted. **Holographic** (in-process Python SQLite + HRR) and **Hindsight**
> (Python SDK / embedded daemon) have no clean boundary to wrap from
> TypeScript; adapting them would be parity-by-label, so they are deliberately
> out of native scope. Use upstream Hermes (Python) for those, or Code Buddy's
> built-in `local` provider (already a durable local store).

## Provider matrix

| Provider | Status | Boundary | Self-host? | Activate with |
|---|---|---|---|---|
| local (built-in) | ✅ default | in-process | n/a | always on |
| **Mem0** | ✅ adapter | HTTP | yes (OSS REST) | `MEM0_BASE_URL` (self-host) or `MEM0_API_KEY` (cloud) |
| **Honcho** | ✅ adapter | HTTP v3 | yes (FastAPI) | `HONCHO_BASE_URL` (self-host) or `HONCHO_API_KEY` (cloud) |
| **OpenViking** | ✅ adapter | HTTP `/api/v1` | yes (AGPL) | `OPENVIKING_ENDPOINT` |
| **ByteRover** | ✅ adapter | `brv` CLI | account-gated | `npm i -g byterover-cli` **+ `brv login`** |
| **Supermemory** | ✅ adapter | HTTP v3 | no (cloud) | `SUPERMEMORY_API_KEY` |
| **RetainDB** | ✅ adapter | HTTP v1 | no (cloud) | `RETAINDB_API_KEY` |
| Hindsight | ⛔ out of scope | Python SDK / daemon | — | use upstream Hermes |
| Holographic | ⛔ out of scope | in-process Python | — | use upstream Hermes / built-in `local` |

Inspect the live matrix (secret-safe — only env *names* are shown):

```bash
buddy hermes memory status        # human readable
buddy hermes memory status --json # machine readable
```

## Selecting a provider

The built-in `local` provider is always active and durable. To make an external
provider active alongside it:

```bash
export CODEBUDDY_MEMORY_PROVIDER=mem0   # or honcho / openviking / byterover / supermemory / retaindb
```

Endpoints/bodies are sourced from the real upstreams (NousResearch/hermes-agent
plugins, plastic-labs/honcho v3 SDK routes, mem0/supermemory/RetainDB public
docs) — not guessed. Auth credentials are read from the environment only and are
never accepted from the model or printed.

## Self-hosting on a 24/7 Linux box (e.g. a Tailscale host)

A private always-on Linux host turns the "cloud SaaS" providers Mem0/Honcho/
OpenViking into **self-hosted, sovereign** memory. Run the service on the box,
then point Code Buddy at it over the private network. Replace `MYHOST` with your
Tailscale name/IP.

### Mem0 (OSS REST server)

```bash
# On the Linux host (Mem0 server needs an LLM for fact extraction):
docker run -d --name mem0 -p 8888:8888 \
  -e OPENAI_API_KEY=sk-...   # or any OpenAI-compatible endpoint mem0 supports \
  mem0/mem0-api-server         # see docs.mem0.ai/open-source/features/rest-api
```

```bash
# On your workstation:
export CODEBUDDY_MEMORY_PROVIDER=mem0
export MEM0_BASE_URL=http://MYHOST:8888    # self-host => no /v1 prefix, /memories + /search
# MEM0_API_KEY optional for self-host (sent as X-API-Key if set)
```

> **Important — Mem0's write path is synchronous LLM extraction.** Unlike
> Honcho (whose deriver runs *asynchronously* after the message is stored),
> Mem0's `POST /memories` blocks while it calls the chat model to extract facts
> before returning. On slow local inference this can exceed the adapter timeout
> and the connector then falls back to local memory. Give Mem0 a **fast**
> extraction LLM (a hosted model such as GPT‑5.5 via `buddy server`, or a small
> quick local model), not a large dense local model. Tune the client wait with
> `CODEBUDDY_MEMORY_HTTP_TIMEOUT_MS` if your extraction LLM is slow but reliable.

### Honcho (FastAPI + Postgres/pgvector)

Honcho builds the API image from source and needs pgvector Postgres (+ Redis);
it is not a single prebuilt image. Use the repo's example compose:

```bash
# On the Linux host:
git clone https://github.com/plastic-labs/honcho && cd honcho
cp docker-compose.yml.example docker-compose.yml
cp .env.template .env        # set an LLM provider key here for dialectic/deriver;
                             # message-store + search round-trips work without it
docker compose up -d --build # builds the API; serves the v3 API on :8000, /docs for OpenAPI
```

```bash
export CODEBUDDY_MEMORY_PROVIDER=honcho
export HONCHO_BASE_URL=http://MYHOST:8000
# HONCHO_WORKSPACE / HONCHO_PEER default to "codebuddy"
```

### OpenViking (AGPL context database)

```bash
# On the Linux host: run the OpenViking server (default port 1933).
export CODEBUDDY_MEMORY_PROVIDER=openviking
export OPENVIKING_ENDPOINT=http://MYHOST:1933
# OPENVIKING_API_KEY only for authenticated servers
```

### ByteRover (`brv` CLI — account-gated)

```bash
npm install -g byterover-cli   # provides `brv`; detected automatically
brv login                      # REQUIRED: brv's built-in provider needs a
                               # ByteRover account (or: brv login --api-key <key>
                               # from app.byterover.dev/settings/keys for headless)
brv providers connect byterover
export CODEBUDDY_MEMORY_PROVIDER=byterover
```

> **Not free/local-first.** Despite the "local-first" framing, `brv providers
> connect byterover` refuses without a signed-in ByteRover account, so the live
> round-trip (`buddy hermes memory probe byterover`) cannot pass on this box
> without credentials. The adapter (brv detection + curate/query subprocess) is
> proven by shape tests; live validation is account-gated like the cloud
> providers.

## Validate it actually works (the real test)

Shape tests prove the adapter builds the right request; the **live probe** proves
the real backend round-trips. Run it after configuring a provider — ideally from
the box itself or over the private network:

```bash
buddy hermes memory probe                 # probes the active provider
buddy hermes memory probe honcho --json   # probe a specific provider
```

A `PASS` with `Mode: remote/configured backend` means a marker was written to and
read back from the real service. If you see `Mode: local fallback`, the provider
is not configured (the adapter degraded to local memory rather than failing). A
write-without-read on an extraction-based backend (Mem0/OpenViking run an LLM)
can be eventual-consistency — re-run the probe, or check the server logs.

## Validated live on a self-hosted box (2026-06-04, ministar)

Honcho is **live-validated** end-to-end against a real self-hosted instance with
a 100% local LLM stack (Ollama) — `buddy hermes memory probe honcho` → `PASS`,
`remote=true`, `fellBackToLocal=false`; the Honcho server logs confirm real v3
endpoints (`POST /v3/workspaces|/peers|/sessions|/messages|/search`). The exact
recipe and the gotchas that bit us:

1. **Ollama for the LLM stack** (sovereign, $0): chat = `qwen3.6:27b`
   (tool-calling capable, required by Honcho), embeddings = `nomic-embed-text`
   (**768-dim**). Ensure `OLLAMA_HOST=0.0.0.0` so containers can reach it.
2. **Honcho `.env`** (point every text/embedding module at Ollama via
   `host.docker.internal`):
   ```
   LLM_OPENAI_API_KEY=ollama                 # placeholder; Ollama ignores it but Honcho requires it set
   EMBED_MESSAGES=true
   EMBEDDING_VECTOR_DIMENSIONS=768           # MUST match nomic-embed-text
   EMBEDDING_MODEL_CONFIG__TRANSPORT=openai
   EMBEDDING_MODEL_CONFIG__MODEL=nomic-embed-text
   EMBEDDING_MODEL_CONFIG__OVERRIDES__BASE_URL=http://host.docker.internal:11434/v1
   DERIVER_ENABLED=true
   DERIVER_MODEL_CONFIG__TRANSPORT=openai
   DERIVER_MODEL_CONFIG__MODEL=qwen3.6:27b
   DERIVER_MODEL_CONFIG__OVERRIDES__BASE_URL=http://host.docker.internal:11434/v1
   SUMMARY_MODEL_CONFIG__TRANSPORT=openai
   SUMMARY_MODEL_CONFIG__MODEL=qwen3.6:27b
   SUMMARY_MODEL_CONFIG__OVERRIDES__BASE_URL=http://host.docker.internal:11434/v1
   ```
   plus a `docker-compose.override.yml` giving `api` and `deriver`
   `extra_hosts: ["host.docker.internal:host-gateway"]`.
3. **Gotcha — ufw blocks container→host.** If `ufw` is active with
   `deny (routed)` and only `lo`/`tailscale0` allowed in, containers cannot reach
   the host's Ollama. Fix (local-only, reversible):
   `sudo ufw allow from 172.16.0.0/12 to any port 11434 proto tcp`.
4. **Gotcha — embedding dimension.** The DB migration creates the vector column
   at 1536; nomic is 768. After first boot, reconcile with the prebuilt venv (not
   `uv run`, which re-resolves and fails):
   `docker compose run --rm -T --entrypoint "" api /app/.venv/bin/python scripts/configure_embeddings.py`
   then restart `api`/`deriver`.
5. **Gotcha — redis host-port conflict.** If another service already binds
   `6379`, drop Honcho's redis host port publish (api reaches redis on the
   internal network anyway).

Then on the same host: `export CODEBUDDY_MEMORY_PROVIDER=honcho HONCHO_BASE_URL=http://localhost:8000` and `buddy hermes memory probe honcho`.

### Mem0 on the same box — LIVE-VALIDATED (2026-06-04)

Mem0 (OSS REST server, built from `mem0/server`, AUTH_DISABLED, Postgres+pgvector,
Ollama for LLM+embeddings) is now **live-validated end-to-end**:
`buddy hermes memory probe mem0` → `PASS`, `remote=true`, `wrote=true`,
`retrieved=true`, `fellBackToLocal=false`. Getting there required fixing three
distinct things — and the third was a real Code Buddy bug only the live probe
could catch:

1. **Fast, non-thinking extraction LLM.** `POST /memories` runs the chat model
   **synchronously** to extract facts. A *thinking* MoE (`qwen3.6:35b-a3b`)
   generates thousands of reasoning tokens at ~17 tok/s and blew past the
   adapter timeout → fell back to local. Switched mem0's `MEM0_DEFAULT_LLM_MODEL`
   to **`qwen2.5:7b-instruct`** (no thinking, clean JSON, ~2–3 s/extraction).
   Contrast: Honcho's async deriver tolerates slow local inference; Mem0's
   synchronous path does not. (Bump `CODEBUDDY_MEMORY_HTTP_TIMEOUT_MS` if your
   extraction LLM is slow-but-reliable.)
2. **Embedding dimension mismatch.** pgvector's column was created at **1536**
   (OpenAI default) but `nomic-embed-text` emits **768** → every insert failed
   with `expected 1536 dimensions, not 768` and stored nothing. Fix: tell mem0
   the dims (server now reads `MEM0_DEFAULT_EMBEDDER_DIMS`, wired into both the
   pgvector `embedding_model_dims` and the embedder `embedding_dims`); set it to
   `768`, drop the stale `memories` table so it recreates at 768. (Same class of
   gotcha as Honcho's `EMBEDDING_VECTOR_DIMENSIONS`.) **Reproducibility note:**
   `MEM0_DEFAULT_EMBEDDER_DIMS` is a local patch to `~/mem0/server/main.py`
   (wires the env var into both pgvector `embedding_model_dims` and the embedder
   `embedding_dims`); upstream mem0/server has no such knob. If `~/mem0` is
   rebuilt from upstream, re-apply that ~6-line patch or the PASS regresses.
3. **Adapter partition bug (Code Buddy).** With write+store finally working, the
   probe stayed `pending`: `remember` wrote under user_id `<id>:project` but
   `search`/`recall` queried bare `<id>`, so recall **silently missed every
   project-scoped write**. Shape tests passed regardless — only the live
   round-trip exposed it. Fixed with a shared `scopedUserId(scope)` used by both
   write and read, plus a regression test
   (`tests/memory/network-memory-adapters-real.test.ts`).

The 3 still-unprobeable adapters here (Supermemory, RetainDB, OpenViking) were
code-audited for the same write/read partition asymmetry and are **symmetric**
(containerTags / project+user_id / tenant headers used identically on both
sides), so they do not share the Mem0 bug class.

mem0 recipe on this box:

```bash
# /home/patrice/mem0/server/.env
MEM0_DEFAULT_LLM_MODEL=qwen2.5:7b-instruct     # fast, non-thinking
MEM0_DEFAULT_EMBEDDER_MODEL=nomic-embed-text
MEM0_DEFAULT_EMBEDDER_DIMS=768                 # MUST match nomic
OPENAI_BASE_URL=http://host.docker.internal:11434/v1
OPENAI_API_KEY=ollama
# then: docker compose up -d --force-recreate mem0
export CODEBUDDY_MEMORY_PROVIDER=mem0 MEM0_BASE_URL=http://localhost:18888
buddy hermes memory probe mem0           # -> PASS
```

## Cloud providers (need an account)

`Supermemory` and `RetainDB` are cloud-only. The adapters are implemented against
their published REST APIs but are **not live-validated** here (no account). Set
`SUPERMEMORY_API_KEY` / `RETAINDB_API_KEY` and run `buddy hermes memory probe` to
validate against your account.
