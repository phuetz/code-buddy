#!/usr/bin/env bash
# Invoke the clone's buddy CLI with GK28 isolation. Never the ~/.local/bin/buddy
# launcher (that points at ~/code-buddy, forbidden).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOME_DIR="${GK28_HOME:-$ROOT/_qa/gk28/home}"
mkdir -p "$HOME_DIR/.codebuddy/sessions" "$HOME_DIR/.codebuddy/runs"
exec env -u GROK_API_KEY -u OPENAI_API_KEY -u ANTHROPIC_API_KEY \
  -u GEMINI_API_KEY -u ELEVENLABS_API_KEY -u XAI_API_KEY \
  -u CODEBUDDY_LLM_EXTRA_HEADERS \
  HOME="$HOME_DIR" \
  CODEBUDDY_PROVIDER=ollama \
  OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}" \
  GROK_MODEL="${GROK_MODEL:-qwen3:4b-instruct}" \
  OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3:4b-instruct}" \
  CODEBUDDY_SESSIONS_DIR="$HOME_DIR/.codebuddy/sessions" \
  CODEBUDDY_RUNS_DIR="$HOME_DIR/.codebuddy/runs" \
  "$ROOT/node_modules/.bin/tsx" "$ROOT/src/index.ts" "$@"
