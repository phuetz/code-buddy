//! Pocket TTS engine wrapper for buddy-sense.
//!
//! Ported from `buzz-voice` (Apache-2.0, Block). The `english_2026-04` /
//! `french_24l` ONNX bundles use SentencePiece tokenization, a learned voice
//! BOS embedding, recurrent FlowLM state, and stateful Mimi decoding.
//!
//! ## Attribution
//!
//! - Pocket TTS and Mimi: Kyutai, CC-BY-4.0.
//! - ONNX export: KevinAHM/pocket-tts-onnx, CC-BY-4.0 (export scripts Apache-2.0).
//! - Engine: buzz-voice `pocket.rs` / `pocket_april.rs` / `pocket_models.rs`, Apache-2.0.
//! - French reference WAV: CML-TTS via kyutai/tts-voices, CC-BY-4.0.

use std::path::Path;
use std::sync::Mutex;

#[path = "pocket_april.rs"]
mod pocket_april;
#[path = "pocket_models.rs"]
mod pocket_models;

use pocket_april::{prepare_april_prompt, AprilPocketTts};
pub use pocket_models::{
    french_24l_model_info, PocketModelArtifact, PocketModelInfo, FRENCH_24L_BUNDLE_ID,
};

/// Pocket TTS emits 24 kHz mono PCM.
pub const SAMPLE_RATE: u32 = 24_000;

#[allow(dead_code)]
const TTS_NUM_THREADS: usize = 1;

#[allow(dead_code)]
fn tts_num_threads() -> usize {
    std::env::var("BUDDY_SENSE_TTS_THREADS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|&n| n >= 1)
        .unwrap_or(TTS_NUM_THREADS)
}

/// Loaded reference voice samples and their original sample rate.
#[derive(Debug, Clone)]
pub struct VoiceStyle {
    pub(crate) samples: Vec<f32>,
    pub(crate) sample_rate: i32,
}

/// Load a Pocket reference voice WAV from disk (any rate; resampled at synth).
pub fn load_voice_style(path: &Path) -> Result<VoiceStyle, String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| format!("voice path is not valid UTF-8: {}", path.display()))?;
    let mut reader =
        hound::WavReader::open(path_str).map_err(|err| format!("read {}: {err}", path.display()))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let mut mono: Vec<f32> = Vec::new();
    match spec.sample_format {
        hound::SampleFormat::Float => {
            let samples: Vec<f32> = reader
                .samples::<f32>()
                .collect::<Result<_, _>>()
                .map_err(|err| format!("decode {}: {err}", path.display()))?;
            downmix_to_mono(&samples, channels, &mut mono);
        }
        hound::SampleFormat::Int => {
            let max = match spec.bits_per_sample {
                8 => 128.0,
                16 => 32768.0,
                24 => 8388608.0,
                32 => 2147483648.0,
                bits => (1u32 << (bits.saturating_sub(1))) as f32,
            };
            let samples: Vec<f32> = reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max))
                .collect::<Result<_, _>>()
                .map_err(|err| format!("decode {}: {err}", path.display()))?;
            downmix_to_mono(&samples, channels, &mut mono);
        }
    }
    if mono.is_empty() {
        return Err(format!("voice WAV is empty: {}", path.display()));
    }
    Ok(VoiceStyle {
        samples: mono,
        sample_rate: spec.sample_rate as i32,
    })
}

fn downmix_to_mono(samples: &[f32], channels: usize, out: &mut Vec<f32>) {
    if channels <= 1 {
        out.extend_from_slice(samples);
        return;
    }
    out.reserve(samples.len() / channels);
    for frame in samples.chunks(channels) {
        if frame.len() < channels {
            break;
        }
        let sum: f32 = frame.iter().copied().sum();
        out.push(sum / channels as f32);
    }
}

/// Write 24 kHz (or `sample_rate`) mono PCM16 WAV.
pub fn write_wav_pcm16(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|err| format!("create {}: {err}", path.display()))?;
    for &sample in samples {
        let clipped = sample.clamp(-1.0, 1.0);
        let pcm = (clipped * 32767.0).round() as i16;
        writer
            .write_sample(pcm)
            .map_err(|err| format!("write {}: {err}", path.display()))?;
    }
    writer
        .finalize()
        .map_err(|err| format!("finalize {}: {err}", path.display()))?;
    Ok(())
}

