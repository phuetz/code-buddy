//! The thalamus — the brain's attention gate AND a bounded priority scheduler. It
//! receives raw events from the per-organ channels, COALESCES high-rate low-salience
//! events, keeps a parallel short-term MEMORY (per-modality ring buffers), and
//! BROADCASTS admitted events (the "global workspace"). Salient events
//! (>= ESCALATE_SALIENCE) bypass coalescing, and within each attention batch the
//! most salient are served FIRST (`run_multi`), so a salient event (speech) is not
//! stuck behind a backlog of low-salience motion. Same-salience keeps arrival order.

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

    /// Drive the thalamus from PER-ORGAN channels merged fairly (`StreamMap`), instead of one shared
    /// queue. This is the organ-isolation fix: a burst on one organ fills only ITS channel and never
    /// parks another organ's producer (no cross-organ head-of-line blocking). The thalamus still
    /// admits + broadcasts sequentially, but ingress is decoupled per organ. The loop ends when every
    /// organ channel has closed. Returns when all inputs are done.
    pub async fn run_multi(
        mut self,
        receivers: Vec<mpsc::Receiver<SensoryEvent>>,
        tx: broadcast::Sender<SensoryEvent>,
    ) {
        use futures_util::FutureExt;
        use tokio_stream::wrappers::ReceiverStream;
        use tokio_stream::{StreamExt, StreamMap};

        // Max events reordered together in one attention pass (bounded work + latency).
        const ATTENTION_BATCH: usize = 32;

        let mut map: StreamMap<usize, ReceiverStream<SensoryEvent>> = StreamMap::new();
        for (i, rx) in receivers.into_iter().enumerate() {
            map.insert(i, ReceiverStream::new(rx));
        }

        // Block for the next event, then greedily gather whatever is IMMEDIATELY ready into a bounded
        // batch and serve it highest-salience-first — real attention, so a salient event isn't stuck
        // behind a backlog of low-salience motion. Stable sort → equal salience keeps arrival order;
        // coalescing still runs per admit.
        while let Some((_organ, first)) = map.next().await {
            let mut batch = vec![first];
            while batch.len() < ATTENTION_BATCH {
                match map.next().now_or_never() {
                    Some(Some((_organ, ev))) => batch.push(ev),
                    _ => break, // nothing immediately ready, or all organ channels closed
                }
            }
            batch.sort_by_key(|e| std::cmp::Reverse(e.salience)); // stable: equal salience keeps arrival order
            for ev in batch {
                if let Some(out) = self.admit(ev) {
                    let _ = tx.send(out);
                }
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
        let handle = tokio::spawn(async move { thalamus.run_multi(vec![srx], btx).await });

        stx.send(ev(Modality::Vision, "motion", 0, 10)).await.unwrap(); // passes
        stx.send(ev(Modality::Vision, "motion", 30, 10)).await.unwrap(); // within window → coalesced
        stx.send(ev(Modality::Audio, "speech_start", 40, 200)).await.unwrap(); // salient → passes
        drop(stx); // close the sense channel → the run loop ends after draining
        handle.await.unwrap();

        let mut kinds = Vec::new();
        while let Ok(e) = brx.try_recv() {
            kinds.push(e.kind);
        }
        // The 2nd motion is coalesced; the salient speech is served BEFORE the motion (attention),
        // even though the motion arrived first.
        assert_eq!(kinds, vec!["speech_start", "motion"]);
    }

    #[tokio::test]
    async fn serves_high_salience_before_low_within_a_batch() {
        let (stx, srx) = mpsc::channel::<SensoryEvent>(16);
        let (btx, mut brx) = broadcast::channel::<SensoryEvent>(16);
        let thalamus = Thalamus::new(8, 0); // window 0 → no coalescing, isolate the ordering
        // Buffer low → high → mid BEFORE the thalamus drains, so they land in ONE attention batch.
        stx.send(ev(Modality::Vision, "motion", 0, 10)).await.unwrap(); // low
        stx.send(ev(Modality::Audio, "speech_start", 1, 200)).await.unwrap(); // high
        stx.send(ev(Modality::Ui, "focus", 2, 90)).await.unwrap(); // mid
        drop(stx);
        let handle = tokio::spawn(async move { thalamus.run_multi(vec![srx], btx).await });
        handle.await.unwrap();

        let mut kinds = Vec::new();
        while let Ok(e) = brx.try_recv() {
            kinds.push(e.kind);
        }
        // Served by descending salience (200 > 90 > 10), not arrival order.
        assert_eq!(kinds, vec!["speech_start", "focus", "motion"]);
    }

    #[tokio::test]
    async fn run_multi_merges_every_organ_channel() {
        // Two organs, each on its OWN channel — the thalamus must admit + broadcast from both.
        let (vtx, vrx) = mpsc::channel::<SensoryEvent>(8); // vision organ
        let (atx, arx) = mpsc::channel::<SensoryEvent>(8); // audio organ
        let (btx, mut brx) = broadcast::channel::<SensoryEvent>(16);
        let thalamus = Thalamus::new(8, 100);
        let handle = tokio::spawn(async move { thalamus.run_multi(vec![vrx, arx], btx).await });

        vtx.send(ev(Modality::Vision, "motion", 0, 180)).await.unwrap();
        atx.send(ev(Modality::Audio, "speech_start", 5, 200)).await.unwrap();
        drop(vtx);
        drop(atx);
        handle.await.unwrap();

        let mut mods = Vec::new();
        while let Ok(e) = brx.try_recv() {
            mods.push(e.modality);
        }
        assert!(mods.contains(&Modality::Vision));
        assert!(mods.contains(&Modality::Audio));
        assert_eq!(mods.len(), 2);
    }

    #[tokio::test]
    async fn a_full_organ_channel_does_not_block_another_organ() {
        // The head-of-line fix, at the channel level: with per-organ channels, saturating organ A
        // must not stop organ B's producer. (With ONE shared channel, a full queue blocks ALL sends.)
        let (a_tx, _a_rx) = mpsc::channel::<SensoryEvent>(1); // organ A, capacity 1, unconsumed
        let (b_tx, _b_rx) = mpsc::channel::<SensoryEvent>(1); // organ B, its own channel
        a_tx.try_send(ev(Modality::Vision, "motion", 0, 180)).unwrap(); // fill A
        assert!(a_tx.try_send(ev(Modality::Vision, "motion", 1, 180)).is_err()); // A is now full…
        // …yet B is completely unaffected — its producer sends freely.
        assert!(b_tx.try_send(ev(Modality::Audio, "speech_start", 2, 200)).is_ok());
    }
}
