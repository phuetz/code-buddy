//! The shared sensory-event schema. Every sense emits these; the thalamus routes
//! them; the bridge serializes them as JSON to Code Buddy's event bus.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Modality {
    Audio,
    Vision,
    /// Desktop screen perception (what's on screen), distinct from camera Vision.
    Screen,
    /// Semantic UI events (active app / window / focus) via accessibility.
    Ui,
    /// Internal "vital signs" — the heartbeat/breathing analogue (periodic).
    Vital,
}

impl Modality {
    /// Canonical lowercase name (matches the serde representation) — used for digest keys + logging.
    pub fn as_str(self) -> &'static str {
        match self {
            Modality::Audio => "audio",
            Modality::Vision => "vision",
            Modality::Screen => "screen",
            Modality::Ui => "ui",
            Modality::Vital => "vital",
        }
    }
}

/// A single perception event. `salience` (0..=255) is the thalamic priority:
/// high-salience events are never coalesced/dropped (see bus::should_coalesce).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SensoryEvent {
    pub modality: Modality,
    pub kind: String,
    pub ts_ms: u64,
    pub salience: u8,
    #[serde(default)]
    pub payload: serde_json::Value,
}

impl SensoryEvent {
    pub fn new(
        modality: Modality,
        kind: impl Into<String>,
        salience: u8,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            modality,
            kind: kind.into(),
            ts_ms: now_ms(),
            salience,
            payload,
        }
    }
}

pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_roundtrip_with_lowercase_modality() {
        let e = SensoryEvent {
            modality: Modality::Audio,
            kind: "speech_start".into(),
            ts_ms: 1,
            salience: 200,
            payload: serde_json::json!({ "rms": 0.4 }),
        };
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"modality\":\"audio\""));
        let back: SensoryEvent = serde_json::from_str(&s).unwrap();
        assert_eq!(e, back);
    }
}
