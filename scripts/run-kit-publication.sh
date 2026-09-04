#!/usr/bin/env bash
cd "$HOME/code-buddy" || exit 1
# Le brief de mission vit hors du dépôt (répertoire de travail temporaire de
# la session) : donnez son chemin via MISSION_FILE.
P="${MISSION_FILE:?MISSION_FILE est obligatoire : export MISSION_FILE=<chemin>/mission-kit-publication.txt}"
codex exec -c sandbox_mode=danger-full-access "$(cat "$P")" >> "$HOME/code-buddy/kit-publication.log" 2>&1 < /dev/null
