#!/usr/bin/env bash
# Miroir incrémental des actifs IRREMPLAÇABLES vers le second SSD (/data).
#
# Ce qui est sauvegardé : ce qui ne se retélécharge pas et ne se regénère pas
# sans coût (personas et LoRA = des journées de GPU ; masters vidéo = des
# semaines de production ; livres et traductions = des mois d'écriture ;
# clips Flow = ~20 000 crédits).
# Ce qui ne l'est PAS : le code (il est sur GitHub), les node_modules, les
# modèles publics (retéléchargeables), les caches.
#
#   miroir-actifs.sh            → synchronise
#   miroir-actifs.sh --dry-run  → montre ce qui serait copié, sans rien écrire
#
# Le miroir protège de la panne de disque, PAS du vol ni de l'incendie
# (même machine) : la copie hors site reste le disque externe.
set -uo pipefail

DEST="${MIROIR_DEST:-/data/backups/ministar}"
DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

SOURCES=(
  "$HOME/.codebuddy/personas"        # kits d'identité, garde-robes, LoRA
  "$HOME/.codebuddy/media-video"     # clips Flow/Veo + sidecars
  "$HOME/Videos/personas"            # composites, scènes, QC
  "$HOME/DEV/livres"                 # manuscrits + traductions
  "$HOME/.codebuddy/longform"        # vidéos longues et kits de publication
  "$HOME/.codebuddy/veille"          # catalogue et analyses de la veille
  "$HOME/.codebuddy/influencer-work" # sujets, preuves, productions
)

# Les trailers sont dispersés dans ~/Videos/<slug>-trailer/
while IFS= read -r d; do SOURCES+=("$d"); done < <(find "$HOME/Videos" -maxdepth 1 -type d -name '*-trailer' 2>/dev/null)

EXCLUDES=(
  --exclude 'node_modules/' --exclude '.git/' --exclude '__pycache__/'
  --exclude '*.tmp' --exclude '.cache/' --exclude 'dist/' --exclude 'build/'
)

mkdir -p "$DEST"
echo "=== Miroir des actifs → $DEST ${DRY:+(simulation)} ==="
started=$(date +%s)
total_err=0

for src in "${SOURCES[@]}"; do
  [ -d "$src" ] || continue
  rel="${src#$HOME/}"
  target="$DEST/$rel"
  mkdir -p "$(dirname "$target")"
  printf '  %-45s ' "$rel"
  if rsync -a --delete $DRY "${EXCLUDES[@]}" "$src/" "$target/" 2>/tmp/miroir-err.txt; then
    echo "ok"
  else
    echo "ERREUR (voir /tmp/miroir-err.txt)"
    total_err=$((total_err + 1))
  fi
done

elapsed=$(( $(date +%s) - started ))
size=$(du -sh "$DEST" 2>/dev/null | cut -f1)
avail=$(df -h /data | awk 'NR==2{print $4}')
echo "=== Terminé en ${elapsed}s — miroir: ${size:-?} | libre sur /data: $avail | erreurs: $total_err ==="

# Journal court, pour savoir quand la dernière copie a eu lieu.
printf '%s miroir=%s erreurs=%s duree=%ss\n' "$(date -Iseconds)" "${size:-?}" "$total_err" "$elapsed" \
  >> "$DEST/.journal-miroir.log"

exit $(( total_err > 0 ? 1 : 0 ))
