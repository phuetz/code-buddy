#!/usr/bin/env bash
# GK4 — produce a 9:16 short with local Ollama + Piper, never touching
# ~/.codebuddy, paid APIs, DISPLAY=:10, or the original repo.
set -euo pipefail
ROOT=/home/patrice/DEV/cb-never-slash-2026-09-02
cd "$ROOT"
GK4_HOME="$ROOT/_qa/gk4/home"
VOICE="$ROOT/_qa/gk4/voices/fr_FR-siwis-medium.onnx"
CHROME=/home/patrice/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
LOG="$ROOT/_qa/gk4/logs/from-prompt.log"
mkdir -p "$GK4_HOME" "$ROOT/_qa/gk4/logs"

# Strip inherited paid keys and the forbidden display.
env -u DISPLAY -u GROK_API_KEY -u OPENAI_API_KEY -u ANTHROPIC_API_KEY \
  -u GEMINI_API_KEY -u ELEVENLABS_API_KEY -u XAI_API_KEY \
  HOME="$GK4_HOME" \
  CODEBUDDY_PROVIDER=ollama \
  OLLAMA_HOST=127.0.0.1:11434 \
  GROK_MODEL=qwen3.8:27b \
  OLLAMA_MODEL=qwen3.8:27b \
  CODEBUDDY_TTS_VOICE="$VOICE" \
  CODEBUDDY_TTS_ENGINE=piper \
  CODEBUDDY_CHROMIUM_PATH="$CHROME" \
  LOG_LEVEL=info \
  "$ROOT/node_modules/.bin/tsx" src/index.ts film from-prompt \
    "Pourquoi un robot compagnon doit se taire la nuit" \
    --short \
    --model qwen3.8:27b \
    --name gk4-nuit \
  >"$LOG" 2>&1
status=$?
echo "EXIT:$status" >>"$LOG"
exit "$status"
