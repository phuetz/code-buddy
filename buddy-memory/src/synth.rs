//! Deterministic synthetic CKG corpus + bag-of-tokens embeddings.
//!
//! Used by the Phase-4 bench and parity tests. No real user data, no ONNX, no network.
//! Vectors are L2-normalised so cosine == dot product.

use std::collections::BTreeSet;

/// Dimensionality of the synthetic embedder (small → cheap 50k×100 benches).
pub const SYNTH_DIM: usize = 32;

/// Seeded xorshift64* — no `rand` crate, bit-stable across platforms.
pub struct XorShift(u64);

impl XorShift {
    pub fn new(seed: u64) -> Self {
        Self(if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed })
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    pub fn gen_range(&mut self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        (self.next_u64() as usize) % n
    }
}

fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

/// Tokenise like the store (ASCII alnum runs, length ≥ 2, lowercased).
pub fn tokens(s: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut cur = String::new();
    for ch in s.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            cur.push(ch);
        } else {
            if cur.len() >= 2 {
                out.insert(std::mem::take(&mut cur));
            } else {
                cur.clear();
            }
        }
    }
    if cur.len() >= 2 {
        out.insert(cur);
    }
    out
}

/// Deterministic bag-of-tokens embedding. Shared topic tokens ⇒ nearby vectors.
pub fn embed(text: &str) -> Vec<f32> {
    let mut v = vec![0.0f32; SYNTH_DIM];
    for tok in tokens(text) {
        let h = fnv1a(&tok);
        let bucket = (h as usize) % SYNTH_DIM;
        let sign = if (h >> 16) & 1 == 0 { 1.0 } else { -1.0 };
        v[bucket] += sign;
        let neighbor = (bucket + 1 + ((h >> 8) as usize % 3)) % SYNTH_DIM;
        v[neighbor] += sign * 0.35;
    }
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
    v
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>().max(0.0)
}

#[derive(Clone, Debug)]
pub struct SynthNode {
    pub name: String,
    pub text: String,
    pub node_type: String,
}

#[derive(Clone, Debug)]
pub struct SynthCorpus {
    pub nodes: Vec<SynthNode>,
    pub queries: Vec<String>,
}

/// 100 topical clusters, deterministic token vocabulary, no real-world text.
pub fn generate(n_nodes: usize, n_queries: usize, seed: u64) -> SynthCorpus {
    let n_nodes = n_nodes.max(1);
    let n_clusters = 100usize.min(n_nodes).max(1);
    let mut rng = XorShift::new(seed);
    let types = ["fact", "lesson", "discovery"];
    let mut nodes = Vec::with_capacity(n_nodes);
    for i in 0..n_nodes {
        let cluster = i % n_clusters;
        let mut parts: Vec<String> = (0..4).map(|t| format!("c{cluster}t{t}")).collect();
        for _ in 0..6 {
            parts.push(format!("w{}", rng.gen_range(500)));
        }
        parts.push(format!("n{i}"));
        nodes.push(SynthNode {
            name: format!("node-{i}"),
            text: parts.join(" "),
            node_type: types[i % types.len()].to_string(),
        });
    }
    let mut queries = Vec::with_capacity(n_queries);
    for q in 0..n_queries {
        let cluster = q % n_clusters;
        // Member inside the cluster so keyword + hashed-token semantic both have a target.
        let member = cluster + n_clusters * rng.gen_range((n_nodes / n_clusters).max(1));
        let member = member.min(n_nodes - 1);
        let extra = nodes[member]
            .text
            .split_whitespace()
            .find(|t| t.starts_with('w'))
            .unwrap_or("w0");
        queries.push(format!("c{cluster}t0 c{cluster}t1 c{cluster}t2 {extra}"));
    }
    SynthCorpus { nodes, queries }
}

pub fn rss_kb() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb = rest.split_whitespace().next()?.parse::<u64>().ok()?;
            return Some(kb);
        }
    }
    None
}

pub fn percentile(sorted_ms: &[f64], p: f64) -> f64 {
    if sorted_ms.is_empty() {
        return 0.0;
    }
    let n = sorted_ms.len();
    let idx = ((p / 100.0) * (n as f64 - 1.0)).round() as usize;
    sorted_ms[idx.min(n - 1)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generator_is_deterministic() {
        let a = generate(200, 10, 42);
        let b = generate(200, 10, 42);
        assert_eq!(a.nodes[7].text, b.nodes[7].text);
        assert_eq!(a.queries, b.queries);
        assert_eq!(a.nodes.len(), 200);
        assert_eq!(a.queries.len(), 10);
    }

    #[test]
    fn embed_is_normalized_and_stable() {
        let v = embed("c3t0 c3t1 w12 n9");
        assert_eq!(v.len(), SYNTH_DIM);
        let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((n - 1.0).abs() < 1e-5);
        assert_eq!(v, embed("c3t0 c3t1 w12 n9"));
        let sim = cosine(&embed("c3t0 c3t1"), &embed("c3t0 c3t1 w1"));
        assert!(sim > 0.3);
    }
}
