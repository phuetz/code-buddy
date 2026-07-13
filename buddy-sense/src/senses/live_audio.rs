//! Live-microphone audio sense — the robot's real-time ears.
//!
//! Opt-in behind the `live-audio` feature (which pulls in `stt`). Captures the
//! microphone CONTINUOUSLY via ffmpeg (`-f pulse`, already a dependency used by
//! the camera sense — so no `cpal`, no `libasound2-dev`, no sudo), runs a
//! streaming energy-VAD endpointer to carve the stream into utterances, decodes
//! each closed utterance with the in-process offline recognizer (`stt.rs`,
//! ~120 ms) and emits an `audio/transcript_final` `SensoryEvent` whose payload
//! already carries the text — so the Code Buddy side consumes it directly with
//! no WAV round-trip and no python.
//!
//! The recognizer model is OFFLINE (NeMo Parakeet-TDT), so there is no
//! frame-by-frame `transcript_partial`; we emit the final per utterance only.
//! Latency is dominated by the VAD endpoint silence (`BUDDY_SENSE_MIC_ENDPOINT_MS`),
//! not by the ~120 ms decode.
//!
//! Capture + decode run on a dedicated blocking thread (via `spawn_blocking`):
//! the recognizer is `!Send`, so keeping it off the async runtime avoids holding
//! it across an `.await`.

use crate::event::{Modality, SensoryEvent};
use crate::senses::audio::rms_i16;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc as std_mpsc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

const SPEECH_SALIENCE: u8 = 200; // a final transcript is salient → never coalesced
const SAMPLE_RATE: u32 = 16_000;
const FRAME_MS: u64 = 20; // 20 ms frames → 320 samples @ 16 kHz
/// Default energy-VAD threshold (normalized RMS) to OPEN an utterance. Biased low
/// on purpose: a false positive costs one wasted ~120 ms decode (empty text →
/// skipped), a false negative makes the robot deaf. Conversational mic speech sits
/// well under a studio recording, so we open easily and let the decode gate noise.
/// The shared const ties the runtime default and the real-WAV test together.
pub const DEFAULT_MIC_THRESHOLD: f64 = 0.02;
/// Default trailing silence that closes an utterance. This is deliberately
/// close to the 400 ms low-latency starting point used by mature realtime
/// voice stacks, while retaining a little margin for French hesitations.
pub const DEFAULT_MIC_ENDPOINT_MS: u64 = 420;
/// Keep a tiny acoustic tail for the recognizer, but do not make STT decode the
/// whole endpoint silence after the endpointer has already classified it.
const STT_TAIL_PADDING_MS: u64 = 80;
/// Lead-in kept before speech is detected, so we don't clip the first phoneme.
const PREROLL_MS: u64 = 300;
/// Ignore "utterances" with less than this much voiced audio (clicks, coughs).
const MIN_SPEECH_MS: u64 = 200;
/// Hard cap on a single utterance → force a decode (bounds memory + latency).
const MAX_UTTERANCE_MS: u64 = 15_000;
/// If Smart Turn judges a pause incomplete but no more speech arrives, fail
/// open after this bound rather than leaving the user unanswered.
const DEFAULT_SMART_TURN_MAX_HOLD_MS: u64 = 1_200;
const DEFAULT_SMART_TURN_TIMEOUT_MS: u64 = 400;
/// Learn the room before opening the gate. This startup-only pause prevents a
/// television or amplified microphone floor from becoming a 15-second speech
/// segment immediately after the daemon starts.
const ADAPTIVE_CALIBRATION_MS: u64 = 1_000;
/// Rolling idle-audio window used for the robust (10th-percentile) noise floor.
const ADAPTIVE_NOISE_WINDOW_MS: u64 = 2_000;
const ADAPTIVE_NOISE_PERCENTILE: f64 = 0.10;
/// Speech must stand clearly above the learned floor to open; it may then fall
/// closer to that floor before closing (hysteresis preserves word endings).
const ADAPTIVE_OPEN_MULTIPLIER: f64 = 2.0;
const ADAPTIVE_CLOSE_MULTIPLIER: f64 = 1.2;
const MAX_EFFECTIVE_THRESHOLD: f64 = 0.95;

fn frame_samples() -> usize {
    ((SAMPLE_RATE as u64 * FRAME_MS) / 1000) as usize
}

/// Immediate, transcript-free turn-start signal.  The brain can use the
/// user's speaking time to prepare its grounded agent while STT is still
/// listening; this event never implies that a response is warranted.
fn speech_start_event(rms: f64, thresholds: GateThresholds, adaptive: bool) -> SensoryEvent {
    let mut payload = serde_json::json!({
        "rms": rms,
        "rmsOn": thresholds.on,
        "rmsOff": thresholds.off,
        "adaptiveVad": adaptive,
        "sampleRate": SAMPLE_RATE,
    });
    if let (Some(noise_floor), Some(object)) = (thresholds.noise_floor, payload.as_object_mut()) {
        object.insert("noiseFloorRms".to_string(), serde_json::json!(noise_floor));
    }
    SensoryEvent::new(Modality::Audio, "speech_start", SPEECH_SALIENCE, payload)
}

#[derive(Clone, Copy, Debug)]
struct GateThresholds {
    on: f64,
    off: f64,
    noise_floor: Option<f64>,
}

