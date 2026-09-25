#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -n "${P4_OUTPUT_DIR:-}" ]]; then
  OUT="$P4_OUTPUT_DIR"
  if [[ -e "$OUT" ]]; then
    echo "P4_OUTPUT_DIR already exists; choose a new empty path." >&2
    exit 2
  fi
  mkdir -p "$OUT"
else
  OUT="$(mktemp -d /tmp/codebuddy-p4-replay.XXXXXX)"
fi

TMP="$(mktemp -d /tmp/codebuddy-p4-profile.XXXXXX)"
mkdir -p "$TMP/home" "$TMP/config" "$TMP/data" "$TMP/cache" "$TMP/workspace"
trap 'rm -rf "$TMP"' EXIT

export P4_HOME="$TMP/home"
export P4_CONFIG="$TMP/config"
export P4_DATA="$TMP/data"
export P4_CACHE="$TMP/cache"
export P4_WORKSPACE="$TMP/workspace"

run_cli() {
  env -i \
    PATH=/usr/bin:/bin \
    LANG=C.UTF-8 \
    HOME="$P4_HOME" \
    USERPROFILE="$P4_HOME" \
    CODEBUDDY_HOME="$P4_HOME/.codebuddy" \
    CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT="$P4_WORKSPACE" \
    XDG_CONFIG_HOME="$P4_CONFIG" \
    XDG_DATA_HOME="$P4_DATA" \
    XDG_CACHE_HOME="$P4_CACHE" \
    OLLAMA_HOST=http://127.0.0.1:11434 \
    npm_config_cache="$P4_CACHE/npm" \
    npm_config_offline=true \
    npm_config_update_notifier=false \
    npx tsx src/index.ts "$@"
}

echo "artifact_dir=$OUT"
echo "profile=temporary"
echo "network_allowance=127.0.0.1 only"

# Port inspection only: these listeners are deliberately never contacted.
if command -v ss >/dev/null 2>&1; then
  ss -H -ltn | awk '
    { addr=$4; sub(/^.*:/, "", addr); if (addr==3000 || addr==3001 || addr==5099 || addr==8787) print "reserved_port=" addr " state=occupied; not contacted" }
  ' | sort -u > "$OUT/reserved-ports.txt"
fi
cat "$OUT/reserved-ports.txt" 2>/dev/null || true

# Loopback-only provider canary. No prompt or generation request is sent.
set +e
env -i PATH=/usr/bin:/bin curl --noproxy '*' --fail --silent --show-error --max-time 5 http://127.0.0.1:11434/api/tags > "$OUT/ollama-tags.json" 2> "$OUT/ollama-tags.stderr"
OLLAMA_EXIT=$?
set -e
printf 'ollama_tags_exit=%s bytes=%s\n' "$OLLAMA_EXIT" "$(wc -c < "$OUT/ollama-tags.json")"

# The advertised generator is retained as a raw compatibility result even if
# this source revision does not implement that command.
set +e
run_cli catalog generate --json > "$OUT/catalog-generate.stdout" 2> "$OUT/catalog-generate.stderr"
CATALOG_EXIT=$?
set -e
printf 'catalog_generate_exit=%s stdout_bytes=%s stderr_bytes=%s\n' \
  "$CATALOG_EXIT" "$(wc -c < "$OUT/catalog-generate.stdout")" "$(wc -c < "$OUT/catalog-generate.stderr")"

set +e
run_cli --help > "$OUT/root-help.stdout" 2> "$OUT/root-help.stderr"
ROOT_HELP_EXIT=$?
set -e
if [[ "$ROOT_HELP_EXIT" -ne 0 ]]; then
  echo "root --help failed; stopping." >&2
  exit "$ROOT_HELP_EXIT"
fi

python3 - "$OUT/root-help.stdout" "$OUT/commands.txt" <<'PY'
import re, sys
text = open(sys.argv[1], encoding='utf-8').read().split('Commands:', 1)[1]
rows = [m.group(1) for line in text.splitlines() if (m := re.match(r'^  (\S+)', line))]
names = [name for row in rows for name in row.split('|')]
open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(names) + '\n')
print(f'catalog_source=runtime --help rows={len(rows)} command_names={len(names)}')
PY

printf 'command\targs\thelp_exit\taction_exit\taction_duration_ms\tstdout_bytes\tstderr_bytes\n' > "$OUT/summary.tsv"

