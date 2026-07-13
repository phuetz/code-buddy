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
pub fn detect_motion_events(
    frames: &[Vec<u8>],
    threshold: f64,
    frame_ms: u64,
) -> Vec<SensoryEvent> {
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

/// Live camera capture (behind `live-vision`): keep one ffmpeg process attached to
/// the v4l2 device, read downsampled grayscale frames from its rawvideo stdout,
/// and emit a salient `vision/motion` event. A second output of that same ffmpeg
/// filter graph atomically keeps the current full-resolution JPEG, so a motion
/// event can retain a keyframe without opening the camera a second time. Capture
/// runs in spawn_blocking so it never starves the async runtime.
#[cfg(feature = "live-vision")]
pub mod live {
    use super::{motion_score, MOTION_SALIENCE};
    use crate::event::{now_ms, Modality, SensoryEvent};
    use std::ffi::OsStr;
    use std::io::Read;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use tokio::sync::mpsc;

    const W: usize = 64;
    const H: usize = 48;

    fn ffmpeg_bin() -> String {
        std::env::var("BUDDY_SENSE_FFMPEG")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "ffmpeg".to_string())
    }

    fn ffmpeg_args(device: &str, interval_ms: u64, latest_frame: &Path) -> Vec<String> {
        let interval_ms = interval_ms.max(200);
        let filter = format!(
            "[0:v]fps=1000/{interval_ms},split=2[keyframe][motion_src];\
             [motion_src]scale={W}:{H},format=gray[motion]"
        );
        vec![
            "-hide_banner".into(),
            "-loglevel".into(),
            "error".into(),
            "-nostdin".into(),
            "-y".into(),
            "-f".into(),
            "v4l2".into(),
            "-i".into(),
            device.into(),
            "-filter_complex".into(),
            filter,
            // Write this output first. By the time its paired raw frame reaches
            // stdout, an atomic, complete JPEG from the same capture stream is
            // available for a motion event to retain.
            "-map".into(),
            "[keyframe]".into(),
            "-an".into(),
            "-q:v".into(),
            "3".into(),
            "-f".into(),
            "image2".into(),
            "-update".into(),
            "1".into(),
            "-atomic_writing".into(),
            "1".into(),
            latest_frame.to_string_lossy().into_owned(),
            "-map".into(),
            "[motion]".into(),
            "-an".into(),
            "-pix_fmt".into(),
            "gray".into(),
            "-f".into(),
            "rawvideo".into(),
            "pipe:1".into(),
        ]
    }

    /// Where keyframes are written (`~/.codebuddy/companion/` by default).
    fn frame_dir() -> PathBuf {
        let base = std::env::var("BUDDY_SENSE_FRAME_DIR")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| Path::new(&h).join(".codebuddy/companion"))
            })
            .unwrap_or_else(std::env::temp_dir);
        let _ = std::fs::create_dir_all(&base);
        base
    }

    fn camera_name(device: &str) -> String {
        device
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .unwrap_or("camera")
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect()
    }

    fn retain_keyframe(latest_frame: &Path, destination: &Path) -> bool {
        std::fs::copy(latest_frame, destination)
            .map(|bytes| bytes > 0)
            .unwrap_or(false)
    }

    /// Capture continuously at the configured cadence; emit `vision/motion`
    /// (+ a keyframe from the current stream) on rising motion. Hysteresis keeps
    /// a sustained scene change to one event rather than an event storm.
    pub async fn run(
        tx: mpsc::Sender<SensoryEvent>,
        device: String,
        interval_ms: u64,
        threshold: f64,
    ) {
        let dir = frame_dir();
        let program = ffmpeg_bin();
        let _ = tokio::task::spawn_blocking(move || {
            capture_loop(tx, &device, interval_ms, threshold, &dir, program.as_ref())
        })
        .await;
    }

    fn capture_loop(
        tx: mpsc::Sender<SensoryEvent>,
        device: &str,
        interval_ms: u64,
        threshold: f64,
        dir: &Path,
        program: &OsStr,
    ) {
        let camera = device.rsplit('/').next().unwrap_or("camera").to_string();
        let safe_camera = camera_name(device);
        let latest_frame = dir.join(format!(".buddy-sense-{safe_camera}-latest.jpg"));
        // Never use a stale keyframe if capture fails before ffmpeg's first JPEG.
        let _ = std::fs::remove_file(&latest_frame);

        let mut child = match Command::new(program)
            .args(ffmpeg_args(device, interval_ms, &latest_frame))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                eprintln!(
                    "[buddy-sense] live-vision: ffmpeg spawn failed ({error}); is ffmpeg installed? sense disabled"
                );
                return;
            }
        };
        let mut stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                eprintln!("[buddy-sense] live-vision: no ffmpeg stdout; sense disabled");
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        };

        let mut prev: Option<Vec<u8>> = None;
        let mut moving = false;
        let mut frame = vec![0_u8; W * H];
        loop {
            if stdout.read_exact(&mut frame).is_err() {
                break;
            }
            if let Some(p) = &prev {
                if p.len() == frame.len() {
                    let score = motion_score(p, frame.as_slice());
                    if !moving && score >= threshold {
                        moving = true;
                        let path = dir.join(format!("cam-{}.jpg", now_ms()));
                        let path_str = path.to_string_lossy().to_string();
                        let ok = retain_keyframe(&latest_frame, &path);
                        let payload = serde_json::json!({
                            "score": score,
                            "camera": camera,
                            "imagePath": if ok { Some(path_str) } else { None },
                        });
                        let ev =
                            SensoryEvent::new(Modality::Vision, "motion", MOTION_SALIENCE, payload);
                        if tx.blocking_send(ev).is_err() {
                            break;
                        }
                    } else if moving && score < threshold {
                        moving = false;
                    }
                } else {
                    moving = false; // resolution change → re-baseline + re-arm
                }
            }
            prev = Some(frame.clone());
        }
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_file(latest_frame);
        eprintln!("[buddy-sense] live-vision: capture ended");
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn ffmpeg_is_configured_as_one_continuous_dual_output_process() {
            let latest = Path::new("/tmp/latest.jpg");
            let args = ffmpeg_args("/dev/video7", 1_500, latest);
            assert_eq!(args.iter().filter(|arg| arg.as_str() == "-i").count(), 1);
            assert!(!args.iter().any(|arg| arg == "-frames:v"));
            assert!(args.iter().any(|arg| arg.contains("fps=1000/1500,split=2")));
            assert!(args
                .iter()
                .any(|arg| arg.contains("scale=64:48,format=gray")));
            assert!(args.iter().any(|arg| arg == "pipe:1"));
            assert!(args
                .iter()
                .any(|arg| arg == latest.to_string_lossy().as_ref()));
        }

        #[test]
        fn retain_keyframe_copies_the_existing_stream_frame() {
            let nonce = format!("{}-{}", std::process::id(), now_ms());
            let dir = std::env::temp_dir().join(format!("buddy-sense-video-test-{nonce}"));
            std::fs::create_dir_all(&dir).unwrap();
            let latest = dir.join("latest.jpg");
            let retained = dir.join("cam-test.jpg");
            std::fs::write(&latest, b"jpeg-from-live-stream").unwrap();

            assert!(retain_keyframe(&latest, &retained));
            assert_eq!(std::fs::read(&retained).unwrap(), b"jpeg-from-live-stream");
            assert!(!retain_keyframe(
                &dir.join("missing.jpg"),
                &dir.join("never.jpg")
            ));

            std::fs::remove_dir_all(dir).unwrap();
        }

        #[cfg(unix)]
        #[test]
        fn capture_loop_spawns_once_and_retains_a_keyframe_without_reopening_device() {
            use std::os::unix::fs::PermissionsExt;

            let nonce = format!("{}-{}", std::process::id(), now_ms());
            let dir = std::env::temp_dir().join(format!("buddy-sense-capture-test-{nonce}"));
            std::fs::create_dir_all(&dir).unwrap();
            let program = dir.join("fake-ffmpeg.sh");
            let spawn_log = dir.join("spawns.log");
            let latest = dir.join(".buddy-sense-video0-latest.jpg");
            let script = format!(
                "#!/bin/sh\n\
                 printf 'spawn\\n' >> '{}'\n\
                 printf 'jpeg-from-the-persistent-process' > '{}'\n\
                 dd if=/dev/zero bs={} count=1 2>/dev/null\n\
                 dd if=/dev/zero bs={} count=1 2>/dev/null | tr '\\000' '\\377'\n",
                spawn_log.display(),
                latest.display(),
                W * H,
                W * H,
            );
            std::fs::write(&program, script).unwrap();
            let mut permissions = std::fs::metadata(&program).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&program, permissions).unwrap();

            let (tx, mut rx) = mpsc::channel(1);
            capture_loop(tx, "/dev/video0", 1_500, 0.1, &dir, program.as_os_str());

            let event = rx
                .blocking_recv()
                .expect("the changed raw frame should emit motion");
            assert_eq!(event.kind, "motion");
            let image_path = event.payload["imagePath"]
                .as_str()
                .expect("the in-stream keyframe should be retained");
            assert_eq!(
                std::fs::read(image_path).unwrap(),
                b"jpeg-from-the-persistent-process"
            );
            assert_eq!(std::fs::read_to_string(spawn_log).unwrap(), "spawn\n");

            std::fs::remove_dir_all(dir).unwrap();
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
