#!/usr/bin/env bash
# Rejoue les sondes réelles de la campagne P1. Réseau : Ollama sur loopback.
set -u

if [[ $# -gt 0 && -e "$1" ]]; then
  echo "Refus : le répertoire de sortie existe déjà : $1" >&2
  exit 2
fi
P1_RUN_DIR="${1:-$(mktemp -d /tmp/codebuddy-preuves-p1.XXXXXX)}"
P1_HOME="$P1_RUN_DIR/home"
P1_CODEBUDDY_HOME="$P1_RUN_DIR/codebuddy"
P1_XDG="$P1_RUN_DIR/xdg"
P1_WORK="$P1_RUN_DIR/work"
P1_LOGS="$P1_RUN_DIR/traces"
P1_FAILURES=0
mkdir -p "$P1_HOME" "$P1_CODEBUDDY_HOME" "$P1_XDG" "$P1_WORK" "$P1_LOGS"
printf 'La couleur du phare est indigo.\n' > "$P1_WORK/indice.txt"
echo "Traces : $P1_LOGS"

P1_ENV=(env -i PATH="$PATH" HOME="$P1_HOME" USERPROFILE="$P1_HOME"
  CODEBUDDY_HOME="$P1_CODEBUDDY_HOME" XDG_CONFIG_HOME="$P1_XDG"
  CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://127.0.0.1:11434
  GROK_MODEL=qwen3:4b-instruct CODEBUDDY_PEER_MODEL=qwen3:4b-instruct
  CODEBUDDY_CONTEXT_ZOOM=true CODEBUDDY_CKG_SYNC=true
  NO_COLOR=1 npm_config_update_notifier=false npm_config_offline=true
  P1_WORK="$P1_WORK")

run() {
  local label="$1"
  shift
  if [[ -n "${P1_ONLY:-}" && ",${P1_ONLY}," != *",${label},"* ]]; then
    return 0
  fi
  echo "=== $label ==="
  printf 'COMMANDE : '
  printf '%q ' "$@"
  printf '\n'
  local started=$SECONDS
  "${P1_ENV[@]}" "$@" 2>&1 | tee "$P1_LOGS/$label.log"
  local status=${PIPESTATUS[0]}
  echo "MESURE : statut=$status durée=$((SECONDS - started))s octets=$(wc -c < "$P1_LOGS/$label.log")"
  if [[ "$status" -ne 0 ]]; then
    P1_FAILURES=$((P1_FAILURES + 1))
  fi
  return 0
}

run boucle timeout 180 npx --no-install tsx src/index.ts -d "$P1_WORK" \
  -p 'Utilise l outil view_file pour lire indice.txt, puis réponds uniquement avec la couleur que tu as lue.' \
  --enabled-tools view_file --output-format stream-json
run outils timeout 90 npx --no-install tsx scripts/preuves/p1.ts tools
run fournisseurs timeout 90 npx --no-install tsx scripts/preuves/p1.ts providers
run rag timeout 90 npx --no-install tsx scripts/preuves/p1.ts rag
run contexte timeout 90 npx --no-install tsx scripts/preuves/p1.ts context
run episode timeout 90 npx --no-install tsx scripts/preuves/p1.ts episode
run oubli timeout 90 npx --no-install tsx scripts/preuves/p1.ts forgetting
run autorisations timeout 90 npx --no-install tsx scripts/preuves/p1.ts permissions
run bac_a_sable timeout 90 npx --no-install tsx scripts/preuves/p1.ts sandbox
run bascule timeout 120 npx --no-install tsx scripts/preuves/p1.ts fallback
run sous_agents timeout 240 npx --no-install tsx scripts/preuves/p1.ts subagents
run essaim timeout 240 npx --no-install tsx scripts/preuves/p1.ts swarm
run flotte timeout 180 npx --no-install tsx scripts/preuves/p1.ts fleet
run conseil timeout 240 npx --no-install tsx src/index.ts council \
  'Quelle est la couleur du ciel clair ? Réponds en un mot.' \
  --count 2 --models ollama/qwen3:4b-instruct,ollama/qwen2.5:7b-instruct \
  --judge ollama/qwen3:4b-instruct --no-synthesis
if [[ -f "$P1_LOGS/conseil.log" ]]; then
  if rg -q 'Apprentissage council ignoré|Pas de verdict fiable' "$P1_LOGS/conseil.log"; then
    echo 'ASSERTION conseil avec arbitrage et apprentissage : ÉCHEC' | tee -a "$P1_LOGS/conseil.log"
    P1_FAILURES=$((P1_FAILURES + 1))
  else
    echo 'ASSERTION conseil avec arbitrage et apprentissage : OK' | tee -a "$P1_LOGS/conseil.log"
  fi
fi

echo "FIN : $P1_LOGS ; assertions en échec=$P1_FAILURES"
if [[ "$P1_FAILURES" -gt 0 ]]; then exit 1; fi
