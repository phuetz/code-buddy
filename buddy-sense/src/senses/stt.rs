//! STT engine — in-process offline speech recognition (sherpa-rs / sherpa-onnx).
//! Opt-in behind the `stt` feature. Replaces the out-of-process python whisper /
//! parakeet workers: loads the NeMo Parakeet-TDT offline transducer ONCE and
//! decodes a whole utterance in ~120 ms (RTF ~0.03 on CPU), so there is no
//! per-utterance process spawn, no disk round-trip, and no python on the hot path.
//!
//! Two entry points:
//!   - `transcribe_wav` — decode a single WAV file (used by the cargo test).
//!   - `run_worker`     — a persistent JSONL worker on stdin/stdout, mirroring the
//!     existing TS `FasterWhisperWorker` protocol exactly so the TS side is a drop-in
//!     swap: emit `{"ready":true}` once loaded, then read `{"id","wav"}` lines and
//!     answer `{"id","text"}` (or `{"id","error"}`) per request.

use crate::senses::audio::read_wav_mono;
use sherpa_rs::transducer::{TransducerConfig, TransducerRecognizer};
use std::io::Write;

/// Default location of the Parakeet model (overridable via `BUDDY_SENSE_STT_MODEL_DIR`).
const DEFAULT_MODEL_SUBDIR: &str = ".codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";

/// The model's feature dimension (from the encoder's ONNX metadata `feat_dim=128`).
const FEATURE_DIM: i32 = 128;

pub fn resolve_model_dir() -> String {
    if let Ok(dir) = std::env::var("BUDDY_SENSE_STT_MODEL_DIR") {
        if !dir.trim().is_empty() {
            return dir;
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    format!("{home}/{DEFAULT_MODEL_SUBDIR}")
}

fn num_threads() -> i32 {
    std::env::var("BUDDY_SENSE_STT_THREADS")
        .ok()
        .and_then(|s| s.parse::<i32>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(4)
}

/// A loaded recognizer. Hold one for the lifetime of the worker (load is ~1–2 s).
pub struct Stt {
    rec: TransducerRecognizer,
}

impl Stt {
    /// Load the offline transducer from a sherpa-onnx model directory.
    pub fn load(model_dir: &str) -> Result<Self, String> {
        let f = |name: &str| format!("{model_dir}/{name}");
        for name in [
            "encoder.int8.onnx",
            "decoder.int8.onnx",
            "joiner.int8.onnx",
            "tokens.txt",
        ] {
            if !std::path::Path::new(&f(name)).exists() {
                return Err(format!("model file missing: {}", f(name)));
            }
        }
        let rec = TransducerRecognizer::new(TransducerConfig {
            encoder: f("encoder.int8.onnx"),
            decoder: f("decoder.int8.onnx"),
            joiner: f("joiner.int8.onnx"),
            tokens: f("tokens.txt"),
            model_type: "nemo_transducer".into(),
            num_threads: num_threads(),
            sample_rate: 16_000,
            feature_dim: FEATURE_DIM,
            decoding_method: "greedy_search".into(),
            ..Default::default()
        })
        .map_err(|e| format!("create recognizer: {e}"))?;
        Ok(Self { rec })
    }

    /// Decode an in-memory mono i16 buffer at `sample_rate` (sherpa resamples to 16 kHz).
    pub fn transcribe_pcm(&mut self, sample_rate: u32, samples: &[i16]) -> String {
        let f32s: Vec<f32> = samples.iter().map(|&s| s as f32 / 32768.0).collect();
        self.rec.transcribe(sample_rate, &f32s).trim().to_string()
    }

    /// Decode a WAV file path (downmixed to mono via the audio sense's reader).
    pub fn transcribe_wav(&mut self, path: &str) -> Result<String, String> {
        let (samples, rate) = read_wav_mono(path)?;
        Ok(self.transcribe_pcm(rate, &samples))
    }
}

/// One-shot helper for tests / CLI: load + decode a single WAV.
#[allow(dead_code)] // used by tests + available as a library helper
pub fn transcribe_wav(model_dir: &str, wav: &str) -> Result<String, String> {
    Stt::load(model_dir)?.transcribe_wav(wav)
}

/// Persistent JSONL worker on stdin/stdout. Protocol mirrors the TS STT worker:
///   stdout: `{"ready":true}` once, then `{"id":"…","text":"…"}` per request.
///   stdin : one JSON object per line, `{"id":"…","wav":"/abs/path.wav"}`.
/// sherpa's own diagnostics go to stderr, so stdout stays a clean JSONL channel.
pub fn run_worker() -> ! {
    let model_dir = resolve_model_dir();
    let mut stt = match Stt::load(&model_dir) {
        Ok(s) => s,
        Err(e) => {
            // Emit a structured fatal line then exit non-zero so the TS side's
            // `readySettled === false` path rejects the ready promise loudly.
            let _ = writeln!(std::io::stdout(), "{}", serde_json::json!({ "error": e }));
            eprintln!("[buddy-sense stt] fatal: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("[buddy-sense stt] model loaded from {model_dir}");
    emit(&serde_json::json!({ "ready": true }));

    let stdin = std::io::stdin();
    let mut line = String::new();
    loop {
        line.clear();
        match stdin.read_line(&mut line) {
            Ok(0) => break, // EOF — parent closed stdin
            Ok(_) => {}
            Err(e) => {
                eprintln!("[buddy-sense stt] stdin error: {e}");
                break;
            }
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[buddy-sense stt] invalid JSON request: {e}");
                continue;
            }
        };
        let id = req
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let wav = req.get("wav").and_then(|v| v.as_str()).unwrap_or("");
        if wav.is_empty() {
            emit(&serde_json::json!({ "id": id, "error": "missing wav" }));
            continue;
        }
        match stt.transcribe_wav(wav) {
            Ok(text) => emit(&serde_json::json!({ "id": id, "text": text })),
            Err(e) => emit(&serde_json::json!({ "id": id, "error": e })),
        }
    }
    std::process::exit(0);
}

fn emit(value: &serde_json::Value) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real offline decode of the model's bundled French sample. Self-skips unless
    // the model is present (so the default `cargo test` isn't environment-coupled);
    // run with the model on disk to exercise the real sherpa-onnx path.
    #[test]
    fn decodes_bundled_french_sample() {
        let dir = resolve_model_dir();
        let wav = format!("{dir}/test_wavs/fr.wav");
        if !std::path::Path::new(&wav).exists() {
            eprintln!("skip: model/sample absent at {wav}");
            return;
        }
        let text = transcribe_wav(&dir, &wav).expect("decode fr.wav");
        eprintln!("decoded: {text}");
        let lower = text.to_lowercase();
        assert!(
            lower.contains("pays") && lower.contains("demand"),
            "expected the JFK French line, got: {text}"
        );
    }
}
