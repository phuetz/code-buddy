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

/// Live camera capture (behind `live-vision`): grab downsampled grayscale frames
/// from a v4l2 device via ffmpeg, run the shared motion core, and emit a salient
/// `vision/motion` event WITH a full-resolution JPEG keyframe path so Code Buddy's
/// cognition layer can describe it with a local vision model. No heavy camera
/// crate — reuses the already-present ffmpeg. Capture runs in spawn_blocking so it
/// never starves the async runtime.
#[cfg(feature = "live-vision")]
pub mod live {
    use super::{motion_score, MOTION_SALIENCE};
    use crate::event::{now_ms, Modality, SensoryEvent};
    use std::process::Command;
    use tokio::sync::mpsc;

    const W: usize = 64;
    const H: usize = 48;

    /// One downsampled grayscale frame (W*H bytes) from the camera, or None on glitch.
    fn capture_gray(device: &str) -> Option<Vec<u8>> {
        let out = Command::new("ffmpeg")
            .args([
                "-hide_banner", "-loglevel", "error", "-f", "v4l2", "-i", device,
                "-frames:v", "1", "-vf", &format!("scale={W}x{H},format=gray"),
                "-f", "rawvideo", "pipe:1",
            ])
            .output()
            .ok()?;
        if !out.status.success() || out.stdout.len() != W * H {
            return None;
        }
        Some(out.stdout)
    }

    /// Grab a full-resolution JPEG keyframe to `path`. Returns true on success.
    fn capture_keyframe(device: &str, path: &str) -> bool {
        Command::new("ffmpeg")
            .args([
                "-hide_banner", "-loglevel", "error", "-y", "-f", "v4l2", "-i", device,
                "-frames:v", "1", path,
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    /// Where keyframes are written (`~/.codebuddy/companion/` by default).
    fn frame_dir() -> std::path::PathBuf {
        let base = std::env::var("BUDDY_SENSE_FRAME_DIR")
            .ok()
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::var("HOME").ok().map(|h| std::path::Path::new(&h).join(".codebuddy/companion")))
            .unwrap_or_else(std::env::temp_dir);
        let _ = std::fs::create_dir_all(&base);
        base
    }

    /// Capture every `interval_ms`; emit `vision/motion` (+ keyframe) on rising
    /// motion (hysteresis → one event per sustained change, not a storm).
    pub async fn run(tx: mpsc::Sender<SensoryEvent>, device: String, interval_ms: u64, threshold: f64) {
        let camera = device.rsplit('/').next().unwrap_or("camera").to_string();
        let mut prev: Option<Vec<u8>> = None;
        let mut moving = false;
        let mut ticker = tokio::time::interval(std::time::Duration::from_millis(interval_ms.max(200)));
        loop {
            ticker.tick().await;
            let dev = device.clone();
            let frame = match tokio::task::spawn_blocking(move || capture_gray(&dev)).await {
                Ok(Some(f)) => f,
                _ => continue,
            };
            if let Some(p) = &prev {
                if p.len() == frame.len() {
                    let score = motion_score(p, &frame);
                    if !moving && score >= threshold {
                        moving = true;
                        let path = frame_dir().join(format!("cam-{}.jpg", now_ms()));
                        let path_str = path.to_string_lossy().to_string();
                        let (dev2, cap_path) = (device.clone(), path_str.clone());
                        let ok = tokio::task::spawn_blocking(move || capture_keyframe(&dev2, &cap_path))
                            .await
                            .unwrap_or(false);
                        let payload = serde_json::json!({
                            "score": score,
                            "camera": camera,
                            "imagePath": if ok { Some(path_str) } else { None },
                        });
                        let ev = SensoryEvent::new(Modality::Vision, "motion", MOTION_SALIENCE, payload);
                        if tx.send(ev).await.is_err() {
                            break;
                        }
                    } else if moving && score < threshold {
                        moving = false;
                    }
                } else {
                    moving = false; // resolution change → re-baseline + re-arm
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