/// Resident Pocket TTS engine (INT8 generation graphs).
pub struct PocketTts {
    inner: Mutex<AprilPocketTts>,
}

/// Load the pinned French (or other schema-2) INT8 bundle from `model_dir`.
#[allow(dead_code)]
pub fn load_text_to_speech(model_dir: &str) -> Result<PocketTts, String> {
    PocketTts::load(Path::new(model_dir), tts_num_threads())
}

impl PocketTts {
    pub fn load(model_dir: &Path, num_threads: usize) -> Result<Self, String> {
        let info = french_24l_model_info();
        for artifact in info.artifacts {
            let path = model_dir.join(artifact.filename);
            if !path.is_file() {
                return Err(format!(
                    "incomplete Pocket TTS {} INT8 bundle: missing {}",
                    info.bundle_id,
                    path.display()
                ));
            }
        }
        Ok(PocketTts {
            inner: Mutex::new(AprilPocketTts::load(model_dir, num_threads)?),
        })
    }

    #[allow(dead_code)]
    pub fn split_text_into_chunks(&self, text: &str) -> Result<Vec<String>, String> {
        let engine = self
            .inner
            .lock()
            .map_err(|_| "Pocket TTS engine lock poisoned".to_string())?;
        let Some(prepared) = prepare_april_prompt(text, engine.prompt_policy()) else {
            return Ok(Vec::new());
        };
        engine.split_prompt(&prepared)
    }

    #[allow(dead_code)]
    pub fn synth_chunk(&self, text: &str, style: &VoiceStyle) -> Result<Vec<f32>, String> {
        let mut engine = self
            .inner
            .lock()
            .map_err(|_| "Pocket TTS engine lock poisoned".to_string())?;
        let policy = engine.prompt_policy();
        let Some(prepared) = prepare_april_prompt(text, policy) else {
            return Ok(Vec::new());
        };
        let chunks = engine.split_prompt(&prepared)?;
        let mut samples = Vec::new();
        for chunk in chunks {
            let prepared = prepare_april_prompt(&chunk, policy)
                .ok_or_else(|| "Pocket TTS prompt chunk became empty".to_string())?;
            samples.extend(engine.synth_chunk(&prepared, style)?);
        }
        Ok(samples)
    }

