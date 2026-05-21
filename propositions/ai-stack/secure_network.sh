#!/usr/bin/env bash
# Sécurisation réseau Ministar Linux : UFW + règles tailnet-first
#
# Politique :
#   - default deny incoming, allow outgoing
#   - tailscale0 : tout autorisé (= tailnet de confiance)
#   - LAN RFC1918 : SSH (22) + mosh (60000-61000/udp) seulement
#   - Internet : rien
#
# IMPORTANT — Docker contourne UFW :
#   Docker édite directement la chain DOCKER d'iptables et n'est pas filtré
#   par UFW. Les ports publiés par docker-compose (8080 open-webui, 6333 qdrant,
#   8888 searxng, 4000 litellm host-net, 6380 ai-redis host-net) restent
#   accessibles sur 0.0.0.0 même après ce script. Pour les serrer :
#     - éditer docker-compose.yml pour binder sur "127.0.0.1:PORT:..."
#     - puis exposer via tailscale serve / funnel pour ce qui doit être distant
#   Plan détaillé : claude-et-patrice/propositions/SECURISATION-RESEAU-MINISTAR-2026-05-01.md
#
# Lance avec : sudo ./secure_network.sh

set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Lance en root : sudo $0"; exit 1; }

echo "==> Pré-flight"
TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || true)
[[ -n "$TS_IP" ]] || { echo "!! Tailscale non détecté. Aborting."; exit 1; }
echo "  Tailscale IP : $TS_IP"

# Détection du subnet LAN actuel (interface non-tailscale, non-loopback, non-docker)
LAN_IF=$(ip route show default | awk '/default/ {print $5; exit}')
LAN_NET=$(ip -4 -o addr show "$LAN_IF" 2>/dev/null | awk '{print $4}' | head -1 || true)
echo "  Interface LAN  : $LAN_IF"
echo "  Subnet LAN     : ${LAN_NET:-(inconnu)}"

# Sanity : on ne s'auto-coupe pas
SSH_SOURCE_IP="${SSH_CLIENT:- }"
SSH_SOURCE_IP="${SSH_SOURCE_IP%% *}"
[[ -n "${SSH_SOURCE_IP:-}" ]] && [[ "${SSH_SOURCE_IP}" != "" ]] && echo "  SSH source     : $SSH_SOURCE_IP"

echo
echo "==> ⚠️  Confirmation requise"
echo "Ce script va :"
echo "  - reset UFW"
echo "  - allow tout sur tailscale0 et lo"
echo "  - allow SSH (22/tcp) et mosh (60000-61000/udp) depuis RFC1918"
echo "  - deny tout le reste en entrée"
echo "  - activer UFW"
echo
echo "Si ton SSH actuel n'est pas via tailscale ($TS_IP) ni RFC1918 ($LAN_NET),"
echo "tu vas perdre la connexion."
echo
read -rp "Continuer ? [y/N] " ans
[[ "$ans" =~ ^[Yy]$ ]] || { echo "Annulé."; exit 0; }

echo
echo "==> Configuration UFW"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw default deny routed

ufw allow in on lo
ufw allow in on tailscale0

# SSH depuis le LAN (RFC1918) — pour ne pas se couper
ufw allow from 10.0.0.0/8     to any port 22 proto tcp
ufw allow from 172.16.0.0/12  to any port 22 proto tcp
ufw allow from 192.168.0.0/16 to any port 22 proto tcp

# Mosh depuis le LAN (optionnel mais utile)
ufw allow from 10.0.0.0/8     to any port 60000:61000 proto udp
ufw allow from 172.16.0.0/12  to any port 60000:61000 proto udp
ufw allow from 192.168.0.0/16 to any port 60000:61000 proto udp

echo
echo "==> Règles configurées (avant activation) :"
ufw show added

echo
echo "==> Activation"
ufw --force enable

echo
echo "==> Status"
ufw status verbose

echo
echo "==> Vérifier que les ports critiques sont OK"
echo "  ssh tailscale  : $(ss -tnH '( sport = :22 )' state established | wc -l) connexion(s) actives"
echo "  xrdp tailscale : ferme ? testable depuis ton G7 PT en mstsc → $TS_IP"
echo
echo "Note : les ports Docker (8080 open-webui, 6333 qdrant, etc.) restent"
echo "ouverts sur 0.0.0.0 — Docker bypass UFW. Voir la proposition pour la suite."
