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
#
# Pour placer BALAYAGE_DIR sous le dépôt sans laisser la résolution Node
# remonter vers son node_modules, les tests peuvent fournir :
#   BALAYAGE_NODE_OPTIONS="--experimental-loader=... --require=..."
#   BALAYAGE_BLOCKED_MODULES="pkg-a,pkg-b"
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${BALAYAGE_DIR:-$(mktemp -d)}"
mkdir -p "$BASE"   # BALAYAGE_DIR peut nommer un répertoire encore inexistant
OMIT="--omit=optional"
[ "${1:-}" = "--avec-optionnelles" ] && OMIT=""
# Un process qui ignore SIGTERM ferait hangner tout le balayage sans --kill-after ;
# les tests raccourcissent le délai via BALAYAGE_TIMEOUT.
TIMEOUT="${BALAYAGE_TIMEOUT:-45}"

if [ -n "${BALAYAGE_ENTREE:-}" ]; then
  # Point d'entrée injecté (tests) : on exerce l'extraction et les gardes sans
  # build/pack/install réels.
  ENTREE="$BALAYAGE_ENTREE"
  [ -f "$ENTREE" ] || { echo "point d'entrée injecté introuvable : $ENTREE"; exit 2; }
else
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
fi
mkdir -p "$BASE/home"

# Environnement vide : ni clé d'API, ni configuration héritée.
appel() {
  local -a environnement=(
    "HOME=$BASE/home"
    "PATH=/usr/bin:/bin"
    "TERM=dumb"
  )
  [ -n "${BALAYAGE_NODE_OPTIONS:-}" ] && environnement+=("NODE_OPTIONS=$BALAYAGE_NODE_OPTIONS")
  [ -n "${BALAYAGE_BLOCKED_MODULES:-}" ] && environnement+=("CODEBUDDY_TEST_BLOCKED_MODULES=$BALAYAGE_BLOCKED_MODULES")
  env -i "${environnement[@]}" timeout --kill-after=5 "$TIMEOUT" node "$ENTREE" "$@" 2>&1
}

# Extrait la liste des sous-commandes d'un point d'entrée node depuis son --help.
extraire_commandes() {
  env -i "HOME=$BASE/home" "PATH=/usr/bin:/bin" "TERM=dumb" \
    timeout --kill-after=5 "$TIMEOUT" node "$1" --help 2>&1 \
    | grep -oE '^  [a-z][a-z0-9-]+' | tr -d ' ' | sort -u
}

extraire_commandes "$ENTREE" > "$BASE/commandes.txt"
total=$(wc -l < "$BASE/commandes.txt")

# L'ATTENDU : les commandes que le paquet DEVRAIT exposer. Fourni par un test
# (BALAYAGE_ATTENDU), sinon dérivé de la SOURCE (dist du dépôt) en mode réel — le
# balayage vérifie justement que l'INSTALLÉ se comporte comme la source.
: > "$BASE/attendues.txt"
if [ -n "${BALAYAGE_ATTENDU:-}" ] && [ -f "$BALAYAGE_ATTENDU" ]; then
  sort -u "$BALAYAGE_ATTENDU" > "$BASE/attendues.txt"
elif [ -z "${BALAYAGE_ENTREE:-}" ] && [ -f "$REPO/dist/index.js" ]; then
  extraire_commandes "$REPO/dist/index.js" > "$BASE/attendues.txt"
fi
attendu=$(wc -l < "$BASE/attendues.txt")

# Une extraction vide n'est PAS un succès : le balayage n'a rien pu tester (aide
# restructurée, sortie sur stderr, env -i cassé…). Sans cette garde, la boucle ne
# tourne pas, n=0, et le script annonce « ✓ 0/0 » — aveugle à sa propre panne.
if [ "$total" -eq 0 ]; then
  echo "✗ aucune commande extraite de --help : le balayage n'a rien pu tester" >&2
  echo "  (aide restructurée, sortie sur stderr, ou point d'entrée muet ?) — traces : $BASE" >&2
  exit 2
fi

# total>0 ne suffit pas : une restructuration PARTIELLE du --help donnerait un
# sous-ensemble (3/30) qui passe la garde et imprime « ✓ 3/3 » — un faux succès avec
# l'apparence d'un vrai balayage. Comparer à l'attendu ferme la famille : toute
# commande attendue absente de l'extraction fait échouer, nommément.
if [ "$attendu" -gt 0 ]; then
  manquantes=$(comm -23 "$BASE/attendues.txt" "$BASE/commandes.txt")
  if [ -n "$manquantes" ]; then
    echo "✗ extraction incomplète : $total/$attendu commandes attendues seulement." >&2
    echo "  Manquantes (aide restructurée ou installation partielle ?) :" >&2
    echo "$manquantes" | sed 's/^/    - /' >&2
    echo "  traces : $BASE" >&2
    exit 2
  fi
fi
echo "== balayage de $total commandes"

: > "$BASE/fautives.txt"
: > "$BASE/resultats.txt"
while read -r c; do
  sortie="$(appel "$c" --help)"
  statut=$?
  if [ "$statut" -ne 0 ] || grep -qE "Cannot find package|ERR_MODULE_NOT_FOUND|Unhandled promise|Crash context saved" <<<"$sortie"; then
    paquet="$(grep -oE "Cannot find package '[^']+'" <<<"$sortie" | head -1 | cut -d"'" -f2)"
    raison="${paquet:-exit-$statut}"
    echo "$c|$raison" >> "$BASE/fautives.txt"
    echo "$c|$statut|FAIL|$raison" >> "$BASE/resultats.txt"
    printf '  ✗ %-18s %s\n' "$c" "$raison"
  else
    echo "$c|$statut|PASS" >> "$BASE/resultats.txt"
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
