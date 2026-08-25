#!/usr/bin/env bash
#
# À lancer demain matin après 9h (heure de Paris), quand le quota YouTube est réinitialisé.
#
#   1. dépose les 9 pistes de sous-titres qui manquent ;
#   2. retire les 6 Shorts en double (ceux du 24/08 à 07:35, qui portent l'ancien rendu).
#
# Il ne rend AUCUNE vidéo publique — ça reste ton geste, dans YouTube Studio, une fois
# les sous-titres en place.
#
# Usage :
#   bash ~/demain-lisa.sh            # fait le travail
#   bash ~/demain-lisa.sh --essai    # montre ce qui serait fait, sans rien changer
#
set -uo pipefail

LISA="$HOME/.codebuddy/personas/lisa"
SHORTS="$LISA/shorts-split-2026-08-22"
OUTILS="$HOME/code-buddy/scripts/influencer"
ESSAI=""
[ "${1:-}" = "--essai" ] || [ "${1:-}" = "--dry-run" ] && ESSAI="oui"

gras()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info()  { printf '   %s\n' "$*"; }
souci() { printf '\033[33m   ⚠ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
gras "Quota disponible ?"

# Le sondage doit coûter AUTANT que l'opération visée. Un appel à 1 unité (channels.list)
# passe encore quand il ne reste que des miettes, et laisse croire que le quota est reparti :
# mesuré le 25/08 à 3h47, il annonçait « disponible » alors que les neuf dépôts ont tous
# échoué. On sonde donc avec captions.list, qui coûte 50 unités comme celui qui précède
# chaque dépôt.
if node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const {createRequire}=require('module');
const MCP=path.join(os.homedir(),'DEV','youtube-mcp');
const {google}=createRequire(path.join(MCP,'package.json'))('googleapis');
const env={};
for(const l of fs.readFileSync(path.join(MCP,'.env'),'utf8').split('\n')){
  const m=l.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*)\s*\$/);
  if(m)env[m[1]]=m[2].replace(/^['\"]|['\"]\$/g,'');
}
const o=new google.auth.OAuth2(env.GOOGLE_CLIENT_ID,env.GOOGLE_CLIENT_SECRET,'http://localhost:8723');
o.setCredentials(JSON.parse(fs.readFileSync(path.join(MCP,'tokens.json'),'utf8')));
google.youtube({version:'v3',auth:o}).captions.list({part:['snippet'],videoId:'ARYfmvZ4H5E'})
  .then(()=>process.exit(0)).catch(e=>{console.error(e.message.split('\n')[0].slice(0,70));process.exit(1);});
" 2>&1 | sed 's/^/   /'; then
  info "✅ le quota est reparti."
else
  souci "le quota est encore épuisé — il se réinitialise à 9h00 (heure de Paris)."
  souci "reviens plus tard et relance : bash ~/demain-lisa.sh"
  exit 1
fi

# ---------------------------------------------------------------------------
gras "1/2 — les 9 pistes de sous-titres qui manquent"
info "N3, N4, N5, V1 à V5, et la longue « L'IA vient de changer de prix »"
info "coût : environ 4 050 unités sur 10 000"

if [ -n "$ESSAI" ]; then
  bash "$HOME/publier-lisa.sh" --essai --etape 5
else
  bash "$HOME/publier-lisa.sh" --etape 5
fi

# ---------------------------------------------------------------------------
gras "2/2 — retirer les 6 Shorts en double"
info "Les Shorts L1 à L6 ont été mis en ligne deux fois : ceux de 07:35 portent le rendu"
info "d'AVANT correction (« tout chinois », punchline coupée). On retire les anciens."
info ""
info "Garde-fou : aucun doublon n'est retiré tant que son remplaçant n'a pas été VU en"
info "ligne — si la dernière version avait disparu, l'ancienne serait la seule copie."

if [ -n "$ESSAI" ]; then
  node "$OUTILS/youtube_supprimer_doublons.mjs" \
    "$SHORTS/PACK-PUBLICATION-SPLIT-21.uploads.jsonl"
else
  node "$OUTILS/youtube_supprimer_doublons.mjs" \
    "$SHORTS/PACK-PUBLICATION-SPLIT-21.uploads.jsonl" --faire
fi

# ---------------------------------------------------------------------------
gras "Terminé"
cat <<'FIN'
   Il ne reste qu'un geste, et il est à toi :

   Ouvre YouTube Studio, relis les 21 Shorts et les 2 longues (toutes privées), et
   passe en public celles que tu valides.

   Fais-le APRÈS les sous-titres, jamais avant : YouTube indexe la transcription au
   moment du passage en public.

   Si un dépôt a encore échoué, relance simplement — les pistes déjà posées sont
   sautées, rien n'est refait deux fois :
       bash ~/demain-lisa.sh
FIN
