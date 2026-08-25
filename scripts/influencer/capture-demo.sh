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
set -uo pipefail

usage() { sed -n '2,12p' "$0" | sed 's/^# \?//'; exit 2; }
[ $# -ge 2 ] || usage
MODE=$1; SORTIE=$(realpath -m "$2"); shift 2
mkdir -p "$(dirname "$SORTIE")"

case "$MODE" in
  terminal)
    [ "${1:-}" = "--" ] && shift
    [ $# -ge 1 ] || { echo "aucune commande à filmer" >&2; exit 2; }
    command -v asciinema >/dev/null || { echo "asciinema absent" >&2; exit 2; }
    CAST=$(mktemp --suffix=.cast); rm -f "$CAST"
    # 120×26 remplit presque exactement la dalle 1592×760 de la carte (ratio ~1,99
    # contre 2,09) : peu de bandes latérales. CAPTURE_COLS/ROWS pour une démo dont
    # les lignes sont courtes — moins de colonnes = texte plus gros à l'écran final.
    asciinema rec --cols "${CAPTURE_COLS:-120}" --rows "${CAPTURE_ROWS:-26}" --overwrite \
      --command "$(printf '%q ' "$@")" "$CAST" || true
    [ -s "$CAST" ] || { echo "capture vide" >&2; exit 1; }
    if command -v agg >/dev/null; then
      GIF=$(mktemp --suffix=.gif)
      agg --theme monokai --font-size 20 "$CAST" "$GIF"
      ffmpeg -y -v error -i "$GIF" -movflags +faststart \
        -vf "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -crf 19 -pix_fmt yuv420p "$SORTIE"
      rm -f "$GIF"
    else
      echo "agg absent : installe-le (cargo install --git https://github.com/asciinema/agg)" >&2
      echo "le .cast est conservé : $CAST" >&2; exit 3
    fi
    rm -f "$CAST"
    ;;
  fenetre|ecran)
    SECONDES=${1:-20}
    [ -n "${DISPLAY:-}" ] || { echo "DISPLAY non défini" >&2; exit 2; }
    if [ "$MODE" = fenetre ]; then
      command -v xdotool >/dev/null || { echo "xdotool absent" >&2; exit 2; }
      eval "$(xdotool getactivewindow getwindowgeometry --shell)"
      # x264 exige des dimensions paires.
      GEO="$(( WIDTH / 2 * 2 ))x$(( HEIGHT / 2 * 2 ))"; POS="+${X},${Y}"
    else
      GEO=$(xdpyinfo | awk '/dimensions:/{print $2}'); POS="+0,0"
    fi
    echo "capture $GEO à $POS pendant ${SECONDES}s — ne touche pas à la fenêtre"
    ffmpeg -y -v error -f x11grab -framerate 30 -video_size "$GEO" -i "${DISPLAY}${POS}" \
      -t "$SECONDES" -c:v libx264 -preset fast -crf 19 -pix_fmt yuv420p -movflags +faststart "$SORTIE"
    ;;
  *) usage ;;
esac

ffprobe -v error -show_entries format=duration -show_entries stream=width,height \
  -of csv=p=0 "$SORTIE" | tr '\n' ' '
echo "→ $SORTIE"
