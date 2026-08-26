#!/usr/bin/env bash
# Filme un outil en marche, pour en faire une carte « démo » dans une vidéo longue.
#
#   capture-demo.sh terminal <sortie.mp4> -- <commande...>   filme un terminal qui exécute la commande
#   capture-demo.sh fenetre  <sortie.mp4> [secondes]         filme la fenêtre active
#   capture-demo.sh ecran    <sortie.mp4> [secondes]         filme tout l'écran
#
# Pourquoi filmer plutôt que capturer une image : une carte `capture` prouve qu'une
# source EXISTE, une carte `demo` prouve qu'un outil FONCTIONNE. C'est la seule
# chose qu'un concurrent qui commente l'actualité ne peut pas fabriquer.
#
# Le terminal passe par asciinema + agg : la sortie est nette à n'importe quelle
# taille (c'est du texte re-rendu, pas des pixels agrandis), et rien de l'écran
# réel n'est filmé — aucune fuite de fenêtre, de notification ou de nom de fichier.
#
# PIÈGE AVANT `fenetre`/`ecran` : Chromium installé par snap est confiné par
# AppArmor. Son option --screenshot échoue hors de $HOME avec « No such file or
# directory », même si le dossier existe. Utiliser brave-browser pour préparer
# une capture destinée au dépôt, ou écrire d'abord sous $HOME puis déplacer.
set -euo pipefail

usage() { sed -n '2,19p' "$0" | sed 's/^# \?//'; exit 2; }
die() { echo "ERREUR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 absent"; }

positive_number() {
  [[ $1 =~ ^([0-9]+([.][0-9]*)?|[.][0-9]+)$ ]] &&
    awk -v value="$1" 'BEGIN { exit !(value > 0) }'
}

CAST=''
GIF=''
STATUS_FILE=''
TMP_SORTIE=''
KEEP_CAST=0

cleanup() {
  [ -z "$GIF" ] || rm -f -- "$GIF"
  [ -z "$STATUS_FILE" ] || rm -f -- "$STATUS_FILE"
  [ -z "$TMP_SORTIE" ] || rm -f -- "$TMP_SORTIE"
  if [ -n "$CAST" ]; then
    if [ "$KEEP_CAST" -eq 1 ] && [ -s "$CAST" ]; then
      echo "le .cast est conservé pour diagnostic : $CAST" >&2
    else
      rm -f -- "$CAST"
    fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

validate_video() {
  local path=$1 dims duration width height
  dims=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
    -of csv=s=x:p=0 "$path") || return 1
  duration=$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$path") || return 1
  [[ $dims =~ ^([0-9]+)x([0-9]+)$ ]] || return 1
  width=${BASH_REMATCH[1]}; height=${BASH_REMATCH[2]}
  positive_number "$duration" || return 1
  [ "$width" -gt 0 ] && [ "$height" -gt 0 ] || return 1
  [ $((width % 2)) -eq 0 ] && [ $((height % 2)) -eq 0 ] || return 1
  VIDEO_DIMS=$dims
  VIDEO_DURATION=$duration
}

[ $# -ge 2 ] || usage
MODE=$1; shift
case "$MODE" in terminal|fenetre|ecran) ;; *) usage ;; esac

need realpath
need mktemp
need ffmpeg
need ffprobe
need flock

SORTIE=$(realpath -m "$1"); shift
SORTIE_DIR=$(dirname "$SORTIE")
mkdir -p "$SORTIE_DIR" || die "impossible de créer le dossier de sortie : $SORTIE_DIR"
[ -d "$SORTIE_DIR" ] && [ -w "$SORTIE_DIR" ] || die "dossier de sortie non accessible en écriture : $SORTIE_DIR"

# Deux captures vers le même nom ne doivent ni s'écraser ni annoncer le fichier de
# l'autre. Les fichiers de travail, eux, sont tous uniques et vivent à côté de la
# sortie : pas de nom fixe partagé, pas d'écriture dans /tmp.
LOCK_FILE="$SORTIE_DIR/.$(basename "$SORTIE").capture.lock"
exec 9>"$LOCK_FILE"
flock -n 9 || die "une autre capture écrit déjà vers $SORTIE"
TMP_SORTIE=$(mktemp --tmpdir="$SORTIE_DIR" ".$(basename "$SORTIE").XXXXXX.mp4")