/// Local, allocation-bounded room calibration. Only idle frames enter the
/// rolling window; once speech opens, thresholds stay frozen for that turn.
/// The configured threshold remains an absolute minimum and becomes the exact
/// fixed threshold when the adaptive kill switch is off.
struct AdaptiveNoiseGate {
    enabled: bool,
    threshold_floor: f64,
    calibration_frames: usize,
    window_cap: usize,
    idle_frames_seen: usize,
    idle_rms: std::collections::VecDeque<f64>,
    thresholds: GateThresholds,
}

impl AdaptiveNoiseGate {
    fn new(threshold_floor: f64, frame_ms: u64, enabled: bool) -> Self {
        let frames_for = |ms: u64| (ms / frame_ms.max(1)).max(1) as usize;
        let threshold_floor = threshold_floor.clamp(0.000_001, MAX_EFFECTIVE_THRESHOLD);
        Self {
            enabled,
            threshold_floor,
            calibration_frames: frames_for(ADAPTIVE_CALIBRATION_MS),
            window_cap: frames_for(ADAPTIVE_NOISE_WINDOW_MS),
            idle_frames_seen: 0,
            idle_rms: std::collections::VecDeque::new(),
            thresholds: GateThresholds {
                on: threshold_floor,
                off: threshold_floor * 0.6,
                noise_floor: None,
            },
        }
    }

    /// Observe one frame while the gate is closed. Returns true once startup
    /// calibration is complete (or immediately in fixed/kill-switch mode).
    fn observe_idle(&mut self, rms: f64) -> bool {
        if !self.enabled {
            return true;
        }
        self.idle_frames_seen = self.idle_frames_seen.saturating_add(1);
        self.idle_rms.push_back(rms.clamp(0.0, 1.0));
        while self.idle_rms.len() > self.window_cap {
            self.idle_rms.pop_front();
        }
        self.recompute();
        self.calibrated()
    }

    fn recompute(&mut self) {
        if self.idle_rms.is_empty() {
            return;
        }
        let mut values: Vec<f64> = self.idle_rms.iter().copied().collect();
        values.sort_by(f64::total_cmp);
        let index = (((values.len() - 1) as f64) * ADAPTIVE_NOISE_PERCENTILE).round() as usize;
        let noise_floor = values[index.min(values.len() - 1)];
        let on = (noise_floor * ADAPTIVE_OPEN_MULTIPLIER)
            .max(self.threshold_floor)
            .min(MAX_EFFECTIVE_THRESHOLD);
        let off = (noise_floor * ADAPTIVE_CLOSE_MULTIPLIER)
            .max(self.threshold_floor * 0.6)
            // Keep real hysteresis even when the open threshold is clamped.
            .min(on * 0.9);
        self.thresholds = GateThresholds {
            on,
            off,
            noise_floor: Some(noise_floor),
        };
    }

    fn calibrated(&self) -> bool {
        !self.enabled || self.idle_frames_seen >= self.calibration_frames
    }

