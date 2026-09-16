# Third-party notices — buddy-sense

## Pocket TTS ONNX engine (`--features pocket-tts`)

The Rust inference loop in `src/tts/pocket.rs`, `src/tts/pocket_april.rs`, and
`src/tts/pocket_models.rs` is a minimal port of:

- **buzz-voice** (`crates/buzz-voice/src/{pocket.rs,pocket_april.rs,pocket_models.rs}`), Apache-2.0, Block.
  Copied on 2026-09-03 and adapted for `french_24l` (language check, semicolon
  policy, recommended frames-after-EOS, hound WAV I/O instead of sherpa-onnx
  `Wave`/`LinearResampler`).

That engine runs:

- **Pocket TTS / Mimi** weights by [Kyutai](https://kyutai.org/), **CC-BY-4.0**.
  Upstream: https://huggingface.co/kyutai/pocket-tts (consulted 2026-09-03).
- **ONNX export** [KevinAHM/pocket-tts-onnx](https://huggingface.co/KevinAHM/pocket-tts-onnx)
  revision `58a6d00cf13d239b6748cb0769f35c580a8f606c` (README dated 2026-01-19,
  v2 bundles added ~4 months before 2026-09-03). Model card licence **CC-BY-4.0**;
  export/runtime Python **Apache-2.0**.
- **French reference WAV** `cml-tts/fr/10087_11650_000028-0002.wav` from
  [kyutai/tts-voices](https://huggingface.co/kyutai/tts-voices), selected from
  the [CML-TTS Dataset](https://openslr.org/146/), **CC-BY-4.0**.

The INT8 graphs `flow_lm_main_int8.onnx`, `flow_lm_flow_int8.onnx`, and
`mimi_decoder_int8.onnx` plus FP32 `mimi_encoder.onnx` / `text_conditioner.onnx`
are downloaded by `scripts/fetch-pocket-tts.sh` and are **not** stored in git.

Use of the Kyutai weights must comply with the model card (no non-consensual
voice impersonation, no deception presenting generated speech as a genuine
recording of a real person).
