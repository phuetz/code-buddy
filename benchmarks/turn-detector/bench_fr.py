#!/usr/bin/env python3
"""Deterministic, offline French end-of-turn bench for LiveKit v1-mini + Silero.

The script deliberately never opens an audio device. Pocket TTS writes WAV files,
then the WAV PCM is pushed into LiveKit's in-process CPU VAD/EOT streams.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import statistics
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import scipy.io.wavfile
from scipy.signal import resample_poly


SAMPLE_RATE = 16_000
TTS_SAMPLE_RATE = 24_000
TAIL_MS = 1_200
EOT_MIN_DELAY_MS = 300
EOT_MAX_DELAY_MS = 2_500
VAD_SILENCE_MS = (300, 500, 800)
FRENCH_EOT_THRESHOLD = 0.285
SYNTHESIS_SEED = 20260903


@dataclass(frozen=True)
class Utterance:
    id: str
    text: str
    first: str | None
    second: str | None
    pause_ms: int | None


@dataclass
class AudioCase:
    utterance: Utterance
    pcm: np.ndarray
    first_speech_end_ms: float | None
    speech_end_ms: float
    resume_ms: float | None


@dataclass
class Measurement:
    utterance_id: str
    kind: str
    silence_ms: int
    reference_speech_end_ms: float
    speech_end_ms: float
    resume_ms: float | None
    candidate_ms: float | None
    decision_ms: float | None
    delay_ms: float | None
    false_cut: bool
    vad_inference_ms: float
    eot_probability: float | None
    eot_threshold: float | None
    eot_inference_ms: float | None
    eot_model: str | None


UTTERANCES = (
    Utterance("pause-01", "Je voudrais une grande pizza et une salade.", "Je voudrais une grande pizza", "et une salade.", 900),
    Utterance("pause-02", "Pour demain matin, réserve le train et un taxi.", "Pour demain matin, réserve le train", "et un taxi.", 950),
    Utterance("pause-03", "J'aimerais appeler Paul et lui laisser un message.", "J'aimerais appeler Paul", "et lui laisser un message.", 1000),
    Utterance("pause-04", "Mets la lumière du salon en marche puis baisse le chauffage.", "Mets la lumière du salon en marche", "puis baisse le chauffage.", 1050),
    Utterance("pause-05", "Dans la liste des courses, ajoute du pain et des pommes.", "Dans la liste des courses, ajoute du pain", "et des pommes.", 1100),
    Utterance("pause-06", "Je pense que le rendez-vous est mardi mais vérifie l'adresse.", "Je pense que le rendez-vous est mardi", "mais vérifie l'adresse.", 1150),
    Utterance("pause-07", "Lis-moi le premier paragraphe et arrête-toi ensuite.", "Lis-moi le premier paragraphe", "et arrête-toi ensuite.", 1200),
    Utterance("pause-08", "J'ai besoin d'un café sans sucre avec un verre d'eau.", "J'ai besoin d'un café sans sucre", "avec un verre d'eau.", 1250),
    Utterance("pause-09", "Envoie le dossier à Claire dès que possible et confirme-moi l'envoi.", "Envoie le dossier à Claire dès que possible", "et confirme-moi l'envoi.", 1300),
    Utterance("pause-10", "Rappelle-moi ce soir après le dîner pour parler du projet.", "Rappelle-moi ce soir après le dîner", "pour parler du projet.", 1350),
    Utterance("complete-01", "Lisa, quel temps fera-t-il demain à Lyon ?", None, None, None),
    Utterance("complete-02", "Peux-tu me rappeler de sortir les poubelles ce soir ?", None, None, None),
    Utterance("complete-03", "J'ai terminé la réunion, tu peux préparer le compte rendu.", None, None, None),
    Utterance("complete-04", "Dis-moi simplement si le four est encore allumé.", None, None, None),
    Utterance("complete-05", "Ajoute du lait et des œufs à ma liste de courses.", None, None, None),
    Utterance("complete-06", "Je voudrais écouter une musique calme pendant dix minutes.", None, None, None),
    Utterance("complete-07", "Ouvre le document de travail, s'il te plaît.", None, None, None),
    Utterance("complete-08", "Merci Lisa, c'est exactement la réponse que j'attendais.", None, None, None),
    Utterance("complete-09", "Raconte-moi en deux phrases ce qui est prévu demain.", None, None, None),
    Utterance("complete-10", "Tu peux arrêter l'écoute et attendre ma prochaine demande.", None, None, None),
)


def _trim_speech(audio: np.ndarray) -> np.ndarray:
    """Remove TTS padding while retaining a short edge around voiced samples."""
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    peak = float(np.max(np.abs(audio), initial=0.0))
    if peak <= 0:
        raise ValueError("Pocket TTS returned an empty waveform")
    active = np.flatnonzero(np.abs(audio) >= max(0.005, peak * 0.01))
    if active.size == 0:
        raise ValueError("Pocket TTS waveform has no active samples")
    edge = int(0.02 * TTS_SAMPLE_RATE)
    start = max(0, int(active[0]) - edge)
    end = min(audio.size, int(active[-1]) + edge + 1)
    return audio[start:end]


def _to_int16(audio: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(audio), initial=0.0))
    scaled = audio / max(1.0, peak) * 0.85
    return np.clip(scaled * 32_767, -32_768, 32_767).astype(np.int16)


def _resample_to_16k(audio: np.ndarray) -> np.ndarray:
    converted = resample_poly(audio.astype(np.float32), 2, 3)
    return _to_int16(converted)


def _load_wav(path: Path) -> np.ndarray:
    rate, audio = scipy.io.wavfile.read(path)
    if rate != SAMPLE_RATE:
        raise ValueError(f"{path} is {rate} Hz, expected {SAMPLE_RATE} Hz")
    if audio.ndim != 1 or audio.dtype != np.int16:
        raise ValueError(f"{path} must be mono PCM16")
    return audio


def synthesize(output_dir: Path) -> dict[str, Any]:
    from pocket_tts import TTSModel
    import torch

    output_dir.mkdir(parents=True, exist_ok=True)
    random.seed(SYNTHESIS_SEED)
    np.random.seed(SYNTHESIS_SEED)
    torch.manual_seed(SYNTHESIS_SEED)
    model = TTSModel.load_model(language="french_24l")
    voice_state = model.get_state_for_audio_prompt("estelle")
    manifest: dict[str, Any] = {
        "sample_rate": SAMPLE_RATE,
        "tts_sample_rate": model.sample_rate,
        "voice": "estelle",
        "language": "french_24l",
        "seed": SYNTHESIS_SEED,
        "generated_with": "pocket-tts",
        "utterances": [],
    }

    for utterance in UTTERANCES:
        if utterance.first is not None and utterance.second is not None and utterance.pause_ms is not None:
            # Ellipsis gives Pocket TTS a non-final prosody at the synthetic
            # pause; the manifest still records the exact digital gap.
            first_audio = _trim_speech(model.generate_audio(voice_state, utterance.first + "…").detach().cpu().numpy())
            second_audio = _trim_speech(model.generate_audio(voice_state, utterance.second).detach().cpu().numpy())
            gap = np.zeros(round(model.sample_rate * utterance.pause_ms / 1_000), dtype=np.float32)
            tail = np.zeros(round(model.sample_rate * TAIL_MS / 1_000), dtype=np.float32)
            combined = np.concatenate((first_audio, gap, second_audio, tail))
            first_speech_end_ms = len(first_audio) / model.sample_rate * 1_000
            resume_ms = first_speech_end_ms + utterance.pause_ms
            speech_end_ms = (len(first_audio) + len(gap) + len(second_audio)) / model.sample_rate * 1_000
        else:
            audio = _trim_speech(model.generate_audio(voice_state, utterance.text).detach().cpu().numpy())
            tail = np.zeros(round(model.sample_rate * TAIL_MS / 1_000), dtype=np.float32)
            combined = np.concatenate((audio, tail))
            first_speech_end_ms = None
            resume_ms = None
            speech_end_ms = len(audio) / model.sample_rate * 1_000

        path = output_dir / f"{utterance.id}.wav"
        pcm = _resample_to_16k(combined)
        scipy.io.wavfile.write(path, SAMPLE_RATE, pcm)
        manifest["utterances"].append({
            "id": utterance.id,
            "text": utterance.text,
            "pause_ms": utterance.pause_ms,
            "first_speech_end_ms": round(first_speech_end_ms, 3) if first_speech_end_ms is not None else None,
            "speech_end_ms": round(speech_end_ms, 3),
            "resume_ms": round(resume_ms, 3) if resume_ms is not None else None,
            "wav": path.name,
            "duration_ms": round(len(pcm) / SAMPLE_RATE * 1_000, 3),
        })

    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


def load_cases(output_dir: Path) -> list[AudioCase]:
    manifest = json.loads((output_dir / "manifest.json").read_text())
    by_id = {item["id"]: item for item in manifest["utterances"]}
    cases: list[AudioCase] = []
    for utterance in UTTERANCES:
        item = by_id[utterance.id]
        cases.append(AudioCase(
            utterance=utterance,
            pcm=_load_wav(output_dir / item["wav"]),
            first_speech_end_ms=float(item["first_speech_end_ms"]) if item["first_speech_end_ms"] is not None else None,
            speech_end_ms=float(item["speech_end_ms"]),
            resume_ms=float(item["resume_ms"]) if item["resume_ms"] is not None else None,
        ))
    return cases


def _frame(pcm: np.ndarray, start: int, end: int):
    from livekit import rtc

    chunk = np.ascontiguousarray(pcm[start:end], dtype=np.int16)
    return rtc.AudioFrame(
        data=chunk.tobytes(),
        sample_rate=SAMPLE_RATE,
        num_channels=1,
        samples_per_channel=len(chunk),
    )


async def vad_candidate(pcm: np.ndarray, silence_ms: int, vad: Any) -> tuple[float | None, float]:
    from livekit.agents import vad as agents_vad

    stream = vad.stream()
    events: list[Any] = []
    async def collect() -> None:
        async for event in stream:
            events.append(event)

    collector = asyncio.create_task(collect())
    frame_samples = round(SAMPLE_RATE * 32 / 1_000)
    for start in range(0, len(pcm), frame_samples):
        stream.push_frame(_frame(pcm, start, min(len(pcm), start + frame_samples)))
        await asyncio.sleep(0)
    stream.end_input()
    await collector
    await stream.aclose()
    ends = [event for event in events if event.type == agents_vad.VADEventType.END_OF_SPEECH]
    if not ends:
        return None, sum(float(event.inference_duration) for event in events)
    candidate = ends[0]
    return float(candidate.timestamp * 1_000), sum(float(event.inference_duration) for event in events)


async def eot_probe(pcm: np.ndarray, prefix_ms: float) -> tuple[float, float]:
    from livekit.agents import inference

    detector = inference.TurnDetector(version="v1-mini")
    stream = detector.stream()
    prefix_samples = min(len(pcm), max(1, round(prefix_ms * SAMPLE_RATE / 1_000)))
    frame_samples = round(SAMPLE_RATE * 32 / 1_000)
    for start in range(0, prefix_samples, frame_samples):
        stream.push_audio(_frame(pcm, start, min(prefix_samples, start + frame_samples)))
        await asyncio.sleep(0)

    # The public stream is asynchronous. Wait until its local ring buffer has
    # consumed the pushed prefix, without sleeping for the audio duration.
    transport = getattr(stream, "_transport", None)
    expected_buffer = min(prefix_samples, round(SAMPLE_RATE * 1.2))
    for _ in range(500):
        if transport is None or len(getattr(transport, "_buf", ())) >= expected_buffer:
            break
        await asyncio.sleep(0)

    started = time.perf_counter()
    event = await stream.predict()
    wall_inference_ms = (time.perf_counter() - started) * 1_000
    await stream.aclose()
    return float(event.end_of_turn_probability), float(event.inference_duration or wall_inference_ms / 1_000) * 1_000


async def run_bench(cases: list[AudioCase]) -> list[Measurement]:
    from livekit.plugins import silero

    measurements: list[Measurement] = []
    for silence_ms in VAD_SILENCE_MS:
        vad = silero.VAD.load(
            min_speech_duration=0.05,
            min_silence_duration=silence_ms / 1_000,
            prefix_padding_duration=0.0,
            force_cpu=True,
            sample_rate=SAMPLE_RATE,
        )
        for case in cases:
            candidate_ms, vad_inference_s = await vad_candidate(case.pcm, silence_ms, vad)
            reference_speech_end_ms = case.first_speech_end_ms if case.resume_ms is not None and case.first_speech_end_ms is not None else case.speech_end_ms
            delay_ms = candidate_ms - reference_speech_end_ms if candidate_ms is not None else None
            false_cut = case.resume_ms is not None and candidate_ms is not None and candidate_ms < case.resume_ms
            measurements.append(Measurement(
                utterance_id=case.utterance.id,
                kind="vad-only",
                silence_ms=silence_ms,
                reference_speech_end_ms=reference_speech_end_ms,
                speech_end_ms=case.speech_end_ms,
                resume_ms=case.resume_ms,
                candidate_ms=candidate_ms,
                decision_ms=candidate_ms,
                delay_ms=delay_ms,
                false_cut=false_cut,
                vad_inference_ms=vad_inference_s * 1_000,
                eot_probability=None,
                eot_threshold=None,
                eot_inference_ms=None,
                eot_model=None,
            ))

            if candidate_ms is None:
                measurements.append(Measurement(
                    utterance_id=case.utterance.id,
                    kind="livekit-v1-mini+silero",
                    silence_ms=silence_ms,
                    reference_speech_end_ms=reference_speech_end_ms,
                    speech_end_ms=case.speech_end_ms,
                    resume_ms=case.resume_ms,
                    candidate_ms=None,
                    decision_ms=None,
                    delay_ms=None,
                    false_cut=False,
                    vad_inference_ms=vad_inference_s * 1_000,
                    eot_probability=None,
                    eot_threshold=FRENCH_EOT_THRESHOLD,
                    eot_inference_ms=None,
                    eot_model="turn-detector-v1-mini",
                ))
                continue

            probability, inference_ms = await eot_probe(case.pcm, candidate_ms)
            likely_end = probability >= FRENCH_EOT_THRESHOLD
            endpoint_ms = EOT_MIN_DELAY_MS if likely_end else EOT_MAX_DELAY_MS
            # LiveKit's endpointing delay is measured from the last observed
            # speech, not added to the VAD candidate. If the candidate is in
            # an intra-turn pause, the reference is the first clause; if it is
            # after the resumed clause, it is the final speech end.
            last_speech_end_ms = (
                case.first_speech_end_ms
                if case.resume_ms is not None and candidate_ms < case.resume_ms and case.first_speech_end_ms is not None
                else case.speech_end_ms
            )
            decision_ms = max(candidate_ms + inference_ms, last_speech_end_ms + endpoint_ms)
            delay_ms = decision_ms - reference_speech_end_ms
            false_cut = case.resume_ms is not None and decision_ms < case.resume_ms
            measurements.append(Measurement(
                utterance_id=case.utterance.id,
                kind="livekit-v1-mini+silero",
                silence_ms=silence_ms,
                reference_speech_end_ms=reference_speech_end_ms,
                speech_end_ms=case.speech_end_ms,
                resume_ms=case.resume_ms,
                candidate_ms=candidate_ms,
                decision_ms=decision_ms,
                delay_ms=delay_ms,
                false_cut=false_cut,
                vad_inference_ms=vad_inference_s * 1_000,
                eot_probability=probability,
                eot_threshold=FRENCH_EOT_THRESHOLD,
                eot_inference_ms=inference_ms,
                eot_model="turn-detector-v1-mini",
            ))
    return measurements


def summarize(measurements: list[Measurement]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for kind in ("vad-only", "livekit-v1-mini+silero"):
        for silence_ms in VAD_SILENCE_MS:
            selected = [m for m in measurements if m.kind == kind and m.silence_ms == silence_ms]
            delays = [m.delay_ms for m in selected if m.delay_ms is not None]
            eot_inferences = [m.eot_inference_ms for m in selected if m.eot_inference_ms is not None]
            vad_inferences = [m.vad_inference_ms for m in selected if m.vad_inference_ms is not None]
            rows.append({
                    "kind": kind,
                    "silence_ms": silence_ms,
                "cases": len(selected),
                "false_cuts": sum(1 for m in selected if m.false_cut),
                "false_cut_rate": round(sum(1 for m in selected if m.false_cut) / 10 * 100, 2),
                "median_delay_ms_all": round(statistics.median(delays), 3) if delays else None,
                "median_delay_ms_complete": round(statistics.median([m.delay_ms for m in selected if m.resume_ms is None and m.delay_ms is not None]), 3) if any(m.resume_ms is None and m.delay_ms is not None for m in selected) else None,
                "median_delay_ms_pause": round(statistics.median([m.delay_ms for m in selected if m.resume_ms is not None and m.delay_ms is not None]), 3) if any(m.resume_ms is not None and m.delay_ms is not None for m in selected) else None,
                "median_vad_inference_ms": round(statistics.median(vad_inferences), 3) if vad_inferences else None,
                "median_eot_inference_ms": round(statistics.median(eot_inferences), 3) if eot_inferences else None,
            })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--synthesize", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=Path(".turn-bench-artifacts-2026-09-03"))
    args = parser.parse_args()
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.synthesize or not (args.output_dir / "manifest.json").exists():
        synthesize(args.output_dir)
    cases = load_cases(args.output_dir)
    bench_wall_start = time.perf_counter()
    bench_cpu_start = time.process_time()
    measurements = asyncio.run(run_bench(cases))
    bench_wall_ms = (time.perf_counter() - bench_wall_start) * 1_000
    bench_cpu_ms = (time.process_time() - bench_cpu_start) * 1_000
    (args.output_dir / "measurements.json").write_text(
        json.dumps([asdict(measurement) for measurement in measurements], ensure_ascii=False, indent=2) + "\n"
    )
    summary = summarize(measurements)
    (args.output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    run_meta = {
        "utterances": len(cases),
        "wall_elapsed_ms": round(bench_wall_ms, 3),
        "process_cpu_ms": round(bench_cpu_ms, 3),
        "one_core_cpu_pct": round(bench_cpu_ms / bench_wall_ms * 100, 3) if bench_wall_ms else None,
        "model": "turn-detector-v1-mini",
        "vad": "silero",
        "sample_rate": SAMPLE_RATE,
        "cpu_only": True,
    }
    (args.output_dir / "run-meta.json").write_text(json.dumps(run_meta, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"run": run_meta, "summary": summary, "artifacts": str(args.output_dir)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
