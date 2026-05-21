#!/usr/bin/env bash
# Watchdog gnome-remote-desktop : redémarre le service quand le bug
# de refcount GNOME 46.x apparaît dans le journal.
#
# Bug ciblé : "g_atomic_ref_count_dec: assertion 'old_value > 0' failed"
# qui apparaît après une déconnexion RDP et corrompt l'état du daemon,
# rendant les reconnexions suivantes impossibles (NLA fail). Fixé en
# amont dans GNOME 47+, à supprimer après upgrade Ubuntu LTS.

set -u

SERVICE="gnome-remote-desktop"
PATTERN='g_atomic_ref_count_dec'
COOLDOWN=10  # secondes minimum entre deux restarts consécutifs

last_restart=0

journalctl -u "$SERVICE" -f --since "now" -o cat | \
while IFS= read -r line; do
  if [[ "$line" == *"$PATTERN"* ]]; then
    now=$(date +%s)
    if (( now - last_restart >= COOLDOWN )); then
      logger -t grd-watchdog "Pattern '$PATTERN' detected → restart $SERVICE"
      if systemctl restart "$SERVICE"; then
        logger -t grd-watchdog "Restart OK"
      else
        logger -t grd-watchdog "Restart FAILED (exit $?)"
      fi
      last_restart=$now
    fi
  fi
done
