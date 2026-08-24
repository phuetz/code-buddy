#!/usr/bin/env bash
#
# Publication LISA IA — 24 août 2026
#
# Ce que ce script fait, dans cet ordre :
#   1. autorise l'accès aux sous-titres (une seule fois, interactif) ;
#   2. dépose la piste de sous-titres exacte sur la longue GLM déjà en ligne ;
#   3. téléverse 14 Shorts EN PRIVÉ et dépose la piste de chacun.
#
# Ce qu'il ne fait JAMAIS : passer une vidéo en public, supprimer une vidéo, modifier
# un titre ou une description. Tout sort en « private » — c'est toi qui publies, depuis
# YouTube Studio, après relecture.
#
# Pourquoi les sous-titres AVANT le passage en public : YouTube indexe la transcription
# dès la publication, et sa transcription automatique écrit « Deeppsych » pour DeepSeek
# et « Liya » pour Lisa. Déposer notre piste d'abord, c'est lui donner les bons mots
# du premier jour.
#
# Usage :
#   bash ~/publier-lisa.sh              # déroule les étapes, en demandant confirmation
#   bash ~/publier-lisa.sh --essai      # montre tout ce qui serait fait, sans rien envoyer
#   bash ~/publier-lisa.sh --etape 2    # ne joue qu'une étape (1, 2 ou 3)
#
set -uo pipefail

LISA="$HOME/.codebuddy/personas/lisa"
SHORTS="$LISA/shorts-split-2026-08-22"
LONGUE="$LISA/longform-02-glm-2026-08-23"
OUTILS="$HOME/code-buddy/scripts/influencer"
MCP="$HOME/DEV/youtube-mcp"
VIDEO_LONGUE="EWvyPEbY19U"

# Les 14 Shorts jugés publiables tels quels. Les 7 écartés (01 L1, 03 L3, 04 L4, 06 L6,
# 09 L9, 16 N5, 17 V1) ont des phrases cassées à l'écran — aucun nom propre faux, mais un
# re-rendu s'impose avant de les montrer. Détail : AUDIT-TEXTE-ECRAN-2026-08-24.md
SHORTS_OK="02,05,07,08,10,11,12,13,14,15,18,19,20,21"

ESSAI=""
ETAPE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --essai|--dry-run) ESSAI="--dry-run"; shift ;;
    --etape) ETAPE="${2:-}"; shift 2 ;;
    *) echo "option inconnue : $1"; exit 2 ;;
  esac
done

gras()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info()  { printf '   %s\n' "$*"; }
souci() { printf '\033[33m   ⚠ %s\033[0m\n' "$*"; }
stop()  { printf '\033[31m\n✗ %s\033[0m\n' "$*"; exit 1; }

demander() {
  [ -n "$ESSAI" ] && return 0
  printf '\n   %s [o/N] ' "$1"
  read -r reponse < /dev/tty
  case "$reponse" in [oOyY]*) return 0 ;; *) return 1 ;; esac
}

joue_etape() { [ -z "$ETAPE" ] || [ "$ETAPE" = "$1" ]; }

# ---------------------------------------------------------------------------
gras "Contrôles avant de commencer"

for outil in node python3; do
  command -v "$outil" >/dev/null || stop "$outil est introuvable."
done
[ -f "$MCP/.env" ] || stop "$MCP/.env est absent (identifiants Google)."
[ -f "$MCP/tokens.json" ] || stop "$MCP/tokens.json est absent (jeton OAuth)."
[ -f "$OUTILS/youtube_captions.mjs" ] || stop "outil de sous-titres introuvable."
[ -f "$LONGUE/LONG02-glm-talonne-claude-v2.fr.srt" ] || stop "la piste de la longue est absente."

pistes=$(ls "$SHORTS/sous-titres/"*.srt 2>/dev/null | wc -l)
[ "$pistes" -ge 21 ] || souci "seulement $pistes pistes de Shorts trouvées (21 attendues)."
info "outils présents, $pistes pistes de Shorts, piste de la longue présente"
[ -n "$ESSAI" ] && info "MODE ESSAI : rien ne sera envoyé à YouTube"

# ---------------------------------------------------------------------------
if joue_etape 1; then
gras "Étape 1 — autoriser l'accès aux sous-titres"

if grep -q 'youtube.force-ssl' "$MCP/tokens.json"; then
  info "déjà autorisé, rien à faire."
else
  info "Le jeton actuel ne permet pas de déposer des sous-titres (il manque le droit"
  info "« youtube.force-ssl »). Il faut ré-autoriser UNE fois."
  info ""
  info "Ce qui va se passer : une adresse s'affiche, tu l'ouvres dans le navigateur,"
  info "tu te connectes AVEC LE COMPTE PROPRIÉTAIRE DE LA CHAÎNE LISA IA, puis tu colles"
  info "ici le code que Google te renvoie."
  info ""
  info "Ton jeton actuel est déjà sauvegardé (tokens.json.bak-*), rien n'est perdu."

  if [ -n "$ESSAI" ]; then
    info "[essai] la ré-autorisation serait lancée ici."
  elif demander "Lancer la ré-autorisation maintenant ?"; then
    ( cd "$MCP" && npm run auth ) || stop "la ré-autorisation a échoué."
    grep -q 'youtube.force-ssl' "$MCP/tokens.json" \
      || stop "le nouveau jeton ne porte toujours pas le droit demandé — as-tu bien utilisé le compte propriétaire ?"
    info "✅ autorisé."
  else
    stop "Sans cette autorisation, les étapes suivantes ne peuvent pas déposer de sous-titres."
  fi
