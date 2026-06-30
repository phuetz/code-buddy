//! Data model + scoring math for the Collective Knowledge Graph engine.
//! Mirrors the TypeScript contract in code-buddy `src/memory/collective-knowledge-graph.ts`
//! (entity/relation/ledger shapes + corroboration/salience/contentHash) so the Rust engine is a
//! drop-in backend. Node/relation TYPES are open `String`s (not closed enums) on purpose, so the
//! memory domain isn't shoehorned into a code-graph schema.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub const SCOPE: &str = "collective";

/// A knowledge node (currently-valid or superseded).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemEntity {
    pub id: String,
    pub node_type: String,
    pub name: String,
    pub text: String,
    pub content_hash: String,
    pub base_confidence: f64,
    pub confidence: f64,
    pub mentions: u64,
    /// Distinct agentIds that asserted this fact (collective-trust signal). BTreeSet = stable order.
    pub contributors: BTreeSet<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// bi-temporal valid-time end; None = currently true.
    pub valid_to: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemRelation {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub rel_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub mentions: u64,
}

/// Append-only ledger record (the persisted write-ahead format; mirrors TS `LedgerEvent`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEvent {
    pub v: u8,
    pub kind: String, // "entity" | "relation"
    #[serde(rename = "recordedAt")]
    pub recorded_at: String,
    #[serde(rename = "agentId")]
    pub agent_id: String,
    #[serde(rename = "contentHash")]
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    // entity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub node_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    // relation
    #[serde(rename = "sourceId", skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(rename = "targetId", skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(rename = "relType", skip_serializing_if = "Option::is_none")]
    pub rel_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Lowercase + strip diacritics + non-alnum→`-`, trim, slice 80. Mirrors TS `normalizeName`.
pub fn normalize_name(s: &str) -> String {
    let lowered = s.to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut prev_dash = false;
    for ch in lowered.chars() {
        // Keep ASCII alphanumerics; fold everything else (incl. accented chars) to '-'.
        let keep = ch.is_ascii_alphanumeric();
        if keep {
            out.push(ch);
            prev_dash = false;
        } else if ch.is_alphanumeric() {
            // Non-ASCII letter/digit (é, ç, …): approximate the TS NFD-fold by dropping the mark,
            // i.e. map common accented latin to ASCII base; fallback to '-'.
            let base = fold_latin(ch);
            if let Some(b) = base {
                out.push(b);
                prev_dash = false;
            } else if !prev_dash {
                out.push('-');
                prev_dash = true;
            }
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-');
    trimmed.chars().take(80).collect()
}

/// Minimal Latin-1 accent folding (é→e, à→a, ç→c, …) to match TS NFD diacritic stripping for names.
fn fold_latin(ch: char) -> Option<char> {
    let c = ch.to_ascii_lowercase();
    match ch {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => Some('a'),
        'è' | 'é' | 'ê' | 'ë' => Some('e'),
        'ì' | 'í' | 'î' | 'ï' => Some('i'),
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => Some('o'),
        'ù' | 'ú' | 'û' | 'ü' => Some('u'),
        'ç' => Some('c'),
        'ñ' => Some('n'),
        'ý' | 'ÿ' => Some('y'),
        _ => {
            if c.is_ascii_alphanumeric() {
                Some(c)
            } else {
                None
            }
        }
    }
}

/// Code-Explorer id convention `Type:scope:name`. Mirrors TS `entityId`.
pub fn entity_id(node_type: &str, name: &str) -> String {
    format!("{}:{}:{}", node_type, SCOPE, normalize_name(name))
}

/// sha256(`type:normalized-text`) first 16 hex chars. Mirrors TS `contentHash`.
pub fn content_hash(node_type: &str, text: &str) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}", node_type, normalized).as_bytes());
    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|b| format!("{:02x}", b)).collect();
    hex[..16].to_string()
}

/// confidence boosted by cross-agent corroboration. Mirrors TS `corroboratedConfidence`.
pub fn corroborated_confidence(base: f64, distinct_agents: usize) -> f64 {
    let v = base + 0.12 * ((distinct_agents as f64) - 1.0).max(0.0);
    v.clamp(0.0, 0.99)
}

/// ranking boost from corroboration (caps 2× at 6+ agents). Mirrors TS `corroborationBoost`.
pub fn corroboration_boost(distinct_agents: usize) -> f64 {
    (1.0 + 0.2 * ((distinct_agents as f64) - 1.0).max(0.0)).min(2.0)
}

/// salience = ln(mentions+1) * exp(-0.693 * days_since_update / half_life). Mirrors TS `computeSalience`.
pub fn compute_salience(mentions: u64, days_since_update: f64, half_life_days: f64, base_sim: f64) -> f64 {
    let reinforcement = ((mentions as f64) + 1.0).ln();
    let recency = (-0.693 * days_since_update / half_life_days).exp();
    base_sim * reinforcement * recency
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corroboration_matches_ts() {
        assert!((corroborated_confidence(0.6, 1) - 0.6).abs() < 1e-9);
        assert!((corroborated_confidence(0.6, 2) - 0.72).abs() < 1e-9);
        assert!((corroborated_confidence(0.95, 5) - 0.99).abs() < 1e-9); // capped
        assert!((corroboration_boost(1) - 1.0).abs() < 1e-9);
        assert!((corroboration_boost(2) - 1.2).abs() < 1e-9);
        assert!((corroboration_boost(10) - 2.0).abs() < 1e-9); // capped
    }

    #[test]
    fn entity_id_and_hash_stable() {
        assert_eq!(entity_id("lesson", "Voice Agent Model"), "lesson:collective:voice-agent-model");
        // accented fold
        assert_eq!(entity_id("fact", "Métformine à 9h"), "fact:collective:metformine-a-9h");
        let h1 = content_hash("fact", "Hello   world");
        let h2 = content_hash("fact", "hello world");
        assert_eq!(h1, h2); // whitespace-collapsed + lowercased
        assert_eq!(h1.len(), 16);
    }
}
