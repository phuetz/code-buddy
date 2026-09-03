# buddy-memory

Rust engine for **Code Buddy**'s Collective Knowledge Graph (CKG) — a shared, queryable graph
memory for an agent collective. Lives **in-tree** as a Rust sidecar of Code Buddy (like
`buddy-sense/`); Code Buddy spawns it and the TS CKG is a thin client. Mirrors the architecture of
[Code Explorer](https://github.com/phuetz/code-explorer) (code intelligence); complements
[lm-resizer](https://github.com/phuetz/lm-resizer) (context compression).

## Why
Code Buddy's collective memory started as a TypeScript prototype (a JSONL ledger replayed in
O(N) on every read). `buddy-memory` re-homes the storage + retrieval in a Rust engine — same
architecture as Code Explorer (persistent graph, incremental index, hybrid search, a stdio
server) — so it scales to thousands/millions of discoveries (scientific research **and** code
insights) without changing Code Buddy's API.

## What it stores
A typed graph of memory nodes (`lesson`, `decision`, `fact`, `discovery`, `agent`, `task`, …)
and edges (`related_to`, `supersedes`, `supports`, `contradicts`, `learned_from`, …), with:
- **bi-temporal supersede** — a changed fact invalidates the old version (validTo) + a `supersedes` edge;
- **cross-agent corroboration** — a fact independent agents agree on gains confidence and rank;
- **append-only JSONL ledger** as the write-ahead format (atomic O_APPEND → cross-process safe);
- (Phase 2) hybrid retrieval — multilingual embeddings + keyword + MMR, no LLM at retrieval.

## Run
```
buddy-memory serve --ledger <path> [--agent <host/repo>]
```
A newline-delimited JSON-RPC server over stdio: `{"id":N,"method":"...","params":{...}}` →
`{"id":N,"result":...}`. Methods: `remember`, `ingest`, `ingestPublication`, `recall`,
`recallHybrid`, `getSuperseded`, `getStats`, `ping`. Code Buddy spawns it as a sidecar; the TS
CKG is a thin client and falls back to its in-process implementation when the binary is absent,
the snapshot is unreadable, or any RPC fails.

Phase 4 recall is sub-linear: inverted index (keyword) + HNSW (`hnsw_rs`) over embeddings,
both updated on ingest and persisted in the v2 snapshot (`<ledger>.snap`). Default in Code Buddy:
rust if this binary is built and the snapshot is loadable, else TypeScript. See
[`docs/ckg-engine.md`](../docs/ckg-engine.md).

Reproducible 50k-node bench (synthetic corpus, no real data, writes under `.gk6-work/`):

```
cargo run --release --bin ckg-bench -- --nodes 50000 --queries 100 --mode exhaustive
cargo run --release --bin ckg-bench -- --nodes 50000 --queries 100 --mode indexed
```

## Build / test
```
cargo build --release
cargo test
```

## Status
Phase 1 (MVP): model + ledger + remember/recall (keyword) + JSON-RPC server — done.
Phase 2: embeddings + hybrid recall (ONNX MiniLM, `embeddings` feature).
Phase 3: snapshot/index (end the O(N) replay) + full parity — done.
Phase 4: HNSW + inverted index (sub-linear recall) + measured default cutover — done.

## License
MIT — same as Code Buddy (all dependencies are permissive: ort, tokenizers, serde, chrono, sha2).
