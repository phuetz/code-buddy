#!/usr/bin/env bash
# Return success only when another OpenCode lane is running. BSD pgrep may
# match ancestor command lines; exclude the entire ancestry, not just $$.
opencode_lane_running() {
  local ancestor=$$ parent candidate excluded=" $$ "
  while [ "$ancestor" -gt 1 ]; do
    read -r parent < <(ps -o ppid= -p "$ancestor" 2>/dev/null) || break
    case "$parent" in ''|*[!0-9]*) break ;; esac
    [ "$parent" = "$ancestor" ] && break
    excluded="$excluded$parent "
    ancestor=$parent
  done
  while read -r candidate; do
    case "$candidate" in ''|*[!0-9]*) continue ;; esac
    case "$excluded" in *" $candidate "*) continue ;; esac
    return 0
  done < <(pgrep -f '[o]pencode[[:space:]]+run([[:space:]]|$)')
  return 1
}
