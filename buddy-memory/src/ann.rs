//! Incremental HNSW over L2-normalised embeddings (`hnsw_rs`, MIT/Apache-2.0).
//!
//! The graph is rebuilt from vectors persisted in the snapshot (contentHash → vec).
//! Live ingest inserts a new point; superseded ids are filtered at search time
//! (HNSW has no cheap delete).

use hnsw_rs::prelude::*;
use std::collections::{HashMap, HashSet};

const M: usize = 16;
const MAX_LAYER: usize = 16;
const EF_CONSTRUCTION: usize = 80;
const EF_SEARCH: usize = 64;

pub struct AnnIndex {
    hnsw: Hnsw<'static, f32, DistCosine>,
    id_of: Vec<String>,
    pos_of: HashMap<String, usize>,
    deleted: HashSet<usize>,
    vectors: Vec<Vec<f32>>,
    dim: usize,
    capacity: usize,
}

impl AnnIndex {
    pub fn with_capacity(dim: usize, capacity: usize) -> Self {
        let capacity = capacity.max(32);
        Self {
            hnsw: Self::new_hnsw(capacity),
            id_of: Vec::with_capacity(capacity),
            pos_of: HashMap::with_capacity(capacity),
            deleted: HashSet::new(),
            vectors: Vec::with_capacity(capacity),
            dim,
            capacity,
        }
    }

    fn new_hnsw(capacity: usize) -> Hnsw<'static, f32, DistCosine> {
        Hnsw::<f32, DistCosine>::new(M, capacity, MAX_LAYER, EF_CONSTRUCTION, DistCosine {})
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    pub fn live_points(&self) -> usize {
        self.pos_of.len()
    }

    pub fn insert(&mut self, id: &str, vec: &[f32]) {
        // 50_000th live insert is when hnsw_rs prints; keep JSON-RPC stdout clean.
        if (self.id_of.len() + 1) % 50_000 == 0 {
            silence_stdout(|| self.insert_inner(id, vec));
        } else {
            self.insert_inner(id, vec);
        }
    }

    pub fn search(&self, query: &[f32], k: usize) -> Vec<(String, f32)> {
        if query.len() != self.dim || self.id_of.is_empty() || k == 0 {
            return Vec::new();
        }
        let want = k + self.deleted.len();
        let knbn = want.max(k).min(self.id_of.len());
        let ef = EF_SEARCH.max(knbn);
        let neigh = self.hnsw.search(query, knbn, ef);
        let mut out = Vec::with_capacity(k);
        for n in neigh {
            if self.deleted.contains(&n.d_id) {
                continue;
            }
            if let Some(id) = self.id_of.get(n.d_id) {
                out.push((id.clone(), n.distance));
                if out.len() >= k {
                    break;
                }
            }
        }
        out
    }

    fn rebuild_with_capacity(&mut self, capacity: usize) {
        let mut live: Vec<(String, Vec<f32>)> = Vec::with_capacity(self.pos_of.len());
        for (id, &pos) in &self.pos_of {
            if self.deleted.contains(&pos) {
                continue;
            }
            if let Some(v) = self.vectors.get(pos) {
                live.push((id.clone(), v.clone()));
            }
        }
        *self = Self::from_pairs(self.dim, capacity, live);
    }

    pub fn from_pairs(dim: usize, capacity: usize, pairs: Vec<(String, Vec<f32>)>) -> Self {
        // hnsw_rs println!s every 50_000 inserts (" setting number of points "). That would
        // inject a non-JSON line on the sidecar's stdout and break JSON-RPC. Silence stdout
        // for the bulk build; incremental insert silences only on the 50k boundary.
        silence_stdout(|| {
            let mut ann =
                Self::with_capacity(dim, capacity.max(pairs.len().saturating_mul(2).max(32)));
            for (id, vec) in pairs {
                ann.insert_inner(&id, &vec);
            }
            ann
        })
    }

    fn insert_inner(&mut self, id: &str, vec: &[f32]) {
        if vec.len() != self.dim || vec.is_empty() {
            return;
        }
        if let Some(&old) = self.pos_of.get(id) {
            self.deleted.insert(old);
        }
        if self.id_of.len() >= self.capacity {
            self.rebuild_with_capacity(self.capacity.saturating_mul(2).max(self.id_of.len() + 32));
        }
        let pos = self.id_of.len();
        self.id_of.push(id.to_string());
        self.vectors.push(vec.to_vec());
        self.pos_of.insert(id.to_string(), pos);
        self.hnsw.insert((vec, pos));
    }
}

/// hnsw_rs prints progress on stdout. The sidecar protocol is one JSON object per line.
#[cfg(unix)]
fn silence_stdout<T>(f: impl FnOnce() -> T) -> T {
    extern "C" {
        fn dup(fd: i32) -> i32;
        fn dup2(oldfd: i32, newfd: i32) -> i32;
        fn close(fd: i32) -> i32;
    }
    use std::fs::OpenOptions;
    use std::os::fd::AsRawFd;
    let saved = unsafe { dup(1) };
    if let Ok(null) = OpenOptions::new().write(true).open("/dev/null") {
        unsafe {
            dup2(null.as_raw_fd(), 1);
        }
        let out = f();
        if saved >= 0 {
            unsafe {
                dup2(saved, 1);
                close(saved);
            }
        }
        out
    } else {
        if saved >= 0 {
            unsafe {
                close(saved);
            }
        }
        f()
    }
}

#[cfg(not(unix))]
fn silence_stdout<T>(f: impl FnOnce() -> T) -> T {
    f()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth::embed;

    #[test]
    fn nearest_neighbour_is_self() {
        let mut ann = AnnIndex::with_capacity(crate::synth::SYNTH_DIM, 32);
        let a = embed("c1t0 c1t1 alpha");
        let b = embed("c9t0 c9t1 omega");
        ann.insert("a", &a);
        ann.insert("b", &b);
        let hits = ann.search(&a, 1);
        assert_eq!(hits[0].0, "a");
    }
}
