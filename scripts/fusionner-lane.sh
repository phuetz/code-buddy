#!/usr/bin/env bash
set -uo pipefail

EXIT_USAGE=2
EXIT_LEDGER=3
EXIT_TESTS=4
EXIT_MERGE=5
JSON=0
MODE=ff-only
MODE_EXPLICIT=0
TESTS_OVERRIDE=
APPROUVE_PAR=

for argument in "$@"; do
  [ "$argument" = --json ] && JSON=1
done

emit_error() {
  local code=$1 type=$2 message=$3
  if [ "$JSON" -eq 1 ]; then
    node -e 'process.stderr.write(JSON.stringify({ok:false,error:process.argv[1],message:process.argv[2],exit_code:Number(process.argv[3])})+"\n")' \
      "$type" "$message" "$code"
  else
    echo "Erreur [$type] : $message" >&2
  fi
  exit "$code"
}

[ "$#" -ge 3 ] || emit_error "$EXIT_USAGE" bad_input \
  'Usage: fusionner-lane.sh <clone> <branche> <dépôt-cible> --approuve-par <nom> [--tests <commande>] [--ff-only|--merge] [--json].'

CLONE_INPUT=$1
BRANCHE=$2
CIBLE_INPUT=$3
shift 3
while [ "$#" -gt 0 ]; do
  case "$1" in
    --approuve-par)
      [ "$#" -ge 2 ] || emit_error "$EXIT_USAGE" bad_input 'Valeur absente pour --approuve-par.'
      APPROUVE_PAR=$2
      shift 2
      ;;
    --tests)
      [ "$#" -ge 2 ] || emit_error "$EXIT_USAGE" bad_input 'Valeur absente pour --tests.'
      TESTS_OVERRIDE=$2
      shift 2
      ;;
    --ff-only|--merge)
      NOUVEAU_MODE=${1#--}
      if [ "$MODE_EXPLICIT" -eq 1 ] && [ "$MODE" != "$NOUVEAU_MODE" ]; then
        emit_error "$EXIT_USAGE" bad_input 'Choisir un seul mode de fusion.'
      fi
      MODE=$NOUVEAU_MODE
      MODE_EXPLICIT=1
      shift
      ;;
    --json)
      shift
      ;;
    *) emit_error "$EXIT_USAGE" bad_input "Option inconnue : $1." ;;
  esac
done

[ -n "$APPROUVE_PAR" ] || emit_error "$EXIT_USAGE" bad_input '--approuve-par est requis.'
CLONE=$(cd "$CLONE_INPUT" 2>/dev/null && pwd) || \
  emit_error "$EXIT_USAGE" bad_input "Clone introuvable : $CLONE_INPUT."
CIBLE=$(cd "$CIBLE_INPUT" 2>/dev/null && pwd) || \
  emit_error "$EXIT_USAGE" bad_input "Dépôt cible introuvable : $CIBLE_INPUT."
[ "$CLONE" != "$CIBLE" ] || emit_error "$EXIT_USAGE" bad_input 'Le clone et le dépôt cible doivent être distincts.'
git -C "$CLONE" rev-parse --git-dir >/dev/null 2>&1 || \
  emit_error "$EXIT_USAGE" bad_input "Clone Git invalide : $CLONE."
git -C "$CIBLE" rev-parse --git-dir >/dev/null 2>&1 || \
  emit_error "$EXIT_USAGE" bad_input "Dépôt Git cible invalide : $CIBLE."

SOURCE_HEAD=$(git -C "$CLONE" rev-parse --verify "refs/heads/$BRANCHE^{commit}" 2>/dev/null) || \
  emit_error "$EXIT_USAGE" bad_input "Branche introuvable dans le clone : $BRANCHE."
BRANCHE_COURANTE=$(git -C "$CLONE" branch --show-current 2>/dev/null || true)
[ "$BRANCHE_COURANTE" = "$BRANCHE" ] || emit_error "$EXIT_USAGE" bad_input \
  "La branche $BRANCHE doit être extraite dans le clone pour tester exactement sa tête."
[ -z "$(git -C "$CLONE" status --porcelain 2>/dev/null)" ] || \
  emit_error "$EXIT_USAGE" dirty_source 'Le clone de lane contient des changements non commités.'
[ -z "$(git -C "$CIBLE" status --porcelain 2>/dev/null)" ] || \
  emit_error "$EXIT_USAGE" dirty_target 'Le dépôt cible contient des changements non commités.'
CIBLE_HEAD=$(git -C "$CIBLE" rev-parse HEAD 2>/dev/null) || \
  emit_error "$EXIT_USAGE" bad_input 'Le dépôt cible doit avoir un commit initial.'

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LEDGER="$SCRIPT_DIR/lane-ledger.sh"
if ! VERIFICATION=$("$LEDGER" verify --json 2>&1); then
  emit_error "$EXIT_LEDGER" ledger_invalid "Le journal de lanes est invalide : $VERIFICATION"
