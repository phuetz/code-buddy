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

# Référence VERSIONNÉE des commandes attendues. Frozen snapshot indépendant de
# l'extracteur au moment du balayage : une régression de l'extracteur ou une
# installation qui perd des commandes rend l'extraction plus courte que la
# référence → détectée. Dériver l'attendu par le MÊME extracteur ne verrait
# jamais une cécité commune aux deux côtés (c'est le défaut d'origine du balayage).
REFERENCE="${BALAYAGE_REFERENCE:-$REPO/scripts/balayage-commandes-attendues.txt}"

# --regenerer : met à jour la référence depuis la source (acte DÉLIBÉRÉ). C'est le chemin
# qui PRODUIT l'ancre : s'il est aveugle, toute la protection s'effondre en silence — une
# source cassée régénérerait la référence à 0 ou 3 commandes, et le balayage retomberait à
# « ✓ 3/3 ». Donc : jamais de troncature préventive (on écrit un temp, on remplace après
# validation), refus d'une référence vide, refus d'une chute brutale sans --force, et stderr
# VISIBLE (quand la régénération échoue, c'est le moment de voir pourquoi).
if [ "${1:-}" = "--regenerer" ]; then
  force=false
  [ "${2:-}" = "--force" ] && force=true
  tmp_ref="$(mktemp)"
  {
    if [ -n "${BALAYAGE_SOURCE_ENTREE:-}" ]; then
      env -i "HOME=${HOME:-/tmp}" "PATH=$PATH" "TERM=dumb" NO_COLOR=1 \
        timeout --kill-after=5 "$TIMEOUT" node "$BALAYAGE_SOURCE_ENTREE" --help
    else
      env -i "HOME=${HOME:-/tmp}" "PATH=$PATH" "TERM=dumb" NO_COLOR=1 \
        timeout --kill-after=5 "$TIMEOUT" "$REPO/node_modules/.bin/tsx" "$REPO/src/index.ts" --help
    fi
  } | grep -oE '^  [a-z][a-z0-9-]+' | tr -d ' ' | sort -u > "$tmp_ref"
  nouveau=$(wc -l < "$tmp_ref")

  # Ne JAMAIS écrire une référence vide : c'est exactement la panne que le balayage existe
  # pour attraper. La référence existante reste intacte.
  if [ "$nouveau" -eq 0 ]; then
    echo "✗ régénération abandonnée : la source n'expose aucune commande — référence INCHANGÉE." >&2
    echo "  (source cassée, --help restructuré, ou point d'entrée muet ?) : $REFERENCE" >&2
    rm -f "$tmp_ref"; exit 2
  fi
  # Une chute brutale (103 → 3) est le cas PARTIEL, suspect : refuser sans --force, en nommant
  # ce qui serait perdu. La revue de diff ne peut pas être la seule barrière.
  if [ -f "$REFERENCE" ]; then
    ancien=$(wc -l < "$REFERENCE")
    if [ "$nouveau" -lt "$ancien" ] && ! $force; then
      echo "✗ régénération abandonnée : $nouveau commandes contre $ancien dans la référence." >&2
      echo "  Commandes qui SERAIENT perdues (source cassée ?) :" >&2
      comm -23 <(sort -u "$REFERENCE") "$tmp_ref" | sed 's/^/    - /' >&2
      echo "  Si la suppression est VOULUE : scripts/balayage-installation.sh --regenerer --force" >&2
      rm -f "$tmp_ref"; exit 2
    fi
  fi
  mv "$tmp_ref" "$REFERENCE"
  echo "référence régénérée : $nouveau commandes → $REFERENCE"
  exit 0
fi

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

# L'ATTENDU : les commandes que le paquet DEVRAIT exposer. Un test l'injecte
# (BALAYAGE_ATTENDU) ; en mode réel c'est la référence VERSIONNÉE — jamais
# re-dérivée par le même extracteur, sans quoi une cécité commune aux deux côtés
# passerait inaperçue.
: > "$BASE/attendues.txt"
if [ -n "${BALAYAGE_ATTENDU:-}" ] && [ -f "$BALAYAGE_ATTENDU" ]; then
  sort -u "$BALAYAGE_ATTENDU" > "$BASE/attendues.txt"
elif [ -z "${BALAYAGE_ENTREE:-}" ] && [ -f "$REFERENCE" ]; then
  sort -u "$REFERENCE" > "$BASE/attendues.txt"
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

# La donnée de RÉFÉRENCE doit être gardée comme la donnée d'entrée. Dès qu'une
# référence est ATTENDUE — mode réel (fichier versionné), ou un test qui fournit
# BALAYAGE_ATTENDU — mais qu'elle ressort vide, la comparaison ci-dessous serait
# sautée EN SILENCE et le balayage retomberait au niveau « total>0 » sans le
# signaler : le faux succès sur extraction PARTIELLE reviendrait par cette porte.
reference_attendue=false
[ -n "${BALAYAGE_ATTENDU:-}" ] && reference_attendue=true
[ -z "${BALAYAGE_ENTREE:-}" ] && reference_attendue=true   # mode réel : la référence versionnée
if $reference_attendue && [ "$attendu" -eq 0 ]; then
  echo "✗ référence des commandes attendues absente ou vide : ${BALAYAGE_ATTENDU:-$REFERENCE}" >&2
  echo "  Régénère-la depuis la source : scripts/balayage-installation.sh --regenerer" >&2
  exit 2
fi

# total>0 ne suffit pas : une restructuration PARTIELLE du --help donnerait un
# sous-ensemble (3/30) qui passe la garde et imprime « ✓ 3/3 » — un faux succès avec
# l'apparence d'un vrai balayage. Comparer à l'attendu (référence figée) ferme la
# famille : toute commande attendue absente de l'extraction fait échouer, nommément —
# que la cause soit une installation qui perd la commande OU un extracteur qui a
# cessé de savoir la lire.
if [ "$attendu" -gt 0 ]; then
  manquantes=$(comm -23 "$BASE/attendues.txt" "$BASE/commandes.txt")
  if [ -n "$manquantes" ]; then
    echo "✗ extraction incomplète : $total/$attendu commandes attendues seulement." >&2
    echo "  Manquantes (installation partielle ou extracteur qui ne lit plus ?) :" >&2
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