safe_args() {
  ACTION_ARGS=()
  ACTION_SAFE=1
  case "$1" in
    models) ACTION_ARGS=(list) ;;
    changelog|whoami|llm|intent) ACTION_ARGS=() ;;
    ws) ACTION_ARGS=(search p4-proof) ;;
    channels) ACTION_ARGS=(list) ;;
    provider) ACTION_ARGS=(inventory) ;;
    mcp) ACTION_ARGS=(list) ;;
    campaign|maison|pipeline) ACTION_ARGS=(status) ;;
    influencer) ACTION_ARGS=(list) ;;
    remind|rules) ACTION_ARGS=(list) ;;
    daemon|heartbeat|companion|groups|fleet|pairing|lsp) ACTION_ARGS=(status) ;;
    trigger|webhook|devices|device|auth-profile|gateway-pairing|approvals|nodes) ACTION_ARGS=(list) ;;
    assistant) ACTION_ARGS=(show) ;;
    self) ACTION_ARGS=(evolution) ;;
    widgets) ACTION_ARGS=(list) ;;
    security) ACTION_ARGS=(audit --json) ;;
    doctor) ACTION_ARGS=(--offline --json) ;;
    security-audit) ACTION_ARGS=(--json) ;;
    ollama) ACTION_ARGS=(status) ;;
    hub) ACTION_ARGS=(list) ;;
    curator) ACTION_ARGS=(latest) ;;
    autonomy) ACTION_ARGS=(status) ;;
    identity) ACTION_ARGS=(show) ;;
    hermes) ACTION_ARGS=(status) ;;
    tools) ACTION_ARGS=(catalog --json) ;;
    session) ACTION_ARGS=(search p4-proof) ;;
    config) ACTION_ARGS=(show) ;;
    cost) ACTION_ARGS=(--last) ;;
    policy) ACTION_ARGS=(check) ;;
    run|cron|skills|knowledge|intents|spec|bundles|evolve|backup|secrets) ACTION_ARGS=(list) ;;
    shadow) ACTION_ARGS=(status) ;;
    research) ACTION_ARGS=(stats) ;;
    film) ACTION_ARGS=(status p4-proof) ;;
    exchange) ACTION_ARGS=(constitution) ;;
    capsule) ACTION_ARGS=(list) ;;
    todo) ACTION_ARGS=(context) ;;
    execpolicy) ACTION_ARGS=(list) ;;
    lessons) ACTION_ARGS=(stats) ;;
    resources) ACTION_ARGS=(schema) ;;
    user-model) ACTION_ARGS=(show) ;;
    insights) ACTION_ARGS=(summary) ;;
    improve) ACTION_ARGS=(status) ;;
    deploy) ACTION_ARGS=(platforms) ;;
    provision) ACTION_ARGS=(db-auth --target local --dir "$P4_WORKSPACE" --json) ;;
    sensory) ACTION_ARGS=(status) ;;
    completions) ACTION_ARGS=(bash) ;;
    *) ACTION_SAFE=0 ;;
  esac
}

while IFS= read -r name; do
  [[ -n "$name" ]] || continue
  mkdir -p "$OUT/cli/$name"
  set +e
  run_cli "$name" --help > "$OUT/cli/$name/help.stdout" 2> "$OUT/cli/$name/help.stderr"
  HELP_EXIT=$?
  set -e

  safe_args "$name"
  ACTION_EXIT=""
  ACTION_DURATION=""
  STDOUT_BYTES=0
  STDERR_BYTES=0
  ARG_TEXT=""
  if [[ "$ACTION_SAFE" -eq 1 ]]; then
    ARG_TEXT="$(printf '%s ' "${ACTION_ARGS[@]}")"
    ARG_TEXT="${ARG_TEXT% }"
    START_NS="$(date +%s%N)"
    set +e
    run_cli "$name" "${ACTION_ARGS[@]}" > "$OUT/cli/$name/action.stdout" 2> "$OUT/cli/$name/action.stderr"
    ACTION_EXIT=$?
    set -e
    END_NS="$(date +%s%N)"
    ACTION_DURATION=$(( (END_NS - START_NS) / 1000000 ))
    STDOUT_BYTES="$(wc -c < "$OUT/cli/$name/action.stdout")"
    STDERR_BYTES="$(wc -c < "$OUT/cli/$name/action.stderr")"
  else
    ARG_TEXT="(aucune sous-commande sûre retenue)"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$name" "$ARG_TEXT" "$HELP_EXIT" "$ACTION_EXIT" "$ACTION_DURATION" "$STDOUT_BYTES" "$STDERR_BYTES" \
    >> "$OUT/summary.tsv"
  printf '%s help=%s action=%s duration_ms=%s stdout=%s stderr=%s\n' \
    "$name" "$HELP_EXIT" "${ACTION_EXIT:-SKIP}" "${ACTION_DURATION:-n/a}" "$STDOUT_BYTES" "$STDERR_BYTES"
done < "$OUT/commands.txt"

