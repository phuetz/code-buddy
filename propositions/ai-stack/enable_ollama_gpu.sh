#!/usr/bin/env bash
# Active le support ROCm/GPU pour Ollama sur Ministar Linux (Radeon 890M = gfx1150).
# Le 890M n'est pas dans la matrice ROCm 7.2 native, mais les libs bundle d'Ollama
# (/usr/local/lib/ollama/rocm) le détectent en gfx1150. On les rend prioritaires
# UNIQUEMENT pour le service ollama via Environment=LD_LIBRARY_PATH dans le drop-in.
#
# IMPORTANT — Régression évitée le 2026-04-30 :
# La version précédente de ce script écrivait /etc/ld.so.conf.d/00-ollama-rocm-bundle.conf
# avec le chemin bundle Ollama. Conséquence : libdrm.so.2 d'Ollama (vieille, sans
# le symbole drmSyncobjEventfd) shadowait la libdrm système pour TOUTES les apps,
# dont gnome-shell/libmutter → "symbol lookup error" → GDM en boucle → écran de
# login impossible. Ne JAMAIS injecter le dossier bundle Ollama dans ld.so.conf.d/.
#
# Lance avec : sudo ./enable_ollama_gpu.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Lance en root : sudo $0"
   exit 1
fi

OVERRIDE_DIR="/etc/systemd/system/ollama.service.d"
OVERRIDE_FILE="$OVERRIDE_DIR/rocm.conf"

mkdir -p "$OVERRIDE_DIR"
cat > "$OVERRIDE_FILE" <<'EOF'
[Service]
# Pas de HSA_OVERRIDE_GFX_VERSION : à 22:20 le 890M était détecté nativement en gfx1150
# par les libs bundle d'Ollama. L'override déclenche un JIT compile qui dépasse le timeout
# discovery hardcoded de 3s d'Ollama 0.21.2 (cf https://github.com/ollama/ollama/pull/13186).
#
# LD_LIBRARY_PATH : faire passer les libs ROCm bundle d'Ollama AVANT celles de
# /opt/rocm-7.2.2 et /opt/amdgpu pour les sub-process du service ollama.
# Scope = ce service uniquement, ne pollue PAS l'editor de liens du système
# (cf incident 2026-04-30, voir commentaire en tête du script).
Environment="LD_LIBRARY_PATH=/usr/local/lib/ollama/rocm:/usr/local/lib/ollama"
EOF

# Garde-fou : si une ancienne install a laissé le ld.so.conf.d global, on le retire.
LEGACY_LD_CONF="/etc/ld.so.conf.d/00-ollama-rocm-bundle.conf"
if [[ -f "$LEGACY_LD_CONF" ]]; then
  echo "==> Suppression du legacy $LEGACY_LD_CONF (cassait gnome-shell)"
  mv "$LEGACY_LD_CONF" "${LEGACY_LD_CONF}.disabled-by-enable_ollama_gpu"
  ldconfig
fi

echo "==> Drop-in écrit : $OVERRIDE_FILE"
cat "$OVERRIDE_FILE"
echo
echo "==> Reload systemd + restart ollama"
systemctl daemon-reload
systemctl restart ollama
sleep 5

echo
echo "==> Vérif libs ROCm vues par le process ollama"
OLLAMA_PID="$(systemctl show -p MainPID --value ollama)"
if [[ -n "$OLLAMA_PID" && "$OLLAMA_PID" != "0" ]]; then
  echo "  PID ollama : $OLLAMA_PID"
  grep -E "libamdhip64|libhsa-runtime|libdrm" "/proc/$OLLAMA_PID/maps" 2>/dev/null \
    | awk '{print $NF}' | sort -u || true
fi

echo
echo "==> Logs récents (discovery GPU)"
journalctl -u ollama --no-pager --since "10 seconds ago" | grep -iE "discov|gpu|gfx|rocm|backend|device|failure" | tail -10
