//! Audio sense — light, local. Energy-based VAD over PCM → speech_start/end
//! events (or the Silero neural VAD behind `neural-vad`). Heavy work (STT) is
//! delegated to Code Buddy. Input is a WAV file (verifiable headless); there is
//! no live-microphone capture path yet.

use crate::event::{Modality, SensoryEvent};

const SPEECH_SALIENCE: u8 = 200; // speech is salient → never coalesced away

pub(crate) fn rms_i16(frame: &[i16]) -> f64 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum: f64 = frame
        .iter()
        .map(|&s| {
            let x = s as f64 / 32768.0;
            x * x
        })
        .sum();
    (sum / frame.len() as f64).sqrt()
}

/// Pure VAD: split samples into frames, RMS threshold with hysteresis, emit
/// speech_start / speech_end events with frame-accurate timestamps.
pub fn vad_events(
    samples: &[i16],
    sample_rate: u32,
    frame_ms: u64,
    threshold: f64,
) -> Vec<SensoryEvent> {
    let frame_len = ((sample_rate as u64 * frame_ms) / 1000) as usize;
    if frame_len == 0 {
        return vec![];
    }
    let mut out = Vec::new();
    let mut speaking = false;
    let mut ts: u64 = 0;
    // Hysteresis: enter speech at `threshold`, leave only when RMS drops below a
    // lower bound — stops chattering start/end on a signal hovering at threshold.
    let t_low = threshold * 0.6;
    for frame in samples.chunks(frame_len) {
        let rms = rms_i16(frame);
        if !speaking && rms >= threshold {
            speaking = true;
            out.push(SensoryEvent {
                modality: Modality::Audio,
                kind: "speech_start".into(),
                ts_ms: ts,
                salience: SPEECH_SALIENCE,
                payload: serde_json::json!({ "rms": rms }),
            });
        } else if speaking && rms < t_low {
            speaking = false;
            out.push(SensoryEvent {
                modality: Modality::Audio,
                kind: "speech_end".into(),
                ts_ms: ts,
                salience: SPEECH_SALIENCE,
                payload: serde_json::json!({ "rms": rms }),
            });
        }
        ts += frame_ms;
    }
    if speaking {
        out.push(SensoryEvent {
            modality: Modality::Audio,
            kind: "speech_end".into(),
            ts_ms: ts,
            salience: SPEECH_SALIENCE,
            payload: serde_json::json!({ "rms": 0.0 }),
        });
    }
    out
}

/// Read a mono/multi-channel WAV as i16 samples (downmix to mono) + its rate.
pub fn read_wav_mono(path: &str) -> Result<(Vec<i16>, u32), String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    // Surface decode errors instead of silently turning an unsupported format
    // into all-zeros ("no speech"). 16-bit int + float cover the common cases.
    let raw: Vec<i16> = match spec.sample_format {
        hound::SampleFormat::Int if spec.bits_per_sample == 16 => reader
            .samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|s| (s * 32767.0) as i16)
            .collect(),
        _ => {
            return Err(format!(
                "unsupported WAV format: {:?} {}-bit (supported: 16-bit int, float)",
                spec.sample_format, spec.bits_per_sample
            ))
        }
    };
    let mono: Vec<i16> = if channels <= 1 {
        raw
    } else {
        raw.chunks(channels)
            .map(|c| (c.iter().map(|&s| s as i32).sum::<i32>() / channels as i32) as i16)
            .collect()
    };
    Ok((mono, spec.sample_rate))
}

/// Convenience: VAD events straight from a WAV file (the headless test path).
pub fn wav_events(path: &str, frame_ms: u64, threshold: f64) -> Result<Vec<SensoryEvent>, String> {
    let (samples, rate) = read_wav_mono(path)?;
    Ok(vad_events(&samples, rate, frame_ms, threshold))
}

/// Neural VAD (Silero via ONNX Runtime) — a higher-accuracy alternative to the
/// energy VAD, opt-in behind `neural-vad`. Needs the Silero `.onnx` model and
/// onnxruntime (loaded dynamically; ORT_DYLIB_PATH). The energy `vad_events`
/// stays the default fallback when this feature/model is absent.
#[cfg(feature = "neural-vad")]
pub mod neural {
    use super::{Modality, SensoryEvent, SPEECH_SALIENCE};
    use vad_rs::{Vad, VadStatus};

    const CHUNK: usize = 1600; // 100 ms @ 16 kHz (Silero window)
    const FRAME_MS: u64 = 100;

    /// Speech_start/end events from 16 kHz mono PCM using Silero VAD.
    pub fn vad_events_neural(
        samples: &[i16],
        sample_rate: u32,
        model_path: &str,
    ) -> Result<Vec<SensoryEvent>, String> {
        if sample_rate != 16_000 {
            return Err(format!(
                "neural VAD requires 16 kHz mono (got {sample_rate})"
            ));
        }
        let mut vad = Vad::new(model_path, 16_000).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        let mut speaking = false;
        let mut ts: u64 = 0;
        for block in samples.chunks(CHUNK) {
            let f: Vec<f32> = block.iter().map(|&s| s as f32 / 32768.0).collect();
            if let Ok(mut r) = vad.compute(&f) {
                match r.status() {
                    VadStatus::Speech if !speaking => {
                        speaking = true;
                        out.push(event("speech_start", ts, r.prob));
                    }
                    VadStatus::Silence if speaking => {
                        speaking = false;
                        out.push(event("speech_end", ts, r.prob));
                    }
                    _ => {}
                }
            }
            ts += FRAME_MS;
        }
        if speaking {
            out.push(event("speech_end", ts, 0.0));
        }
        Ok(out)
    }

