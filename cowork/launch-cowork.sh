#!/usr/bin/env bash
#
# launch-cowork.sh — lance l'app desktop Cowork sur Linux (loop dev léger,
# d'après cowork/DEV-LINUX.md). Compile via `vite build` si besoin puis démarre
# Electron avec les bons flags (--no-sandbox --disable-gpu).
#
# Usage :
#   xvfb-run -a ./launch-cowork.sh     # affichage X isolé, build si nécessaire
#   ./launch-cowork.sh --bg            # lance en arrière-plan (nohup + log)
#   ./launch-cowork.sh --fresh         # tue l'instance en cours d'abord
#   ./launch-cowork.sh --build         # force un vite build même si dist-electron existe
#   ./launch-cowork.sh --cdp           # active le remote-debugging (port 9222)
#   ./launch-cowork.sh --dev           # mode dev live (vite + electron, rechargement à chaud)
#   ./launch-cowork.sh --rebuild-native# recompile better-sqlite3 pour l'ABI Electron
#   ./launch-cowork.sh --display DISPLAY # serveur X explicite (sinon $DISPLAY ou :0)
#   ./launch-cowork.sh --dry-run       # montre ce qui serait fait, sans lancer
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COWORK_DIR="$SCRIPT_DIR"
ROOT_DIR="$(cd "$COWORK_DIR/.." && pwd)"
ELECTRON="$COWORK_DIR/node_modules/electron/dist/electron"
MAIN="$COWORK_DIR/dist-electron/main/index.js"
LOG="$COWORK_DIR/cowork.log"

DISPLAY_ARG="${DISPLAY:-:0}"
CDP=0 ; CDP_PORT=9222 ; FRESH=0 ; FORCE_BUILD=0 ; DEV=0 ; REBUILD_NATIVE=0 ; BG=0 ; DRY=0

usage() {
  sed -n '/^# Usage :/,/^#$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --bg) BG=1 ;;
    --fresh) FRESH=1 ;;
    --build) FORCE_BUILD=1 ;;
    --cdp) CDP=1 ;;
    --cdp-port) shift; CDP_PORT="${1:?--cdp-port requiert une valeur}" ;;
    --dev) DEV=1 ;;
    --rebuild-native) REBUILD_NATIVE=1 ;;
    --display) shift; DISPLAY_ARG="${1:?--display requiert une valeur}" ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "option inconnue : $1" >&2; usage; exit 1 ;;
  esac
  shift
done

log() { printf '→ %s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then echo "   [dry-run] $*"; else eval "$*"; fi; }

# --- Env du panneau Video Studio (voix Piper + diagrammes Mermaid) ---
# Respecte les variables déjà définies ; sinon auto-détecte des assets locaux,
# puis les EXPORTE pour qu'Electron (donc le panneau) en hérite.
if [ -z "${CODEBUDDY_TTS_VOICE:-}" ]; then
  for v in "$HOME/DEV/ai-stack/voice/voices/fr_FR-siwis-medium.onnx" \
           "$HOME/DEV/lisa/voices/fr_FR-siwis-medium.onnx"; do
    [ -f "$v" ] && { export CODEBUDDY_TTS_VOICE="$v"; break; }
  done
fi
if [ -z "${CODEBUDDY_CHROMIUM_PATH:-}" ]; then
  chrome_cand=$(ls -1d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)
  [ -n "$chrome_cand" ] && export CODEBUDDY_CHROMIUM_PATH="$chrome_cand"
fi
[ -n "${CODEBUDDY_TTS_VOICE:-}" ] && log "voix Piper : $(basename "$CODEBUDDY_TTS_VOICE")" \
  || log "voix Piper : (non trouvée → vidéos sans narration)"
[ -n "${CODEBUDDY_CHROMIUM_PATH:-}" ] && log "diagrammes : chromium détecté" \
  || log "diagrammes : (chromium non trouvé → carte texte)"

# --- Pré-requis ---
if [ ! -x "$ELECTRON" ]; then
  echo "Electron introuvable ($ELECTRON)." >&2
  echo "Installez d'abord les deps :  (cd \"$COWORK_DIR\" && npm install)" >&2
  exit 1
fi

# --- Relance propre : tuer l'instance en cours ---
# On cible les process dont la ligne de commande contient le CHEMIN ABSOLU de
# notre main (pas un motif large), et on exclut ce script + son parent : ainsi
# un `pkill` ne peut pas se tuer lui-même ni frapper une autre app Electron.
if [ "$FRESH" = 1 ]; then
  killed=0
  for pid in $(pgrep -f "$MAIN" 2>/dev/null || true); do
    [ "$pid" = "$$" ] && continue
    [ "$pid" = "$PPID" ] && continue
    kill "$pid" 2>/dev/null && killed=1 || true
  done
  if [ "$killed" = 1 ]; then log "instance précédente arrêtée"; sleep 1; else log "aucune instance à arrêter"; fi
fi

# --- Recompiler les modules natifs pour l'ABI d'Electron (optionnel) ---
if [ "$REBUILD_NATIVE" = 1 ]; then
  log "electron-rebuild better-sqlite3…"
  run "\"$COWORK_DIR/node_modules/.bin/electron-rebuild\" --module-dir \"$ROOT_DIR\" --only better-sqlite3"
fi

# --- Mode dev live (vite dev server + electron, rechargement à chaud) ---
if [ "$DEV" = 1 ]; then
  log "mode dev live (npm run dev)"
  if [ "$DRY" = 1 ]; then echo "   [dry-run] (cd \"$COWORK_DIR\" && npm run dev)"; exit 0; fi
  cd "$COWORK_DIR"; exec npm run dev
fi

# --- Build si nécessaire ---
if [ "$FORCE_BUILD" = 1 ] || [ ! -f "$MAIN" ]; then
  log "vite build (~30 s → dist-electron/)…"
  run "(cd \"$COWORK_DIR\" && npx vite build)"
else
  log "dist-electron/ déjà présent (—build pour forcer)"
fi

# --- Lancement ---
CDP_FLAG=""
[ "$CDP" = 1 ] && CDP_FLAG="--remote-debugging-port=$CDP_PORT"
SUFFIX=""
[ "$CDP" = 1 ] && SUFFIX="$SUFFIX, CDP=$CDP_PORT"
[ "$BG" = 1 ] && SUFFIX="$SUFFIX, arrière-plan"
log "lancement Cowork  (DISPLAY=$DISPLAY_ARG$SUFFIX)"

if [ "$DRY" = 1 ]; then
  echo "   [dry-run] DISPLAY=$DISPLAY_ARG NODE_ENV=production \\"
  echo "             $ELECTRON --no-sandbox --disable-gpu $CDP_FLAG \\"
  echo "             $MAIN"
  exit 0
fi

if [ "$BG" = 1 ]; then
  DISPLAY="$DISPLAY_ARG" NODE_ENV=production nohup \
    "$ELECTRON" --no-sandbox --disable-gpu $CDP_FLAG "$MAIN" >"$LOG" 2>&1 &
  disown
  echo "Cowork lancé en arrière-plan (PID $!). Logs : $LOG"
else
  echo "Cowork démarre (Ctrl-C pour quitter). Logs → console."
  exec env DISPLAY="$DISPLAY_ARG" NODE_ENV=production \
    "$ELECTRON" --no-sandbox --disable-gpu $CDP_FLAG "$MAIN"
fi