    fn thresholds(&self) -> GateThresholds {
        self.thresholds
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EndpointReason {
    Silence,
    Cap,
}

impl EndpointReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Silence => "silence",
            Self::Cap => "cap",
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct EndpointMetadata {
    reason: EndpointReason,
    thresholds: GateThresholds,
    adaptive: bool,
    hard_cap_count: u32,
}

impl EndpointMetadata {
    /// Smart Turn may join several VAD segments. Preserve any hard cap across
    /// that join so a 30/45-second capture cannot masquerade as a clean close.
    fn merge(self, previous: Self) -> Self {
        let hard_cap_count = self.hard_cap_count.saturating_add(previous.hard_cap_count);
        Self {
            reason: if hard_cap_count > 0 {
                EndpointReason::Cap
            } else {
                self.reason
            },
            hard_cap_count,
            ..self
        }
    }
}

struct SegmentedUtterance {
    samples: Vec<i16>,
    endpoint: EndpointMetadata,
}

/// Streaming endpointer. Feed it fixed-size frames; it returns `Some(utterance)`
/// (mono i16 @ 16 kHz, pre-roll included) when an utterance closes — i.e. speech
/// followed by `endpoint_ms` of silence, or the max-length cap. Pure + testable;
/// no I/O, no model.
pub struct Segmenter {
    gate: AdaptiveNoiseGate,
    endpoint_frames: u32,
    min_voiced_frames: u32,
    max_frames: u32,
    tail_padding_frames: u32,
    preroll_cap: usize,
    speaking: bool,
    silence_run: u32,
    voiced_frames: u32,
    buf: Vec<i16>,
    preroll: std::collections::VecDeque<Vec<i16>>,
}

impl Segmenter {
    /// Fixed-threshold constructor retained for deterministic callers/tests and
    /// as the exact behaviour selected by `BUDDY_SENSE_MIC_ADAPTIVE=false`.
    #[cfg(test)]
    pub fn new(threshold: f64, frame_ms: u64, endpoint_ms: u64) -> Self {
        Self::with_adaptive(threshold, frame_ms, endpoint_ms, false)
    }

    pub fn with_adaptive(threshold: f64, frame_ms: u64, endpoint_ms: u64, adaptive: bool) -> Self {
        let per = |ms: u64| (ms / frame_ms.max(1)).max(1) as u32;
        Self {
            gate: AdaptiveNoiseGate::new(threshold, frame_ms, adaptive),
            endpoint_frames: per(endpoint_ms),
            min_voiced_frames: per(MIN_SPEECH_MS),
            max_frames: per(MAX_UTTERANCE_MS),
            tail_padding_frames: per(STT_TAIL_PADDING_MS),
            preroll_cap: (PREROLL_MS / frame_ms.max(1)).max(1) as usize,
            speaking: false,
            silence_run: 0,
            voiced_frames: 0,
            buf: Vec::new(),
            preroll: std::collections::VecDeque::new(),
        }
    }

    /// Push one frame. Returns the finished utterance when one closes.
    fn push(&mut self, frame: &[i16]) -> Option<SegmentedUtterance> {
        let rms = rms_i16(frame);
        if !self.speaking {
            // Keep a short rolling lead-in so the first phoneme isn't clipped.
            self.preroll.push_back(frame.to_vec());
            while self.preroll.len() > self.preroll_cap {
                self.preroll.pop_front();
            }
            let calibrated = self.gate.observe_idle(rms);
            if calibrated && rms >= self.gate.thresholds().on {
                self.speaking = true;
                self.silence_run = 0;
                self.voiced_frames = 1;
                self.buf.clear();
                // `frame` is already the newest element of the pre-roll (pushed
                // just above), so draining the pre-roll covers it — don't append
                // it again or the first 20 ms is doubled.
                for f in self.preroll.drain(..) {
                    self.buf.extend_from_slice(&f);
                }
            }
            return None;
        }

        // Speaking: accumulate, track trailing silence for endpointing.
        self.buf.extend_from_slice(frame);
        let thresholds = self.gate.thresholds();
        if rms >= thresholds.off {
            self.silence_run = 0;
            self.voiced_frames += 1;
        } else {
            self.silence_run += 1;
        }

        let frames = (self.buf.len() / frame_samples().max(1)) as u32;
        let ended = self.silence_run >= self.endpoint_frames;
        let capped = frames >= self.max_frames;
        if ended || capped {
            let accepted = self.voiced_frames >= self.min_voiced_frames;
            let mut utt = std::mem::take(&mut self.buf);
            // Remove confirmed endpoint silence before inference. Preserve a
            // short tail so word-final acoustics are not clipped.
            if ended {
                let trim_frames = self.silence_run.saturating_sub(self.tail_padding_frames);
                let trim_samples = trim_frames as usize * frame_samples();
                utt.truncate(utt.len().saturating_sub(trim_samples));
            }
            self.speaking = false;
            self.silence_run = 0;
            self.voiced_frames = 0;
            self.preroll.clear();
            return if accepted {
                let reason = if ended {
                    EndpointReason::Silence
                } else {
                    EndpointReason::Cap
                };
                Some(SegmentedUtterance {
                    samples: utt,
                    endpoint: EndpointMetadata {
                        reason,
                        thresholds,
                        adaptive: self.gate.enabled,
                        hard_cap_count: u32::from(reason == EndpointReason::Cap),
                    },
                })
            } else {
                None
            };
        }
        None
    }

    /// Stream ended mid-utterance → flush whatever we have if it's long enough.
    pub fn flush(&mut self) -> Option<Vec<i16>> {
        if self.speaking && self.voiced_frames >= self.min_voiced_frames {
            self.speaking = false;
            Some(std::mem::take(&mut self.buf))
        } else {
            None
        }
    }

    fn is_speaking(&self) -> bool {
        self.speaking
    }

    fn adaptive_calibrated(&self) -> bool {
        self.gate.enabled && self.gate.calibrated()
    }

    fn effective_thresholds(&self) -> GateThresholds {
        self.gate.thresholds()
    }
}

#[derive(Clone, Debug)]
struct SmartTurnDecision {
    complete: bool,
    probability: f64,
    duration_ms: u64,
    forced_after_hold: bool,
}

struct SmartTurnWorker {
    child: Child,
    stdin: ChildStdin,
    responses: std_mpsc::Receiver<String>,
    seq: u64,
    timeout: Duration,
}

struct HeldTurn {
    samples: Vec<i16>,
    since: Instant,
    decision: SmartTurnDecision,
    endpoint: EndpointMetadata,
}

fn env_u64(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn smart_turn_model_path() -> PathBuf {
    if let Ok(value) = std::env::var("BUDDY_SENSE_SMART_TURN_MODEL") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".codebuddy/turn-detection/smart-turn-v3.2-cpu.onnx")
}

fn smart_turn_worker_path() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("BUDDY_SENSE_SMART_TURN_WORKER") {
        if !value.trim().is_empty() {
            return Some(PathBuf::from(value));
        }
    }
    let mut roots = vec![std::env::current_dir().ok()?];
    if let Ok(exe) = std::env::current_exe() {
        roots.extend(exe.ancestors().map(PathBuf::from));
    }
    roots
        .into_iter()
        .map(|root| root.join("scripts/smart-turn-worker.mjs"))
        .find(|candidate| candidate.is_file())
}

fn smart_turn_enabled() -> bool {
    let configured = std::env::var("BUDDY_SENSE_SMART_TURN")
        .unwrap_or_else(|_| "auto".to_string())
        .to_lowercase();
    !matches!(configured.as_str(), "0" | "false" | "off" | "no")
        && smart_turn_model_path().is_file()
        && smart_turn_worker_path().is_some()
}

impl SmartTurnWorker {
    fn start() -> Result<Self, String> {
        if !smart_turn_enabled() {
            return Err("disabled or model/worker unavailable".to_string());
        }
        let worker = smart_turn_worker_path().ok_or("worker script not found")?;
        let model = smart_turn_model_path();
        let node = std::env::var("BUDDY_SENSE_NODE").unwrap_or_else(|_| "node".to_string());
        let mut child = Command::new(node)
            .arg(worker)
            .env("BUDDY_SENSE_SMART_TURN_MODEL", &model)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("spawn Smart Turn worker: {error}"))?;
        let stdin = child.stdin.take().ok_or("Smart Turn worker has no stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Smart Turn worker has no stdout")?;
        let (tx, responses) = std_mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(value) => {
                        if tx.send(value).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        let ready = responses
            .recv_timeout(Duration::from_secs(15))
            .map_err(|error| format!("Smart Turn ready timeout: {error}"))?;
        let value: serde_json::Value = serde_json::from_str(&ready)
            .map_err(|error| format!("invalid Smart Turn ready response: {error}"))?;
        if value.get("ready").and_then(|item| item.as_bool()) != Some(true) {
            return Err(value
                .get("error")
                .and_then(|item| item.as_str())
                .unwrap_or("worker not ready")
                .to_string());
        }
        Ok(Self {
            child,
            stdin,
            responses,
            seq: 0,
            timeout: Duration::from_millis(env_u64(
                "BUDDY_SENSE_SMART_TURN_TIMEOUT_MS",
                DEFAULT_SMART_TURN_TIMEOUT_MS,
            )),
        })
    }

