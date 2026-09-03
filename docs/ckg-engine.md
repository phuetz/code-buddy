# CKG engine — buddy-memory Phase 4

The Collective Knowledge Graph has two backends that share the same append-only JSONL ledger:

1. **TypeScript in-process** (`src/memory/collective-knowledge-graph.ts`) — always available.
2. **Rust sidecar** (`buddy-memory/`) — JSON-RPC over stdio, snapshot fast-load, hybrid recall.

## Default (Phase 4)

`CODEBUDDY_CKG_ENGINE` unset or `auto` selects rust **only when both** are true:

- the `buddy-memory` binary exists on disk (`CODEBUDDY_BUDDY_MEMORY_BIN`, else `buddy-memory/target/{release,debug}/buddy-memory`);
- the snapshot `<ledger>.snap` is **loadable**: missing is OK (the engine will create one); a corrupt file or unknown `version` keeps TypeScript.

Explicit values:

| Value | Effect |
|---|---|
| `rust` | Force the sidecar. Still falls back to TS if spawn/ping/RPC fails. |
| `ts` / `off` / `false` | Force in-process TS. |
| unset / `auto` | Rust if binary + snapshot loadable, else TS. |

Any engine error on `ingest` / `recallHybrid` logs a warning and continues on the TypeScript path. The ledger is the source of truth either way.

Vitest sets `CODEBUDDY_CKG_ENGINE=ts` when the variable is unset so the suite does not spawn the sidecar unless a test opts in (`rust` or `auto`).

## Sub-linear recall

Keyword `recall` uses an inverted index (token → entity ids), updated on ingest and persisted in snapshot v2.

Hybrid `recallHybrid` unions that index with an **HNSW** graph (`hnsw_rs`, MIT/Apache) over embeddings (ONNX when `embeddings` + model, or deterministic synthetic vectors when `BUDDY_MEMORY_SYNTH_EMBED=1` for benches/tests). The graph is rebuilt from the embedding cache in the snapshot; live `remember()` inserts a new point.

Exhaustive scoring remains available for measurement (`ckg-bench --mode exhaustive` or `Store::set_hybrid_exhaustive(true)`).

## Bench (synthetic 50k nodes, 100 queries, seed 42)

Work dir: `buddy-memory/.gk6-work/` (never `$HOME/.codebuddy`).

```
cd buddy-memory
cargo run --release --bin ckg-bench -- --nodes 50000 --queries 100 --mode exhaustive --seed 42
cargo run --release --bin ckg-bench -- --nodes 50000 --queries 100 --mode indexed --seed 42
```

Measured 2026-09-03 in this clone:

| Mode | p50 | p95 | RSS after |
|---|---:|---:|---:|
| exhaustive | 660.4 ms | 999.6 ms | 181.5 MiB |
| indexed | 10.4 ms | 24.5 ms | 309.3 MiB |

p50 speedup ≈ **64×**. Parity test: mean top-10 overlap ≥ 0.9 on 100 queries (`indexed_hybrid_top10_overlaps_exhaustive`).

## Build

```
cd buddy-memory && cargo build --release --features embeddings
```
