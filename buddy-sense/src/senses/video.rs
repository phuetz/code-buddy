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
    use std::io::{self, Read};
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::time::{Duration, SystemTime};
    use tokio::sync::mpsc;

    const W: usize = 64;
    const H: usize = 48;
    const FRAME_KEEP: usize = 500;
    const DEFAULT_FRAME_TTL_SECS: u64 = 7 * 24 * 60 * 60;
    const DEFAULT_CAMERA_FAILURE_THRESHOLD: u32 = 20;
    const DEFAULT_CAMERA_RETRY_MS: u64 = 500;
    const CAMERA_STATUS_SALIENCE: u8 = 150;

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum CameraTransition {
        Offline,
        Online,
    }

    #[derive(Debug)]
    struct CameraHealth {
        consecutive_failures: u32,
        failure_threshold: u32,
        offline: bool,
    }

    impl CameraHealth {
        fn new(failure_threshold: u32) -> Self {
            Self {
                consecutive_failures: 0,
                failure_threshold: failure_threshold.max(1),
                offline: false,
            }
        }

        fn capture_failed(&mut self) -> Option<CameraTransition> {
            self.consecutive_failures = self.consecutive_failures.saturating_add(1);
            if !self.offline && self.consecutive_failures >= self.failure_threshold {
                self.offline = true;
                Some(CameraTransition::Offline)
            } else {
                None
            }
        }

        fn capture_succeeded(&mut self) -> Option<CameraTransition> {
            self.consecutive_failures = 0;
            if self.offline {
                self.offline = false;
                Some(CameraTransition::Online)
            } else {
                None
            }
        }
    }

    #[derive(Clone, Copy, Debug)]
    struct CaptureRecoveryConfig {
        failure_threshold: u32,
        retry_delay: Duration,
    }

    fn configured_recovery(
        failure_threshold: Option<&str>,
        retry_ms: Option<&str>,
    ) -> CaptureRecoveryConfig {
        let failure_threshold = failure_threshold
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_CAMERA_FAILURE_THRESHOLD);
        let retry_ms = retry_ms
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_CAMERA_RETRY_MS);
        CaptureRecoveryConfig {
            failure_threshold,
            retry_delay: Duration::from_millis(retry_ms),
        }
    }

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

    fn configured_frame_ttl(value: Option<&str>) -> Duration {
        value
            .and_then(|seconds| seconds.parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or_else(|| Duration::from_secs(DEFAULT_FRAME_TTL_SECS))
    }

    /// Remove expired camera keyframes and cap the survivors to the `keep` most
    /// recently modified files. Files outside the `cam-*.jpg` namespace are
    /// deliberately ignored, including ffmpeg's fixed `.buddy-sense-*-latest`
    /// working image.
    pub fn prune_frames(dir: &Path, keep: usize, ttl: Duration) -> io::Result<Vec<PathBuf>> {
        prune_frames_at(dir, keep, ttl, SystemTime::now())
    }

    fn prune_frames_at(
        dir: &Path,
        keep: usize,
        ttl: Duration,
        now: SystemTime,
    ) -> io::Result<Vec<PathBuf>> {
        let mut frames = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            if !file_type.is_file() {
                continue;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if !name.starts_with("cam-") || !name.ends_with(".jpg") {
                continue;
            }
            let modified = match entry.metadata().and_then(|metadata| metadata.modified()) {
                Ok(modified) => modified,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            frames.push((modified, entry.path()));
        }

        // Newest first. The path provides deterministic ordering when a
        // filesystem exposes coarse, equal modification timestamps.
        frames.sort_by(|a, b| b.cmp(a));
        let mut removed = Vec::new();
        for (index, (modified, path)) in frames.into_iter().enumerate() {
            let expired = now
                .duration_since(modified)
                .map(|age| age > ttl)
                .unwrap_or(false);
            if index < keep && !expired {
                continue;
            }
            match std::fs::remove_file(&path) {
                Ok(()) => removed.push(path),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        Ok(removed)
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
        let failure_threshold = std::env::var("BUDDY_SENSE_CAMERA_FAILURE_THRESHOLD").ok();
        let retry_ms = std::env::var("BUDDY_SENSE_CAMERA_RETRY_MS").ok();
        let recovery = configured_recovery(failure_threshold.as_deref(), retry_ms.as_deref());
        let _ = tokio::task::spawn_blocking(move || {
            capture_loop(
                tx,
                &device,
                interval_ms,
                threshold,
                &dir,
                program.as_ref(),
                recovery,
            )
        })
        .await;
    }

    fn emit_camera_transition(
        tx: &mpsc::Sender<SensoryEvent>,
        camera: &str,
        health: &CameraHealth,
        transition: CameraTransition,
    ) -> bool {
        let kind = match transition {
            CameraTransition::Offline => {
                eprintln!(
                    "[buddy-sense] live-vision: camera {camera} offline after {} consecutive capture failures",
                    health.consecutive_failures
                );
                "offline"
            }
            CameraTransition::Online => {
                eprintln!("[buddy-sense] live-vision: camera {camera} online");
                "online"
            }
        };
        let event = SensoryEvent::new(
            Modality::Vision,
            kind,
            CAMERA_STATUS_SALIENCE,
            serde_json::json!({
                "camera": camera,
                "consecutiveFailures": health.consecutive_failures,
            }),
        );
        tx.blocking_send(event).is_ok()
    }

    fn note_capture_failure(
        tx: &mpsc::Sender<SensoryEvent>,
        camera: &str,
        health: &mut CameraHealth,
    ) -> bool {
        match health.capture_failed() {
            Some(transition) => emit_camera_transition(tx, camera, health, transition),
            None => !tx.is_closed(),
        }
    }

    fn wait_before_retry(delay: Duration) {
        if !delay.is_zero() {
            std::thread::sleep(delay);
        }
    }

    fn capture_loop(
        tx: mpsc::Sender<SensoryEvent>,
        device: &str,
        interval_ms: u64,
        threshold: f64,
        dir: &Path,
        program: &OsStr,
        recovery: CaptureRecoveryConfig,
    ) {
        let camera = device.rsplit('/').next().unwrap_or("camera").to_string();
        let safe_camera = camera_name(device);
        let latest_frame = dir.join(format!(".buddy-sense-{safe_camera}-latest.jpg"));
        let mut health = CameraHealth::new(recovery.failure_threshold);

        while !tx.is_closed() {
            // Never use a stale keyframe if capture fails before ffmpeg's first JPEG.
            let _ = std::fs::remove_file(&latest_frame);
            let mut child = match Command::new(program)
                .args(ffmpeg_args(device, interval_ms, &latest_frame))
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
            {
                Ok(child) => child,
                Err(_) => {
                    if !note_capture_failure(&tx, &camera, &mut health) {
                        break;
                    }
                    wait_before_retry(recovery.retry_delay);
                    continue;
                }
            };
            let mut stdout = match child.stdout.take() {
                Some(stdout) => stdout,
                None => {
                    let _ = child.kill();
                    let _ = child.wait();
                    if !note_capture_failure(&tx, &camera, &mut health) {
                        break;
                    }
                    wait_before_retry(recovery.retry_delay);
                    continue;
                }
            };

            let mut prev: Option<Vec<u8>> = None;
            let mut moving = false;
            let mut frame = vec![0_u8; W * H];
            let mut receiver_open = true;
            loop {
                if stdout.read_exact(&mut frame).is_err() {
                    break;
                }
                if let Some(transition) = health.capture_succeeded() {
                    if !emit_camera_transition(&tx, &camera, &health, transition) {
                        receiver_open = false;
                        break;
                    }
                }
                if let Some(p) = &prev {
                    if p.len() == frame.len() {
                        let score = motion_score(p, frame.as_slice());
                        if !moving && score >= threshold {
                            moving = true;
                            let path = dir.join(format!("cam-{}.jpg", now_ms()));
                            let path_str = path.to_string_lossy().to_string();
                            let ok = retain_keyframe(&latest_frame, &path);
                            if ok {
                                let ttl_env = std::env::var("BUDDY_SENSE_FRAME_TTL").ok();
                                let ttl = configured_frame_ttl(ttl_env.as_deref());
                                if let Err(error) = prune_frames(dir, FRAME_KEEP, ttl) {
                                    eprintln!(
                                        "[buddy-sense] live-vision: keyframe pruning failed ({error})"
                                    );
                                }
                            }
                            let retained_path = if ok && path.is_file() {
                                Some(path_str)
                            } else {
                                None
                            };
                            let payload = serde_json::json!({
                                "score": score,
                                "camera": camera,
                                "imagePath": retained_path,
                            });
                            let event = SensoryEvent::new(
                                Modality::Vision,
                                "motion",
                                MOTION_SALIENCE,
                                payload,
                            );
                            if tx.blocking_send(event).is_err() {
                                receiver_open = false;
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
            let _ = std::fs::remove_file(&latest_frame);
            if !receiver_open || tx.is_closed() {
                break;
            }
            if !note_capture_failure(&tx, &camera, &mut health) {
                break;
            }
            wait_before_retry(recovery.retry_delay);
        }
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

        fn write_frame_with_mtime(path: &Path, modified: SystemTime) {
            let file = std::fs::File::create(path).unwrap();
            file.set_times(std::fs::FileTimes::new().set_modified(modified))
                .unwrap();
        }

        #[test]
        fn configured_ttl_defaults_to_seven_days_and_accepts_seconds() {
            assert_eq!(
                configured_frame_ttl(None),
                Duration::from_secs(7 * 24 * 60 * 60)
            );
            assert_eq!(configured_frame_ttl(Some("60")), Duration::from_secs(60));
            assert_eq!(
                configured_frame_ttl(Some("invalid")),
                Duration::from_secs(7 * 24 * 60 * 60)
            );
        }

        #[test]
        fn prune_frames_removes_expired_camera_jpegs_only() {
            let nonce = format!("{}-{}", std::process::id(), now_ms());
            let dir = std::env::temp_dir().join(format!("buddy-sense-prune-ttl-{nonce}"));
            std::fs::create_dir_all(&dir).unwrap();
            let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
            let expired = dir.join("cam-expired.jpg");
            let fresh = dir.join("cam-fresh.jpg");
            let unrelated = dir.join("portrait.jpg");
            write_frame_with_mtime(&expired, SystemTime::UNIX_EPOCH + Duration::from_secs(799));
            write_frame_with_mtime(&fresh, SystemTime::UNIX_EPOCH + Duration::from_secs(900));
            write_frame_with_mtime(
                &unrelated,
                SystemTime::UNIX_EPOCH + Duration::from_secs(100),
            );

            let removed = prune_frames_at(&dir, 500, Duration::from_secs(200), now).unwrap();

            assert_eq!(removed, vec![expired.clone()]);
            assert!(!expired.exists());
            assert!(fresh.exists());
            assert!(unrelated.exists());
            std::fs::remove_dir_all(dir).unwrap();
        }

        #[test]
        fn prune_frames_keeps_only_the_newest_requested_count() {
            let nonce = format!("{}-{}", std::process::id(), now_ms());
            let dir = std::env::temp_dir().join(format!("buddy-sense-prune-count-{nonce}"));
            std::fs::create_dir_all(&dir).unwrap();
            let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
            let mut frames = Vec::new();
            for second in 996..=1_000 {
                let path = dir.join(format!("cam-{second}.jpg"));
                write_frame_with_mtime(&path, SystemTime::UNIX_EPOCH + Duration::from_secs(second));
                frames.push(path);
            }

            let removed = prune_frames_at(&dir, 2, Duration::from_secs(1_000), now).unwrap();

            assert_eq!(removed.len(), 3);
            assert!(!frames[0].exists());
            assert!(!frames[1].exists());
            assert!(!frames[2].exists());
            assert!(frames[3].exists());
            assert!(frames[4].exists());
            std::fs::remove_dir_all(dir).unwrap();
        }

        #[test]
        fn camera_health_emits_each_offline_online_transition_once() {
            let mut health = CameraHealth::new(3);
            assert_eq!(health.capture_failed(), None);
            assert_eq!(health.capture_failed(), None);
            assert_eq!(health.capture_failed(), Some(CameraTransition::Offline));
            assert_eq!(health.capture_failed(), None);
            assert_eq!(health.capture_failed(), None);

            assert_eq!(health.capture_succeeded(), Some(CameraTransition::Online));
            assert_eq!(health.capture_succeeded(), None);
            assert_eq!(health.capture_failed(), None);
        }

        #[test]
        fn camera_recovery_defaults_to_about_ten_seconds_and_is_configurable() {
            let defaults = configured_recovery(None, None);
            assert_eq!(defaults.failure_threshold, 20);
            assert_eq!(defaults.retry_delay, Duration::from_millis(500));

            let custom = configured_recovery(Some("4"), Some("25"));
            assert_eq!(custom.failure_threshold, 4);
            assert_eq!(custom.retry_delay, Duration::from_millis(25));

            let invalid = configured_recovery(Some("0"), Some("invalid"));
            assert_eq!(invalid.failure_threshold, 20);
            assert_eq!(invalid.retry_delay, Duration::from_millis(500));
        }

        #[cfg(unix)]
        fn recv_with_timeout(rx: &mut mpsc::Receiver<SensoryEvent>) -> SensoryEvent {
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            loop {
                match rx.try_recv() {
                    Ok(event) => return event,
                    Err(mpsc::error::TryRecvError::Empty)
                        if std::time::Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("camera event not received before timeout: {error}"),
                }
            }
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
                "#!/bin/sh\nprintf 'spawn\\n' >> '{}'\nprintf 'jpeg-from-the-persistent-process' > '{}'\ndd if=/dev/zero bs={} count=1 2>/dev/null\ndd if=/dev/zero bs={} count=1 2>/dev/null | tr '\\000' '\\377'\nsleep 0.2\n",
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
            let capture_dir = dir.clone();
            let capture_program = program.clone();
            let handle = std::thread::spawn(move || {
                capture_loop(
                    tx,
                    "/dev/video0",
                    1_500,
                    0.1,
                    &capture_dir,
                    capture_program.as_os_str(),
                    CaptureRecoveryConfig {
                        failure_threshold: 3,
                        retry_delay: Duration::from_millis(1),
                    },
                );
            });

            let event = recv_with_timeout(&mut rx);
            assert_eq!(event.kind, "motion");
            let image_path = event.payload["imagePath"]
                .as_str()
                .expect("the in-stream keyframe should be retained");
            assert_eq!(
                std::fs::read(image_path).unwrap(),
                b"jpeg-from-the-persistent-process"
            );
            drop(rx);
            handle.join().unwrap();
            assert_eq!(std::fs::read_to_string(spawn_log).unwrap(), "spawn\n");

            std::fs::remove_dir_all(dir).unwrap();
        }

        #[cfg(unix)]
        #[test]
        fn capture_loop_emits_offline_then_online_across_reconnects() {
            use std::os::unix::fs::PermissionsExt;

            let nonce = format!("{}-{}", std::process::id(), now_ms());
            let dir = std::env::temp_dir().join(format!("buddy-sense-recovery-test-{nonce}"));
            std::fs::create_dir_all(&dir).unwrap();
            let program = dir.join("recovering-ffmpeg.sh");
            let spawn_log = dir.join("spawns.log");
            let script = format!(
                "#!/bin/sh\nprintf 'spawn\\n' >> '{}'\nattempts=$(wc -l < '{}')\nif [ \"$attempts\" -lt 3 ]; then exit 1; fi\ndd if=/dev/zero bs={} count=1 2>/dev/null\nsleep 0.2\n",
                spawn_log.display(),
                spawn_log.display(),
                W * H,
            );
            std::fs::write(&program, script).unwrap();
            let mut permissions = std::fs::metadata(&program).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&program, permissions).unwrap();

            let (tx, mut rx) = mpsc::channel(4);
            let capture_dir = dir.clone();
            let capture_program = program.clone();
            let handle = std::thread::spawn(move || {
                capture_loop(
                    tx,
                    "/dev/video0",
                    1_500,
                    0.1,
                    &capture_dir,
                    capture_program.as_os_str(),
                    CaptureRecoveryConfig {
                        failure_threshold: 2,
                        retry_delay: Duration::from_millis(1),
                    },
                );
            });

            let offline = recv_with_timeout(&mut rx);
            let online = recv_with_timeout(&mut rx);
            assert_eq!(offline.kind, "offline");
            assert_eq!(offline.salience, CAMERA_STATUS_SALIENCE);
            assert_eq!(offline.payload["camera"], "video0");
            assert_eq!(offline.payload["consecutiveFailures"], 2);
            assert_eq!(online.kind, "online");
            assert_eq!(online.salience, CAMERA_STATUS_SALIENCE);
            assert_eq!(online.payload["camera"], "video0");
            assert_eq!(online.payload["consecutiveFailures"], 0);

            drop(rx);
            handle.join().unwrap();
            assert_eq!(
                std::fs::read_to_string(spawn_log).unwrap(),
                "spawn\nspawn\nspawn\n"
            );
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