    fn analyze(&mut self, samples: &[i16]) -> Result<SmartTurnDecision, String> {
        self.seq += 1;
        let pcm_path = std::env::temp_dir().join(format!(
            "codebuddy-smart-turn-{}-{}.pcm",
            std::process::id(),
            self.seq,
        ));
        let result = (|| -> Result<SmartTurnDecision, String> {
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&pcm_path)
                .map_err(|error| format!("create Smart Turn PCM: {error}"))?;
            for sample in samples {
                file.write_all(&sample.to_le_bytes())
                    .map_err(|error| format!("write Smart Turn PCM: {error}"))?;
            }
            drop(file);
            let request = serde_json::json!({
                "id": self.seq.to_string(),
                "pcmPath": pcm_path,
            });
            writeln!(self.stdin, "{request}")
                .and_then(|_| self.stdin.flush())
                .map_err(|error| format!("write Smart Turn request: {error}"))?;
            let line = self
                .responses
                .recv_timeout(self.timeout)
                .map_err(|error| format!("Smart Turn response timeout: {error}"))?;
            let value: serde_json::Value = serde_json::from_str(&line)
                .map_err(|error| format!("invalid Smart Turn response: {error}"))?;
            if let Some(error) = value.get("error").and_then(|item| item.as_str()) {
                return Err(error.to_string());
            }
            Ok(SmartTurnDecision {
                complete: value
                    .get("complete")
                    .and_then(|item| item.as_bool())
                    .ok_or("missing completion decision")?,
                probability: value
                    .get("probability")
                    .and_then(|item| item.as_f64())
                    .ok_or("missing probability")?,
                duration_ms: value
                    .get("durationMs")
                    .and_then(|item| item.as_u64())
                    .unwrap_or(0),
                forced_after_hold: false,
            })
        })();
        let _ = std::fs::remove_file(pcm_path);
        result
    }
}

impl Drop for SmartTurnWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn ffmpeg_bin() -> String {
    std::env::var("BUDDY_SENSE_FFMPEG")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string())
}

/// Spawn the sense: a blocking capture+decode loop on its own thread (the
/// recognizer is `!Send`). `source` is a PulseAudio source name (or "default").
pub async fn run(
    tx: mpsc::Sender<SensoryEvent>,
    source: String,
    threshold: f64,
    endpoint_ms: u64,
    adaptive: bool,
) {
    let _ = tokio::task::spawn_blocking(move || {
        capture_loop(tx, source, threshold, endpoint_ms, adaptive)
    })
    .await;
}

