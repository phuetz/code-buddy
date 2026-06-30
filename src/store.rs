//! The CKG store: append-only JSONL ledger (write-ahead) + in-memory index, mirroring the
//! TypeScript `CollectiveKnowledgeGraph` behaviour so the Rust engine is a drop-in backend.
//! Incremental, offset-based ledger reads (a write by process A becomes visible to a read by
//! process B sharing the same ledger — the load-bearing cross-process invariant) — and no full
//! O(N) replay on every read.

use crate::model::*;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// One neighbour edge in a recall result (TS `{predicate,target,reason?}`).
#[derive(Debug, Serialize)]
pub struct RelOut {
    pub predicate: String,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Result shape == TS `CkgRecallResult` (camelCase for the wire).
#[derive(Debug, Serialize)]
pub struct RecallResult {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
    pub text: String,
    pub salience: f64,
    pub mentions: u64,
    pub confidence: f64,
    pub corroborations: usize,
    #[serde(rename = "agentId", skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub similarity: Option<f64>,
    #[serde(rename = "validTo", skip_serializing_if = "Option::is_none")]
    pub valid_to: Option<String>,
    pub relations: Vec<RelOut>,
}

#[derive(Debug, Serialize)]
pub struct Stats {
    pub entities: usize,
    pub superseded: usize,
    pub relations: usize,
    #[serde(rename = "ledgerPath")]
    pub ledger_path: String,
}

/// Fast-load snapshot of the materialized graph at a given ledger offset. Avoids replaying the
/// whole JSONL on cold start: load the snapshot, then replay only the ledger tail beyond `offset`.
/// The ledger stays the source of truth; the snapshot is a best-effort cache.
#[derive(Serialize, Deserialize)]
struct Snapshot {
    version: u8,
    offset: u64,
    current: HashMap<String, MemEntity>,
    superseded: HashMap<String, MemEntity>,
    relations: HashMap<String, MemRelation>,
}

/// Write a fresh snapshot after this many appended events.
const SNAPSHOT_EVERY: u64 = 200;

pub struct Store {
    ledger_path: PathBuf,
    snapshot_path: PathBuf,
    current: HashMap<String, MemEntity>,
    superseded: HashMap<String, MemEntity>,
    relations: HashMap<String, MemRelation>,
    offset: u64,
    events_since_snapshot: u64,
    default_agent: String,
    #[cfg(feature = "embeddings")]
    embedder: Option<crate::embed::Embedder>,
    #[cfg(feature = "embeddings")]
    embed_tried: bool,
    #[cfg(feature = "embeddings")]
    emb_cache: HashMap<String, Vec<f32>>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn days_since(iso: &str) -> f64 {
    match DateTime::parse_from_rfc3339(iso) {
        Ok(t) => {
            let secs = (Utc::now() - t.with_timezone(&Utc)).num_seconds() as f64;
            (secs / 86_400.0).max(0.0)
        }
        Err(_) => 0.0,
    }
}

fn clamp01(n: f64) -> f64 {
    if n.is_finite() {
        n.clamp(0.0, 1.0)
    } else {
        0.8
    }
}

fn tokenize(s: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut cur = String::new();
    for ch in s.to_lowercase().chars() {
        let c = fold_for_token(ch);
        if c.is_ascii_alphanumeric() {
            cur.push(c);
        } else {
            if cur.len() >= 2 {
                out.insert(cur.clone());
            }
            cur.clear();
        }
    }
    if cur.len() >= 2 {
        out.insert(cur);
    }
    out
}

fn fold_for_token(ch: char) -> char {
    match ch {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        _ => ch,
    }
}

/// fraction of query tokens present in `text` (recall-oriented). Mirrors TS `keywordOverlap`.
fn keyword_overlap(q: &BTreeSet<String>, text: &str) -> f64 {
    if q.is_empty() {
        return 0.0;
    }
    let cand = tokenize(text);
    let hits = q.iter().filter(|t| cand.contains(*t)).count();
    hits as f64 / q.len() as f64
}

impl Store {
    pub fn new(ledger_path: PathBuf, default_agent: String) -> Self {
        let snapshot_path = snapshot_path_for(&ledger_path);
        let mut s = Store {
            ledger_path,
            snapshot_path,
            current: HashMap::new(),
            superseded: HashMap::new(),
            relations: HashMap::new(),
            offset: 0,
            events_since_snapshot: 0,
            default_agent,
            #[cfg(feature = "embeddings")]
            embedder: None,
            #[cfg(feature = "embeddings")]
            embed_tried: false,
            #[cfg(feature = "embeddings")]
            emb_cache: HashMap::new(),
        };
        s.load_snapshot(); // fast cold start (sets offset to the snapshot's coverage)
        s.load_incremental(); // replay only the ledger tail beyond the snapshot
        s
    }

