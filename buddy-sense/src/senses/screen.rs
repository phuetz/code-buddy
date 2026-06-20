//! Screen sense — light, event-driven analysis of what's on screen.
//!
//! Architecture INSPIRED BY Screenpipe (capture-on-CHANGE, not 24/7 recording;
//! delegate the heavy OCR/vision to the cognition layer) but written clean-room:
//! our own code, permissive crates (xcap), no persistent recording → no disk
//! hazard. Emits a salient `screen/change` event when the screen changes; Code
//! Buddy reacts with OCR/describe on demand. Live capture is behind `live-screen`.

// detect_change_events + the salience const are used by tests + the live feature,
// not by the default binary.
#![allow(dead_code)]

use crate::event::{Modality, SensoryEvent};
use crate::senses::video::motion_score; // shared luma-diff core (our own code)

const SCREEN_SALIENCE: u8 = 140;

/// Detect screen changes across a sequence of downsampled grayscale frames.
/// Rising-edge hysteresis (one event per change, not a storm), emitting
/// `screen/change`. Pure + testable headless.
pub fn detect_change_events(frames: &[Vec<u8>], threshold: f64, frame_ms: u64) -> Vec<SensoryEvent> {
    let mut out = Vec::new();
    let mut changed = false;
    let mut ts: u64 = 0;
    for pair in frames.windows(2) {
        let score = motion_score(&pair[0], &pair[1]);
        if !changed && score >= threshold {
            changed = true;
            out.push(SensoryEvent {
                modality: Modality::Screen,
                kind: "change".into(),
                ts_ms: ts,
                salience: SCREEN_SALIENCE,
                payload: serde_json::json!({ "score": score }),
            });
        } else if changed && score < threshold {
            changed = false;
        }
        ts += frame_ms; // ms, consistent with the audio sense (not a frame index)
    }
    out
}

#[cfg(feature = "live-screen")]
pub mod live {
    use super::*;
    use tokio::sync::mpsc;

    /// Capture the primary monitor as a downsampled grayscale frame (xcap).
    fn capture_primary_gray(step: usize) -> Option<Vec<u8>> {
        let monitor = xcap::Monitor::all().ok()?.into_iter().next()?;
        let image = monitor.capture_image().ok()?; // RgbaImage
        let (w, h) = (image.width() as usize, image.height() as usize);
        let raw = image.into_raw(); // Vec<u8> RGBA
        let step = step.max(1);
        let mut gray = Vec::with_capacity((w / step + 1) * (h / step + 1));
        let mut y = 0;
        while y < h {
            let mut x = 0;
            while x < w {
                let i = (y * w + x) * 4;
                let r = raw[i] as f64;
                let g = raw[i + 1] as f64;
                let b = raw[i + 2] as f64;
                gray.push((0.299 * r + 0.587 * g + 0.114 * b) as u8);
                x += step;
            }
            y += step;
        }
        Some(gray)
    }

    /// Run the screen sense: capture every `interval_ms`, emit `screen/change` on
    /// rising change. Capture runs in spawn_blocking (never starves the runtime).
    pub async fn run(tx: mpsc::Sender<SensoryEvent>, interval_ms: u64, threshold: f64) {
        let mut prev: Option<Vec<u8>> = None;
        let mut changed = false;
        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(interval_ms.max(1)));
        loop {
            ticker.tick().await;
            let frame = match tokio::task::spawn_blocking(|| capture_primary_gray(8)).await {
                Ok(Some(f)) => f,
                _ => continue,
            };
            if let Some(p) = &prev {
                if p.len() == frame.len() {
                    let score = motion_score(p, &frame);
                    if !changed && score >= threshold {
                        changed = true;
                        let ev = SensoryEvent::new(Modality::Screen, "change", SCREEN_SALIENCE, serde_json::json!({ "score": score }));
                        if tx.send(ev).await.is_err() {
                            break;
                        }
                    } else if changed && score < threshold {
                        changed = false;
                    }
                }
            }
            prev = Some(frame);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_screen_produces_no_change() {
        let f = vec![120u8; 64];
        assert!(detect_change_events(&[f.clone(), f.clone(), f.clone()], 0.05, 100).is_empty());
    }

    #[test]
    fn a_changed_screen_fires_one_change_event() {
        let a = vec![20u8; 64];
        let b = vec![220u8; 64];
        let events = detect_change_events(&[a.clone(), a.clone(), b.clone(), b.clone()], 0.1, 100);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].modality, Modality::Screen);
        assert_eq!(events[0].kind, "change");
        assert_eq!(events[0].salience, SCREEN_SALIENCE);
    }
}