fi
if ! LANE=$("$LEDGER" find-delegation \
  --repository "$CLONE" --branch "$BRANCHE" --head "$SOURCE_HEAD" --json 2>&1); then
  emit_error "$EXIT_LEDGER" ledger_entry_missing \
    "Aucune entrée vérifiée ne couvre la branche $BRANCHE à $SOURCE_HEAD."
fi
LANE_HEAD_AVANT=$(printf '%s' "$LANE" | node -e \
  'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).entry.head_before))') || \
  emit_error "$EXIT_LEDGER" ledger_invalid 'Impossible de lire la base de la lane vérifiée.'
LANE_RAPPORT=$(printf '%s' "$LANE" | node -e \
  'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).entry.report))') || \
  emit_error "$EXIT_LEDGER" ledger_invalid 'Impossible de lire le rapport de la lane vérifiée.'
LANE_RAPPORT_SHA=$(printf '%s' "$LANE" | node -e \
  'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).entry.report_sha256))') || \
  emit_error "$EXIT_LEDGER" ledger_invalid 'Impossible de lire le hash du rapport vérifié.'
git -C "$CLONE" cat-file -e "$LANE_HEAD_AVANT^{commit}" 2>/dev/null || \
  emit_error "$EXIT_LEDGER" ledger_invalid 'Le HEAD initial de la lane est absent du clone.'
RAPPORT_CANONIQUE=$(realpath -e "$CLONE/$LANE_RAPPORT" 2>/dev/null) || \
  emit_error "$EXIT_LEDGER" report_invalid 'Le rapport signé est absent du clone.'
