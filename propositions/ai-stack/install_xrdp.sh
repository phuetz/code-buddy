#!/usr/bin/env bash
# Migration gnome-remote-desktop --system → xrdp + xorgxrdp.
# Multi-user via PAM (chaque user Linux auth avec son mdp système).
# Idempotent : ré-exécutable sans casse.
#
# Pré-requis :
#   - Tous les users qui doivent pouvoir RDP doivent avoir un mdp Linux
#     (sinon : sudo passwd <user>)
#   - Lancer depuis SSH ou console locale, PAS depuis une session RDP

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Lance en root : sudo $0"
  exit 1
fi

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
info()  { echo -e "${BLUE}→${NC} $*"; }

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SRC_DIR/xrdp/startwm.sh"            ]] || fail "Manque : $SRC_DIR/xrdp/startwm.sh"
[[ -f "$SRC_DIR/xrdp/02-allow-colord.rules" ]] || fail "Manque : $SRC_DIR/xrdp/02-allow-colord.rules"

# ──────────────────────────────────────────────────────────────────────
# 1. Stop & disable gnome-remote-desktop + watchdog (rollback préservé)
# ──────────────────────────────────────────────────────────────────────
info "Arrêt de gnome-remote-desktop et grd-watchdog (port 3389 libéré)"
systemctl disable --now gnome-remote-desktop.service 2>/dev/null || warn "GRD pas actif (skip)"
systemctl disable --now grd-watchdog.service         2>/dev/null || warn "watchdog pas actif (skip)"
ok "GRD + watchdog désactivés (configs SAM gardées en cas de rollback)"

# ──────────────────────────────────────────────────────────────────────
# 2. Install xrdp + xorgxrdp
# ──────────────────────────────────────────────────────────────────────
info "Installation xrdp + xorgxrdp depuis noble/universe"
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xrdp xorgxrdp
ok "Paquets installés ($(dpkg-query -f '${Version}' -W xrdp))"

# ──────────────────────────────────────────────────────────────────────
# 3. Permissions et config
# ──────────────────────────────────────────────────────────────────────
usermod -aG ssl-cert xrdp
ok "User xrdp ajouté au groupe ssl-cert"

# Backup du startwm.sh d'origine si pas déjà fait
if [[ -f /etc/xrdp/startwm.sh && ! -f /etc/xrdp/startwm.sh.dist ]]; then
  cp /etc/xrdp/startwm.sh /etc/xrdp/startwm.sh.dist
  ok "Backup : /etc/xrdp/startwm.sh.dist"
fi

install -m 755 "$SRC_DIR/xrdp/startwm.sh" /etc/xrdp/startwm.sh
ok "startwm.sh custom posé (force GNOME Xorg)"

install -m 644 "$SRC_DIR/xrdp/02-allow-colord.rules" /etc/polkit-1/rules.d/02-allow-colord.rules
ok "Polkit rule posée (anti-popup color-manager)"

# ──────────────────────────────────────────────────────────────────────
# 4. Start & enable
# ──────────────────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now xrdp.service xrdp-sesman.service
ok "xrdp + xrdp-sesman enabled + started"

# ──────────────────────────────────────────────────────────────────────
# 5. Vérifs
# ──────────────────────────────────────────────────────────────────────
echo
echo "═══ État ═══"
systemctl is-active xrdp xrdp-sesman | paste <(echo -e "xrdp\nxrdp-sesman") -
echo
echo "Port 3389 :"
ss -tlnp 2>/dev/null | grep 3389 || warn "Personne n'écoute sur 3389 — vérifier journalctl -u xrdp"
echo
echo "═══ Test ═══"
echo "Depuis G7 PT Windows / ASUS Sébastien :"
echo "  mstsc → 100.98.18.76 → user=patrice (ou sebastien) + mdp Linux"
echo
echo "Si écran noir / problème session GNOME :"
echo "  journalctl -u xrdp -f"
echo "  journalctl -u xrdp-sesman -f"
echo
echo "Rollback :"
echo "  sudo $SRC_DIR/rollback_xrdp_to_grd.sh"
