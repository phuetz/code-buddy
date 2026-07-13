//! buddy-sense — a parallel multi-sensory "nervous system" feeding Code Buddy.
//!
//! Senses (parallel) → bounded channel → thalamus (coalesce/prioritize/memory)
//! → broadcast → bridge (WebSocket) → Code Buddy's event bus.
//!
//! Usage:
//!   buddy-sense path/to/audio.wav    # run the audio sense over a WAV (headless)
//!   buddy-sense                      # demo: emit a heartbeat every 2s
//! Env: BUDDY_SENSE_BRIDGE_URL (default ws://127.0.0.1:8129)

mod bridge;
mod bus;
mod event;
mod organs;
mod senses;

use tokio::sync::{broadcast, mpsc};

use event::SensoryEvent;
use organs::{resolve_organs, Organ};

const AUDIO_FRAME_MS: u64 = 20;
const AUDIO_THRESHOLD: f64 = 0.05;

/// Run the VAD and tag speech events with the source WAV path, so Code Buddy can
/// transcribe the utterance (speech → STT → action) on its side.
fn audio_events_for(path: &str) -> Result<Vec<SensoryEvent>, String> {
    let mut events = compute_audio_events(path)?;
    for ev in &mut events {
        if ev.kind.starts_with("speech") {
            if let Some(obj) = ev.payload.as_object_mut() {
                obj.insert("wav".to_string(), serde_json::Value::String(path.to_string()));
            }
        }
    }
    Ok(events)
}

/// Pick the audio VAD: the Silero neural VAD when built with `neural-vad` AND a
/// model is configured + present, otherwise the energy VAD (always available).
fn compute_audio_events(path: &str) -> Result<Vec<SensoryEvent>, String> {
    #[cfg(feature = "neural-vad")]
    {
        if let Ok(model) = std::env::var("BUDDY_SENSE_VAD_MODEL") {
            if std::path::Path::new(&model).exists() {
                // Fall through to the energy VAD on any neural error (bad rate,
                // missing onnxruntime, decode failure) — never go deaf.
                match senses::audio::read_wav_mono(path)
                    .and_then(|(samples, rate)| senses::audio::neural::vad_events_neural(&samples, rate, &model))
                {
                    Ok(events) => {
                        eprintln!("[buddy-sense] audio: neural VAD (Silero)");
                        return Ok(events);
                    }
                    Err(e) => eprintln!("[buddy-sense] neural VAD failed ({e}); falling back to energy VAD"),
                }
            }
        }
    }
    senses::audio::wav_events(path, AUDIO_FRAME_MS, AUDIO_THRESHOLD)
}