fn capture_loop(
    tx: mpsc::Sender<SensoryEvent>,
    source: String,
    threshold: f64,
    endpoint_ms: u64,
    adaptive: bool,
) {
    // Load the recognizer ONCE (≈1–2 s). On failure, log loudly and bow out so
    // the daemon keeps beating instead of going deaf with a panic.
    let model_dir = crate::senses::stt::resolve_model_dir();
    let mut stt = match crate::senses::stt::Stt::load(&model_dir) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[buddy-sense] live-audio: recognizer load failed ({e}); sense disabled");
            return;
        }
    };
    eprintln!("[buddy-sense] live-audio: recognizer ready ({model_dir})");
    let mut smart_turn = SmartTurnWorker::start().ok();
    if smart_turn.is_some() {
        eprintln!("[buddy-sense] live-audio: Smart Turn v3.2 ready");
    } else {
        eprintln!("[buddy-sense] live-audio: Smart Turn unavailable; using VAD endpointing");
    }

    let mut child = match Command::new(ffmpeg_bin())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "pulse",
            "-i",
            &source,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[buddy-sense] live-audio: ffmpeg spawn failed ({e}); is ffmpeg installed? sense disabled");
            return;
        }
    };
    let mut out = match child.stdout.take() {
        Some(o) => o,
        None => {
            eprintln!("[buddy-sense] live-audio: no ffmpeg stdout; sense disabled");
            let _ = child.kill();
            return;
        }
    };

    let n = frame_samples();
    let mut bytes = vec![0u8; n * 2];
    let mut seg = Segmenter::with_adaptive(threshold, FRAME_MS, endpoint_ms, adaptive);
    let mut calibration_logged = false;
    let mut held_turn: Option<HeldTurn> = None;
    let max_hold = Duration::from_millis(env_u64(
        "BUDDY_SENSE_SMART_TURN_MAX_HOLD_MS",
        DEFAULT_SMART_TURN_MAX_HOLD_MS,
    ));
    eprintln!("[buddy-sense] live-audio: listening (pulse:{source})");

    loop {
        if out.read_exact(&mut bytes).is_err() {
            break; // ffmpeg ended / EOF
        }
        let frame: Vec<i16> = bytes
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        let was_speaking = seg.is_speaking();
        let frame_rms = rms_i16(&frame);
        let segment = seg.push(&frame);
        if !was_speaking && seg.is_speaking() {
            let event = speech_start_event(frame_rms, seg.effective_thresholds(), adaptive);
            if tx.blocking_send(event).is_err() {
                break;
            }
        }
        if !calibration_logged && seg.adaptive_calibrated() {
            let thresholds = seg.effective_thresholds();
            eprintln!(
                "[buddy-sense] live-audio: adaptive gate ready (noise {:.4}, on {:.4}, off {:.4})",
                thresholds.noise_floor.unwrap_or(0.0),
                thresholds.on,
                thresholds.off,
            );
            calibration_logged = true;
        }
        if let Some(mut segment) = segment {
            if let Some(mut previous) = held_turn.take() {
                previous.samples.append(&mut segment.samples);
                segment.samples = previous.samples;
                segment.endpoint = segment.endpoint.merge(previous.endpoint);
            }
            let decision = smart_turn
                .as_mut()
                .map(|worker| worker.analyze(&segment.samples));
            match decision {
                Some(Ok(value)) if !value.complete => {
                    if std::env::var("BUDDY_SENSE_MIC_DEBUG").is_ok() {
                        eprintln!(
                            "[buddy-sense] Smart Turn: incomplete ({:.3}, {}ms); holding",
                            value.probability, value.duration_ms,
                        );
                    }
                    held_turn = Some(HeldTurn {
                        samples: segment.samples,
                        since: Instant::now(),
                        decision: value,
                        endpoint: segment.endpoint,
                    });
                }
                Some(Err(error)) => {
                    eprintln!("[buddy-sense] Smart Turn failed ({error}); falling back to VAD");
                    smart_turn = None;
                    if !emit_utterance(
                        &mut stt,
                        &tx,
                        segment.samples,
                        endpoint_ms,
                        None,
                        Some(segment.endpoint),
                    ) {
                        break;
                    }
                }
                Some(Ok(value)) => {
                    if !emit_utterance(
                        &mut stt,
                        &tx,
                        segment.samples,
                        endpoint_ms,
                        Some(value),
                        Some(segment.endpoint),
                    ) {
                        break;
                    }
                }
                None => {
                    if !emit_utterance(
                        &mut stt,
                        &tx,
                        segment.samples,
                        endpoint_ms,
                        None,
                        Some(segment.endpoint),
                    ) {
                        break;
                    }
                }
            }
        }
        if !seg.is_speaking() {
            let expired = held_turn
                .as_ref()
                .is_some_and(|held| held.since.elapsed() >= max_hold);
            if expired {
                let mut held = held_turn.take().expect("held turn exists");
                held.decision.forced_after_hold = true;
                if !emit_utterance(
                    &mut stt,
                    &tx,
                    held.samples,
                    endpoint_ms,
                    Some(held.decision),
                    Some(held.endpoint),
                ) {
                    break;
                }
            }
        }
    }
    let held = held_turn.take();
    let final_endpoint = held.as_ref().map(|turn| turn.endpoint);
    let mut final_utt = held.map(|turn| turn.samples).unwrap_or_default();
    if let Some(mut utt) = seg.flush() {
        final_utt.append(&mut utt);
    }
    if !final_utt.is_empty() {
        let _ = emit_utterance(&mut stt, &tx, final_utt, endpoint_ms, None, final_endpoint);
    }
    let _ = child.kill();
    eprintln!("[buddy-sense] live-audio: capture ended");
}