fi
fi

# ---------------------------------------------------------------------------
if joue_etape 2; then
gras "Étape 2 — sous-titres de la longue « GLM talonne Claude » (déjà en ligne, privée)"

info "vidéo $VIDEO_LONGUE · 18 min 08 s · 427 sous-titres"
info "le texte vient de ton script, pas d'une ré-écoute : aucun nom inventé"

if node "$OUTILS/youtube_captions.mjs" \
  --video "$VIDEO_LONGUE" \
  --file "$LONGUE/LONG02-glm-talonne-claude-v2.fr.srt" \
  --lang fr $ESSAI
then
  info "✅ piste déposée."
elif ! grep -q 'youtube.force-ssl' "$MCP/tokens.json"; then
  souci "l'autorisation manque encore (étape 1) — rien n'a été envoyé."
else
  souci "dépôt impossible pour l'instant. Si la vidéo est encore en cours de traitement"
  souci "chez YouTube, réessaie dans quelques minutes : bash ~/publier-lisa.sh --etape 2"
fi
fi

# ---------------------------------------------------------------------------
if joue_etape 3; then
gras "Étape 3 — 14 Shorts en privé, chacun avec sa piste"

info "blocs publiés : $SHORTS_OK"
info "écartés (re-rendu nécessaire) : 01, 03, 04, 06, 09, 16, 17"
info "chaque Short part en PRIVÉ : rien n'est visible tant que tu ne l'as pas décidé"

JOURNAL="$SHORTS/PACK-PUBLICATION-SPLIT-21.uploads.jsonl"
AVANT=$(wc -l < "$JOURNAL" 2>/dev/null || echo 0)

if demander "Téléverser les 14 Shorts en privé ?"; then
  node "$OUTILS/youtube_upload.mjs" \
    --pack "$SHORTS/PACK-PUBLICATION-SPLIT-21.md" \
    --only "$SHORTS_OK" $ESSAI \
    || souci "au moins un téléversement a échoué — regarde le détail ci-dessus."

  if [ -z "$ESSAI" ]; then
    gras "Étape 3b — dépôt des pistes sur les Shorts qui viennent de partir"
    # On ne lit QUE les lignes ajoutées à l'instant : pas de risque de redéposer une
    # piste sur une vidéo d'une session précédente (ou supprimée depuis).
    tail -n +$((AVANT + 1)) "$JOURNAL" 2>/dev/null | while IFS= read -r ligne; do
      [ -z "$ligne" ] && continue
      id=$(printf '%s' "$ligne" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' 2>/dev/null)
      fichier=$(printf '%s' "$ligne" | python3 -c 'import json,sys,os; print(os.path.basename(json.load(sys.stdin)["file"]))' 2>/dev/null)
      [ -z "$id" ] && continue
      piste="$SHORTS/sous-titres/${fichier%.mp4}.fr.srt"
      if [ ! -f "$piste" ]; then
        souci "pas de piste pour $fichier — Short laissé sans sous-titres."
        continue
      fi
      info "→ $fichier ($id)"
      node "$OUTILS/youtube_captions.mjs" --video "$id" --file "$piste" --lang fr \
        || souci "dépôt échoué pour $id — souvent parce que YouTube traite encore la vidéo. Note l'identifiant et réessaie plus tard."
    done
  fi
else
  info "étape sautée."
fi
fi

# ---------------------------------------------------------------------------
gras "Terminé — ce qu'il te reste à faire"
cat <<'FIN'
   1. Ouvre YouTube Studio et relis les vidéos privées.
   2. Passe en public celles que tu valides. C'est le seul geste qui les rend visibles ;
      ce script ne l'a pas fait et ne le fera jamais tout seul.

   Bon à savoir :
   - Si une vidéo était encore « en cours de traitement » chez YouTube, son dépôt de
     sous-titres a pu échouer. Relance simplement : bash ~/publier-lisa.sh --etape 2
   - Quota : chaque piste coûte 400 unités sur 10 000 par jour ; un téléversement vidéo
     ne coûte qu'une unité dans un compteur séparé (100 par jour). Aucun risque ici.

   Restent en attente, et ce sont tes décisions :
   - 7 Shorts à re-rendre (01, 03, 04, 06, 09, 16, 17) : phrases cassées à l'écran,
     aucun nom propre faux — détail dans AUDIT-TEXTE-ECRAN-2026-08-24.md
   - la longue de 8 min 45 (« L'IA vient de changer de prix et de maître ») : elle est
     prête à publier, mais son script narré n'a pas été conservé, donc je ne peux pas
     lui fabriquer de piste exacte sans la deviner. Dis-moi si on la publie sans piste,
     ou si on reconstitue son texte d'abord.
   - deux défauts dans la VOIX de la longue GLM, que ni le sous-titrage ni un re-rendu
     ne corrigent : « deux mille sept cents » au lieu de 2 800 (une fois sur six), et
     une phrase répétée à 03:50 puis 04:01.
FIN
