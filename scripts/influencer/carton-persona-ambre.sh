#!/usr/bin/env bash
# Incruste le carton obligatoire d'Ambre (PACK-LANCEMENT §6B) dans les 2,5 premières secondes d'une vidéo :
#   « IMAGES VIRTUELLES · FILM D’AMBIANCE » / « Ambre est une narratrice virtuelle »
# Usage : carton-persona-ambre.sh ENTREE.mp4 SORTIE.mp4   (ne touche jamais l'original ; audio copié tel quel)
set -euo pipefail
in="$1"; out="$2"
GRAS=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
NORMAL=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
read -r W H < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$in" | tr ',' ' ')
if [ "$H" -gt "$W" ]; then S1=46; S2=36; Y1='340'; Y2='408'; else S1=40; S2=30; Y1='h-190'; Y2='h-134'; fi
ALPHA='if(lt(t,0.3),t/0.3,if(gt(t,2.1),max(0,(2.5-t)/0.4),1))'
L1="${CARTON_L1:-IMAGES VIRTUELLES · FILM D’AMBIANCE}"
L2="${CARTON_L2:-Ambre est une narratrice virtuelle}"
ffmpeg -y -v error -i "$in" -vf "\
drawtext=fontfile=$GRAS:text='$L1':fontsize=$S1:fontcolor=white:x=(w-text_w)/2:y=$Y1:box=1:boxcolor=black@0.55:boxborderw=18:alpha='$ALPHA':enable='between(t,0,2.5)',\
drawtext=fontfile=$NORMAL:text='$L2':fontsize=$S2:fontcolor=#f5ece1:x=(w-text_w)/2:y=$Y2:box=1:boxcolor=black@0.55:boxborderw=14:alpha='$ALPHA':enable='between(t,0,2.5)'" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a copy -movflags +faststart "$out"
echo "$out"
