# Voice Realtime Notes

Date: 2026-06-28

## Sources checked

- Faster-whisper: https://github.com/SYSTRAN/faster-whisper
  - CTranslate2-based Whisper implementation; supports CPU int8 and is designed for lower memory / faster local inference than the reference implementation.
- Whisper paper: https://arxiv.org/abs/2212.04356
  - Robust multilingual ASR comes from broad weak supervision; useful for French companion comprehension, but model size directly trades latency for accuracy.
- Silero VAD: https://github.com/snakers4/silero-vad
  - Practical reference point for low-cost real-time VAD; its public docs report sub-millisecond processing for short chunks on CPU.
- ALSA `arecord`: https://manpages.debian.org/testing/alsa-utils/arecord.1.en.html
  - Local capture path supports explicit PCM device selection via ALSA; Code Buddy can list capture devices and prefer webcam/USB microphones.

## Applied in Code Buddy

- `buddy-vision/ear.py` now defaults to `BUDDY_EAR_DEVICE=auto`, parses `arecord -l`, and prefers webcam/USB microphones over monitor/HDMI devices.
- `speech_end` events now carry capture quality (`peakRms`, `avgRms`, VAD thresholds, selected device) and timing (`startedAtMs`, `endedAtMs`, `writeMs`).
- `speech-reaction.ts` records STT, decision, action, and total loop latency in `hearing` percepts.
- In live sensory mode, faster-whisper is kept warm in a persistent worker to avoid reloading `WhisperModel` on every utterance. Disable with `CODEBUDDY_SPEECH_WORKER=false`.
- `companion impulses` now raises:
  - `Reduce voice latency` when STT or full loop timing exceeds the real-time budget.
  - `Improve voice capture` when the utterance signal is too close to the VAD threshold.

## Next technical steps

- Replace energy VAD with Silero or TEN VAD when a lightweight runtime dependency is acceptable.
- Add an optional streaming partial-transcript path so Code Buddy can start planning before end-of-utterance.
- Track rolling p50/p95 voice loop latency in the companion journal.
