# Pocket TTS ONNX bundles

Opt-in local TTS for `buddy-sense tts` (`--features pocket-tts`).

## `french_24l` INT8 (KevinAHM/pocket-tts-onnx @ `58a6d00`)

- **Where:** `french_24l/`
- **Size:** ~377 MiB on disk (INT8 generation graphs + FP32 encoder/conditioner)
- **Licence:** model weights CC-BY-4.0 (Kyutai Pocket TTS); ONNX export scripts Apache-2.0 (KevinAHM); French reference WAV CC-BY-4.0 (CML-TTS via kyutai/tts-voices)
- **Fetch:** `bash scripts/fetch-pocket-tts.sh` then `sha256sum -c models/pocket-tts/french_24l/SHA256SUMS`
- The `.onnx` graphs are gitignored. Metadata (`bundle.json`, tokenizer, BOS, SHA256SUMS, LICENSE, reference WAV) can be committed.

There is no 6-layer French checkpoint upstream. The 24-layer pack is the only official French Pocket TTS model.

## Run

```bash
cargo run --features pocket-tts -- tts --text "Bonjour, je suis Lisa." --out /tmp/lisa.wav
```