/// Decode one utterance and push a `transcript_final`. Returns false if the bus
/// is closed (→ stop the loop).
fn add_endpoint_payload(
    payload: &mut serde_json::Value,
    metadata: EndpointMetadata,
    endpoint_ms: u64,
) {
    let Some(object) = payload.as_object_mut() else {
        return;
    };
    object.insert(
        "endedReason".to_string(),
        serde_json::json!(metadata.reason.as_str()),
    );
    object.insert(
        "endpointWaitMs".to_string(),
        serde_json::json!(if metadata.reason == EndpointReason::Silence {
            endpoint_ms
        } else {
            0
        }),
    );
    object.insert(
        "rmsOn".to_string(),
        serde_json::json!(metadata.thresholds.on),
    );
    object.insert(
        "rmsOff".to_string(),
        serde_json::json!(metadata.thresholds.off),
    );
    object.insert(
        "adaptiveVad".to_string(),
        serde_json::json!(metadata.adaptive),
    );
    object.insert(
        "hardCap".to_string(),
        serde_json::json!(metadata.hard_cap_count > 0),
    );
    object.insert(
        "hardCapCount".to_string(),
        serde_json::json!(metadata.hard_cap_count),
    );
    if let Some(noise_floor) = metadata.thresholds.noise_floor {
        object.insert("noiseFloorRms".to_string(), serde_json::json!(noise_floor));
    }
}

