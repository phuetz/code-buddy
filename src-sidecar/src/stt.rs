//! Local Whisper STT via whisper-rs
//!
//! Dual-model strategy ported from VoiceCommander:
//! - Fast model (base/small) for short audio
//! - Accurate model (large-v3-turbo) for longer audio

use serde::Deserialize;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const SAMPLE_RATE: u32 = 16000;

#[derive(Deserialize)]
struct LoadModelParams {
    path: String,
    slot: Option<String>, // "fast" or "accurate"
}

#[derive(Deserialize)]
struct TranscribeParams {
    /// Base64-encoded WAV audio
    audio_b64: String,
    /// Language code (e.g., "en", "fr", "auto")
    language: Option<String>,
    /// Duration threshold in seconds for model switching
    duration_threshold: Option<f32>,
}

pub struct SttState {
    fast_ctx: Mutex<Option<WhisperContext>>,
    fast_model_name: Mutex<String>,
    accurate_ctx: Mutex<Option<WhisperContext>>,
    accurate_model_name: Mutex<String>,
}

impl SttState {
    pub fn new() -> Self {
        Self {
            fast_ctx: Mutex::new(None),
            fast_model_name: Mutex::new(String::new()),
            accurate_ctx: Mutex::new(None),
            accurate_model_name: Mutex::new(String::new()),
        }
    }

    pub fn load_model(
        &mut self,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let p: LoadModelParams =
            serde_json::from_value(params.clone()).map_err(|e| format!("Invalid params: {}", e))?;

        let path = PathBuf::from(&p.path);
        if !path.exists() {
            return Err(format!("Model file not found: {}", p.path));
        }

        let ctx = WhisperContext::new_with_params(
            path.to_str().unwrap(),
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("Failed to load model: {}", e))?;

        let slot = p.slot.unwrap_or_else(|| {
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if name.contains("base") || name.contains("small") || name.contains("tiny") {
                "fast".into()
            } else {
                "accurate".into()
            }
        });

        let model_name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".into());

        match slot.as_str() {
            "fast" => {
                *self.fast_ctx.lock().unwrap() = Some(ctx);
                *self.fast_model_name.lock().unwrap() = model_name.clone();
            }
            "accurate" | _ => {
                *self.accurate_ctx.lock().unwrap() = Some(ctx);
                *self.accurate_model_name.lock().unwrap() = model_name.clone();
            }
        }

        Ok(serde_json::json!({
            "loaded": model_name,
            "slot": slot,
        }))
    }

    pub fn transcribe(
        &self,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let p: TranscribeParams =
            serde_json::from_value(params.clone()).map_err(|e| format!("Invalid params: {}", e))?;

        // Decode base64 audio
        let audio_bytes = base64_decode(&p.audio_b64)?;
        let pcm = decode_wav_to_pcm(&audio_bytes)?;

        if pcm.is_empty() {
            return Err("No audio data decoded".into());
        }

        // Dual model selection based on duration
        let duration_secs = pcm.len() as f32 / SAMPLE_RATE as f32;
        let threshold = p.duration_threshold.unwrap_or(20.0);
        let use_accurate = duration_secs >= threshold;

        let fast_guard = self.fast_ctx.lock().unwrap();
        let accurate_guard = self.accurate_ctx.lock().unwrap();

        let (ctx, model_used) = if use_accurate {
            let name = self.accurate_model_name.lock().unwrap().clone();
            (
                accurate_guard.as_ref().or(fast_guard.as_ref()),
                if name.is_empty() {
                    self.fast_model_name.lock().unwrap().clone()
                } else {
                    name
                },
            )
        } else {
            let name = self.fast_model_name.lock().unwrap().clone();
            (
                fast_guard.as_ref().or(accurate_guard.as_ref()),
                if name.is_empty() {
                    self.accurate_model_name.lock().unwrap().clone()
                } else {
                    name
                },
            )
        };

        let ctx = ctx.ok_or("No model loaded. Call stt.load_model first.")?;

        // Configure Whisper params
        let mut wparams = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        let lang = p
            .language
            .as_deref()
            .and_then(|l| if l.is_empty() || l == "auto" { None } else { Some(l) });
        wparams.set_language(lang);
        wparams.set_translate(false);
        wparams.set_print_special(false);
        wparams.set_print_progress(false);
        wparams.set_print_realtime(false);
        wparams.set_print_timestamps(false);
        wparams.set_suppress_blank(true);
        wparams.set_suppress_non_speech_tokens(true);
        wparams.set_n_threads(get_n_threads());

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("State error: {}", e))?;

