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
mod senses;

use tokio::sync::{broadcast, mpsc};

use event::SensoryEvent;

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
    let url = std::env::var("BUDDY_SENSE_BRIDGE_URL").unwrap_or_else(|_| "ws://127.0.0.1:8129".to_string());
    let wav = std::env::args().skip(1).find(|a| a.ends_with(".wav"));

    // Sense → thalamus (bounded = backpressure). Thalamus → consumers (broadcast).
    let (sense_tx, sense_rx) = mpsc::channel::<SensoryEvent>(32);
    let (bcast_tx, _keep) = broadcast::channel::<SensoryEvent>(128);

    let thalamus = bus::Thalamus::new(64, 200);
    {
        let tx = bcast_tx.clone();
        tokio::spawn(async move { thalamus.run(sense_rx, tx).await });
    }

    // Bridge to Code Buddy. A shared token (if set) authenticates our frames.
    {
        let rx = bcast_tx.subscribe();
        let token = std::env::var("BUDDY_SENSE_TOKEN").ok().filter(|t| !t.is_empty());
        tokio::spawn(async move { bridge::run_bridge(url, token, rx).await });
    }

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
    {
        let tx = sense_tx.clone();
        tokio::spawn(async move { senses::vital::run(tx, heartbeat_ms, heartbeat_count).await });
    }

    // Screen sense — light event-driven screen-change detection (opt-in build).
    #[cfg(feature = "live-screen")]
    {
        let tx = sense_tx.clone();
        let screen_ms = std::env::var("BUDDY_SENSE_SCREEN_MS").ok().and_then(|s| s.parse::<u64>().ok()).unwrap_or(1000);
        let screen_threshold = std::env::var("BUDDY_SENSE_SCREEN_THRESHOLD").ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.02);
        eprintln!("[buddy-sense] screen sense active ({screen_ms}ms, threshold {screen_threshold})");
        tokio::spawn(async move { senses::screen::live::run(tx, screen_ms, screen_threshold).await });
    }

    // Camera sense — live webcam motion detection (the robot's eyes), opt-in build.
    #[cfg(feature = "live-vision")]
    {
        let tx = sense_tx.clone();
        let device = std::env::var("BUDDY_SENSE_CAMERA").unwrap_or_else(|_| "/dev/video0".to_string());
        let cam_ms = std::env::var("BUDDY_SENSE_CAMERA_MS").ok().and_then(|s| s.parse::<u64>().ok()).unwrap_or(1500);
        let cam_threshold = std::env::var("BUDDY_SENSE_CAMERA_THRESHOLD").ok().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.04);
        eprintln!("[buddy-sense] camera sense active ({device}, {cam_ms}ms, threshold {cam_threshold})");
        tokio::spawn(async move { senses::video::live::run(tx, device, cam_ms, cam_threshold).await });
    }

    // UI sense — semantic accessibility events (active app / focus), opt-in build.
    #[cfg(feature = "live-ui")]
    {
        let tx = sense_tx.clone();
        eprintln!("[buddy-sense] ui sense active (AT-SPI)");
        tokio::spawn(async move { senses::ui::live::run(tx).await });
    }

    match wav {
        Some(path) => {
            // Audio runs concurrently with the heartbeat — both feed the thalamus.
            match audio_events_for(&path) {
                Ok(events) => {
                    eprintln!("[buddy-sense] audio: {} VAD event(s) from {path}", events.len());
                    for ev in events {
                        if sense_tx.send(ev).await.is_err() {
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