case "$MODE" in
  terminal)
    [ "${1:-}" = "--" ] && shift
    [ $# -ge 1 ] || { echo "aucune commande à filmer" >&2; exit 2; }
    need asciinema
    need agg
    need timeout

    CAPTURE_TIMEOUT_SECONDS=${CAPTURE_TIMEOUT_SECONDS:-120}
    positive_number "$CAPTURE_TIMEOUT_SECONDS" || die \
      "CAPTURE_TIMEOUT_SECONDS doit être un nombre strictement positif (reçu : $CAPTURE_TIMEOUT_SECONDS)"

    CAST=$(mktemp --tmpdir="$SORTIE_DIR" ".$(basename "$SORTIE").XXXXXX.cast")
    STATUS_FILE=$(mktemp --tmpdir="$SORTIE_DIR" ".$(basename "$SORTIE").XXXXXX.status")
    GIF=$(mktemp --tmpdir="$SORTIE_DIR" ".$(basename "$SORTIE").XXXXXX.gif")
    command_text=$(printf '%q ' "$@")
    status_quoted=$(printf '%q' "$STATUS_FILE")
    wrapped_command="${command_text}; capture_rc=\$?; printf '%s\\n' \"\$capture_rc\" > ${status_quoted}; exit \"\$capture_rc\""

    set +e
    timeout --foreground --signal=INT --kill-after=5s "${CAPTURE_TIMEOUT_SECONDS}s" \
      asciinema rec --cols "${CAPTURE_COLS:-120}" --rows "${CAPTURE_ROWS:-26}" --overwrite \
        --command "$wrapped_command" "$CAST"
    record_rc=$?
    set -e
    if [ "$record_rc" -eq 124 ]; then
      KEEP_CAST=1
      die "commande interrompue après ${CAPTURE_TIMEOUT_SECONDS}s (CAPTURE_TIMEOUT_SECONDS pour ajuster)"
    fi
    if [ ! -s "$STATUS_FILE" ]; then
      KEEP_CAST=1
      die "enregistrement interrompu avant la fin de la commande"
    fi
    command_rc=$(sed -n '1p' "$STATUS_FILE")
    [[ $command_rc =~ ^[0-9]+$ ]] || { KEEP_CAST=1; die "statut de la commande illisible"; }
    if [ "$command_rc" -ne 0 ]; then
      KEEP_CAST=1
      die "la commande filmée a échoué (code $command_rc)"
    fi
    if ! awk 'NR > 1 { found=1 } END { exit !found }' "$CAST"; then
      KEEP_CAST=1
      die "capture vide : la commande n'a produit aucune sortie"
    fi
    if ! agg --theme monokai --font-size 20 "$CAST" "$GIF"; then
      KEEP_CAST=1
      die "agg n'a pas pu convertir l'enregistrement"
    fi
    if ! ffmpeg -y -v error -i "$GIF" -movflags +faststart \
      -vf "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -crf 19 \
      -pix_fmt yuv420p "$TMP_SORTIE"; then
      KEEP_CAST=1
      die "ffmpeg n'a pas pu encoder la capture terminal"
    fi
    ;;
  fenetre|ecran)
    SECONDES=${1:-20}
    positive_number "$SECONDES" || die "durée invalide : $SECONDES (nombre strictement positif attendu)"
    [ -n "${DISPLAY:-}" ] || { echo "DISPLAY non défini" >&2; exit 2; }
    if [ "$MODE" = fenetre ]; then
      need xdotool
      if ! window_geometry=$(xdotool getactivewindow getwindowgeometry --shell 2>&1); then
        die "aucune fenêtre active accessible sur DISPLAY=$DISPLAY : $window_geometry"
      fi
      X=$(awk -F= '$1 == "X" { print $2 }' <<<"$window_geometry")
      Y=$(awk -F= '$1 == "Y" { print $2 }' <<<"$window_geometry")
      WIDTH=$(awk -F= '$1 == "WIDTH" { print $2 }' <<<"$window_geometry")
      HEIGHT=$(awk -F= '$1 == "HEIGHT" { print $2 }' <<<"$window_geometry")
      [[ $X =~ ^-?[0-9]+$ && $Y =~ ^-?[0-9]+$ && $WIDTH =~ ^[0-9]+$ && $HEIGHT =~ ^[0-9]+$ ]] ||
        die "géométrie de fenêtre invalide : ${window_geometry//$'\n'/ }"
      POS="+${X},${Y}"
    else
      need xdpyinfo
      if ! screen_geometry=$(xdpyinfo 2>&1); then
        die "écran inaccessible sur DISPLAY=$DISPLAY : $screen_geometry"
      fi
      raw_geometry=$(awk '/dimensions:/ { print $2; exit }' <<<"$screen_geometry")
      [[ $raw_geometry =~ ^([0-9]+)x([0-9]+)$ ]] || die "dimensions d'écran introuvables sur DISPLAY=$DISPLAY"
      WIDTH=${BASH_REMATCH[1]}; HEIGHT=${BASH_REMATCH[2]}
      X=0; Y=0; POS='+0,0'
    fi
    WIDTH=$((WIDTH / 2 * 2)); HEIGHT=$((HEIGHT / 2 * 2))
    [ "$WIDTH" -ge 2 ] && [ "$HEIGHT" -ge 2 ] || die "dimensions trop petites après arrondi pair : ${WIDTH}x${HEIGHT}"
    GEO="${WIDTH}x${HEIGHT}"
    echo "capture $GEO à $POS pendant ${SECONDES}s — ne touche pas à la fenêtre"
    if ! ffmpeg -y -v error -f x11grab -framerate 30 -video_size "$GEO" -i "${DISPLAY}${POS}" \
      -t "$SECONDES" -c:v libx264 -preset fast -crf 19 -pix_fmt yuv420p \
      -movflags +faststart "$TMP_SORTIE"; then
      die "ffmpeg n'a pas pu capturer $MODE sur DISPLAY=$DISPLAY"
    fi
    ;;
esac

if ! validate_video "$TMP_SORTIE"; then
  KEEP_CAST=1
  die "capture refusée : le MP4 produit est absent, vide, corrompu ou incompatible avec x264"
fi
chmod 0644 "$TMP_SORTIE"
mv -f -- "$TMP_SORTIE" "$SORTIE"
TMP_SORTIE=''
KEEP_CAST=0
printf '%s %s ' "${VIDEO_DIMS/x/,}" "$VIDEO_DURATION"
echo "→ $SORTIE"
