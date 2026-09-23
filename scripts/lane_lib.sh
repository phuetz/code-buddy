#!/usr/bin/env bash
# lane_lib.sh — Bibliothèque de garde des chaînes de lanes
set -euo pipefail
LANE_JOURNAL="${LANE_JOURNAL:-/tmp}"
LANE_RUN_DIR="${LANE_RUN_DIR:-/tmp/lanes}"
LANE_LOAD_THRESHOLD="${LANE_LOAD_THRESHOLD:-80}"
LANE_MEM_MIN_GO="${LANE_MEM_MIN_GO:-512}"
mkdir -p "$LANE_RUN_DIR" "$LANE_JOURNAL"

# 1. lane_log "msg" — horodatage, jamais de contenu binaire
lane_log() {
    local msg
    # Octets invalides écartés (iconv -c), caractères de contrôle purgés, accents conservés.
    msg="$(printf '%s' "$*" | iconv -f UTF-8 -t UTF-8 -c | tr -d '\000-\010\013\014\016-\037')"
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$msg" >> "$LANE_JOURNAL/lane.log"
}

# 2. lane_wait_marker "journal" "marqueur" [timeout_s] — grep -aqF borné
lane_wait_marker() {
    local journal="$1" marqueur="$2" timeout_s="${3:-300}" elapsed=0
    [[ ! -f "$journal" ]] && { lane_log "ATTENTE: $marqueur — fichier absent"; return 1; }
    while true; do
        grep -aqF -- "$marqueur" "$journal" 2>/dev/null && return 0
        (( elapsed >= timeout_s )) && { lane_log "TIMEOUT: $marqueur"; return 1; }
        sleep 5; (( elapsed += 5 ))
    done
}

# 3a. Pidfile start — jamais pkill -f, vérification cmdline via /proc
lane_pidfile_start() {
    local nom="$1"; shift
    local pf="$LANE_RUN_DIR/${nom}.pid"
    if [[ -f "$pf" ]]; then
        local old_pid
        old_pid="$(cat -- "$pf")"
        kill -0 "$old_pid" 2>/dev/null && { kill -TERM "$old_pid" 2>/dev/null || true; sleep 1; kill -KILL "$old_pid" 2>/dev/null || true; }
    fi
    "$@" & local pid=$!; printf '%s\n' "$pid" > "$pf"
    lane_log "PIDFILE: $nom (pid=$pid)"; echo "$pid"
}

# 3b. Pidfile running — vérifie existence + cmdline
lane_pidfile_running() {
    local nom="$1"
    local attendu_cmd="${2:-}"
    local pf="$LANE_RUN_DIR/${nom}.pid"
    local pid
    [[ ! -f "$pf" ]] && return 1
    pid="$(cat -- "$pf")"
    kill -0 "$pid" 2>/dev/null || return 1
    if [[ -n "$attendu_cmd" ]] && [[ -r "/proc/$pid/cmdline" ]]; then
        local cmd
        cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        [[ "$cmd" != *"$attendu_cmd"* ]] && { lane_log "PIDFILE: $nom pid=$pid mismatch"; return 1; }
    fi
    return 0
}

# 3c. Pidfile kill propre
lane_pidfile_kill() {
    local nom="$1"
    local signal="${2:-TERM}"
    local pf="$LANE_RUN_DIR/${nom}.pid"
    local pid
    [[ ! -f "$pf" ]] && return 0
    pid="$(cat -- "$pf")"
    kill -0 "$pid" 2>/dev/null && kill -"$signal" "$pid" 2>/dev/null || true
    rm -f -- "$pf"
}

# 4. lane_oc_guard — verrou OpenCode par pidfile
lane_oc_guard() {
    lane_pidfile_running "_opencode" && { lane_log "GUARD: OC déjà actif"; return 1; }
    lane_log "GUARD: verrou OC acquis"
}

# 5. lane_push_docs_only repo base branch pattern
lane_push_docs_only() {
    local repo="$1" base="$2" branche="$3" motif="$4"
    local files
    files="$(cd "$repo" && git diff --name-only "$base"..HEAD 2>/dev/null || true)"
    [[ -z "$files" ]] && { lane_log "PUSH-DOCS: aucun changement"; return 0; }
    local ok=true f
    while IFS= read -r f; do
        [[ -n "$f" ]] && ! echo "$f" | grep -qE "$motif" && { lane_log "PUSH-DOCS: refusé '$f'"; ok=false; }
    done <<< "$files"
    if $ok; then
        (cd "$repo" && git push origin "$branche" 2>&1) || { lane_log "PUSH-DOCS: échec push"; return 1; }
    else
        lane_log "PUSH-DOCS: fichiers: $files"; return 1
    fi
}

# 6. lane_commit_staged repo msg — uniquement si index non vide
lane_commit_staged() {
    local repo="$1" message="$2" count
    count="$(cd "$repo" && git diff --cached --name-only 2>/dev/null | wc -l)"
    if [[ "$count" -gt 0 ]]; then
        (cd "$repo" && git commit -m "$message" 2>&1) || { lane_log "COMMIT: échec"; return 1; }
        lane_log "COMMIT: $count fichier(s) : $message"
    else
        lane_log "COMMIT: index vide"
    fi
}

# 7. lane_marker_end journal nom code — TERMINÉ ou ÉCHOUÉ (marqueurs distincts)
lane_marker_end() {
    local journal="$1" nom="$2" code="${3:-0}" tag="TERMINÉ" rc=0
    [[ "$code" -ne 0 ]] && { tag="ÉCHOUÉ"; rc=1; }
    # Convert accents to ASCII for reliable grep matching
    local atag="${tag//[Éé]/E}"
    atag="${atag//À/A}"
    atag="${atag//à/A}"
    atag="${atag//Ô/o}"
    atag="${atag//ô/o}"
    atag="${atag//Û/u}"
    atag="${atag//û/u}"
    printf '%s\n' "=== ${nom} ${tag} ===" >> "$journal"
    printf '%s\n' "MARKER_${nom}_${atag}" >> "$journal"
    lane_log "MARQUEUR: $nom $tag (code=$code)"
    return "$rc"
}

# 8. lane_charge_ok [load_max] [mem_min_go] — garde CPU/RAM
lane_charge_ok() {
    local max_load="${1:-$LANE_LOAD_THRESHOLD}" min_mem="${2:-$LANE_MEM_MIN_GO}"
    local cores load_avg load_pct mem_free
    cores="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)"
    load_avg="$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)"
    load_pct="$(awk -v la="$load_avg" -v co="$cores" 'BEGIN{printf "%.0f", (la/co)*100}')"
    mem_free="$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
    [[ "$load_pct" -gt "$max_load" ]] && { lane_log "CHARGE: CPU $load_pct%"; return 1; }
    [[ "$mem_free" -lt "$min_mem" ]] && { lane_log "CHARGE: RAM ${mem_free}Mo"; return 1; }
    lane_log "CHARGE: OK (CPU=${load_pct}% RAM=${mem_free}Mo)"
}
