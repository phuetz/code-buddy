#!/usr/bin/env bash
# Setup MATE premium pour les sessions xrdp Ministar.
# Inspiré d'Ubuntu MATE 24.04 + Linux Mint MATE 22 + dedoimedo guide.
#
# À lancer DANS un terminal MATE actif (pas via SSH) :
#   - gsettings agit sur le DBus user de la session active
#   - les configs autostart sont per-user
#
# Idempotent : ré-exécutable sans casse.
# Per-user : Patrice et Sébastien doivent chacun le lancer dans leur session.

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
info() { echo -e "${BLUE}→${NC} $*"; }

# Garde-fou : pas via SSH
if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]] && [[ ! -S "/run/user/$(id -u)/bus" ]]; then
  fail "Pas de session DBus user détectée. Lance ce script dans un terminal MATE, pas via SSH."
fi
[[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]] && export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_SRC="$SRC_DIR/mate-config"

# Backup gsettings actuels (rollback possible avec dconf load)
BACKUP="$HOME/.config/mate-config-backup-$(date +%Y%m%d-%H%M%S).ini"
mkdir -p "$HOME/.config"
dconf dump /org/mate/ > "$BACKUP" 2>/dev/null || true
ok "Backup gsettings : $BACKUP"

# ──────────────────────────────────────────────────────────────────────
# 1. Thèmes Yaru-MATE-dark
# ──────────────────────────────────────────────────────────────────────
gsettings set org.mate.interface gtk-theme 'Yaru-MATE-dark'
gsettings set org.mate.Marco.general theme 'Yaru-MATE-dark'
gsettings set org.mate.interface icon-theme 'Yaru-MATE-dark'
gsettings set org.mate.peripherals-mouse cursor-theme 'Yaru' 2>/dev/null || true
ok "Thèmes : Yaru-MATE-dark (GTK + Marco + icônes + curseur)"

# ──────────────────────────────────────────────────────────────────────
# 2. Polices Ubuntu
# ──────────────────────────────────────────────────────────────────────
gsettings set org.mate.interface font-name           'Ubuntu 10'
gsettings set org.mate.interface monospace-font-name 'Ubuntu Mono 11'
gsettings set org.mate.interface document-font-name  'Ubuntu 10'
gsettings set org.mate.Marco.general titlebar-font   'Ubuntu Bold 10'
gsettings set org.mate.caja.desktop font             'Ubuntu 10' 2>/dev/null || true
ok "Polices : Ubuntu (interface, titres, documents, mono)"

# ──────────────────────────────────────────────────────────────────────
# 3. Boutons fenêtre + bordures
# ──────────────────────────────────────────────────────────────────────
gsettings set org.mate.Marco.general button-layout 'menu:minimize,maximize,close'
ok "Boutons fenêtre : alignés à droite (style Ubuntu)"

# ──────────────────────────────────────────────────────────────────────
# 4. Layout Mutiny (Unity-like) via mate-tweak
# ──────────────────────────────────────────────────────────────────────
if command -v mate-tweak >/dev/null 2>&1; then
  if mate-tweak --layout=mutiny 2>/dev/null; then
    ok "Layout MATE : Mutiny (Unity-like, top bar + sidebar dock)"
  else
    warn "mate-tweak --layout=mutiny a échoué. Lance manuellement :"
    warn "  Système → Préférences → MATE Tweak → Panel → Mutiny"
  fi
else
  warn "mate-tweak pas installé. Installe avec :"
  warn "  sudo apt install -y mate-tweak"
fi

# ──────────────────────────────────────────────────────────────────────
# 5. Picom (compositor) — DÉSACTIVÉ par défaut en xrdp (cause de freeze)
# ──────────────────────────────────────────────────────────────────────
# Picom + xorgxrdp = combinaison instable (compositing GLX sur un X server
# virtualisé). Marco fait son propre compositing software qui marche bien
# en RDP. Pour activer picom (en session locale Xorg uniquement),
# relance avec : WITH_PICOM=1 mate-style.sh
if [[ "${WITH_PICOM:-0}" == "1" ]] && command -v picom >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/picom" "$HOME/.config/autostart"
  install -m 644 "$CONF_SRC/picom.conf" "$HOME/.config/picom/picom.conf"
  install -m 644 "$CONF_SRC/picom-autostart.desktop" "$HOME/.config/autostart/picom.desktop"
  gsettings set org.mate.Marco.general compositing-manager false
  ok "Picom : ACTIVÉ (compositing externe, Marco compositing OFF)"
else
  # S'assurer que picom est bien désactivé (rollback de runs précédents)
  [[ -f "$HOME/.config/autostart/picom.desktop" ]] && \
    mv "$HOME/.config/autostart/picom.desktop" "$HOME/.config/autostart/picom.desktop.disabled"
  pkill -u "$USER" -x picom 2>/dev/null || true
  gsettings set org.mate.Marco.general compositing-manager true
  ok "Picom : DÉSACTIVÉ (Marco compositing intégré ON, safe pour xrdp)"