# Re-run the focused regression suite with a temp config file so Vite does not
# write its bundled config into the shared, read-only node_modules symlink.
mkdir -p "$TMP/test-home" "$TMP/test-profile"
python3 - "$TMP/vitest.config.ts" "$ROOT" <<'PY'
from pathlib import Path
import sys
out, root = sys.argv[1:]
text = Path(root, 'vitest.config.ts').read_text()
text = text.replace("from 'vitest/config'", f"from '{root}/node_modules/vitest/dist/config.js'")
for old, new in [
    ("'./tests/setup/home-isolation.ts'", f"'{root}/tests/setup/home-isolation.ts'"),
    ("'./vitest.setup.ts'", f"'{root}/vitest.setup.ts'"),
    ("'./tests/setup/home-isolation-global.ts'", f"'{root}/tests/setup/home-isolation-global.ts'"),
    ("'./tests/hygiene/no-repo-writes-global-setup.ts'", f"'{root}/tests/hygiene/no-repo-writes-global-setup.ts'"),
    ("path.resolve(__dirname, './src')", f"'{root}/src'"),
    ("path.resolve(__dirname, './tests/support/jest-globals.ts')", f"'{root}/tests/support/jest-globals.ts'"),
]:
    text = text.replace(old, new)
Path(out).write_text(text)
PY
set +e
env -i \
  PATH=/usr/bin:/bin \
  LANG=C.UTF-8 \
  HOME="$TMP/test-home" \
  USERPROFILE="$TMP/test-home" \
  CODEBUDDY_HOME="$TMP/test-profile" \
  XDG_CONFIG_HOME="$P4_CONFIG" \
  XDG_DATA_HOME="$P4_DATA" \
  XDG_CACHE_HOME="$P4_CACHE" \
  npm_config_cache="$P4_CACHE/npm" \
  npm_config_offline=true \
  npm_config_update_notifier=false \
  npx vitest run --configLoader runner --config "$TMP/vitest.config.ts" tests/workspace/ws-cli.test.ts \
  > "$OUT/ws-cli-test.stdout" 2> "$OUT/ws-cli-test.stderr"
WS_TEST_EXIT=$?
set -e
printf 'ws_cli_test_exit=%s stdout_bytes=%s stderr_bytes=%s\n' \
  "$WS_TEST_EXIT" "$(wc -c < "$OUT/ws-cli-test.stdout")" "$(wc -c < "$OUT/ws-cli-test.stderr")"
if [[ "$WS_TEST_EXIT" -ne 0 ]]; then
  echo "ws CLI regression test failed; see captured output." >&2
  exit "$WS_TEST_EXIT"
fi

# Public MCP stdio exchange: initialize and enumerate tools. No tool is called.
for mode in serve legacy; do
  mkdir -p "$OUT/mcp"
  python3 - "$mode" "$OUT" <<'PY'
import json, os, subprocess, sys, time
mode, out = sys.argv[1:]
command = ['npx', 'tsx', 'src/index.ts', 'mcp', 'serve'] if mode == 'serve' else ['npx', 'tsx', 'src/index.ts', 'mcp-server']
messages = [
    {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'p4-proof','version':'1'}}},
    {'jsonrpc':'2.0','method':'notifications/initialized','params':{}},
    {'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}},
]
env = {
    'PATH': '/usr/bin:/bin',
    'LANG': 'C.UTF-8',
    'HOME': os.environ['P4_HOME'],
    'USERPROFILE': os.environ['P4_HOME'],
    'CODEBUDDY_HOME': os.path.join(os.environ['P4_HOME'], '.codebuddy'),
    'CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT': os.environ['P4_WORKSPACE'],
    'XDG_CONFIG_HOME': os.environ['P4_CONFIG'],
    'XDG_DATA_HOME': os.environ['P4_DATA'],
    'XDG_CACHE_HOME': os.environ['P4_CACHE'],
    'OLLAMA_HOST': 'http://127.0.0.1:11434',
    'npm_config_cache': os.path.join(os.environ['P4_CACHE'], 'npm'),
    'npm_config_offline': 'true',
    'npm_config_update_notifier': 'false',
}
start = time.monotonic()
proc = subprocess.run(command, input='\n'.join(map(json.dumps, messages))+'\n', text=True, capture_output=True, timeout=30, env=env)
duration = round((time.monotonic()-start)*1000)
stem = os.path.join(out, 'mcp', mode)
open(stem+'.stdout','w',encoding='utf-8').write(proc.stdout)
open(stem+'.stderr','w',encoding='utf-8').write(proc.stderr)
responses=[]
for line in proc.stdout.splitlines():
    try: responses.append(json.loads(line))
    except json.JSONDecodeError: pass
listing=next((item for item in responses if item.get('id')==2),{})
tools=listing.get('result',{}).get('tools',[])
read_only=sum(item.get('annotations',{}).get('readOnlyHint') is True for item in tools)
print(f'mcp_{mode}_exit={proc.returncode} duration_ms={duration} stdout_bytes={len(proc.stdout.encode())} stderr_bytes={len(proc.stderr.encode())} tools={len(tools)} annotated_read_only={read_only}')
if proc.returncode != 0 or not tools or not listing:
    raise SystemExit(1)
PY
done

if [[ -x cowork/node_modules/.bin/electron && -f cowork/dist-electron/main/index.js ]]; then
  echo "cowork_runtime=available; this replay leaves the desktop app closed"
else
  echo "cowork_runtime=unavailable (Electron executable or compiled main entry missing)"
fi

echo "raw_outputs=$OUT"
