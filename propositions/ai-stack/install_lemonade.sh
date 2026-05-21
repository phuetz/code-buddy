#!/usr/bin/env bash
# Lemonade Server install via PPA officielle (Ubuntu 24.04+)
# https://launchpad.net/~lemonade-team/+archive/ubuntu/stable
# v10.3.0 (28 avril 2026) — supporte ROCm 7.2, NPU XDNA2 via FLM backend
# Lance avec : sudo ./install_lemonade.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Lance en root : sudo $0"
   exit 1
fi

echo "==> 1. Ajout du PPA lemonade-team/stable"
add-apt-repository -y ppa:lemonade-team/stable

echo "==> 2. apt update"
apt-get update

echo "==> 3. Install lemonade-server"
apt-get install -y lemonade-server

echo "==> 4. Vérification du service"
systemctl status lemond.service --no-pager 2>&1 | head -10 || true

echo
echo "============================================="
echo "Lemonade installé."
echo "Web UI : http://localhost:8000"
echo "API OpenAI-compat : http://localhost:8000/api/v1"
echo
echo "Vérifs utiles :"
echo "  systemctl status lemond"
echo "  journalctl -u lemond -n 50"
echo "  curl http://localhost:8000/api/v1/models"
echo "============================================="
