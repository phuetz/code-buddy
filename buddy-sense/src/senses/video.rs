//! Video sense — light motion detection. Compares downsampled grayscale frames;
//! rising motion emits a salient `vision/motion` event. The heavy describe
//! (camera_analyze with a local vision model) stays in Code Buddy — this sense
//! only decides "something moved." DETECTOR CORE ONLY for now: there is no live
//! camera capture path yet (frames are fed externally / by tests). The live
//! demo used Code Buddy's existing camera_analyze. Pure + testable headless.

// Exercised by tests; not called by the default binary (no live path yet).
#![allow(dead_code)]

use crate::event::{Modality, SensoryEvent};

const MOTION_SALIENCE: u8 = 180; // motion is salient → escalated by the thalamus

/// Mean absolute difference between two equal-length grayscale frames, 0.0..1.0.
pub fn motion_score(prev: &[u8], frame: &[u8]) -> f64 {
    if prev.is_empty() || prev.len() != frame.len() {
        return 0.0;
    }
    let sum: u64 = prev
        .iter()
        .zip(frame)
        .map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs() as u64)
        .sum();
    sum as f64 / (prev.len() as f64 * 255.0)
}

/// Detect motion across a frame sequence. Emits a `vision/motion` event when the
/// score crosses `threshold` upward (hysteresis: re-arms only after it drops back
/// below), so a sustained scene change yields one event, not a storm.
pub fn detect_motion_events(frames: &[Vec<u8>], threshold: f64, frame_ms: u64) -> Vec<SensoryEvent> {
    let mut out = Vec::new();
    let mut moving = false;
    let mut ts: u64 = 0;
    for pair in frames.windows(2) {
        let score = motion_score(&pair[0], &pair[1]);
        if !moving && score >= threshold {
            moving = true;
            out.push(SensoryEvent {
                modality: Modality::Vision,
                kind: "motion".into(),
                ts_ms: ts,
                salience: MOTION_SALIENCE,
                payload: serde_json::json!({ "score": score }),
            });
        } else if moving && score < threshold {
            moving = false;
        }
        ts += frame_ms; // ms, consistent with the audio sense (not a frame index)
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_frames_produce_no_motion() {
        let frame = vec![100u8; 64];
        let frames = vec![frame.clone(), frame.clone(), frame.clone()];
        assert!(detect_motion_events(&frames, 0.05, 100).is_empty());
    }

    #[test]
    fn a_changed_frame_fires_one_motion_event() {
        let calm = vec![10u8; 64];
        let bright = vec![240u8; 64];
        // calm, calm, bright (motion), bright (sustained → no second event)
        let frames = vec![calm.clone(), calm.clone(), bright.clone(), bright.clone()];
        let events = detect_motion_events(&frames, 0.1, 100);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].modality, Modality::Vision);
        assert_eq!(events[0].kind, "motion");
        assert_eq!(events[0].salience, MOTION_SALIENCE);
    }

    #[test]
    fn score_is_zero_for_identical_and_high_for_opposite() {
        assert_eq!(motion_score(&[50, 50], &[50, 50]), 0.0);
        assert!(motion_score(&[0, 0], &[255, 255]) > 0.99);
    }
}
