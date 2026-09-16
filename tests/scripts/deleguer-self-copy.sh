#!/usr/bin/env bash
# Non-régression : deleguer.sh ne doit plus se relire pendant son exécution.
# Le moteur factice « echo » insère 20 lignes en tête du script d'ORIGINE pendant la lane.
# - avec l'auto-copie (défaut) : la lane termine avec code 0 et son épilogue normal ;
# - DELEGUER_NO_SELF_COPY=1 (comportement d'avant) : bash relit le fichier décalé.
# Usage : bash tests/scripts/deleguer-self-copy.sh   (sortie 0 = vert)
set -uo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$ICI/../../scripts/deleguer.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/deleguer-selfcopy-XXXXXX")"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/depot" "$T/home"
( cd "$T/depot" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init )
printf '# Mission factice\nBonjour.\n' > "$T/mission.md"

lance() { # $1 = copie du script à tester, $2 = variable d'environnement optionnelle
  cp "$SRC" "$1" && chmod +x "$1"
  ( cd "$ICI/../.." && env HOME="$T/home" ${2:-} bash "$1" "$T/depot" "$T/mission.md" echo ) > "$T/out.txt" 2>&1
  echo $?
}

rc_avec=$(lance "$T/avec.sh")
grep -q "moteur echo: source modifiée" "$T/out.txt" && grep -q "moteur echo · " "$T/out.txt" && ok_avec=1 || ok_avec=0
lignes_ajoutees=$(grep -c "^# ligne de test" "$T/avec.sh")

rc_sans=$(lance "$T/sans.sh" "DELEGUER_NO_SELF_COPY=1")
grep -q "unbound variable\|syntax error\|command not found\|No such file" "$T/out.txt" && casse_sans=1 || casse_sans=0

echo "avec auto-copie : code=$rc_avec épilogue=$ok_avec lignes_insérées=$lignes_ajoutees"
echo "sans auto-copie : code=$rc_sans dérive_détectée=$casse_sans"
if [ "$rc_avec" = 0 ] && [ "$ok_avec" = 1 ] && [ "$lignes_ajoutees" = 20 ]; then
  echo "VERT : la lane survit à l'édition à chaud du script"; exit 0
fi
echo "ROUGE"; exit 1
