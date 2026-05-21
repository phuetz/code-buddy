#!/usr/bin/env bash
# Démarre / vérifie toute la stack AI locale sur Ministar Linux.
# Idempotent : ne fait rien si tout tourne déjà.
# Usage : ./start-stack.sh [--with-comfy]

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; }
info()  { echo -e "${BLUE}→${NC} $*"; }

check_port() {
  local port="$1" label="$2"
  if ss -tln 2>/dev/null | grep -q ":$port "; then
    ok "$label (:$port)"
    return 0
  else
    fail "$label (:$port) ne répond pas"
    return 1
  fi
}

http_ok() {
  local url="$1" label="$2" extra_header="${3:-}"
  if [[ -n "$extra_header" ]]; then
    curl -sf --max-time 5 -H "$extra_header" "$url" >/dev/null 2>&1
  else
    curl -sf --max-time 5 "$url" >/dev/null 2>&1
  fi
  if [[ $? -eq 0 ]]; then ok "$label"; else fail "$label ($url)"; fi
}

echo "═══ AI Stack — Ministar Linux ═══"
echo

# 1. Ollama (systemd) — désactivé au boot depuis 2026-04-30 (incident UI ROCm)
info "Ollama service"
if systemctl is-active --quiet ollama; then
  ok "ollama.service actif"
else
  warn "ollama.service inactif — démarrage"
  sudo systemctl start ollama
  sleep 2
fi
check_port 11434 "Ollama API"
echo

# 2. Stack docker compose (qdrant, searxng, redis, litellm, open-webui)
#    Open WebUI absorbé dans compose le 2026-04-30 (avant : container dédié hors compose).
info "Stack docker compose"
docker compose up -d 2>&1 | grep -E "Created|Started|Running" | head -10
sleep 3

# Healthchecks docker (status reflète l'état réel des services)
info "Health docker (interval 30s, attendre 1 min après cold start)"
docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -v "^NAME"
echo

# Probes HTTP (validation réseau, indépendant des healthchecks docker)
http_ok http://127.0.0.1:8080/health "Open WebUI"
http_ok http://127.0.0.1:6333/healthz "Qdrant"
http_ok "http://127.0.0.1:8888/search?q=ping&format=json" "SearXNG"
http_ok http://127.0.0.1:4000/health/liveliness "LiteLLM proxy"
check_port 6380 "ai-redis"
echo

# 3. ComfyUI (option, hors compose, venv PyTorch CPU pour l'instant)
if [[ "${1:-}" == "--with-comfy" ]]; then
  info "ComfyUI (CPU)"
  if ss -tln 2>/dev/null | grep -q ":8188 "; then
    ok "ComfyUI déjà sur :8188"
  else
    info "Démarrage ComfyUI en background → /tmp/comfyui.log"
    cd /home/patrice/DEV/ComfyUI
    nohup .venv/bin/python main.py --cpu --listen 127.0.0.1 --port 8188 \
      > /tmp/comfyui.log 2>&1 &
    cd "$SCRIPT_DIR"
    echo "  PID=$!  (kill avec : pkill -f 'main.py --cpu --listen')"
    sleep 5
    check_port 8188 "ComfyUI"
  fi
  echo
fi

# 4. Récap
echo "═══ URLs ═══"
echo "  Open WebUI    http://localhost:8080"
echo "  LiteLLM       http://localhost:4000  (key dans litellm/.env)"
echo "  Qdrant        http://localhost:6333/dashboard"
echo "  SearXNG       http://localhost:8888"
echo "  ComfyUI       http://localhost:8188   $([[ "${1:-}" == "--with-comfy" ]] || echo '(lancer avec ./start-stack.sh --with-comfy)')"
echo "  Ollama API    http://localhost:11434"
echo
echo "Modèles Ollama :"
ollama list 2>/dev/null | tail -n +2 | awk '{printf "  %-40s %s\n", $1, $3" "$4}'
