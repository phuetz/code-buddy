//! The thalamus — the brain's attention GATE (not a reordering scheduler). It
//! receives raw events from every sense (bounded channel = backpressure),
//! COALESCES high-rate low-salience events, keeps a parallel short-term MEMORY
//! (per-modality ring buffers), and BROADCASTS the admitted events in arrival
//! order (the "global workspace"). Salient events (>= ESCALATE_SALIENCE) bypass
//! coalescing — but this is a GATE, not priority reordering: a salient event
//! behind a backlog is still delivered after it (true priority is future work).

use std::collections::{HashMap, VecDeque};

use tokio::sync::{broadcast, mpsc};

use crate::event::{Modality, SensoryEvent};

/// At/above this salience, an event is escalated and never coalesced/dropped.
pub const ESCALATE_SALIENCE: u8 = 128;

/// Parallel short-term memory: a bounded ring buffer per modality.
pub struct Memory {
    cap: usize,
    buffers: HashMap<Modality, VecDeque<SensoryEvent>>,
}

impl Memory {
    pub fn new(cap: usize) -> Self {
        Self { cap, buffers: HashMap::new() }
    }

    pub fn push(&mut self, ev: &SensoryEvent) {
        let b = self.buffers.entry(ev.modality).or_default();
        if b.len() >= self.cap {
            b.pop_front();
        }
        b.push_back(ev.clone());
    }

    // recent/len back short-term recall (Phase 2/3) + the tests; not yet read by the binary.
    #[allow(dead_code)]
    pub fn recent(&self, m: Modality, n: usize) -> Vec<SensoryEvent> {
        self.buffers
            .get(&m)
            .map(|b| b.iter().rev().take(n).cloned().collect())
            .unwrap_or_default()
    }

    #[allow(dead_code)]
    pub fn len(&self, m: Modality) -> usize {
        self.buffers.get(&m).map_or(0, |b| b.len())
    }
}

/// Should `ev` be dropped as redundant, given the immediately-preceding event of
/// the same modality? Coalesces a burst of the same low-salience kind within
/// `window_ms`. Salient events always pass.
pub fn should_coalesce(prev: Option<&SensoryEvent>, ev: &SensoryEvent, window_ms: u64) -> bool {
    // Salient events bypass coalescing; vital signs (the heartbeat) are a
    // deliberate rhythm and must never be dropped, even at fast rates.
    if ev.salience >= ESCALATE_SALIENCE || ev.modality == Modality::Vital {
        return false;
    }
    match prev {
        Some(p) if p.modality == ev.modality && p.kind == ev.kind => {
            ev.ts_ms.saturating_sub(p.ts_ms) < window_ms
        }
        _ => false,
    }
}

pub struct Thalamus {
    coalesce_window_ms: u64,
    memory: Memory,
    last: HashMap<Modality, SensoryEvent>,
}

impl Thalamus {
    pub fn new(memory_cap: usize, coalesce_window_ms: u64) -> Self {
        Self { coalesce_window_ms, memory: Memory::new(memory_cap), last: HashMap::new() }
    }

    /// Admit one event: returns Some(ev) to broadcast, or None if coalesced.
    /// Pure-ish (mutates memory + last); unit-tested directly.
    pub fn admit(&mut self, ev: SensoryEvent) -> Option<SensoryEvent> {
        if should_coalesce(self.last.get(&ev.modality), &ev, self.coalesce_window_ms) {
            return None;
        }
        self.memory.push(&ev);
        self.last.insert(ev.modality, ev.clone());
        Some(ev)
    }

    #[allow(dead_code)]
    pub fn memory(&self) -> &Memory {
        &self.memory
    }

    /// Drive the thalamus: drain the sense channel, admit, broadcast.
    pub async fn run(mut self, mut rx: mpsc::Receiver<SensoryEvent>, tx: broadcast::Sender<SensoryEvent>) {
        while let Some(ev) = rx.recv().await {
            if let Some(out) = self.admit(ev) {
                // Ignore send errors: a broadcast with no live receivers is fine.
                let _ = tx.send(out);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ev(m: Modality, kind: &str, ts: u64, sal: u8) -> SensoryEvent {
        SensoryEvent { modality: m, kind: kind.into(), ts_ms: ts, salience: sal, payload: json!({}) }
    }

    #[test]
    fn coalesces_a_burst_of_low_salience_same_kind() {
        let mut t = Thalamus::new(8, 100);
        assert!(t.admit(ev(Modality::Vision, "motion", 0, 10)).is_some()); // first passes
        assert!(t.admit(ev(Modality::Vision, "motion", 30, 10)).is_none()); // within window → dropped
        assert!(t.admit(ev(Modality::Vision, "motion", 50, 10)).is_none()); // still within → dropped
        assert!(t.admit(ev(Modality::Vision, "motion", 200, 10)).is_some()); // past window → passes
    }

    #[test]
    fn salient_events_always_pass() {
        let mut t = Thalamus::new(8, 1000);
        assert!(t.admit(ev(Modality::Audio, "speech_start", 0, 200)).is_some());
        assert!(t.admit(ev(Modality::Audio, "speech_start", 10, 200)).is_some()); // salient → not coalesced
    }

    #[test]
    fn vital_heartbeat_is_never_coalesced_even_at_fast_rates() {
        let mut t = Thalamus::new(8, 1000); // 1s window — a 10ms heartbeat would coalesce if not excluded
        assert!(t.admit(ev(Modality::Vital, "heartbeat", 0, 5)).is_some());
        assert!(t.admit(ev(Modality::Vital, "heartbeat", 10, 5)).is_some());
        assert!(t.admit(ev(Modality::Vital, "heartbeat", 20, 5)).is_some());
    }

    #[test]
    fn memory_is_a_bounded_ring_buffer_per_modality() {
        let mut t = Thalamus::new(2, 0); // window 0 → never coalesce
        for i in 0..5 {
            t.admit(ev(Modality::Vital, "heartbeat", i, 10));
        }
        assert_eq!(t.memory().len(Modality::Vital), 2); // capped
        let recent = t.memory().recent(Modality::Vital, 2);
        assert_eq!(recent[0].ts_ms, 4); // most recent first
        assert_eq!(recent[1].ts_ms, 3);
    }

    #[tokio::test]
    async fn run_loop_broadcasts_admitted_and_drops_coalesced() {
        let (stx, srx) = mpsc::channel::<SensoryEvent>(16);
        let (btx, mut brx) = broadcast::channel::<SensoryEvent>(16);
        let thalamus = Thalamus::new(8, 100);
        let handle = tokio::spawn(async move { thalamus.run(srx, btx).await });

        stx.send(ev(Modality::Vision, "motion", 0, 10)).await.unwrap(); // passes
        stx.send(ev(Modality::Vision, "motion", 30, 10)).await.unwrap(); // within window → coalesced
        stx.send(ev(Modality::Audio, "speech_start", 40, 200)).await.unwrap(); // salient → passes
        drop(stx); // close the sense channel → the run loop ends after draining
        handle.await.unwrap();

        let mut kinds = Vec::new();
        while let Ok(e) = brx.try_recv() {
            kinds.push(e.kind);
        }
        assert_eq!(kinds, vec!["motion", "speech_start"]); // the 2nd motion was dropped
    }
}
