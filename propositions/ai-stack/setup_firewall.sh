#!/usr/bin/env bash
# Configure UFW pour exposer la stack AI uniquement sur tailscale0.
# SSH reste accessible sur toutes les interfaces (filet de sécurité local).
#
# Lance avec : sudo ./setup_firewall.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Lance en root : sudo $0"
   exit 1
fi

echo "==> État UFW actuel"
ufw status verbose 2>&1 | head -20
echo

# 1. Politique par défaut : tout bloquer en entrée, tout autoriser en sortie
ufw default deny incoming
ufw default allow outgoing

# 2. SSH ouvert partout (filet de sécurité — si tailscale plante, SSH local reste OK)
ufw allow 22/tcp comment "SSH (toutes interfaces — filet de sécurité)"

# 3. Tailscale interface : autoriser tout le trafic entrant
#    Cela couvre Open WebUI, Ollama, Qdrant, SearXNG, LiteLLM, etc. depuis le tailnet.
ufw allow in on tailscale0 comment "Tailscale tailnet (services AI)"

# 4. Loopback toujours ouvert (Docker, services locaux)
ufw allow in on lo

# 5. Optionnel : autoriser aussi le LAN local si Patrice veut accès direct
#    (décommente si besoin — sinon le LAN passera par Tailscale)
# ufw allow from 192.168.0.0/16 comment "LAN domestique"

# 6. Activer
ufw --force enable

echo
echo "==> État UFW après config"
ufw status verbose

echo
echo "==> Vérif depuis G7 PT (sur Tailscale) :"
echo "    curl http://100.98.18.76:8080/health  → doit répondre"
echo "    curl http://<ip-ethernet-locale>:8080  → doit timeout"