    /// Read only the bytes appended since the last load (offset-based), apply complete lines.
    /// Leaves a torn trailing line for the next read. This is the cross-process visibility path.
    pub fn load_incremental(&mut self) {
        let len = match fs::metadata(&self.ledger_path) {
            Ok(m) => m.len(),
            Err(_) => return, // no ledger yet
        };
        if len <= self.offset {
            return;
        }
        let bytes = match read_range(&self.ledger_path, self.offset, len) {
            Some(b) => b,
            None => return,
        };
        // Process only up to the last newline; keep the remainder for next time.
        let last_nl = match bytes.iter().rposition(|&b| b == b'\n') {
            Some(p) => p,
            None => return, // no complete line yet
        };
        let complete = &bytes[..=last_nl];
        for line in complete.split(|&b| b == b'\n') {
            if line.is_empty() {
                continue;
            }
            if let Ok(ev) = serde_json::from_slice::<LedgerEvent>(line) {
                self.apply_event(&ev);
            }
        }
        self.offset += (last_nl as u64) + 1;
    }

    fn append(&mut self, ev: &LedgerEvent) {
        if let Some(dir) = self.ledger_path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&self.ledger_path) {
            let line = serde_json::to_string(ev).unwrap_or_default();
            let _ = writeln!(f, "{}", line);
        }
        // Apply via the ledger tail (NOT apply_event directly): load_incremental reads everything
        // from `offset` — our just-written line PLUS any events other processes appended since our
        // last read — applying each exactly once and advancing the offset. This is what keeps
        // cross-instance corroboration correct and is race-safe (no manual offset arithmetic).
        self.load_incremental();
        self.events_since_snapshot += 1;
        // Adaptive cadence: a snapshot clones+serializes the whole graph (O(N)), so snapshotting
        // every 200 events would be O(N²) under bulk ingest. Scale the interval with graph size:
        // snapshot every max(200, N/4) events → O(N) amortized. The trade-off is a longer ledger
        // tail to replay after a crash, which the fast cold-start load absorbs.
        let threshold = SNAPSHOT_EVERY.max(self.current.len() as u64 / 4);
        if self.events_since_snapshot >= threshold {
            self.save_snapshot();
        }
    }

    /// Persist a fast-load snapshot of the current materialized graph (atomic temp+rename).
    pub fn save_snapshot(&mut self) {
        let snap = Snapshot {
            version: 1,
            offset: self.offset,
            current: self.current.clone(),
            superseded: self.superseded.clone(),
            relations: self.relations.clone(),
        };
        if let Ok(json) = serde_json::to_string(&snap) {
            let tmp = self.snapshot_path.with_extension("snap.tmp");
            if fs::write(&tmp, json).is_ok() {
                let _ = fs::rename(&tmp, &self.snapshot_path);
            }
        }
        self.events_since_snapshot = 0;
    }