        let start = std::time::Instant::now();

        state
            .full(wparams, &pcm)
            .map_err(|e| format!("Transcription error: {}", e))?;

        let num_segments = state
            .full_n_segments()
            .map_err(|e| format!("Segment error: {}", e))?;

        let mut text = String::new();
        let mut segments = Vec::new();

        for i in 0..num_segments {
            if let Ok(segment_text) = state.full_get_segment_text(i) {
                text.push_str(&segment_text);
                let t0 = state.full_get_segment_t0(i).unwrap_or(0);
                let t1 = state.full_get_segment_t1(i).unwrap_or(0);
                segments.push(serde_json::json!({
                    "text": segment_text.trim(),
                    "start": t0 as f64 / 100.0,
                    "end": t1 as f64 / 100.0,
                }));
            }
        }

        let elapsed_ms = start.elapsed().as_millis();
        let text = text.trim().to_string();

        Ok(serde_json::json!({
            "text": if text.is_empty() { "[No speech detected]" } else { &text },
            "segments": segments,
            "duration_secs": duration_secs,
            "processing_ms": elapsed_ms,
            "model_used": model_used,
            "model_slot": if use_accurate { "accurate" } else { "fast" },
        }))
    }

    pub fn list_models(&self) -> Result<serde_json::Value, String> {
        let fast = self.fast_model_name.lock().unwrap().clone();
        let accurate = self.accurate_model_name.lock().unwrap().clone();
        Ok(serde_json::json!({
            "fast": if fast.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(fast) },
            "accurate": if accurate.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(accurate) },
        }))
    }

    pub fn status(&self) -> Result<serde_json::Value, String> {
        let has_fast = self.fast_ctx.lock().unwrap().is_some();
        let has_accurate = self.accurate_ctx.lock().unwrap().is_some();
        Ok(serde_json::json!({
            "fast_loaded": has_fast,
            "accurate_loaded": has_accurate,
            "ready": has_fast || has_accurate,
        }))
    }
}

fn get_n_threads() -> i32 {
    thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
}

fn decode_wav_to_pcm(wav_data: &[u8]) -> Result<Vec<f32>, String> {
    let cursor = Cursor::new(wav_data);
    let mut reader =
        hound::WavReader::new(cursor).map_err(|e| format!("Failed to read WAV: {}", e))?;
    let spec = reader.spec();

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let max_val = (1 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .filter_map(|s| s.ok())
                .map(|s| s as f32 / max_val)
                .collect()
        }
        hound::SampleFormat::Float => reader.samples::<f32>().filter_map(|s| s.ok()).collect(),
    };

    // Stereo → mono
    if spec.channels == 2 {
        return Ok(samples
            .chunks(2)
            .map(|c| (c[0] + c.get(1).copied().unwrap_or(0.0)) / 2.0)
            .collect());
    }

    Ok(samples)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Simple base64 decoder (no external dependency)
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;

    for &byte in input.as_bytes() {
        let val = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\n' | b'\r' | b' ' => continue,
            _ => return Err(format!("Invalid base64 character: {}", byte as char)),
        };

        buf = (buf << 6) | val as u32;
        bits += 6;

        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }

    // suppress unused variable warning
    let _ = TABLE;

    Ok(output)
}
