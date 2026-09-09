#!/usr/bin/env bash
# tests/scripts/lane_lib.test.sh -- Tests lane_lib.sh (bash pur)
set -euo pipefail

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

LANE_JOURNAL="$TEST_DIR/journal"
LANE_RUN_DIR="$TEST_DIR/run"
export LANE_JOURNAL LANE_RUN_DIR

source "/home/patrice/DEV/code-buddy-audit-scripts-2026-09-09/scripts/lane_lib.sh"

PASS=0 FAIL=0
ok()   { echo "  OK $1"; PASS=$((PASS + 1)); }
nok()  { echo "  KO $1"; FAIL=$((FAIL + 1)); }
assert_file_contains() { grep -qF -- "$2" "$1" 2>/dev/null || { nok "$3 : absent '$2' dans $1"; return; }; ok "$3"; }
assert_file_not_contains() { ! grep -qF -- "$2" "$1" 2>/dev/null || { nok "$3 : présent '$2' dans $1"; return; }; ok "$3"; }

echo "--- 1. lane_log ---"
lane_log "hello log"
assert_file_contains "$LANE_JOURNAL/lane.log" "[20" "log écrit avec horodatage"

binary_payload="avant$(printf \\xFF\\xFE)après"
lane_log "$binary_payload"
assert_file_not_contains "$LANE_JOURNAL/lane.log" "â€¦" "contenu binaire filtré"

echo "--- 2. lane_wait_marker ---"
echo "MARQUEUR_TROUVE" > "$TEST_DIR/marker_test.log"
if lane_wait_marker "$TEST_DIR/marker_test.log" "MARQUEUR_TROUVE" 5; then
    ok "marqueur trouvé"
else
    nok "marqueur trouvé"
fi

if lane_wait_marker "$TEST_DIR/nofile.log" "SIGNAL" 2 >/dev/null 2>&1; then
    nok "fichier absent devrait échouer"
else
    ok "fichier absent -> retour 1"
fi

touch "$TEST_DIR/timeout_test.log"
if lane_wait_marker "$TEST_DIR/timeout_test.log" "NEXISTE_PAS" 3 >/dev/null 2>&1; then
    nok "timeout devrait échouer"
else
    ok "timeout sans marqueur -> retour 1"
fi

echo "--- 3. Pidfile helpers ---"
lane_pidfile_start "test_cmd" sleep 9999 > /dev/null &
sleep 0.5
if lane_pidfile_running "test_cmd"; then
    ok "pidfile_running détecte processus"
else
    nok "pidfile_running détecte processus"
fi

if lane_pidfile_running "test_cmd" "sleep"; then
    ok "cmdline match sleep"
else
    nok "cmdline match sleep"
fi

pf="$LANE_RUN_DIR/fake.pid"
echo "1" > "$pf"
if lane_pidfile_running "fake" "nonexistent_cmd_xyz"; then
    nok "cmdline mismatch devrait échouer"
else
    ok "cmdline mismatch -> retour 1"
fi

lane_pidfile_kill "test_cmd" TERM
if [[ ! -f "$LANE_RUN_DIR/test_cmd.pid" ]]; then
    ok "kill supprime pidfile"
else
    nok "kill supprime pidfile"
fi

lane_pidfile_kill "nonexistent" TERM
ok "kill inexistant ne plante pas"

echo "--- 4. lane_oc_guard ---"
if lane_oc_guard; then
    ok "oc_guard acquiert verrou (pas de processus)"
else
    nok "oc_guard acquiert verrou (pas de processus)"
fi

# Démarrer un vrai processus opencode pour simuler la présence
lane_pidfile_start "_opencode" sleep 9998 > /dev/null &
sleep 0.5

if lane_oc_guard >/dev/null 2>&1; then
    nok "oc_guard devrait refuser quand occupé"
else
    ok "oc_guard refuse quand occupé"
fi
lane_pidfile_kill "_opencode" TERM 2>/dev/null || true
echo "--- 5. lane_push_docs_only ---"
REPO_TEST="$TEST_DIR/repo"
mkdir -p "$REPO_TEST"
(cd "$REPO_TEST" && git init --quiet && git config user.email "t@t.com" && git config user.name "T")

mkdir -p "$REPO_TEST/docs"
mkdir -p "$REPO_TEST/docs"
mkdir -p "$REPO_TEST/docs"
touch "$REPO_TEST/docs/a.md"
(cd "$REPO_TEST" && git add docs/a.md && git commit --quiet -m "doc")
if lane_push_docs_only "$REPO_TEST" HEAD~1 HEAD "docs/" >/dev/null 2>&1; then
    ok "push docs-only autorisé"
else
    nok "push docs-only autorisé"
fi

mkdir -p "$REPO_TEST/src"
mkdir -p "$REPO_TEST/src"
mkdir -p "$REPO_TEST/src"
touch "$REPO_TEST/src/main.js"
(cd "$REPO_TEST" && git add src/main.js && git commit --quiet -m "src")
if lane_push_docs_only "$REPO_TEST" HEAD~1 HEAD "docs/" >/dev/null 2>&1; then
    nok "push refusé devrait échouer"
else
    ok "push refusé fichier hors motif"
fi

echo "--- 6. lane_commit_staged ---"
(lane_commit_staged "$REPO_TEST" "test msg" && ok "commit index vide OK") || nok "commit index vide"

touch "$REPO_TEST/file.txt"
(cd "$REPO_TEST" && git add file.txt)
(lane_commit_staged "$REPO_TEST" "feat: test" && ok "commit index non vide OK") || nok "commit index non vide"

echo "--- 7. lane_marker_end ---"
MARKER_LOG="$TEST_DIR/marker.log"
lane_marker_end "$MARKER_LOG" "TEST_A" 0
assert_file_contains "$MARKER_LOG" "=== TEST_A TERMINÉ ===" "marqueur TERMINÉ"
assert_file_contains "$MARKER_LOG" "MARKER_TEST_A_TERMIN" "marqueur MARKER_ écrit"

if lane_marker_end "$MARKER_LOG" "TEST_B" 1 >/dev/null 2>&1; then
    nok "marker_end(≠0) devrait retourner 1"
else
    ok "marker_end(≠0) retourne 1"
fi
assert_file_contains "$MARKER_LOG" "=== TEST_B ÉCHOUÉ ===" "marqueur ÉCHOUÉ"
assert_file_contains "$MARKER_LOG" "MARKER_TEST_B_ECHOU" "marqueur MARKER_ ÉCHOUÉ"

echo "--- 8. lane_charge_ok ---"
if lane_charge_ok 9999 1; then
    ok "charge_ok seuils hauts passe"
else
    nok "charge_ok seuils hauts"
fi

if lane_charge_ok 0 1 >/dev/null 2>&1; then
    nok "charge_ok(0%) devrait échouer"
else
    ok "charge_ok(0%) bloque"
fi

echo ""
echo "=============================="
echo "Résultats : $PASS OK, $FAIL KO"
echo "=============================="
[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