    /// Restore from the snapshot if present and consistent with the ledger. Best-effort: any
    /// problem (missing/corrupt/ahead-of-ledger) leaves the store empty for a full tail replay.
    fn load_snapshot(&mut self) {
        let data = match fs::read_to_string(&self.snapshot_path) {
            Ok(d) => d,
            Err(_) => return,
        };
        let snap: Snapshot = match serde_json::from_str::<Snapshot>(&data) {
            Ok(s) if s.version == 1 => s,
            _ => return,
        };
        let ledger_len = fs::metadata(&self.ledger_path).map(|m| m.len()).unwrap_or(0);
        if snap.offset > ledger_len {
            return; // snapshot ahead of the ledger (truncated/rebuilt) → ignore, replay fully
        }
        self.current = snap.current;
        self.superseded = snap.superseded;
        self.relations = snap.relations;
        self.offset = snap.offset;
    }

    fn apply_event(&mut self, ev: &LedgerEvent) {
        match ev.kind.as_str() {
            "entity" => self.apply_entity(ev),
            "relation" => self.apply_relation(ev),
            _ => {}
        }
    }

    fn apply_entity(&mut self, ev: &LedgerEvent) {
        let (id, node_type, name) = match (&ev.id, &ev.node_type, &ev.name) {
            (Some(i), Some(t), Some(n)) => (i.clone(), t.clone(), n.clone()),
            _ => return,
        };
        if let Some(cur) = self.current.get(&id) {
            if cur.content_hash == ev.content_hash {
                let cur = self.current.get_mut(&id).unwrap();
                cur.mentions += 1;
                if !ev.agent_id.is_empty() {
                    cur.contributors.insert(ev.agent_id.clone());
                }
                cur.confidence = corroborated_confidence(cur.base_confidence, cur.contributors.len());
                cur.updated_at = ev.recorded_at.clone();
                return;
            }
            // Different text for the same id → bi-temporal supersede.
            let mut old = self.current.remove(&id).unwrap();
            let old_hash = old.content_hash.clone();
            old.valid_to = Some(ev.recorded_at.clone());
            self.superseded.insert(format!("{}@{}", id, old_hash), old);
            let fresh = self.make_entity(ev, &id, &node_type, &name);
            self.current.insert(id.clone(), fresh);
            let target = format!("{}@{}", id, old_hash);
            let rel_id = content_hash(
                "relation",
                &format!("{}@{}|supersedes|{}", id, ev.content_hash, target),
            );
            self.relations.entry(rel_id.clone()).or_insert(MemRelation {
                id: rel_id,
                source_id: id,
                target_id: target,
                rel_type: "supersedes".to_string(),
                reason: Some(format!("fact changed (was {})", &old_hash[..old_hash.len().min(8)])),
                mentions: 1,
            });
            return;
        }
        let e = self.make_entity(ev, &id, &node_type, &name);
        self.current.insert(id, e);
    }

    fn make_entity(&self, ev: &LedgerEvent, id: &str, node_type: &str, name: &str) -> MemEntity {
        let base = ev.confidence.unwrap_or(0.8);
        let mut contributors = BTreeSet::new();
        if !ev.agent_id.is_empty() {
            contributors.insert(ev.agent_id.clone());
        }
        MemEntity {
            id: id.to_string(),
            node_type: node_type.to_string(),
            name: name.to_string(),
            text: ev.text.clone().unwrap_or_else(|| name.to_string()),
            content_hash: ev.content_hash.clone(),
            base_confidence: base,
            confidence: base,
            mentions: 1,
            contributors,
            agent_id: if ev.agent_id.is_empty() { None } else { Some(ev.agent_id.clone()) },
            source: ev.source.clone(),
            valid_to: None,
            created_at: ev.recorded_at.clone(),
            updated_at: ev.recorded_at.clone(),
        }
    }

    fn apply_relation(&mut self, ev: &LedgerEvent) {
        let (source_id, target_id, rel_type) = match (&ev.source_id, &ev.target_id, &ev.rel_type) {
            (Some(s), Some(t), Some(r)) => (s.clone(), t.clone(), r.clone()),
            _ => return,
        };
        let rel_id = ev.content_hash.clone();
        if let Some(r) = self.relations.get_mut(&rel_id) {
            r.mentions += 1;
            return;
        }
        self.relations.insert(
            rel_id.clone(),
            MemRelation { id: rel_id, source_id, target_id, rel_type, reason: ev.reason.clone(), mentions: 1 },
        );
    }

