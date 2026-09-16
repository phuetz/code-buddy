//! Reproducible CKG hybrid-recall bench (Phase 4).
//!
//! Synthetic 50k-node ledger (no real data). Writes under `buddy-memory/.gk6-work/`
//! inside the clone — never `$HOME/.codebuddy` or shared `/tmp`.
//!
//! ```text
//! cargo run --release --bin ckg-bench -- --nodes 50000 --queries 100 --mode exhaustive
//! cargo run --release --bin ckg-bench -- --nodes 50000 --queries 100 --mode indexed
//! ```

use buddy_memory::store::Store;
use buddy_memory::synth::{generate, percentile, rss_kb, write_ledger};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

fn parse_flag(args: &[String], name: &str, default: &str) -> String {
    args.windows(2)
        .find(|w| w[0] == name)
        .map(|w| w[1].clone())
        .unwrap_or_else(|| default.to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let n_nodes: usize = parse_flag(&args, "--nodes", "50000")
        .parse()
        .unwrap_or(50_000);
    let n_queries: usize = parse_flag(&args, "--queries", "100").parse().unwrap_or(100);
    let mode = parse_flag(&args, "--mode", "exhaustive");
    let seed: u64 = parse_flag(&args, "--seed", "42").parse().unwrap_or(42);
    let limit: usize = parse_flag(&args, "--limit", "10").parse().unwrap_or(10);
    let crate_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let default_work = crate_root.join(".gk6-work").join(format!("bench-{mode}"));
    let work = PathBuf::from(parse_flag(
        &args,
        "--work",
        default_work.to_str().unwrap_or(".gk6-work/bench"),
    ));
    let default_out = work.join("result.json");
    let out = PathBuf::from(parse_flag(
        &args,
        "--out",
        default_out.to_str().unwrap_or("result.json"),
    ));

    std::env::set_var("BUDDY_MEMORY_SYNTH_EMBED", "1");
    let _ = fs::create_dir_all(&work);
    let ledger = work.join("ckg-ledger.jsonl");

    let rss_start = rss_kb();
    let t_gen = Instant::now();
    let corpus = generate(n_nodes, n_queries, seed);
    let gen_ms = t_gen.elapsed().as_secs_f64() * 1000.0;

    let t_write = Instant::now();
    write_ledger(&ledger, &corpus, "bench/gk6");
    let write_ms = t_write.elapsed().as_secs_f64() * 1000.0;

    let t_load = Instant::now();
    let mut store = Store::new(ledger.clone(), "bench/gk6".into());
    store.set_hybrid_exhaustive(mode != "indexed");
    let stats = store.stats();
    let load_ms = t_load.elapsed().as_secs_f64() * 1000.0;
    let rss_loaded = rss_kb();

    // Warm the embedding cache on one query so timed trials measure retrieval, not first fill.
    let _ = store.recall_hybrid(&corpus.queries[0], limit, None, 0.7, 0.7);
    let rss_warm = rss_kb();

    let mut lat_ms: Vec<f64> = Vec::with_capacity(n_queries);
    for q in &corpus.queries {
        let t = Instant::now();
        let hits = store.recall_hybrid(q, limit, None, 0.7, 0.7);
        lat_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        let _ = hits;
    }
    let rss_after = rss_kb();
    let mut sorted = lat_ms.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p50 = percentile(&sorted, 50.0);
    let p95 = percentile(&sorted, 95.0);
    let mean = lat_ms.iter().sum::<f64>() / lat_ms.len().max(1) as f64;

    let kb = |x: Option<u64>| x.map(|v| v as f64 / 1024.0).unwrap_or(0.0);
    let result = json!({
        "mode": mode,
        "nodes": stats.entities,
        "queries": n_queries,
        "limit": limit,
        "seed": seed,
        "exhaustive": store.hybrid_exhaustive(),
        "gen_ms": gen_ms,
        "write_ms": write_ms,
        "load_ms": load_ms,
        "recall_p50_ms": p50,
        "recall_p95_ms": p95,
        "recall_mean_ms": mean,
        "rss_start_mib": kb(rss_start),
        "rss_loaded_mib": kb(rss_loaded),
        "rss_warm_mib": kb(rss_warm),
        "rss_after_mib": kb(rss_after),
        "ledger": ledger.to_string_lossy(),
    });
    if let Some(dir) = out.parent() {
        let _ = fs::create_dir_all(dir);
    }
    fs::write(&out, serde_json::to_string_pretty(&result).unwrap()).expect("write result");

    eprintln!(
        "GK6 CKG bench  mode={mode}  nodes={}  queries={n_queries}",
        stats.entities
    );
    eprintln!("  generate {gen_ms:.1} ms   ledger-write {write_ms:.1} ms   load {load_ms:.1} ms");
    eprintln!("  recallHybrid p50={p50:.3} ms  p95={p95:.3} ms  mean={mean:.3} ms");
    eprintln!(
        "  RSS start={:.1} MiB  loaded={:.1} MiB  warm={:.1} MiB  after={:.1} MiB",
        kb(rss_start),
        kb(rss_loaded),
        kb(rss_warm),
        kb(rss_after)
    );
    eprintln!("  result {}", out.display());
    println!(
        "{}",
        serde_json::to_string(&result).unwrap_or_else(|_| Value::Null.to_string())
    );
}