fi

# ──────────────────────────────────────────────────────────────────────
# 6. Plank dock — autostart + preset config
# ──────────────────────────────────────────────────────────────────────
if command -v plank >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/autostart"
  install -m 644 "$CONF_SRC/plank-autostart.desktop" "$HOME/.config/autostart/plank.desktop"

  # Preset config Plank via gsettings
  gsettings set net.launchpad.plank.dock.settings:/net/launchpad/plank/docks/dock1/ \
    theme 'Transparent' 2>/dev/null || true
  gsettings set net.launchpad.plank.dock.settings:/net/launchpad/plank/docks/dock1/ \
    icon-size 36 2>/dev/null || true
  gsettings set net.launchpad.plank.dock.settings:/net/launchpad/plank/docks/dock1/ \
    position 'top' 2>/dev/null || true
  gsettings set net.launchpad.plank.dock.settings:/net/launchpad/plank/docks/dock1/ \
    hide-mode 'none' 2>/dev/null || true

  ok "Plank : autostart + theme Transparent + position top + size 36"

  if ! pgrep -u "$USER" -x plank >/dev/null; then
    nohup plank >/dev/null 2>&1 &
    sleep 1
    pgrep -u "$USER" -x plank >/dev/null && ok "Plank lancé en arrière-plan"
  fi
else
  warn "plank pas installé. Installe avec : sudo apt install -y plank"
fi

# ──────────────────────────────────────────────────────────────────────
# 7. Wallpaper (Ubuntu 24.04 Noble Numbat — fallback si Ubuntu MATE absent)
# ──────────────────────────────────────────────────────────────────────
WALLPAPER=""
for candidate in \
  /usr/share/backgrounds/ubuntu-mate-common/Ubuntu-Mate-cold-fusion.jpg \
  /usr/share/backgrounds/Numbat_wallpaper_dimmed_3480x2160.png \
  /usr/share/backgrounds/warty-final-ubuntu.png ; do
  if [[ -f "$candidate" ]]; then
    WALLPAPER="$candidate"
    break
  fi
done
if [[ -n "$WALLPAPER" ]]; then
  gsettings set org.mate.background picture-filename "$WALLPAPER"
  gsettings set org.mate.background picture-options 'zoom'
  ok "Wallpaper : $(basename "$WALLPAPER")"
fi

# ──────────────────────────────────────────────────────────────────────
# 8. Notifications coin haut-droit + autres tweaks
# ──────────────────────────────────────────────────────────────────────
gsettings set org.mate.NotificationDaemon popup-location 'top_right' 2>/dev/null || true
gsettings set org.mate.peripherals-touchpad tap-to-click true 2>/dev/null || true
gsettings set org.mate.interface enable-animations true
ok "Notifications coin haut-droit + animations ON"

# ──────────────────────────────────────────────────────────────────────
# 9. Caja (file manager) : vue liste + delete activé
# ──────────────────────────────────────────────────────────────────────
gsettings set org.mate.caja.preferences default-folder-viewer 'list-view' 2>/dev/null || true
gsettings set org.mate.caja.preferences enable-delete true 2>/dev/null || true
gsettings set org.mate.caja.preferences click-policy 'double' 2>/dev/null || true
ok "Caja : vue liste, delete activé"

# ──────────────────────────────────────────────────────────────────────
# 10. mate-terminal : police + transparence légère
# ──────────────────────────────────────────────────────────────────────
PROFILE=$(gsettings get org.mate.terminal.global default-profile 2>/dev/null | tr -d "'") || true
if [[ -n "$PROFILE" ]]; then
  gsettings set "org.mate.terminal.profile:/org/mate/terminal/profiles/$PROFILE/" \
    use-system-font false 2>/dev/null || true
  gsettings set "org.mate.terminal.profile:/org/mate/terminal/profiles/$PROFILE/" \
    font 'Ubuntu Mono 12' 2>/dev/null || true
  gsettings set "org.mate.terminal.profile:/org/mate/terminal/profiles/$PROFILE/" \
    background-type 'transparent' 2>/dev/null || true
  gsettings set "org.mate.terminal.profile:/org/mate/terminal/profiles/$PROFILE/" \
    background-darkness 0.92 2>/dev/null || true
  ok "mate-terminal : Ubuntu Mono 12 + transparence légère (~8%)"
fi

echo
echo "═══ Setup MATE premium appliqué ═══"
echo
echo "Pour voir tous les changements appliqués :"
echo "  Logout/login (déconnecte mstsc, reconnecte) — recommandé"
echo
echo "Pour switcher de layout (Mutiny / Cupertino / Familiar / etc.) :"
echo "  Système → Préférences → MATE Tweak → Panel"
echo
echo "Si latence sentie en RDP, désactive picom :"
echo "  mv ~/.config/autostart/picom.desktop{,.disabled}"
echo "  pkill picom"
echo
echo "Rollback complet :"
echo "  dconf load /org/mate/ < $BACKUP"