    fn make_event(&self, kind: &str, content_hash: String, agent_id: String, source: Option<String>) -> LedgerEvent {
        LedgerEvent {
            v: 1,
            kind: kind.to_string(),
            recorded_at: now_iso(),
            agent_id,
            content_hash,
            source,
            id: None,
            node_type: None,
            name: None,
            text: None,
            confidence: None,
            source_id: None,
            target_id: None,
            rel_type: None,
            reason: None,
        }
    }

    /// Store a node (+ optional relations). `text` is assumed already secret-redacted by the TS client.
    pub fn remember(&mut self, input: &RememberInput) -> Option<RecallResult> {
        let text = input.text.trim();
        if text.is_empty() {
            return None;
        }
        let node_type = input.node_type.clone().unwrap_or_else(|| "fact".to_string());
        let name = match &input.name {
            Some(n) if !n.trim().is_empty() => n.trim().to_string(),
            _ => normalize_name(text),
        };
        let id = entity_id(&node_type, &name);
        let agent = input.agent_id.clone().unwrap_or_else(|| self.default_agent.clone());
        let ch = content_hash(&node_type, text);
        let conf = clamp01(input.confidence.unwrap_or(0.8));

        let mut ev = self.make_event("entity", ch, agent.clone(), input.source.clone());
        ev.id = Some(id.clone());
        ev.node_type = Some(node_type);
        ev.name = Some(name);
        ev.text = Some(text.to_string());
        ev.confidence = Some(conf);
        self.append(&ev);

        if let Some(rels) = &input.relations {
            for rel in rels {
                let target_type = rel.target_type.clone().unwrap_or_else(|| "concept".to_string());
                let target_id = entity_id(&target_type, &rel.target_name);
                let rel_ch = content_hash("relation", &format!("{}|{}|{}", id, rel.predicate, target_id));
                let mut rev = self.make_event("relation", rel_ch, agent.clone(), input.source.clone());
                rev.source_id = Some(id.clone());
                rev.target_id = Some(target_id.clone());
                rev.rel_type = Some(rel.predicate.clone());
                rev.reason = rel.reason.clone();
                self.append(&rev);
                if !self.current.contains_key(&target_id) {
                    let tch = content_hash(&target_type, &rel.target_name);
                    let mut tev = self.make_event("entity", tch, agent.clone(), None);
                    tev.id = Some(target_id.clone());
                    tev.node_type = Some(target_type);
                    tev.name = Some(rel.target_name.clone());
                    tev.text = Some(rel.target_name.clone());
                    tev.confidence = Some(0.5);
                    self.append(&tev);
                }
            }
        }
        self.current.get(&id).map(|e| self.to_result(e, None, None))
    }

    pub fn recall(&mut self, query: &str, limit: usize, types: Option<&[String]>) -> Vec<RecallResult> {
        self.load_incremental();
        let q = tokenize(query);
        let mut scored: Vec<(f64, &MemEntity)> = Vec::new();
        for e in self.current.values() {
            if let Some(ts) = types {
                if !ts.iter().any(|t| t == &e.node_type) {
                    continue;
                }
            }
            let kw = keyword_overlap(&q, &format!("{} {}", e.name, e.text));
            if !q.is_empty() && kw == 0.0 {
                continue;
            }
            let salience = compute_salience(e.mentions, days_since(&e.updated_at), 60.0, 1.0);
            let score = (if q.is_empty() { 1.0 } else { kw }) * salience * corroboration_boost(e.contributors.len());
            scored.push((score, e));
        }
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.into_iter().take(limit).map(|(s, e)| self.to_result(e, Some(s), None)).collect()
    }

    pub fn get_superseded(&mut self) -> Vec<RecallResult> {
        self.load_incremental();
        self.superseded.values().map(|e| self.to_result(e, None, None)).collect()
    }

    pub fn stats(&mut self) -> Stats {
        self.load_incremental();
        Stats {
            entities: self.current.len(),
            superseded: self.superseded.len(),
            relations: self.relations.len(),
            ledger_path: self.ledger_path.to_string_lossy().to_string(),
        }
    }