fn emit_utterance(
    stt: &mut crate::senses::stt::Stt,
    tx: &mpsc::Sender<SensoryEvent>,
    utt: Vec<i16>,
    endpoint_ms: u64,
    turn_decision: Option<SmartTurnDecision>,
    endpoint: Option<EndpointMetadata>,
) -> bool {
    let audio_ms = (utt.len() as u64 * 1000) / SAMPLE_RATE as u64;
    let decode_started = std::time::Instant::now();
    let text = stt.transcribe_pcm(SAMPLE_RATE, &utt);
    let decode_ms = decode_started.elapsed().as_millis() as u64;
    if text.is_empty() {
        return true; // silence / non-speech that slipped the gate — skip quietly
    }
    // Validation aid: `BUDDY_SENSE_MIC_DEBUG=1` echoes each final to stderr so you
    // can speak and see the transcript at the terminal, without a bus consumer.
    if std::env::var("BUDDY_SENSE_MIC_DEBUG").is_ok() {
        eprintln!("[buddy-sense] live-audio transcript ({audio_ms}ms audio, {decode_ms}ms decode): {text}");
    }
    let mut payload = serde_json::json!({
        "text": text,
        "ms": audio_ms,
        "audioMs": audio_ms,
        "decodeMs": decode_ms,
        "endpointMs": endpoint_ms,
    });
    if let Some(metadata) = endpoint {
        add_endpoint_payload(&mut payload, metadata, endpoint_ms);
    }
    if let (Some(decision), Some(object)) = (turn_decision, payload.as_object_mut()) {
        object.insert(
            "turnDetector".to_string(),
            serde_json::json!("smart-turn-v3.2"),
        );
        object.insert(
            "turnProbability".to_string(),
            serde_json::json!(decision.probability),
        );
        object.insert(
            "turnDetectionMs".to_string(),
            serde_json::json!(decision.duration_ms),
        );
        object.insert(
            "turnForcedAfterHold".to_string(),
            serde_json::json!(decision.forced_after_hold),
        );
    }
    let ev = SensoryEvent::new(
        Modality::Audio,
        "transcript_final",
        SPEECH_SALIENCE,
        payload,
    );
    tx.blocking_send(ev).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames_of(level: i16, count: usize) -> Vec<Vec<i16>> {
        let n = frame_samples();
        (0..count).map(|_| vec![level; n]).collect()
    }

    #[test]
    fn segments_one_utterance_from_silence_speech_silence() {
        // endpoint 100 ms = 5 frames of silence closes the utterance.
        let mut seg = Segmenter::new(0.05, FRAME_MS, 100);
        let mut closed = Vec::new();
        // 3 silence, 20 loud (≈400 ms > MIN_SPEECH 200 ms), then silence to endpoint.
        let mut stream = Vec::new();
        stream.extend(frames_of(0, 3));
        stream.extend(frames_of(12_000, 20));
        stream.extend(frames_of(0, 8));
        for f in &stream {
            if let Some(utt) = seg.push(f) {
                closed.push(utt);
            }
        }
        assert_eq!(closed.len(), 1, "exactly one utterance should close");
        // Pre-roll (≤15 frames) + 20 voiced + only the 80 ms STT tail.
        let got = closed[0].samples.len() / frame_samples();
        assert!(
            got >= 20 && got <= 20 + 15 + 5,
            "unexpected utterance span: {got} frames"
        );
        assert_eq!(closed[0].endpoint.reason, EndpointReason::Silence);
    }

    #[test]
    fn speech_start_payload_exposes_the_live_gate_without_claiming_a_reply() {
        let thresholds = GateThresholds {
            on: 0.04,
            off: 0.024,
            noise_floor: Some(0.02),
        };
        let event = speech_start_event(0.08, thresholds, true);
        assert_eq!(event.modality, Modality::Audio);
        assert_eq!(event.kind, "speech_start");
        assert_eq!(event.salience, SPEECH_SALIENCE);
        assert_eq!(event.payload["rms"], 0.08);
        assert_eq!(event.payload["rmsOn"], 0.04);
        assert_eq!(event.payload["rmsOff"], 0.024);
        assert_eq!(event.payload["noiseFloorRms"], 0.02);
        assert_eq!(event.payload["adaptiveVad"], true);
        assert_eq!(event.payload["sampleRate"], SAMPLE_RATE);
        assert!(event.payload.get("respond").is_none());
    }

    #[test]
    fn strips_confirmed_endpoint_silence_before_stt() {
        let mut seg = Segmenter::new(0.05, FRAME_MS, 420);
        let mut utterance = None;
        let mut stream = Vec::new();
        stream.extend(frames_of(0, 3));
        stream.extend(frames_of(12_000, 20));
        stream.extend(frames_of(0, 21));
        for frame in stream {
            if let Some(value) = seg.push(&frame) {
                utterance = Some(value);
            }
        }
        let frames = utterance.expect("utterance should close").samples.len() / frame_samples();
        // 3-frame pre-roll + 20 speech + 4-frame (80 ms) acoustic tail.
        assert_eq!(frames, 27);
    }

    #[test]
    fn smart_turn_classifies_complete_and_interrupted_real_french_audio() {
        if !smart_turn_enabled() {
            eprintln!("skip: Smart Turn worker/model unavailable");
            return;
        }
        let wav = format!(
            "{}/test_wavs/fr.wav",
            crate::senses::stt::resolve_model_dir()
        );
        if !std::path::Path::new(&wav).is_file() {
            eprintln!("skip: French reference WAV unavailable");
            return;
        }
        let pcm_path = std::env::temp_dir().join(format!(
            "codebuddy-smart-turn-test-{}.pcm",
            std::process::id(),
        ));
        let status = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                &wav,
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "s16le",
                pcm_path.to_str().expect("temporary path is UTF-8"),
            ])
            .status();
        if !status.is_ok_and(|value| value.success()) {
            eprintln!("skip: ffmpeg unavailable for Smart Turn integration test");
            return;
        }
        let bytes = std::fs::read(&pcm_path).expect("read converted PCM");
        let _ = std::fs::remove_file(&pcm_path);
        let samples: Vec<i16> = bytes
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let mut worker = SmartTurnWorker::start().expect("start Smart Turn worker");
        let complete = worker.analyze(&samples).expect("classify complete sample");
        let interrupted = worker
            .analyze(&samples[..samples.len().min(SAMPLE_RATE as usize * 4)])
            .expect("classify interrupted sample");
        eprintln!(
            "Smart Turn complete={:.3}/{}ms interrupted={:.3}/{}ms",
            complete.probability,
            complete.duration_ms,
            interrupted.probability,
            interrupted.duration_ms,
        );
        assert!(complete.complete, "full French thought should be complete");
        assert!(
            !interrupted.complete,
            "four-second mid-thought cut should be incomplete"
        );
        assert!(complete.duration_ms <= DEFAULT_SMART_TURN_TIMEOUT_MS);
        assert!(interrupted.duration_ms <= DEFAULT_SMART_TURN_TIMEOUT_MS);
    }

    #[test]
    fn pure_silence_yields_nothing() {
        let mut seg = Segmenter::new(0.05, FRAME_MS, 100);
        let mut closed = 0;
        for f in frames_of(0, 100) {
            if seg.push(&f).is_some() {
                closed += 1;
            }
        }
        assert_eq!(closed, 0);
    }

    #[test]
    fn rejects_too_short_a_blip() {
        // A 60 ms blip (3 frames) is below MIN_SPEECH_MS (200 ms) → discarded.
        let mut seg = Segmenter::new(0.05, FRAME_MS, 100);
        let mut closed = 0;
        let mut stream = Vec::new();
        stream.extend(frames_of(0, 3));
        stream.extend(frames_of(12_000, 3)); // 60 ms blip
        stream.extend(frames_of(0, 8)); // silence past endpoint
        for f in &stream {
            if seg.push(f).is_some() {
                closed += 1;
            }
        }
        assert_eq!(closed, 0, "a sub-200 ms blip must not produce an utterance");
    }

    #[test]
    fn adaptive_quiet_room_keeps_the_configured_floor() {
        let mut seg = Segmenter::with_adaptive(0.02, FRAME_MS, 100, true);
        for frame in frames_of(0, 60) {
            assert!(seg.push(&frame).is_none());
        }
        assert!(seg.adaptive_calibrated());
        assert!(!seg.is_speaking());
        let thresholds = seg.effective_thresholds();
        assert!((thresholds.on - 0.02).abs() < 1e-9);
        assert!((thresholds.off - 0.012).abs() < 1e-9);
        assert_eq!(thresholds.noise_floor, Some(0.0));
    }

    #[test]
    fn adaptive_continuous_noise_does_not_open_or_hit_the_cap() {
        let mut seg = Segmenter::with_adaptive(0.02, FRAME_MS, 100, true);
        // 20 seconds of steady amplified room noise: calibration learns it,
        // then the gate remains closed instead of emitting at the 15 s cap.
        for frame in frames_of(3_000, 1_000) {
            assert!(seg.push(&frame).is_none());
        }
        assert!(seg.adaptive_calibrated());
        assert!(!seg.is_speaking());
        let thresholds = seg.effective_thresholds();
        assert!(thresholds.on > rms_i16(&frames_of(3_000, 1)[0]));
        assert!(thresholds.off > rms_i16(&frames_of(3_000, 1)[0]));
    }

    #[test]
    fn adaptive_speech_above_noise_opens_the_gate() {
        let mut seg = Segmenter::with_adaptive(0.02, FRAME_MS, 100, true);
        for frame in frames_of(3_000, 60) {
            assert!(seg.push(&frame).is_none());
        }
        assert!(!seg.is_speaking());
        assert!(seg.push(&frames_of(12_000, 1)[0]).is_none());
        assert!(
            seg.is_speaking(),
            "speech clearly above the learned room floor must open"
        );
    }

    #[test]
    fn adaptive_return_to_room_noise_closes_by_silence() {
        let mut seg = Segmenter::with_adaptive(0.02, FRAME_MS, 100, true);
        let mut closed = None;
        let mut stream = Vec::new();
        stream.extend(frames_of(3_000, 60)); // calibrate steady room noise
        stream.extend(frames_of(12_000, 15)); // 300 ms speech above it
        stream.extend(frames_of(3_000, 8)); // learned background now counts as silence
        for frame in stream {
            if let Some(segment) = seg.push(&frame) {
                closed = Some(segment);
            }
        }
        let segment = closed.expect("returning to the learned floor should close the turn");
        assert_eq!(segment.endpoint.reason, EndpointReason::Silence);
        assert_eq!(segment.endpoint.hard_cap_count, 0);
        assert!(segment.endpoint.adaptive);
        assert!(segment.endpoint.thresholds.noise_floor.is_some());
    }

    #[test]
    fn hard_cap_reason_and_effective_thresholds_are_exposed_in_payload() {
        let mut seg = Segmenter::new(0.05, FRAME_MS, 100);
        let mut capped = None;
        for frame in frames_of(12_000, (MAX_UTTERANCE_MS / FRAME_MS) as usize) {
            if let Some(segment) = seg.push(&frame) {
                capped = Some(segment);
                break;
            }
        }
        let metadata = capped
            .expect("continuous speech should reach the hard cap")
            .endpoint;
        assert_eq!(metadata.reason, EndpointReason::Cap);
        assert_eq!(metadata.hard_cap_count, 1);

        let mut payload = serde_json::json!({});
        add_endpoint_payload(&mut payload, metadata, 420);
        assert_eq!(payload["endedReason"], "cap");
        assert_eq!(payload["endpointWaitMs"], 0);
        assert_eq!(payload["rmsOn"], 0.05);
        assert_eq!(payload["rmsOff"], 0.03);
        assert_eq!(payload["adaptiveVad"], false);
        assert_eq!(payload["hardCap"], true);
        assert_eq!(payload["hardCapCount"], 1);
    }

    // End-to-end proof of the Phase-2 pipeline MINUS the ffmpeg mic capture:
    // frame a real speech WAV exactly as the live loop does, run it through the
    // Segmenter, decode the closed utterance with the real offline recognizer,
    // and assert the French transcript. Self-skips unless the model is on disk
    // (so the default `cargo test` isn't environment-coupled). The only piece
    // this does NOT cover is the live mic, which needs a human speaking.
    #[test]
    fn segments_and_decodes_a_real_wav() {
        let dir = crate::senses::stt::resolve_model_dir();
        let wav = format!("{dir}/test_wavs/fr.wav");
        if !std::path::Path::new(&wav).exists() {
            eprintln!("skip: model/sample absent at {wav}");
            return;
        }
        let (samples, rate) = crate::senses::audio::read_wav_mono(&wav).expect("read fr.wav");
        if rate != SAMPLE_RATE {
            eprintln!("skip: fr.wav is {rate} Hz, segmenter assumes {SAMPLE_RATE}");
            return;
        }
        let n = frame_samples();
        // Use the SHIPPED runtime default, not a hand-tuned value — this test must
        // prove the daemon's real config segments real speech, or it proves nothing.
        let mut seg = Segmenter::new(DEFAULT_MIC_THRESHOLD, FRAME_MS, DEFAULT_MIC_ENDPOINT_MS);
        let mut utts: Vec<Vec<i16>> = Vec::new();
        for frame in samples.chunks(n) {
            if let Some(u) = seg.push(frame) {
                utts.push(u.samples);
            }
        }
        if let Some(u) = seg.flush() {
            utts.push(u);
        }
        assert!(
            !utts.is_empty(),
            "the segmenter should carve at least one utterance from real speech"
        );
        let mut stt = crate::senses::stt::Stt::load(&dir).expect("load recognizer");
        let joined = utts
            .iter()
            .map(|u| stt.transcribe_pcm(SAMPLE_RATE, u))
            .collect::<Vec<_>>()
            .join(" ");
        eprintln!("segmented+decoded: {joined}");
        let lower = joined.to_lowercase();
        assert!(
            lower.contains("pays") && lower.contains("demand"),
            "expected the JFK French line, got: {joined}"
        );
    }

    #[test]
    fn two_utterances_are_segmented_separately() {
        let mut seg = Segmenter::new(0.05, FRAME_MS, 100);
        let mut closed = 0;
        let mut stream = Vec::new();
        stream.extend(frames_of(0, 3));
        stream.extend(frames_of(12_000, 15));
        stream.extend(frames_of(0, 8)); // close #1
        stream.extend(frames_of(12_000, 15));
        stream.extend(frames_of(0, 8)); // close #2
        for f in &stream {
            if seg.push(f).is_some() {
                closed += 1;
            }
        }
        assert_eq!(closed, 2);
    }
}
