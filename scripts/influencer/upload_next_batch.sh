#!/bin/bash
# Upload quotidien en PRIVÉ des 6 shorts suivants du pack LISA IA (quota API YouTube ≈ 6 uploads/jour). Patrice publie/programme dans YouTube Studio.
# État : ~/.codebuddy/personas/lisa/shorts-split-2026-08-22/_upload-state (dernier index uploadé). Pack : PACK-PUBLICATION-SPLIT-21.md (01..21).
set -u; D=$HOME/.codebuddy/personas/lisa/shorts-split-2026-08-22; S=$D/_upload-state; P=$D/PACK-PUBLICATION-SPLIT-21.md
[ -f "$D/MUSIQUE-TIERS-2026-08-23.md" ] || { echo "$(date +%F) re-rendu musique pas encore fini — rien uploadé" >> $D/_upload-daily.log; exit 0; }
last=$(cat "$S" 2>/dev/null || echo 0); [ "$last" -ge 21 ] && { echo "$(date +%F) pack terminé" >> $D/_upload-daily.log; exit 0; }
ONLY=$(seq -f "%02g" $((last+1)) $(( last+6 > 21 ? 21 : last+6 )) | paste -sd, -)
cd $HOME/code-buddy/scripts/influencer && node youtube_upload.mjs --pack "$P" --only "$ONLY" --privacy private >> "$D/_upload-daily.log" 2>&1 && echo $(( last+6 > 21 ? 21 : last+6 )) > "$S"
echo "$(date +%F_%H%M) uploadés (privé) : $ONLY" >> $D/_upload-daily.log
