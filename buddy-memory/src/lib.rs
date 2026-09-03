//! Collective Knowledge Graph engine library (ledger, snapshot, hybrid recall).
//! The JSON-RPC sidecar lives in `src/main.rs`; the Phase-4 bench is `src/bin/ckg-bench.rs`.

#[cfg(feature = "embeddings")]
pub mod embed;
pub mod model;
pub mod store;
pub mod synth;