case "$RAPPORT_CANONIQUE" in
  "$CLONE"/*) ;;
  *) emit_error "$EXIT_LEDGER" report_invalid 'Le rapport signé sort du clone.' ;;
esac
RAPPORT_SHA_ACTUEL=$(sha256sum "$RAPPORT_CANONIQUE" | cut -d' ' -f1)
[ "$RAPPORT_SHA_ACTUEL" = "$LANE_RAPPORT_SHA" ] || \
  emit_error "$EXIT_LEDGER" report_invalid 'Le rapport livré ne correspond plus à son SHA-256 signé.'

TEST_FILES=()
while IFS= read -r -d '' fichier; do
  case "$fichier" in
    tests/*.test.ts|tests/*.test.tsx|tests/*.spec.ts|tests/*.spec.tsx)
      TEST_FILES+=("$fichier")
      ;;
  esac
done < <(git -C "$CLONE" diff --name-only -z "$LANE_HEAD_AVANT..$SOURCE_HEAD" -- tests)

if [ -n "$TESTS_OVERRIDE" ]; then
  TESTS_COMMANDE=$TESTS_OVERRIDE
elif [ "${#TEST_FILES[@]}" -gt 0 ]; then
  printf -v TESTS_COMMANDE 'npx vitest run %q ' "${TEST_FILES[@]}"
  TESTS_COMMANDE=${TESTS_COMMANDE% }
else
  TESTS_COMMANDE='aucun fichier de test touché'
fi
COMMANDE_COMPLETE="npm run typecheck && $TESTS_COMMANDE"

if [ "$JSON" -eq 1 ]; then
  (cd "$CLONE" && npm run typecheck) >/dev/null 2>&1
else
  echo "→ Typecheck dans $CLONE"
  (cd "$CLONE" && npm run typecheck)
fi
CODE_TEST=$?
if [ "$CODE_TEST" -eq 0 ] && [ -n "$TESTS_OVERRIDE" ]; then
  if [ "$JSON" -eq 1 ]; then
    (cd "$CLONE" && bash -c "$TESTS_OVERRIDE") >/dev/null 2>&1
  else
    echo "→ Tests : $TESTS_OVERRIDE"
    (cd "$CLONE" && bash -c "$TESTS_OVERRIDE")
  fi
  CODE_TEST=$?
elif [ "$CODE_TEST" -eq 0 ] && [ "${#TEST_FILES[@]}" -gt 0 ]; then
  if [ "$JSON" -eq 1 ]; then
    (cd "$CLONE" && npx vitest run "${TEST_FILES[@]}") >/dev/null 2>&1
  else
    echo "→ Tests touchés : ${TEST_FILES[*]}"
    (cd "$CLONE" && npx vitest run "${TEST_FILES[@]}")
  fi
  CODE_TEST=$?
fi

RESULTAT_TESTS=passed
[ "$CODE_TEST" -eq 0 ] || RESULTAT_TESTS=failed
if ! APPROBATION=$($LEDGER append approval \
  --approved-by "$APPROUVE_PAR" \
  --repository "$CLONE" \
  --target-repository "$CIBLE" \
  --branch "$BRANCHE" \
  --head "$SOURCE_HEAD" \
  --tests-command "$COMMANDE_COMPLETE" \
  --tests-result "$RESULTAT_TESTS" \
  --tests-exit-code "$CODE_TEST" \
  --json 2>&1); then
  emit_error "$EXIT_LEDGER" ledger_write_failed "Impossible d'écrire l'approbation : $APPROBATION"
fi
if [ "$CODE_TEST" -ne 0 ]; then
  emit_error "$EXIT_TESTS" tests_failed "Les vérifications ont échoué avec le code $CODE_TEST ; fusion refusée."
fi

SOURCE_HEAD_APRES=$(git -C "$CLONE" rev-parse --verify "refs/heads/$BRANCHE^{commit}" 2>/dev/null) || \
  emit_error "$EXIT_LEDGER" source_changed 'La branche source a disparu après les vérifications.'
[ "$SOURCE_HEAD_APRES" = "$SOURCE_HEAD" ] || emit_error "$EXIT_LEDGER" source_changed \
  'La branche source a changé pendant les vérifications ; relancer la porte.'
[ "$(git -C "$CIBLE" rev-parse HEAD 2>/dev/null)" = "$CIBLE_HEAD" ] || \
  emit_error "$EXIT_MERGE" target_changed 'La tête cible a changé pendant les vérifications.'
[ -z "$(git -C "$CIBLE" status --porcelain 2>/dev/null)" ] || \
  emit_error "$EXIT_MERGE" dirty_target 'Le dépôt cible a changé pendant les vérifications.'

if [ "$JSON" -eq 1 ]; then
  git -C "$CIBLE" fetch --no-tags "$CLONE" "refs/heads/$BRANCHE" >/dev/null 2>&1
else
  echo "→ Import local de $BRANCHE"
  git -C "$CIBLE" fetch --no-tags "$CLONE" "refs/heads/$BRANCHE"
fi
[ "$?" -eq 0 ] || emit_error "$EXIT_MERGE" merge_failed 'Impossible d’importer la branche locale.'
FETCHED_HEAD=$(git -C "$CIBLE" rev-parse FETCH_HEAD 2>/dev/null) || \
  emit_error "$EXIT_MERGE" merge_failed 'FETCH_HEAD absent après import local.'
[ "$FETCHED_HEAD" = "$SOURCE_HEAD" ] || emit_error "$EXIT_MERGE" source_changed \
  'La branche importée ne correspond plus à la tête approuvée.'

if [ "$MODE" = ff-only ]; then
  git -C "$CIBLE" merge-base --is-ancestor "$CIBLE_HEAD" FETCH_HEAD >/dev/null 2>&1 || \
    emit_error "$EXIT_MERGE" merge_failed 'La fusion exige un merge non fast-forward ; relancer avec --merge.'
else
  git -C "$CIBLE" merge-tree --write-tree "$CIBLE_HEAD" FETCH_HEAD >/dev/null 2>&1 || \
    emit_error "$EXIT_MERGE" merge_failed 'La fusion explicite présenterait des conflits.'
fi

if [ "$JSON" -eq 1 ]; then
  if [ "$MODE" = ff-only ]; then
    git -C "$CIBLE" merge --ff-only FETCH_HEAD >/dev/null 2>&1
  else
    git -C "$CIBLE" merge --no-ff --no-edit FETCH_HEAD >/dev/null 2>&1
  fi
else
  echo "→ Fusion $MODE dans $CIBLE"
  if [ "$MODE" = ff-only ]; then
    git -C "$CIBLE" merge --ff-only FETCH_HEAD
  else
    git -C "$CIBLE" merge --no-ff --no-edit FETCH_HEAD
  fi
fi
CODE_FUSION=$?
if [ "$CODE_FUSION" -ne 0 ]; then
  git -C "$CIBLE" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && \
    git -C "$CIBLE" merge --abort >/dev/null 2>&1
  emit_error "$EXIT_MERGE" merge_failed "Git a refusé la fusion avec le code $CODE_FUSION."
fi

HEAD_FINAL=$(git -C "$CIBLE" rev-parse HEAD)
if [ "$JSON" -eq 1 ]; then
  node -e 'process.stdout.write(JSON.stringify({ok:true,mode:process.argv[1],branch:process.argv[2],head:process.argv[3],target_head:process.argv[4]})+"\n")' \
    "$MODE" "$BRANCHE" "$SOURCE_HEAD" "$HEAD_FINAL"
else
  echo "Lane $BRANCHE approuvée et fusionnée ($MODE), cible $HEAD_FINAL."
fi
