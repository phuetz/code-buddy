#!/usr/bin/env bash
# Vérifie qu'une installation neuve de Code Buddy répond sur TOUTES ses commandes.
#
# Construit le paquet publiable, l'installe dans un répertoire vierge SANS les
# dépendances optionnelles (le cas d'un utilisateur sans chaîne de compilation),
# puis appelle chaque commande avec un HOME neuf et un environnement vide.
#
# Sortie 0 : aucune commande ne plante. Sortie 1 : la liste des fautives.
#
#   scripts/balayage-installation.sh [--avec-optionnelles]
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${BALAYAGE_DIR:-$(mktemp -d)}"
mkdir -p "$BASE"   # BALAYAGE_DIR peut nommer un répertoire encore inexistant
OMIT="--omit=optional"
[ "${1:-}" = "--avec-optionnelles" ] && OMIT=""

echo "== construction"
( cd "$REPO" && npm run build ) > "$BASE/build.log" 2>&1 || { echo "build en échec, voir $BASE/build.log"; exit 2; }

echo "== empaquetage"
TGZ="$(cd "$REPO" && npm pack --silent 2>/dev/null | tail -1)"
[ -n "$TGZ" ] || { echo "npm pack n'a rien produit"; exit 2; }
mkdir -p "$BASE/install" && mv "$REPO/$TGZ" "$BASE/install/"

echo "== installation propre ${OMIT:-(avec les optionnelles)}"
( cd "$BASE/install" && npm init -y >/dev/null 2>&1 && npm install "./$TGZ" $OMIT --no-audit --no-fund ) \
  > "$BASE/install.log" 2>&1 || { echo "installation en échec, voir $BASE/install.log"; exit 2; }

ENTREE="$BASE/install/node_modules/@phuetz/code-buddy/dist/index.js"
[ -f "$ENTREE" ] || { echo "point d'entrée introuvable : $ENTREE"; exit 2; }
mkdir -p "$BASE/home"

# Environnement vide : ni clé d'API, ni configuration héritée.
appel() { env -i HOME="$BASE/home" PATH=/usr/bin:/bin TERM=dumb timeout 45 node "$ENTREE" "$@" 2>&1; }

appel --help | grep -oE '^  [a-z][a-z0-9-]+' | tr -d ' ' | sort -u > "$BASE/commandes.txt"
total=$(wc -l < "$BASE/commandes.txt")
echo "== balayage de $total commandes"

: > "$BASE/fautives.txt"
while read -r c; do
  sortie="$(appel "$c" --help)"
  if grep -qE "Cannot find package|ERR_MODULE_NOT_FOUND|Unhandled promise|Crash context saved" <<<"$sortie"; then
    paquet="$(grep -oE "Cannot find package '[^']+'" <<<"$sortie" | head -1 | cut -d"'" -f2)"
    echo "$c|${paquet:-inconnu}" >> "$BASE/fautives.txt"
    printf '  ✗ %-18s %s\n' "$c" "${paquet:-plantage}"
  fi
done < "$BASE/commandes.txt"

n=$(wc -l < "$BASE/fautives.txt")
echo
if [ "$n" -eq 0 ]; then
  echo "✓ $total/$total commandes répondent sur une installation neuve"
  exit 0
fi
echo "✗ $n/$total commandes plantent — par paquet manquant :"
cut -d'|' -f2 "$BASE/fautives.txt" | sort | uniq -c | sort -rn | sed 's/^/   /'
echo
echo "traces : $BASE"
exit 1
