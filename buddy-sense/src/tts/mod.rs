//! Pocket TTS (ONNX) — opt-in behind `--features pocket-tts`.
//!
//! Ported from `buzz-voice` (Apache-2.0, Block) with attribution in
//! `THIRD-PARTY.md`. The engine reads a KevinAHM `schema_version=2` bundle
//! (Kyutai Pocket TTS, CC-BY-4.0) and emits 24 kHz mono PCM.
//!
//! CLI: `buddy-sense tts --text "…" --out out.wav`

mod pocket;

#[allow(unused_imports)]
pub use pocket::{
    french_24l_model_info, load_text_to_speech, load_voice_style, write_wav_pcm16,
    PocketModelArtifact, PocketModelInfo, PocketTts, VoiceStyle, FRENCH_24L_BUNDLE_ID, SAMPLE_RATE,
};

use std::env;
use std::path::{Path, PathBuf};
use std::process;
use std::time::Instant;

/// Default on-disk layout used by the fetch script and cargo tests.
pub fn default_model_dir() -> PathBuf {
    if let Ok(dir) = env::var("BUDDY_SENSE_POCKET_MODEL_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/pocket-tts/french_24l")
}

pub fn default_voice_path(model_dir: &Path) -> PathBuf {
    if let Ok(path) = env::var("BUDDY_SENSE_POCKET_VOICE") {
        if !path.trim().is_empty() {
            return PathBuf::from(path);
        }
    }
    let french = model_dir.join("reference_fr.wav");
    if french.is_file() {
        french
    } else {
        model_dir.join("reference_sample.wav")
    }
}

#[allow(dead_code)]
fn arg_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    let mut i = 0;
    while i < args.len() {
        if args[i] == flag {
            return args.get(i + 1).map(String::as_str);
        }
        if let Some(rest) = args[i].strip_prefix(&format!("{flag}=")) {
            return Some(rest);
        }
        i += 1;
    }
    None
}

#[allow(dead_code)]
fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

/// `buddy-sense tts --text … --out x.wav` (and optional `--bench`).
#[allow(dead_code)]
pub fn run_cli() -> ! {
    let args: Vec<String> = env::args().skip(1).collect();
    if has_flag(&args, "--help") || has_flag(&args, "-h") {
        eprintln!(
            "buddy-sense tts --text <phrase> --out <file.wav> [--model-dir DIR] [--voice FILE] [--threads N]\n\
             buddy-sense tts --bench [--model-dir DIR] [--voice FILE] [--threads N]"
        );
        process::exit(0);
    }

    let model_dir = arg_value(&args, "--model-dir")
        .map(PathBuf::from)
        .unwrap_or_else(default_model_dir);
    let voice_path = arg_value(&args, "--voice")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_voice_path(&model_dir));
    let threads = arg_value(&args, "--threads")
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|&n| n >= 1)
        .unwrap_or(1);

    if has_flag(&args, "--bench") {
        match run_bench(&model_dir, &voice_path, threads) {
            Ok(()) => process::exit(0),
            Err(err) => {
                eprintln!("[buddy-sense tts] bench failed: {err}");
                process::exit(1);
            }
        }
    }

    let text = arg_value(&args, "--text").unwrap_or("");
    let out = arg_value(&args, "--out").unwrap_or("");
    if text.is_empty() || out.is_empty() {
        eprintln!("buddy-sense tts requires --text and --out (or --bench). See --help.");
        process::exit(2);
    }

    match synth_to_file(text, Path::new(out), &model_dir, &voice_path, threads) {
        Ok(stats) => {
            eprintln!(
                "[buddy-sense tts] wrote {} ({:.2}s audio, first_pcm={:.0}ms, total={:.0}ms, rms={:.4})",
                out, stats.duration_s, stats.first_pcm_ms, stats.total_ms, stats.rms
            );
            process::exit(0);
        }
        Err(err) => {
            eprintln!("[buddy-sense tts] {err}");
            process::exit(1);
        }
    }
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub struct SynthStats {
    pub duration_s: f64,
    pub first_pcm_ms: f64,
    pub total_ms: f64,
    pub rms: f64,
    pub samples: usize,
}

#[allow(dead_code)]
pub fn synth_to_file(
    text: &str,
    out: &Path,
    model_dir: &Path,
    voice_path: &Path,
    threads: usize,
) -> Result<SynthStats, String> {
    let engine = PocketTts::load(model_dir, threads)?;
    let style = load_voice_style(voice_path)?;
    let t0 = Instant::now();
    let mut first_pcm = None;
    let mut samples = Vec::new();
    engine.synth_chunk_streaming(text, &style, 2, &mut |chunk| {
        if first_pcm.is_none() && !chunk.is_empty() {
            first_pcm = Some(t0.elapsed());
        }
        samples.extend_from_slice(&chunk);
        true
    })?;
    let total = t0.elapsed();
    if samples.is_empty() {
        return Err("Pocket TTS produced no PCM".to_string());
    }
    write_wav_pcm16(out, &samples, SAMPLE_RATE)?;
    let rms = rms_f32(&samples);
    Ok(SynthStats {
        duration_s: samples.len() as f64 / f64::from(SAMPLE_RATE),
        first_pcm_ms: first_pcm.unwrap_or(total).as_secs_f64() * 1e3,
        total_ms: total.as_secs_f64() * 1e3,
        rms,
        samples: samples.len(),
    })
}

pub fn rms_f32(samples: &[f32]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
    (sum / samples.len() as f64).sqrt()
}

#[allow(dead_code)]
fn run_bench(model_dir: &Path, voice_path: &Path, threads: usize) -> Result<(), String> {
    let phrases = [
        "Bonjour, je suis là.",
        "Il est l'heure de prendre tes médicaments.",
        "Le café est prêt dans la cuisine.",
        "Rappelle-moi d'appeler Paul demain matin.",
        "Oui, j'ai bien compris ta question.",
    ];
    let engine = PocketTts::load(model_dir, threads)?;
    let style = load_voice_style(voice_path)?;
    println!("phrase\tpass\tfirst_pcm_ms\ttotal_ms\tduration_s\trms");
    for phrase in phrases {
        for pass in 1..=3 {
            let t0 = Instant::now();
            let mut first_pcm = None;
            let mut samples = Vec::new();
            engine.synth_chunk_streaming(phrase, &style, 2, &mut |chunk| {
                if first_pcm.is_none() && !chunk.is_empty() {
                    first_pcm = Some(t0.elapsed());
                }
                samples.extend_from_slice(&chunk);
                true
            })?;
            let total = t0.elapsed();
            let rms = rms_f32(&samples);
            let dur = samples.len() as f64 / f64::from(SAMPLE_RATE);
            println!(
                "{}\t{}\t{:.1}\t{:.1}\t{:.2}\t{:.4}",
                phrase,
                pass,
                first_pcm.unwrap_or(total).as_secs_f64() * 1e3,
                total.as_secs_f64() * 1e3,
                dur,
                rms
            );
        }
    }
    Ok(())
}
