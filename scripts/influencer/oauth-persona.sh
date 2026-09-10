#!/usr/bin/env bash
# Authentifie youtube-mcp sur la chaîne d'UNE persona (ambre, jade…) SANS écraser
# les jetons de LISA IA, qui vivent dans ~/DEV/youtube-mcp/tokens.json.
#
#   bash scripts/influencer/oauth-persona.sh ambre   → tokens-ambre.json
#   bash scripts/influencer/oauth-persona.sh jade    → tokens-jade.json
#
# `npm run auth` écrit TOUJOURS dans tokens.json : on met Lisa à l'abri, on lance
# l'auth, on range le résultat sous tokens-<persona>.json et on remet Lisa en
# place quoi qu'il arrive (Ctrl-C compris). Au sélecteur Google, choisir la
# chaîne de la persona — la chaîne doit EXISTER AVANT (sinon le sélecteur ne la
# propose pas et on authentifie Lisa une seconde fois).
set -euo pipefail
persona="${1:-}"
[[ "$persona" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "usage : $0 <persona> (ambre, jade…)" >&2; exit 2; }
mcp="$HOME/DEV/youtube-mcp"
lisa="$mcp/tokens.json"
cible="$mcp/tokens-$persona.json"
abri="$mcp/tokens.json.lisa-abri-$(date +%Y%m%d-%H%M%S)"
[[ -f "$lisa" ]] || { echo "aucun $lisa : Lisa n'est pas authentifiée, rien à protéger — lancer npm run auth nu" >&2; exit 3; }
[[ -f "$cible" ]] && { echo "$cible existe déjà — le supprimer d'abord si tu veux ré-authentifier" >&2; exit 4; }

cp -p "$lisa" "$abri"
remettre_lisa() {
  if [[ -f "$abri" ]]; then
    cp -p "$abri" "$lisa"
    echo "Lisa remise en place depuis $(basename "$abri")"
  fi
}
trap remettre_lisa EXIT

# Retirer tokens.json pour que auth-setup ne demande pas « Re-authorize? » sur Lisa.
rm -f "$lisa"
echo "→ auth youtube-mcp pour la chaîne « $persona » : choisis CETTE chaîne dans le sélecteur Google, pas Lisa IA."
( cd "$mcp" && npm run --silent auth )

if [[ -f "$lisa" ]]; then
  mv "$lisa" "$cible"
  echo "Jetons rangés dans $cible"
else
  echo "aucun jeton produit (auth interrompue ?)" >&2
fi
# Le trap remet Lisa dans tokens.json.
trap - EXIT; remettre_lisa

cat <<FIN

CONTRÔLE OBLIGATOIRE — imprime le nom de la chaîne authentifiée :
  node ~/code-buddy/scripts/influencer/youtube_channel_settings.mjs --show --tokens $cible
Si elle affiche « Lisa IA » : rm $cible et recommencer (le script settings refuse
de toute façon d'écrire sur Lisa avec ces jetons, deuxième filet).
FIN
