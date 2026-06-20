//! Audio sense — light, local. Energy-based VAD over PCM → speech_start/end
//! events. Heavy work (STT) is delegated to Code Buddy. A WAV source makes the
//! whole path verifiable headless; a live microphone is opt-in (`live-mic`).

use crate::event::{Modality, SensoryEvent};

const SPEECH_SALIENCE: u8 = 200; // speech is salient → never coalesced away

fn rms_i16(frame: &[i16]) -> f64 {
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
pub fn vad_events(samples: &[i16], sample_rate: u32, frame_ms: u64, threshold: f64) -> Vec<SensoryEvent> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vad_emits_start_then_end_for_silence_loud_silence() {
        let rate = 16_000u32;
        let frame = (rate / 50) as usize; // 20 ms
        let mut s = Vec::new();
        s.extend(std::iter::repeat(0i16).take(frame * 3)); // silence
        s.extend(std::iter::repeat(12_000i16).take(frame * 3)); // loud
        s.extend(std::iter::repeat(0i16).take(frame * 3)); // silence
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
        let blk = |v: i16, n: usize| std::iter::repeat(v).take(frame * n);
        let mut s = Vec::new();
        s.extend(blk(0, 2)); // silence
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
}
