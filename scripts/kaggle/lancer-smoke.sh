#!/bin/bash
# Boucle Kaggle complète : push -> poll -> artefacts. $0, pilotable par agent.
# Prérequis : ~/.kaggle/kaggle.json (jeton API) + compte vérifié téléphone (GPU).
set -eu
cd "$(dirname "$0")"
KAGGLE=~/.local/bin/kaggle

USER=$($KAGGLE config view 2>/dev/null | grep -oP 'username: \K\S+' || true)
[ -z "$USER" ] && { echo "ÉCHEC : pas d'identifiants (~/.kaggle/kaggle.json)"; exit 1; }
sed -i "s/KAGGLE_USERNAME/$USER/" kernel-metadata.json
KERNEL="$USER/codebuddy-vision-train-smoke"

echo "=== push ($KERNEL)"
$KAGGLE kernels push

echo "=== poll (le smoke prend ~5-10 min sur T4)"
for i in $(seq 1 60); do
  sleep 30
  STATUS=$($KAGGLE kernels status "$KERNEL" 2>&1 | tail -1)
  echo "[$i] $STATUS"
  case "${STATUS,,}" in
    *complete*) break ;;
    *error*|*cancel*) echo "ÉCHEC — log :"; $KAGGLE kernels output "$KERNEL" -p sortie/ >/dev/null 2>&1 || true; cat sortie/*.log 2>/dev/null | tail -30; exit 1 ;;
  esac
done

echo "=== artefacts"
mkdir -p sortie && $KAGGLE kernels output "$KERNEL" -p sortie/
ls -la sortie/
echo "OK : best.pt récupéré = la boucle push→GPU→artefact est prouvée."
