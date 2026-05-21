#!/usr/bin/env bash
# Active le backend Vulkan pour Ollama sur Ministar Linux (Radeon 890M / gfx1150).
# Pivot 2026-05-01 : contourne HSA/rocBLAS qui timeout au discovery (Ollama 0.21.2)
# et le bug HSA gfx1150 isolé via le crash clinfo. RADV/Mesa parle direct à amdgpu.
#
# Lance avec : sudo ./enable_ollama_vulkan.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Lance en root : sudo $0"
   exit 1
fi

OVERRIDE_FILE="/etc/systemd/system/ollama.service.d/rocm.conf"

if [[ ! -f "$OVERRIDE_FILE" ]]; then
  echo "ERREUR : $OVERRIDE_FILE absent. Lance d'abord enable_ollama_gpu.sh."
  exit 1
fi

# Idempotent : ne ré-ajoute pas la ligne si déjà présente
if grep -q "OLLAMA_VULKAN=1" "$OVERRIDE_FILE"; then
  echo "==> OLLAMA_VULKAN=1 déjà présent dans $OVERRIDE_FILE"
else
  cat >> "$OVERRIDE_FILE" <<'EOF'

# 2026-05-01 — Pivot Vulkan : contourne HSA/rocBLAS (bug gfx1150 + timeout discovery 0.21.2).
# RADV/Mesa parle directement à amdgpu côté kernel, sans libhsa-runtime.
Environment="OLLAMA_VULKAN=1"
EOF
  echo "==> OLLAMA_VULKAN=1 ajouté à $OVERRIDE_FILE"
fi

echo
echo "==> Drop-in actuel :"
cat "$OVERRIDE_FILE"

echo
echo "==> Reload systemd + restart ollama"
systemctl daemon-reload
systemctl restart ollama
sleep 6

echo
echo "==> Logs discovery récents"
journalctl -u ollama --no-pager --since "15 sec ago" \
  | grep -iE "discov|gpu|gfx|rocm|vulkan|backend|device|failure|inference compute" \
  | tail -25
