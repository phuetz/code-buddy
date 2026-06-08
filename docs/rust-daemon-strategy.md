# Rust daemon strategy — what to offload, and what NOT to rewrite

**Date: 2026-06-08.** Code Buddy is TypeScript/Node. Node is excellent at **I/O-bound** work (the agentic loop is mostly waiting on LLMs, files, sockets) and poor at **CPU-bound** work. The rule: **push CPU-heavy primitives into a native Rust daemon; keep the I/O glue in TS.**

We already have two native daemons, both newline-delimited JSON-RPC over stdin/stdout:
- **`codebuddy-sidecar`** — Whisper STT + desktop automation (`src-sidecar/`).
- **`codebuddy-captured`** — screen-frame perceptual hashing / dedup (`src-captured/`, this work). Reachable from Node via `src/capture/captured-bridge.ts`.

The same daemon pattern is the home for everything below.

## What ELSE a Rust daemon should offload — most of it is ALREADY native

**Important correction:** the obvious "heavy compute" candidates are **already built natively in Code Buddy** — do NOT rebuild them in the daemon. Verified:

| Candidate | Status in Code Buddy | Don't rebuild |
|---|---|---|
| **Embeddings** | ✅ `src/embeddings/embedding-provider.ts` (@xenova/transformers `all-MiniLM-L6-v2` local; or openai/grok) | redundant |
| **Vector search / ANN** | ✅ `src/context/codebase-rag/hnsw-store.ts` (`HNSWVectorStore`) + `usearch` native dep | redundant |
| **Codebase indexing & search** | ✅ **`gitnexus-rs`** (`src/plugins/gitnexus`, `src/tools/gitnexus-tool.ts`) + `@vscode/ripgrep` + tree-sitter | redundant |
| **Tokenization / token counting** | ✅ `tiktoken` (`src/context/token-counter.ts`) | redundant |

So the Rust daemon's **genuine, non-redundant niche is media/screen work** the JS stack doesn't already cover natively:

| Offload | Why | Rust | Status |
|---|---|---|---|
| **Perceptual hashing / dedup** | screen-frame idle-dedup, robust vs sha1 | `image_hasher` | ✅ **done** (`codebuddy-captured phash/diff`) |
| **OCR** | the screen pipeline shells to tesseract per frame | `ocrs` (pure Rust) / `leptess` | candidate (screen-specific) |
| **Native screen capture** | watcher's high-freq frame grab (vs ffmpeg single-frame) | `xcap` | candidate |
| Fuzzy string match (str_replace cascade) | already TS; not a real bottleneck | `strsim` | skip |

Lesson: **check `package.json` + `src/` before proposing an "offload."** Code Buddy already ships native `usearch`/HNSW, embeddings, gitnexus, and tiktoken — the compute thesis is largely already satisfied; the daemon only adds what's genuinely missing (so far: screen-frame hashing).

## Would the SERVER benefit from being rewritten in Rust? — No.

`src/server/` (HTTP 3000 + Gateway WS 3001, `/api/chat/completions`, sessions, A2A, peer RPC, fleet) is **I/O-bound glue**: it proxies LLM calls and shuttles JSON/WS frames. The bottleneck is **provider latency + network**, not CPU — exactly where Node's event loop already shines. Rewriting it in Rust would:
- be a **huge effort** (re-implement every route, auth/JWT, WS, MCP, A2A, the OpenAI-compat surface),
- **sever the tight coupling** with the TS agent core (the agentic loop, 110+ tools, middlewares are all TS), and
- buy **little throughput** — the server spends its time awaiting, not computing.

**The only CPU-heavy things the server does** (token counting, embedding/vector ops in the RAG path, request validation at very high QPS, compression/TLS) are better served by the **shared daemon** than by a rewrite — the server calls the same `codebuddy-captured`/sidecar bridge the CLI does.

**Verdict:** keep the server (and the agent core) in TypeScript. Move the **compute** — not the glue — into the native daemon, and let both the CLI and the server call it. That is the architecture this work starts: TS orchestrates I/O; Rust does the heavy lifting.

## Next step (reuse, don't rebuild)

The screen **"what did I see?"** index should **reuse the existing stack** — `EmbeddingProvider` (embed OCR text) → `HNSWVectorStore` (`usearch`) — NOT a new daemon vector store. The daemon stays focused on what's genuinely missing: native screen OCR (`ocrs`) and capture (`xcap`), feeding text into the embedding/HNSW path Code Buddy already has.