    fn to_result(&self, e: &MemEntity, salience: Option<f64>, similarity: Option<f64>) -> RecallResult {
        let relations: Vec<RelOut> = self
            .relations
            .values()
            .filter(|r| r.source_id == e.id)
            .map(|r| RelOut { predicate: r.rel_type.clone(), target: r.target_id.clone(), reason: r.reason.clone() })
            .collect();
        RecallResult {
            id: e.id.clone(),
            node_type: e.node_type.clone(),
            name: e.name.clone(),
            text: e.text.clone(),
            salience: salience.unwrap_or_else(|| compute_salience(e.mentions, days_since(&e.updated_at), 60.0, 1.0)),
            mentions: e.mentions,
            confidence: e.confidence,
            corroborations: e.contributors.len(),
            agent_id: e.agent_id.clone(),
            source: e.source.clone(),
            similarity,
            valid_to: e.valid_to.clone(),
            relations,
        }
    }
}

#[cfg(feature = "embeddings")]
impl Store {
    fn ensure_embedder(&mut self) {
        if self.embed_tried {
            return;
        }
        self.embed_tried = true;
        let model = std::env::var("BUDDY_MEMORY_EMBED_MODEL").unwrap_or_else(|_| {
            let home = std::env::var("CODEBUDDY_HOME")
                .or_else(|_| std::env::var("HOME").map(|h| format!("{}/.codebuddy", h)))
                .unwrap_or_else(|_| ".codebuddy".to_string());
            format!("{}/models/buddy-memory/model.onnx", home)
        });
        let path = std::path::Path::new(&model);
        if !path.exists() {
            return;
        }
        let needs_tt = std::env::var("BUDDY_MEMORY_EMBED_TOKEN_TYPE").map(|v| v != "false").unwrap_or(true);
        if let Ok(e) = crate::embed::Embedder::load(path, 384, 256, needs_tt) {
            self.embedder = Some(e);
        }
    }

