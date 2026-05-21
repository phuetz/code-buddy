#!/usr/bin/env bash
# install_codebuddy_fleet.sh
# Install the systemd unit that keeps `buddy server --port 3001` alive
# at boot, so other peers (Cowork, DARKSTAR, G7 PT) can discover and
# dispatch to this Ministar via Tailscale.
#
# Run with sudo. Idempotent — safe to re-run after edits to the .service.

set -euo pipefail

SERVICE_NAME="codebuddy-fleet.service"
UNIT_SRC="$(dirname "$(readlink -f "$0")")/${SERVICE_NAME}"
UNIT_DEST="/etc/systemd/system/${SERVICE_NAME}"
LOG_FILE="/var/log/codebuddy-fleet.log"
ENV_DIR="/home/patrice/.codebuddy"
ENV_FILE="${ENV_DIR}/fleet.env"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: this script must run as root (sudo)" >&2
  exit 1
fi

if [[ ! -f "${UNIT_SRC}" ]]; then
  echo "ERROR: source unit not found at ${UNIT_SRC}" >&2
  exit 1
fi

echo "→ Installing ${SERVICE_NAME} → ${UNIT_DEST}"
install -m 644 "${UNIT_SRC}" "${UNIT_DEST}"

# Log file with patrice as owner so the service can append.
echo "→ Ensuring ${LOG_FILE} exists and is writable by patrice"
touch "${LOG_FILE}"
chown patrice:patrice "${LOG_FILE}"
chmod 640 "${LOG_FILE}"

# Optional env file. If missing, create a stub with comments so patrice
# knows where to drop API keys without leaking them to git.
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "→ Creating stub ${ENV_FILE} (placeholders, edit to add cloud keys)"
  install -d -m 700 -o patrice -g patrice "${ENV_DIR}"
  cat > "${ENV_FILE}" <<'EOF'
# Code Buddy Fleet Gateway — environment file
# Loaded by codebuddy-fleet.service before ExecStart. Uncomment +
# fill the keys you want this peer to expose to the fleet (each
# enabled provider becomes a model in `peer.describe`).
#
# Local-only providers don't need keys here.

# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=...
# GROK_API_KEY=...

# Fleet identification
# CODEBUDDY_FLEET_HOSTNAME=ministar
# CODEBUDDY_FLEET_GPU="iGPU 890M (Vulkan via RADV)"
# CODEBUDDY_FLEET_RAM_GB=64
# CODEBUDDY_FLEET_MAX_CONCURRENCY=4

# Ollama / LM Studio (already on default ports — uncomment to override)
# OLLAMA_BASE_URL=http://127.0.0.1:11434
# LM_STUDIO_BASE_URL=http://127.0.0.1:1234
EOF
  chown patrice:patrice "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
fi

echo "→ systemctl daemon-reload"
systemctl daemon-reload

echo "→ Enabling ${SERVICE_NAME} at boot"
systemctl enable "${SERVICE_NAME}"

echo "→ Restarting ${SERVICE_NAME} (pickup any unit changes)"
systemctl restart "${SERVICE_NAME}"

sleep 2

echo
echo "─── status ───"
systemctl --no-pager status "${SERVICE_NAME}" || true

echo
echo "─── recent log lines ───"
tail -n 20 "${LOG_FILE}" 2>/dev/null || echo "(log empty so far)"

echo
echo "Installed. To check live: journalctl -u ${SERVICE_NAME} -f"
echo "Or: tail -f ${LOG_FILE}"
echo
echo "Health probe: curl http://localhost:3001/api/health"
