#!/usr/bin/env bash
# buddy-sense demo — the nervous system, end to end, headless.
#
# Boots a tiny Code Buddy receiver (the sensory bridge → event bus) and runs the
# Rust daemon, then shows real SensoryEvents flowing across the WebSocket bridge:
#   - vital  : the autonomic heartbeat (always on), with live system load
#   - audio  : VAD over a generated speech WAV → speech_start / speech_end
# No hardware required (heartbeat + WAV path). Live mic/camera/screen/ui senses are
# opt-in Cargo features — see README.md.
#
# Usage:  ./demo.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PORT=18200
LISA_VOICE="${LISA_VOICE:-$HOME/DEV/lisa/voices/fr_FR-siwis-medium.onnx}"
WAV=/tmp/buddy-sense-demo.wav

cleanup() { kill "${RECV_PID:-0}" "${DAEMON_PID:-0}" 2>/dev/null || true; rm -f "$WAV" /tmp/_bs_recv.mts; }
trap cleanup EXIT

echo "▸ building the daemon…"
( cd "$HERE" && cargo build -q )

echo "▸ generating a speech WAV…"
if command -v piper >/dev/null && [ -f "$LISA_VOICE" ]; then
  echo "Bonjour Patrice, je suis le système nerveux de Code Buddy." \
    | piper --model "$LISA_VOICE" --output_file "$WAV" 2>/dev/null
else
  # fallback: a 1s tone surrounded by silence (16-bit 16 kHz mono)
  python3 - "$WAV" <<'PY'
import wave, struct, math, sys
r=16000; d=[0]*(r//2)+[int(0.4*math.sin(2*math.pi*330*i/r)*32767) for i in range(int(r*0.7))]+[0]*(r//2)
w=wave.open(sys.argv[1],'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(r)
w.writeframes(b''.join(struct.pack('<h',s) for s in d)); w.close()
PY
fi

echo "▸ starting the Code Buddy receiver (sensory bridge → event bus)…"
cat > /tmp/_bs_recv.mts <<EOF
const { startSensoryBridge } = await import('$ROOT/src/sensory/sensory-bridge.js');
const { getGlobalEventBus } = await import('$ROOT/src/events/event-bus.js');
const b = startSensoryBridge({ port: $PORT });
await b.ready;
getGlobalEventBus().on('sensory:perception', (e) => {
  const m = e.metadata ?? {};
  console.log('  Code Buddy ◂ ' + m.modality + '/' + m.kind + '  ' + JSON.stringify(m.payload ?? {}));
});
setTimeout(() => b.close().then(() => process.exit(0)), 9000);
EOF
( cd "$ROOT" && npx tsx /tmp/_bs_recv.mts ) & RECV_PID=$!
sleep 3

echo "▸ running the daemon (heartbeat + audio sense over the WAV)…"
echo "  ─────────────────────────────────────────────────────────────"
BUDDY_SENSE_BRIDGE_URL="ws://127.0.0.1:$PORT" BUDDY_SENSE_HEARTBEAT_MS=800 \
  "$HERE/target/debug/buddy-sense" "$WAV" 2>&1 | sed 's/^/  daemon ▸ /' &
DAEMON_PID=$!
sleep 6
echo "  ─────────────────────────────────────────────────────────────"
echo "▸ done. Senses → thalamus → bridge → Code Buddy's event bus, all local + \$0."