    /// Hybrid recall: semantic (ONNX embeddings) + keyword + salience + corroboration, then MMR
    /// for diversity. No LLM at retrieval. Falls back to keyword recall if the model is missing or
    /// produces zero vectors. Mirrors the TS `recallHybrid` scoring.
    pub fn recall_hybrid(
        &mut self,
        query: &str,
        limit: usize,
        types: Option<&[String]>,
        w_sem: f64,
        mmr_lambda: f64,
    ) -> Vec<RecallResult> {
        self.load_incremental();
        self.ensure_embedder();
        if self.embedder.is_none() {
            return self.recall(query, limit, types);
        }
        struct Cand {
            id: String,
            embed_text: String,
            kw_text: String,
            ch: String,
            mentions: u64,
            updated_at: String,
            contributors: usize,
        }
        let mut cands: Vec<Cand> = Vec::new();
        for e in self.current.values() {
            if let Some(ts) = types {
                if !ts.iter().any(|t| t == &e.node_type) {
                    continue;
                }
            }
            cands.push(Cand {
                id: e.id.clone(),
                embed_text: format!("{}. {}", e.name, e.text),
                kw_text: format!("{} {}", e.name, e.text),
                ch: e.content_hash.clone(),
                mentions: e.mentions,
                updated_at: e.updated_at.clone(),
                contributors: e.contributors.len(),
            });
        }
        if cands.is_empty() {
            return Vec::new();
        }

        let mut to_embed: Vec<&str> = vec![query];
        let mut need: Vec<usize> = Vec::new();
        for (i, c) in cands.iter().enumerate() {
            if !self.emb_cache.contains_key(&c.ch) {
                need.push(i);
                to_embed.push(&c.embed_text);
            }
        }
        let emb = match self.embedder.as_mut().unwrap().embed(&to_embed) {
            Ok(v) if !v.is_empty() => v,
            _ => return self.recall(query, limit, types),
        };
        let qvec = emb[0].clone();
        if qvec.iter().all(|x| *x == 0.0) {
            return self.recall(query, limit, types); // model failed → keyword
        }
        for (k, ci) in need.iter().enumerate() {
            if let Some(v) = emb.get(k + 1) {
                self.emb_cache.insert(cands[*ci].ch.clone(), v.clone());
            }
        }

        let q = tokenize(query);
        let mut items: Vec<(usize, f64, f32)> = Vec::new(); // (cand idx, relevance, similarity)
        for (i, c) in cands.iter().enumerate() {
            let v = match self.emb_cache.get(&c.ch) {
                Some(v) => v,
                None => continue,
            };
            let sem = crate::embed::cosine(&qvec, v);
            let kw = keyword_overlap(&q, &c.kw_text);
            let sal = compute_salience(c.mentions, days_since(&c.updated_at), 60.0, 1.0);
            let rel = (w_sem * sem as f64 + (1.0 - w_sem) * kw)
                * (0.7 + 0.3 * sal.min(1.0))
                * corroboration_boost(c.contributors);
            items.push((i, rel, sem));
        }
        items.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // MMR (Carbonell-Goldstein): relevant but diverse.
        let mut picked: Vec<(usize, f64, f32)> = Vec::new();
        while picked.len() < limit && !items.is_empty() {
            let mut best = 0usize;
            let mut best_mmr = f64::NEG_INFINITY;
            for (j, cand) in items.iter().enumerate() {
                let mut max_sim = 0f32;
                for p in &picked {
                    if let (Some(a), Some(b)) =
                        (self.emb_cache.get(&cands[cand.0].ch), self.emb_cache.get(&cands[p.0].ch))
                    {
                        max_sim = max_sim.max(crate::embed::cosine(a, b));
                    }
                }
                let mmr = mmr_lambda * cand.1 - (1.0 - mmr_lambda) * max_sim as f64;
                if mmr > best_mmr {
                    best_mmr = mmr;
                    best = j;
                }
            }
            picked.push(items.remove(best));
        }

        picked
            .into_iter()
            .filter_map(|(idx, rel, sem)| {
                self.current.get(&cands[idx].id).map(|e| self.to_result(e, Some(rel), Some(sem as f64)))
            })
            .collect()
    }
}

#[cfg(all(test, feature = "embeddings"))]
mod hybrid_tests {
    use super::*;

    fn model_present() -> bool {
        std::env::var("BUDDY_MEMORY_EMBED_MODEL")
            .ok()
            .map(|p| std::path::Path::new(&p).exists())
            .unwrap_or_else(|| {
                std::env::var("HOME")
                    .map(|h| std::path::Path::new(&format!("{}/.codebuddy/models/buddy-memory/model.onnx", h)).exists())
                    .unwrap_or(false)
            })
    }

