#!/usr/bin/env bash
# Rollback : repasse de xrdp vers gnome-remote-desktop --system.
# Rapide, sans purge, pour récupérer l'état d'avant install_xrdp.sh.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Lance en root : sudo $0"
  exit 1
fi

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

systemctl disable --now xrdp.service xrdp-sesman.service 2>/dev/null || warn "xrdp pas actif (skip)"
ok "xrdp + xrdp-sesman désactivés"

systemctl enable --now gnome-remote-desktop.service grd-watchdog.service
ok "gnome-remote-desktop + grd-watchdog ré-activés"

echo
echo "═══ Port 3389 ═══"
ss -tlnp 2>/dev/null | grep 3389 || warn "Personne n'écoute — check journalctl -u gnome-remote-desktop"
echo
echo "Patrice retrouve son accès via la SAM existante (grdctl set-credentials)."
echo "Sébastien reste sans accès RDP (état pré-migration xrdp)."