#[tokio::main]
async fn main() {
    // `buddy-sense stt` → run the in-process STT worker (JSONL on stdin/stdout) and
    // never return. Built only with `--features stt`; a clear error otherwise.
    if std::env::args().skip(1).any(|a| a == "stt") {
        #[cfg(feature = "stt")]
        {
            senses::stt::run_worker();
        }
        #[cfg(not(feature = "stt"))]
        {
            eprintln!("[buddy-sense] `stt` requires building with --features stt");
            std::process::exit(2);
        }
    }

    let url = std::env::var("BUDDY_SENSE_BRIDGE_URL").unwrap_or_else(|_| "ws://127.0.0.1:8129".to_string());
    let wav = std::env::args().skip(1).find(|a| a.ends_with(".wav"));

    // Thalamus → consumers (broadcast). The per-organ sense channels are created below (one per
    // ACTIVE organ, for isolation) and the thalamus is spawned over all of them via run_multi.
    let (bcast_tx, _keep) = broadcast::channel::<SensoryEvent>(128);

    // Which organs (senses) run — chosen at RUNTIME among the ones this binary was COMPILED with.
    // `available` reflects the compiled features; `BUDDY_SENSE_ORGANS` (csv) narrows it (Vital is
    // autonomic and always kept). This is what lets the operator run several organs in parallel
    // without recompiling, and makes the live set visible in the logs.
    // `mut` is used only under the sense features; a default build pushes nothing.
    #[allow(unused_mut)]
    let mut available = vec![Organ::Vital];
    #[cfg(feature = "live-screen")]
    available.push(Organ::Screen);
    #[cfg(feature = "live-vision")]
    available.push(Organ::Vision);
    #[cfg(feature = "live-ui")]
    available.push(Organ::Ui);
    #[cfg(feature = "live-audio")]
    available.push(Organ::LiveAudio);
    let organs = resolve_organs(&available, std::env::var("BUDDY_SENSE_ORGANS").ok().as_deref());
    eprintln!(
        "[buddy-sense] organs live ({}): {}",
        organs.len(),
        organs.iter().map(|o| o.as_str()).collect::<Vec<_>>().join(", ")
    );
    let organ_active = |o: Organ| organs.contains(&o);

    // Bridge to Code Buddy. A shared token (if set) authenticates our frames.
    {
        let rx = bcast_tx.subscribe();
        let token = std::env::var("BUDDY_SENSE_TOKEN").ok().filter(|t| !t.is_empty());
        tokio::spawn(async move { bridge::run_bridge(url, token, rx).await });
    }

    // PER-ORGAN channels → the thalamus. Each active organ gets its OWN bounded channel, so a burst
    // on one organ fills only its queue and never parks another organ's producer (organ isolation:
    // no cross-organ head-of-line blocking). Collected here, merged by the thalamus (run_multi).
    let mut organ_rx: Vec<mpsc::Receiver<SensoryEvent>> = Vec::new();

    // Vital sense — the autonomic heartbeat, ALWAYS on and in PARALLEL with the
    // other senses (like a real heartbeat, independent of sight/hearing).
    let heartbeat_ms = std::env::var("BUDDY_SENSE_HEARTBEAT_MS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(1000);
    // Optional: stop after N beats (a finite burst). None → beats forever.
    let heartbeat_count = std::env::var("BUDDY_SENSE_HEARTBEAT_COUNT")
        .ok()
        .and_then(|s| s.parse::<u64>().ok());
    if organ_active(Organ::Vital) {
        let (tx, rx) = mpsc::channel::<SensoryEvent>(32);
        organ_rx.push(rx);
        tokio::spawn(async move { senses::vital::run(tx, heartbeat_ms, heartbeat_count).await });
    }

    // Screen sense — light event-driven screen-change detection (opt-in build).
    #[cfg(feature = "live-screen")]
    if organ_active(Organ::Screen) {
        let (tx, rx) = mpsc::channel::<SensoryEvent>(32);
        organ_rx.push(rx);
        let screen_ms = std::env::var("BUDDY_SENSE_SCREEN_MS").ok().and_then(|s| s.parse::<u64>().ok()).unwrap_or(1000);
        let screen_threshold = std::env::var("BUDDY_SENSE_SCREEN_THRESHOLD").ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.02);
        eprintln!("[buddy-sense] screen sense active ({screen_ms}ms, threshold {screen_threshold})");
        tokio::spawn(async move { senses::screen::live::run(tx, screen_ms, screen_threshold).await });
    }

    // Camera sense — live webcam motion detection (the robot's eyes), opt-in build.
    #[cfg(feature = "live-vision")]
    if organ_active(Organ::Vision) {
        let (tx, rx) = mpsc::channel::<SensoryEvent>(32);
        organ_rx.push(rx);
        let device = std::env::var("BUDDY_SENSE_CAMERA").unwrap_or_else(|_| "/dev/video0".to_string());
        let cam_ms = std::env::var("BUDDY_SENSE_CAMERA_MS").ok().and_then(|s| s.parse::<u64>().ok()).unwrap_or(1500);
        let cam_threshold = std::env::var("BUDDY_SENSE_CAMERA_THRESHOLD").ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.04);
        eprintln!("[buddy-sense] camera sense active ({device}, {cam_ms}ms, threshold {cam_threshold})");
        tokio::spawn(async move { senses::video::live::run(tx, device, cam_ms, cam_threshold).await });
    }

    // UI sense — semantic accessibility events (active app / focus), opt-in build.
    #[cfg(feature = "live-ui")]
    if organ_active(Organ::Ui) {
        let (tx, rx) = mpsc::channel::<SensoryEvent>(32);
        organ_rx.push(rx);
        eprintln!("[buddy-sense] ui sense active (AT-SPI)");
        tokio::spawn(async move { senses::ui::live::run(tx).await });
    }

    // Live-microphone sense — the robot's real-time ears (opt-in build). Captures
    // the mic continuously via ffmpeg, segments by VAD, decodes each utterance
    // in-process and emits `audio/transcript_final` (text already in the payload).
    // Needs the recognizer .so on the loader path → spawn this binary with
    // LD_LIBRARY_PATH set to its own directory (where the prebuilt .so are copied).
    #[cfg(feature = "live-audio")]
    if organ_active(Organ::LiveAudio) {
        let (tx, rx) = mpsc::channel::<SensoryEvent>(32);
        organ_rx.push(rx);
        let source = std::env::var("BUDDY_SENSE_MIC_SOURCE").unwrap_or_else(|_| "default".to_string());
        let threshold = std::env::var("BUDDY_SENSE_MIC_THRESHOLD").ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(senses::live_audio::DEFAULT_MIC_THRESHOLD);
        let endpoint_ms = std::env::var("BUDDY_SENSE_MIC_ENDPOINT_MS").ok().and_then(|s| s.parse::<u64>().ok()).unwrap_or(senses::live_audio::DEFAULT_MIC_ENDPOINT_MS);
        let adaptive = !matches!(
            std::env::var("BUDDY_SENSE_MIC_ADAPTIVE")
                .unwrap_or_else(|_| "true".to_string())
                .trim()
                .to_lowercase()
                .as_str(),
            "0" | "false" | "off" | "no"
        );
        eprintln!(
            "[buddy-sense] live-audio sense active (pulse:{source}, threshold floor {threshold}, endpoint {endpoint_ms}ms, adaptive {adaptive})"
        );
        tokio::spawn(async move {
            senses::live_audio::run(tx, source, threshold, endpoint_ms, adaptive).await
        });
    }

    // Audio-batch (WAV) source — its own channel too, so it's isolated like a live organ. Option so
    // the None (no-WAV) daemon doesn't create an idle channel.
    let audio_batch_tx = if wav.is_some() {
        let (tx, rx) = mpsc::channel::<SensoryEvent>(32);
        organ_rx.push(rx);
        Some(tx)
    } else {
        None
    };

    // Drive the thalamus over ALL per-organ channels (merged fairly; ingress isolated per organ).
    {
        let thalamus = bus::Thalamus::new(64, 200);
        let tx = bcast_tx.clone();
        tokio::spawn(async move { thalamus.run_multi(organ_rx, tx).await });
    }

    match wav {
        Some(path) => {
            // Audio runs concurrently with the heartbeat — both feed the thalamus (its own channel).
            let audio_tx = audio_batch_tx.expect("audio_batch_tx is Some when wav is Some");
            match audio_events_for(&path) {
                Ok(events) => {
                    eprintln!("[buddy-sense] audio: {} VAD event(s) from {path}", events.len());
                    for ev in events {
                        if audio_tx.send(ev).await.is_err() {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                    }
                }
                Err(e) => eprintln!("[buddy-sense] audio error: {e}"),
            }
            // Keep beating a moment so audio + heartbeat interleave, then flush.
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        }
        None => {
            eprintln!("[buddy-sense] running — vital heartbeat every {heartbeat_ms}ms (pass a .wav for the audio sense). Ctrl-C to stop.");
            std::future::pending::<()>().await;
        }
    }
}
