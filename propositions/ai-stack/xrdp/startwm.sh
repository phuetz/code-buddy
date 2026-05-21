#!/bin/sh
# Lancement de session MATE pour xrdp.
# MATE est utilisé pour les sessions xrdp à la place de GNOME — ce dernier
# nécessite trop de gymnastique systemd-user/dbus/Xorg pour fonctionner
# fiablement via xrdp sur Ubuntu 24.04 LTS (mutter qui ne s'enregistre
# pas, ConditionEnvironment XDG_SESSION_TYPE=x11 jamais validée, etc.).
# La session GNOME locale (Wayland sur tty1) reste intacte.

if test -r /etc/profile; then
  . /etc/profile
fi

if test -r ~/.profile; then
  . ~/.profile
fi

# Autorise les apps confinées (Firefox snap, etc.) à accéder au display X.
# Sans ça : "cannot open display: :10.0" car snap-confine bloque par défaut.
if command -v xhost >/dev/null 2>&1; then
  xhost +SI:localuser:$(id -un) >/dev/null 2>&1 || true
fi

USER_UID=$(id -u)
if [ -z "$DBUS_SESSION_BUS_ADDRESS" ] && [ -S "/run/user/${USER_UID}/bus" ]; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${USER_UID}/bus"
fi

if [ -z "$XDG_RUNTIME_DIR" ] && [ -d "/run/user/${USER_UID}" ]; then
  export XDG_RUNTIME_DIR="/run/user/${USER_UID}"
fi

export XDG_CURRENT_DESKTOP=MATE
export XDG_SESSION_DESKTOP=mate

exec mate-session
