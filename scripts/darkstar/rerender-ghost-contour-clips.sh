#!/usr/bin/env bash

# Rerendu non destructif des sept clips Ambre touchés par le contour fantôme.
# Aucune décharge VRAM, interruption, publication ou réutilisation des anciens
# noms de fichiers. Relancer reprend les masters déjà valides.

set -uo pipefail

export PATH="/home/patrice/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin"

REPO=/home/patrice/code-buddy
SELECTED=/home/patrice/Videos/personas/garde-robe-reparee/contours-fantomes-20260731/selected
DESTINATION=/home/patrice/Videos/personas/ambre-scenes/tenues
COMFY=http://127.0.0.1:8189
RENDERER="$REPO/scripts/darkstar/render-native-fashion-clip.ts"
WORKFLOWS="$REPO/scripts/darkstar/workflows"
SOUND="$REPO/scripts/influencer/add-sound.py"
MUSIC="/home/patrice/.codebuddy/media-audio/music/warm/ES_It Could Be Sweet (Instrumental Version) - Ludlow.mp3"
WORK_ROOT="$DESTINATION/.ghost-contour-rerenders-20260731-fresh"
SUMMARY="$WORK_ROOT/summary.tsv"

MOTION="Locked-off vertical close fashion portrait of the exact same adult woman from the repaired input image. Only extremely subtle natural breathing, a few hair strands moving softly, a tiny closed-mouth warm smile, steady direct eye contact with the camera. Maintain the exact original framing and subject scale in every frame. Preserve the exact face, natural eye size, jaw proportions, body, clothing, lighting and background. Absolutely no camera movement, no zoom, no pullback, no reframing, no full-body reveal, no vertical stretching, no scene transition, no new objects, no visible teeth."
SETTING="Use the exact original background from the repaired input keyframe as an immutable plate. Keep every horizon, terrace, plant and furnishing fixed in the same place. Locked camera and fixed crop, no pan, no zoom, no parallax, no decor change."

TASKS=(
  "ambre-kimono-azur-une-piece|726314001|Preserve the repaired navy tank-top neckline and the exact azure kimono, sleeves, edges, colors and fabric without alteration."
  "ambre-jupe-pareo-bandeau|726315001|Preserve the exact repaired bandeau top and pareo skirt, knot, waistline, seams, colors and fabric without alteration."
  "ambre-maillot-une-piece-corail|726316001|Preserve the exact repaired coral one-piece swimsuit, continuous underarm edge, single right arm, color and fabric without alteration."
  "ambre-combishort-lin-sable|726317001|Preserve the exact repaired sand linen playsuit, collar, belt, buttons, pockets, seams and fabric without alteration."
  "ambre-robe-plage-crochet-ecru|726319001|Preserve the exact repaired ecru crochet beach dress, both sleeves, openwork pattern, neckline, edges and fabric without alteration."
  "ambre-robe-longue-fluide-dos-nu|726285001|Preserve the exact repaired burnt-orange long fluid halter dress, symmetric neckline, belt, satin sheen and drape without alteration."
  "ambre-une-piece-blanc-pareo-imprime|726281001|Preserve the exact repaired white one-piece swimsuit and printed tied pareo, symmetric straps, centered buttons, colors, knots and fabric edges."
)

source_for_slug() {
  local slug=$1
  if [ "$slug" = ambre-maillot-une-piece-corail ]; then
    printf '%s/%s-repaired.png\n' "$SELECTED" "$slug"
  else
    printf '%s/%s-inpaint.png\n' "$SELECTED" "$slug"
  fi
}

comfy_idle() {
  local stats queue
  stats=$(curl -fsS --connect-timeout 5 --max-time 10 "$COMFY/system_stats") ||
    return 1
  [ "$(jq -r '.system.os // empty' <<<"$stats")" = win32 ] || return 1
  queue=$(curl -fsS --connect-timeout 5 --max-time 10 "$COMFY/queue") ||
    return 1
  [ "$(jq '(.queue_running | length) + (.queue_pending | length)' <<<"$queue")" -eq 0 ]
}

valid_master() {
  local filename=$1
  [ -s "$filename" ] || return 1
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height,avg_frame_rate:format=duration \
    -of json "$filename" 2>/dev/null |
    jq -e '
      (.streams[0].width == 1080) and
      (.streams[0].height == 1920) and
      (.streams[0].avg_frame_rate == "30/1") and
      ((.format.duration | tonumber) >= 9.5) and
      ((.format.duration | tonumber) <= 11.5)
    ' >/dev/null
}

render_one() {
  local slug=$1 seed=$2 outfit=$3 source output sounded workdir
  source=$(source_for_slug "$slug")
  output="$DESTINATION/$slug-contours-20260731.mp4"
  sounded="$DESTINATION/$slug-contours-20260731-son.mp4"
  workdir="$WORK_ROOT/$slug"
  mkdir -p "$workdir"
  [ -s "$source" ] || {
    printf '%s\tSOURCE_ABSENTE\t%s\n' "$slug" "$source" >>"$SUMMARY"
    return 1
  }
  if ! valid_master "$output"; then
    if ! comfy_idle; then
      printf '%s\tFILE_OCCUPEE_SANS_INTERRUPTION\t%s\n' "$slug" "$source" >>"$SUMMARY"
      return 2
    fi
    (
      cd "$REPO" || exit 90
      npx tsx "$RENDERER" \
        --prompt "$MOTION" \
        --outfit "$outfit" \
        --setting "$SETTING" \
        --keyframe "$source" \
        --comfy "$COMFY" \
        --segments 1 \
        --single-pingpong \
        --anchor-end-to-keyframe \
        --seed "$seed" \
        --workdir "$workdir" \
        --out "$output" \
        --batch-id "ghost-contour-$slug-20260731" \
        --journal "$workdir/retry.jsonl" \
        --max-minutes 720 \
        --workflows-dir "$WORKFLOWS" \
        --seedvr2-batch 5
    ) >>"$workdir/render.log" 2>&1 || {
      printf '%s\tRENDU_ECHEC\t%s\n' "$slug" "$output" >>"$SUMMARY"
      return 1
    }
  fi
  valid_master "$output" || {
    printf '%s\tMASTER_INVALIDE\t%s\n' "$slug" "$output" >>"$SUMMARY"
    return 1
  }
  if [ ! -s "$sounded" ]; then
    python3 "$SOUND" "$output" --music "$MUSIC" --scene sea --out "$sounded" \
      >>"$workdir/sound.log" 2>&1 || {
        printf '%s\tSON_ECHEC\t%s\n' "$slug" "$sounded" >>"$SUMMARY"
        return 1
      }
  fi
  printf '%s\tOK\t%s\t%s\t%s\n' \
    "$slug" "$source" "$output" "$sounded" >>"$SUMMARY"
}

main() {
  local task slug seed outfit status
  mkdir -p "$WORK_ROOT"
  if [ ! -f "$SUMMARY" ]; then
    printf 'slug\tstatus\tsource\tmaster\tmaster_son\n' >"$SUMMARY"
  fi
  comfy_idle || {
    printf 'PRECHECK\tFILE_OCCUPEE_SANS_INTERRUPTION\t%s\n' "$COMFY" >>"$SUMMARY"
    return 2
  }
  for task in "${TASKS[@]}"; do
    IFS='|' read -r slug seed outfit <<<"$task"
    render_one "$slug" "$seed" "$outfit"
    status=$?
    [ "$status" -eq 2 ] && return 2
  done
}

main "$@"
