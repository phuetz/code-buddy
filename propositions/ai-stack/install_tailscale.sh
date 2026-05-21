#!/usr/bin/env bash
# Tailscale install pour Ministar Linux — VPN mesh maillage avec G7 PT + DARKSTAR
# Source : https://tailscale.com/download/linux
# Lance avec : sudo ./install_tailscale.sh   (ou via Claude Code : `! sudo ./install_tailscale.sh`)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Lance en root : sudo $0"
   exit 1
fi

REAL_USER="${SUDO_USER:-patrice}"
echo "==> Install Tailscale (user: $REAL_USER)"

# 1. Install via le script officiel (idempotent)
if command -v tailscale >/dev/null 2>&1; then
  echo "==> tailscale déjà installé : $(tailscale version | head -1)"
else
  echo "==> Téléchargement et install via script officiel"
  curl -fsSL https://tailscale.com/install.sh | sh
fi

# 2. Service systemd
systemctl enable --now tailscaled
sleep 2

# 3. tailscale up — ouvre une URL d'auth
echo
echo "==> tailscale up — ouvre une URL d'auth dans le navigateur"
echo "    Connecte-toi avec patrice.huetz@gmail.com (Google)"
echo
tailscale up --hostname=ministar-linux --accept-routes

# 4. Récap
echo
echo "==> État Tailscale"
tailscale status
echo
echo "==> IP tailnet (à noter pour brancher G7 PT / DARKSTAR) :"
tailscale ip -4
