//! The CKG store: append-only JSONL ledger (write-ahead) + in-memory index, mirroring the
//! TypeScript `CollectiveKnowledgeGraph` behaviour so the Rust engine is a drop-in backend.
//! Incremental, offset-based ledger reads (a write by process A becomes visible to a read by
//! process B sharing the same ledger — the load-bearing cross-process invariant) — and no full
//! O(N) replay on every read.

use crate::model::*;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
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

pub struct Store {
    ledger_path: PathBuf,
    current: HashMap<String, MemEntity>,
    superseded: HashMap<String, MemEntity>,
    relations: HashMap<String, MemRelation>,
    offset: u64,
    default_agent: String,
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
        let mut s = Store {
            ledger_path,
            current: HashMap::new(),
            superseded: HashMap::new(),
            relations: HashMap::new(),
            offset: 0,
            default_agent,
        };
        s.load_incremental();
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
        // Advance offset past our own write so load_incremental won't double-apply it.
        if let Ok(m) = fs::metadata(&self.ledger_path) {
            self.offset = m.len();
        }
        self.apply_event(ev);
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