    #[test]
    fn hybrid_recall_finds_paraphrase_semantically() {
        if !model_present() {
            eprintln!("skip: multilingual model not present");
            return;
        }
        let dir = std::env::temp_dir().join(format!("bm-hyb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ledger = dir.join("ledger.jsonl");
        let mut s = Store::new(ledger, "test/repo".to_string());
        s.remember(&RememberInput { text: "La réponse vocale du robot est beaucoup trop lente.".into(), node_type: Some("discovery".into()), ..Default::default() });
        s.remember(&RememberInput { text: "La recette de gâteau demande trois œufs et du beurre.".into(), node_type: Some("discovery".into()), ..Default::default() });
        // Paraphrase with no shared keywords → semantic must surface the voice discovery.
        let hits = s.recall_hybrid("mon assistant parle avec beaucoup de retard", 2, None, 0.7, 0.7);
        assert!(!hits.is_empty());
        assert!(hits[0].text.contains("vocale"), "top hit should be the voice discovery, got {:?}", hits[0].text);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod store_tests {
    use super::*;

    fn tmp_ledger() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static CTR: AtomicU64 = AtomicU64::new(0);
        // Per-call unique (tests run in parallel threads and rm their own dir — avoid collisions).
        let n = CTR.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("bm-store-{}-{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("ledger.jsonl")
    }
    fn input(name: &str, text: &str, agent: &str) -> RememberInput {
        RememberInput { text: text.into(), node_type: Some("fact".into()), name: Some(name.into()), agent_id: Some(agent.into()), ..Default::default() }
    }

    #[test]
    fn snapshot_then_reload_preserves_state() {
        let led = tmp_ledger();
        {
            let mut s = Store::new(led.clone(), "a/r".into());
            s.remember(&input("k1", "alpha beta gamma", "a/r"));
            s.remember(&input("k2", "delta epsilon", "a/r"));
            s.save_snapshot();
            s.remember(&input("k3", "zeta eta theta", "a/r")); // appended AFTER the snapshot (tail)
        }
        // Fresh store: must load snapshot (k1,k2) + replay only the tail (k3).
        let mut s2 = Store::new(led.clone(), "a/r".into());
        assert_eq!(s2.stats().entities, 3);
        assert!(s2.snapshot_path.exists());
        assert!(s2.recall("zeta eta", 5, None).iter().any(|r| r.name == "k3"));
        let _ = std::fs::remove_dir_all(led.parent().unwrap());
    }

    #[test]
    fn supersede_invalidates_old_and_links() {
        let led = tmp_ledger();
        let mut s = Store::new(led.clone(), "a/r".into());
        s.remember(&input("decision", "on route la voix vers devstral local", "a/r"));
        s.remember(&input("decision", "on route la voix vers gpt-5.5 cloud", "a/r"));
        let cur = s.recall("route voix", 5, None);
        let top = cur.iter().find(|r| r.name == "decision").expect("current decision");
        assert!(top.text.contains("gpt-5.5"));
        assert!(top.relations.iter().any(|rel| rel.predicate == "supersedes"));
        let old = s.get_superseded();
        assert_eq!(old.len(), 1);
        assert!(old[0].text.contains("devstral"));
        assert!(old[0].valid_to.is_some());
        let _ = std::fs::remove_dir_all(led.parent().unwrap());
    }

    #[test]
    fn corroboration_counts_distinct_agents() {
        let led = tmp_ledger();
        let mut a = Store::new(led.clone(), "ministar/cb".into());
        let mut b = Store::new(led.clone(), "laptop/cb".into());
        a.remember(&RememberInput { text: "le ledger append-only evite les pertes".into(), node_type: Some("fact".into()), name: Some("k".into()), agent_id: Some("ministar/cb".into()), confidence: Some(0.6), ..Default::default() });
        b.remember(&RememberInput { text: "le ledger append-only evite les pertes".into(), node_type: Some("fact".into()), name: Some("k".into()), agent_id: Some("laptop/cb".into()), confidence: Some(0.6), ..Default::default() });
        let hits = b.recall("ledger pertes", 1, None);
        assert_eq!(hits[0].corroborations, 2);
        assert!(hits[0].confidence > 0.6);
        let _ = std::fs::remove_dir_all(led.parent().unwrap());
    }
}

fn snapshot_path_for(ledger: &Path) -> PathBuf {
    let name = ledger.file_name().and_then(|n| n.to_str()).unwrap_or("ckg-ledger.jsonl");
    ledger.with_file_name(format!("{}.snap", name))
}

fn read_range(path: &Path, start: u64, end: u64) -> Option<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = fs::File::open(path).ok()?;
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = vec![0u8; (end - start) as usize];
    f.read_exact(&mut buf).ok()?;
    Some(buf)
}

/// remember() input (mirrors TS `CkgRememberInput`, snake/camel handled by main's request parsing).
#[derive(Debug, Default)]
pub struct RememberInput {
    pub text: String,
    pub node_type: Option<String>,
    pub name: Option<String>,
    pub agent_id: Option<String>,
    pub source: Option<String>,
    pub confidence: Option<f64>,
    pub relations: Option<Vec<RememberRel>>,
}

#[derive(Debug)]
pub struct RememberRel {
    pub predicate: String,
    pub target_name: String,
    pub target_type: Option<String>,
    pub reason: Option<String>,
}