    fn event(kind: &str, ts_ms: u64, prob: f32) -> SensoryEvent {
        SensoryEvent {
            modality: Modality::Audio,
            kind: kind.to_string(),
            ts_ms,
            salience: SPEECH_SALIENCE,
            payload: serde_json::json!({ "prob": prob }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vad_emits_start_then_end_for_silence_loud_silence() {
        let rate = 16_000u32;
        let frame = (rate / 50) as usize; // 20 ms
        let mut s: Vec<i16> = vec![0i16; frame * 3]; // silence
        s.resize(frame * 6, 12_000); // loud
        s.resize(frame * 9, 0); // silence
        let evs = vad_events(&s, rate, 20, 0.05);
        let kinds: Vec<&str> = evs.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, vec!["speech_start", "speech_end"]);
        assert!(evs[0].ts_ms < evs[1].ts_ms);
        assert_eq!(evs[0].salience, SPEECH_SALIENCE);
    }

    #[test]
    fn pure_silence_emits_nothing() {
        let evs = vad_events(&vec![0i16; 16_000], 16_000, 20, 0.05);
        assert!(evs.is_empty());
    }

    #[test]
    fn hysteresis_prevents_chatter_around_threshold() {
        let rate = 16_000u32;
        let frame = (rate / 50) as usize; // 20 ms
        let blk = |v: i16, n: usize| vec![v; frame * n];
        let mut s = blk(0, 2); // silence
        for _ in 0..3 {
            s.extend(blk(3932, 1)); // rms ~0.12 — above threshold 0.1
            s.extend(blk(2621, 1)); // rms ~0.08 — below threshold but above t_low (0.06)
        }
        s.extend(blk(0, 2)); // silence
        let evs = vad_events(&s, rate, 20, 0.1);
        let kinds: Vec<&str> = evs.iter().map(|e| e.kind.as_str()).collect();
        // One start, one end — NOT a start/end on every dip (the chatter bug).
        assert_eq!(kinds, vec!["speech_start", "speech_end"]);
    }

    fn write_wav(
        path: &std::path::Path,
        channels: u16,
        bits: u16,
        fmt: hound::SampleFormat,
        samples: &[i32],
    ) {
        let spec = hound::WavSpec {
            channels,
            sample_rate: 16_000,
            bits_per_sample: bits,
            sample_format: fmt,
        };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for &s in samples {
            w.write_sample(s).unwrap();
        }
        w.finalize().unwrap();
    }

    #[test]
    fn read_wav_mono_decodes_16bit_and_downmixes_stereo() {
        let dir = std::env::temp_dir();
        let mono = dir.join("bs_test_mono.wav");
        write_wav(&mono, 1, 16, hound::SampleFormat::Int, &[100, -200, 300]);
        let (samples, rate) = read_wav_mono(mono.to_str().unwrap()).unwrap();
        assert_eq!(rate, 16_000);
        assert_eq!(samples, vec![100, -200, 300]);
        std::fs::remove_file(&mono).ok();

        let stereo = dir.join("bs_test_stereo.wav");
        write_wav(
            &stereo,
            2,
            16,
            hound::SampleFormat::Int,
            &[100, 200, -100, 100],
        ); // L,R interleaved
        let (mono_samples, _) = read_wav_mono(stereo.to_str().unwrap()).unwrap();
        assert_eq!(mono_samples, vec![150, 0]); // downmixed to mono (averaged)
        std::fs::remove_file(&stereo).ok();
    }

    #[test]
    fn read_wav_mono_errors_on_unsupported_depth_rather_than_silence() {
        let dir = std::env::temp_dir();
        let p = dir.join("bs_test_24bit.wav");
        write_wav(&p, 1, 24, hound::SampleFormat::Int, &[1000, -2000, 3000]);
        // The "never go deaf" arm: an unsupported depth must error, not decode to zeros.
        assert!(read_wav_mono(p.to_str().unwrap()).is_err());
        std::fs::remove_file(&p).ok();
    }

    // Real Silero VAD on a real speech WAV. Needs onnxruntime (ORT_DYLIB_PATH) +
    // the model + a 16 kHz speech WAV — set the two env vars to run it; otherwise
    // it self-skips (so the default test run isn't environment-coupled).
    #[cfg(feature = "neural-vad")]
    #[test]
    fn neural_vad_detects_speech_in_a_real_wav() {
        let (Some(wav), Some(model)) = (
            std::env::var("BUDDY_SENSE_VAD_TEST_WAV").ok(),
            std::env::var("BUDDY_SENSE_VAD_MODEL").ok(),
        ) else {
            eprintln!("skip: set BUDDY_SENSE_VAD_TEST_WAV + BUDDY_SENSE_VAD_MODEL");
            return;
        };
        let (samples, rate) = read_wav_mono(&wav).unwrap();
        let evs = neural::vad_events_neural(&samples, rate, &model).unwrap();
        eprintln!("neural VAD → {} event(s)", evs.len());
        assert!(
            evs.iter().any(|e| e.kind == "speech_start"),
            "expected speech in a real speech WAV"
        );
    }
}
