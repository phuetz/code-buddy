#!/usr/bin/env bash
# Installe le watchdog gnome-remote-desktop :
#   /usr/local/bin/grd-watchdog.sh         (script)
#   /etc/systemd/system/grd-watchdog.service (unit)
# Puis enable + start.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Lance en root : sudo $0"
  exit 1
fi

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_SRC="$SRC_DIR/grd-watchdog.sh"
UNIT_SRC="$SRC_DIR/grd-watchdog.service"

[[ -f "$SCRIPT_SRC" ]] || { echo "Manque : $SCRIPT_SRC" >&2; exit 1; }
[[ -f "$UNIT_SRC"   ]] || { echo "Manque : $UNIT_SRC"   >&2; exit 1; }

install -m 755 "$SCRIPT_SRC" /usr/local/bin/grd-watchdog.sh
ok "Script installé : /usr/local/bin/grd-watchdog.sh"

install -m 644 "$UNIT_SRC" /etc/systemd/system/grd-watchdog.service
ok "Unit installée : /etc/systemd/system/grd-watchdog.service"

systemctl daemon-reload
systemctl enable --now grd-watchdog.service
ok "Service grd-watchdog enabled + started"

echo
systemctl status grd-watchdog.service --no-pager | head -10
echo
echo "Logs en direct :"
echo "  journalctl -u grd-watchdog -f"
echo
echo "Désactivation :"
echo "  sudo systemctl disable --now grd-watchdog && sudo rm /etc/systemd/system/grd-watchdog.service /usr/local/bin/grd-watchdog.sh"
