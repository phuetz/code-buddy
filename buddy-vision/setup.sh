#!/usr/bin/env bash
# Set up the robot-vision sidecar: Python venv + MediaPipe model + local VLM.
set -e
cd "$(dirname "$0")"

python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r requirements.txt

mkdir -p models
if [ ! -f models/face_landmarker.task ]; then
  curl -sL -o models/face_landmarker.task \
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
fi

if command -v ollama >/dev/null 2>&1; then
  ollama pull "${CODEBUDDY_VISION_MODEL:-moondream}"
else
  echo "[setup] install Ollama + 'ollama pull moondream' for the local VLM context."
fi

echo "[setup] done. Run with a 'buddy server' (CODEBUDDY_SENSORY=true) up:"
echo "  BUDDY_SENSE_TOKEN=<tok> BUDDY_SENSE_CAMERA_INDEX=0 .venv/bin/python watch.py"
