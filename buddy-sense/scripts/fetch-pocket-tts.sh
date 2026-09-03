#!/usr/bin/env bash
# Fetch the KevinAHM french_24l INT8 Pocket TTS bundle into this crate.
# Total ~377 MiB. CC-BY-4.0 (Kyutai / KevinAHM). No Hugging Face cache.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/models/pocket-tts/french_24l"
mkdir -p "$DEST"
REV="58a6d00cf13d239b6748cb0769f35c580a8f606c"
BASE="https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/${REV}/onnx/french_24l"
files="bundle.json bos_before_voice.npy tokenizer.model flow_lm_main_int8.onnx flow_lm_flow_int8.onnx mimi_decoder_int8.onnx mimi_encoder.onnx text_conditioner.onnx"
cd "$DEST"
for f in $files; do
  if [ -f "$f" ]; then
    echo "exists $f ($(stat -c%s "$f") bytes)"
    continue
  fi
  echo "GET $f"
  curl -fL --retry 3 --retry-delay 2 -o "$f.part" "$BASE/$f"
  mv "$f.part" "$f"
done
if [ ! -f reference_fr.wav ]; then
  curl -fL --retry 3 --retry-delay 2 -o reference_fr.wav.part \
    "https://huggingface.co/kyutai/tts-voices/resolve/main/cml-tts/fr/10087_11650_000028-0002.wav"
  mv reference_fr.wav.part reference_fr.wav
fi
if [ ! -f LICENSE ]; then
  curl -fL --retry 3 -o LICENSE \
    "https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/${REV}/onnx/LICENSE" || true
fi
if [ -f SHA256SUMS ]; then
  sha256sum -c SHA256SUMS
fi
echo "OK $DEST ($(du -sh . | cut -f1))"
