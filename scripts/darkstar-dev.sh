#!/usr/bin/env bash
# Cycle de développement sur darkstar — la machine Windows de la maison.
#
# Pourquoi : Code Buddy suppose un shell POSIX à ~30 endroits, et la CI est le seul juge
# des correctifs Windows — dix minutes par tentative, et le verdict arrive après le push.
# Darkstar a Node 24, PowerShell 5.1 ET pwsh 7 : on peut y reproduire, corriger et vérifier
# avant de pousser quoi que ce soit.
#
#   darkstar-dev.sh envoyer          transfère l'état local (bundle git, rien de public)
#   darkstar-dev.sh test <motif...>  lance vitest là-bas et rapporte ici
#   darkstar-dev.sh tsc              typecheck sur Windows
#   darkstar-dev.sh shell <cmd>      une commande PowerShell, pour reproduire à la main
#   darkstar-dev.sh diff             ce qui a été modifié là-bas et ne l'est pas ici
#   darkstar-dev.sh rapatrier        ramène les modifications de darkstar dans ce dépôt
#
# Le code fait foi ICI. Une correction écrite là-bas se rapatrie et se commite ici, pour
# qu'il n'existe jamais deux vérités. `rapatrier` refuse d'écraser un travail non commité.
set -uo pipefail

HOTE=${DARKSTAR_HOTE_SSH:-patri@darkstar}
DISTANT=${DARKSTAR_DEPOT:-C:/Users/patri/code-buddy}
LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PS='C:/Program Files/PowerShell/7/pwsh.exe'

die() { echo "ERREUR: $*" >&2; exit 1; }
distant() { ssh -o BatchMode=yes "$HOTE" "cd $DISTANT; $*"; }

case "${1:-}" in
  envoyer)
    branche=$(cd "$LOCAL" && git rev-parse --abbrev-ref HEAD)
    attendu=$(cd "$LOCAL" && git rev-parse HEAD)
    tmp=$(mktemp -d); bundle="$tmp/cb.bundle"
    echo "== bundle de $branche"
    (cd "$LOCAL" && git bundle create "$bundle" "$branche") >/dev/null 2>&1 || die "bundle en échec"
    scp -q "$bundle" "$HOTE:C:/Users/patri/cb.bundle" || die "copie en échec"
    rm -rf "$tmp"
    echo "== fetch côté darkstar"
    courante=$(distant "git rev-parse --abbrev-ref HEAD" | tr -d '\r')
    if [ "$courante" = "$branche" ]; then
      # Git refuse de fetcher dans la branche checkoutée : FETCH_HEAD + fast-forward.
      # --ff-only échoue si darkstar a divergé — c'est voulu, le code fait foi ici.
      distant "git fetch C:/Users/patri/cb.bundle ${branche}; git merge --ff-only FETCH_HEAD"
    else
      distant "git fetch C:/Users/patri/cb.bundle ${branche}:refs/heads/${branche} --force; git checkout ${branche} --force"
    fi
    # Le succès se prouve par le résultat, pas par le code de retour du pipe SSH.
    recu=$(distant "git rev-parse HEAD" | tr -d '\r')
    [ "$recu" = "$attendu" ] || die "transfert non prouvé : darkstar=$recu attendu=$attendu"
    echo "== darkstar est à $recu"
    ;;
  test)
    shift; [ $# -gt 0 ] || die "usage: darkstar-dev.sh test <chemin de test...>"
    distant "npx vitest run $* --silent 2>&1 | Select-Object -Last 25"
    ;;
  tsc)
    distant "npx tsc --noEmit -p tsconfig.json 2>&1 | Select-Object -Last 20"
    ;;
  shell)
    shift; [ $# -gt 0 ] || die "usage: darkstar-dev.sh shell <commande powershell>"
    ssh -o BatchMode=yes "$HOTE" "& '$PS' -NoProfile -Command \"cd $DISTANT; $*\""
    ;;
  diff)
    distant "git status --porcelain; echo '---'; git diff --stat"
    ;;
  rapatrier)
    sales=$(cd "$LOCAL" && git status --porcelain | grep -v '^??' | wc -l)
    [ "$sales" -eq 0 ] || die "$sales fichier(s) non commité(s) ici — commite d'abord, le rapatriement écraserait"
    patch=$(mktemp)
    distant "git diff" > "$patch" 2>/dev/null
    if [ ! -s "$patch" ]; then echo "rien à rapatrier"; rm -f "$patch"; exit 0; fi
    echo "== $(grep -c '^+++' "$patch") fichier(s) modifiés sur darkstar"
    (cd "$LOCAL" && git apply --check "$patch") || die "le correctif ne s'applique pas ici — les dépôts ont divergé, refaire 'envoyer'"
    (cd "$LOCAL" && git apply "$patch") && echo "== appliqué ici. Relire, vérifier, puis commiter."
    rm -f "$patch"
    ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \?//'; exit 2 ;;
esac