    /// Streaming synthesis. `on_audio` receives PCM deltas (~`emit_frames` × 80 ms).
    /// Returns Ok(false) when the callback cancels.
    pub fn synth_chunk_streaming(
        &self,
        text: &str,
        style: &VoiceStyle,
        emit_frames: usize,
        on_audio: &mut dyn FnMut(Vec<f32>) -> bool,
    ) -> Result<bool, String> {
        let mut engine = self
            .inner
            .lock()
            .map_err(|_| "Pocket TTS engine lock poisoned".to_string())?;
        let policy = engine.prompt_policy();
        let Some(prepared) = prepare_april_prompt(text, policy) else {
            return Ok(true);
        };
        let chunks = engine.split_prompt(&prepared)?;
        for chunk in chunks {
            let prepared = prepare_april_prompt(&chunk, policy)
                .ok_or_else(|| "Pocket TTS prompt chunk became empty".to_string())?;
            if !engine.synth_chunk_streaming(&prepared, style, emit_frames, on_audio)? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

/// Linear resampler used instead of sherpa-onnx's LinearResampler.
pub(crate) fn resample_linear(samples: &[f32], src_hz: i32, dst_hz: i32) -> Vec<f32> {
    if src_hz == dst_hz || samples.is_empty() {
        return samples.to_vec();
    }
    if src_hz <= 0 || dst_hz <= 0 {
        return samples.to_vec();
    }
    let ratio = src_hz as f64 / dst_hz as f64;
    let out_len = ((samples.len() as f64) / ratio).round().max(1.0) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 * ratio;
        let i0 = src.floor() as usize;
        let frac = (src - i0 as f64) as f32;
        let a = samples.get(i0).copied().unwrap_or(0.0);
        let b = samples.get(i0 + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn french_int8_layout_is_complete() {
        let info = french_24l_model_info();
        assert_eq!(info.bundle_id, "french_24l");
        assert_eq!(info.sample_rate, SAMPLE_RATE);
        assert_eq!(info.max_token_per_chunk, 50);
        assert!(info
            .artifacts
            .iter()
            .any(|artifact| artifact.filename == "flow_lm_main_int8.onnx"));
        assert!(!info
            .artifacts
            .iter()
            .any(|artifact| artifact.filename == "flow_lm_main.onnx"));
        assert_eq!(
            info.artifacts
                .iter()
                .map(|artifact| artifact.size_bytes)
                .sum::<u64>(),
            394_054_154
        );
    }

    #[test]
    fn resample_identity_when_rates_match() {
        let samples = vec![0.1, -0.2, 0.3];
        assert_eq!(resample_linear(&samples, 24_000, 24_000), samples);
    }

    #[test]
    fn write_wav_roundtrip_is_non_empty() {
        let dir = std::env::temp_dir().join("buddy-sense-pocket-wav");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("tone.wav");
        let samples: Vec<f32> = (0..2400).map(|i| ((i as f32) * 0.1).sin() * 0.2).collect();
        write_wav_pcm16(&path, &samples, SAMPLE_RATE).expect("write");
        let style = load_voice_style(&path).expect("read back");
        assert_eq!(style.sample_rate, SAMPLE_RATE as i32);
        assert!(!style.samples.is_empty());
        let _ = std::fs::remove_file(&path);
    }

    fn french_bundle_dir() -> std::path::PathBuf {
        if let Ok(dir) = std::env::var("BUDDY_SENSE_POCKET_MODEL_DIR") {
            if !dir.trim().is_empty() {
                return std::path::PathBuf::from(dir);
            }
        }
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/pocket-tts/french_24l")
    }

    #[test]
    fn french_24l_emits_non_silent_pcm_wav() {
        let dir = french_bundle_dir();
        let voice = if dir.join("reference_fr.wav").is_file() {
            dir.join("reference_fr.wav")
        } else {
            dir.join("reference_sample.wav")
        };
        assert!(
            dir.join("flow_lm_main_int8.onnx").is_file(),
            "missing French INT8 bundle at {} — run buddy-sense/scripts/fetch-pocket-tts.sh",
            dir.display()
        );
        let engine = PocketTts::load(&dir, 1).expect("load french_24l");
        let style = load_voice_style(&voice).expect("load French reference voice");
        let mut first_pcm_ms = None;
        let t0 = std::time::Instant::now();
        let mut samples = Vec::new();
        engine
            .synth_chunk_streaming("Bonjour, je suis Lisa.", &style, 2, &mut |chunk| {
                if first_pcm_ms.is_none() && !chunk.is_empty() {
                    first_pcm_ms = Some(t0.elapsed().as_secs_f64() * 1e3);
                }
                samples.extend_from_slice(&chunk);
                true
            })
            .expect("synthesize");
        let total_ms = t0.elapsed().as_secs_f64() * 1e3;
        assert!(!samples.is_empty(), "WAV/PCM must be non-empty");
        assert!(samples.iter().all(|s| s.is_finite()));
        let duration = samples.len() as f64 / f64::from(SAMPLE_RATE);
        assert!(
            duration >= 0.4 && duration <= 8.0,
            "duration {duration:.2}s is not coherent for a short greeting"
        );
        let rms = crate::tts::rms_f32(&samples);
        assert!(rms > 0.01, "RMS {rms} must be > 0.01");
        let out = dir.join("_gk5-test.wav");
        write_wav_pcm16(&out, &samples, SAMPLE_RATE).expect("write test wav");
        let meta = std::fs::metadata(&out).expect("stat test wav");
        assert!(meta.len() > 44, "WAV file must contain a header plus PCM");
        eprintln!(
            "french_24l: samples={} duration={:.2}s rms={:.4} first_pcm={:.0}ms total={:.0}ms wav={}",
            samples.len(),
            duration,
            rms,
            first_pcm_ms.unwrap_or(total_ms),
            total_ms,
            meta.len()
        );
    }
}
