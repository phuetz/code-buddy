# buddy-vision — the robot's semantic eye and live ear

Python sidecars for camera and microphone. `watch.py` watches a camera and emits
**semantic events** (`person_entered` / `person_left` / `drowsy`) to Code
Buddy's sensory bridge. `ear.py` captures a live microphone with ALSA
`arecord`, writes utterance WAVs, and emits `speech_end` events for Code Buddy's
faster-whisper → voice-assistant loop. Each detector is a **state machine** →
one event per *transition*, never per frame → no alert spam (the "Vigil"
pattern). 100% local, `$0`, offline.

Sibling to `../buddy-sense/` (the Rust nervous system: audio / screen / motion).
Both feed the same bridge; the brain side lives in `../src/sensory/`.

## Setup
```bash
./setup.sh        # venv + face_landmarker.task model + 'ollama pull moondream'
```
(The venv and the model are git-ignored — only the source + recipe are tracked.)

## Run
Needs a `buddy server` with `CODEBUDDY_SENSORY=true` running (it hosts the bridge
on `ws://127.0.0.1:8129`). For camera reactions, the server also needs
`CODEBUDDY_SENSORY_CAMERA=true` and `CODEBUDDY_SENSORY_TOKEN`; pass that same
secret to this sidecar as `BUDDY_SENSE_TOKEN`.
```bash
BUDDY_SENSE_TOKEN=<token> BUDDY_SENSE_CAMERA_INDEX=0 .venv/bin/python watch.py
BUDDY_SENSE_TOKEN=<token> BUDDY_EAR_DEVICE=auto .venv/bin/python ear.py
```

Before running the live ear loop, run the real ALSA preflight. It does not need
`websocket-client` or `numpy`; it only verifies the capture devices and the
auto-selected microphone:

```bash
BUDDY_EAR_DEVICE=auto .venv/bin/python ear.py --diagnose --json
```

`BUDDY_EAR_DEVICE=auto` lists ALSA capture devices with `arecord -l` and
prefers webcam/USB microphones (BRIO, Logitech, C920/C922, camera/webcam
labels). Override it with a concrete ALSA device such as
`plughw:CARD=BRIO,DEV=0` when you want a specific microphone.
Each `speech_end` includes `peakRms`, `avgRms`, VAD thresholds, selected device,
capture duration, and WAV write time so Code Buddy can diagnose weak microphones
and loop latency from companion percepts.

## Detectors
| event | how |
|-------|-----|
| `person_entered` / `person_left` | MediaPipe FaceLandmarker by default, or optional YOLOv8 person detection (`BUDDY_VISION_PERSON_BACKEND=yolo`) |
| `drowsy` | `eyeBlink` blendshape closed ≥ `BUDDY_VISION_DROWSY_SECS` (Vigil) |

A cheap motion gate (frame-diff) skips inference when nothing moves. On a
transition: a JPEG keyframe is saved, the event is pushed to the bridge, and a
line is appended to `~/.codebuddy/companion/events.jsonl` (audit/stats).

## YOLOv8 presence backend

The latest companion path can use the YOLOv8 test setup from `~/vision_tests`
for robust full-body person presence while keeping the existing no-spam state
machine:

```bash
~/vision_tests/venv/bin/python -m pip install websocket-client
BUDDY_VISION_DETECTORS=person \
BUDDY_VISION_PERSON_BACKEND=yolo \
BUDDY_VISION_YOLO_MODEL=~/vision_tests/yolov8n.onnx \
~/vision_tests/venv/bin/python watch.py
```

If you want YOLO installed into this sidecar venv instead:

```bash
BUDDY_VISION_INSTALL_YOLO=1 ./setup.sh
BUDDY_SENSE_TOKEN=<token> BUDDY_VISION_PERSON_BACKEND=yolo .venv/bin/python watch.py
```

YOLO env knobs: `BUDDY_VISION_YOLO_MODEL`, `BUDDY_VISION_YOLO_CONF`,
`BUDDY_VISION_YOLO_IOU`, `BUDDY_VISION_YOLO_DEVICE`,
`BUDDY_VISION_YOLO_CLASSES` (COCO id `0` = person, default).

## Env
`BUDDY_SENSE_BRIDGE_URL` (ws://127.0.0.1:8129), `BUDDY_SENSE_TOKEN`,
`BUDDY_SENSE_CAMERA_INDEX`, `BUDDY_VISION_CAMERA_NAME`, `BUDDY_VISION_DETECTORS`
(person,drowsy), `BUDDY_VISION_PERSON_BACKEND` (mediapipe,yolo),
`BUDDY_VISION_FPS`, `BUDDY_VISION_MOTION`, `BUDDY_VISION_BLINK`,
`BUDDY_VISION_DROWSY_SECS`, `BUDDY_VISION_PERSON_GRACE`, `BUDDY_EAR_DEVICE`,
`BUDDY_SENSE_FRAME_TTL` (seconds; default 604800 / 7 days),
`BUDDY_EAR_RMS_ON`, `BUDDY_EAR_RMS_OFF`, `BUDDY_EAR_MIN_MS`,
`BUDDY_EAR_MAX_MS`, `BUDDY_EAR_HANG_MS`, `BUDDY_EAR_WAV_DIR`.

## Brain side (Code Buddy)
`src/sensory/sensory-bridge.ts` (WS ingress) → event bus → reactions
(`vision-reaction.ts` = motion→VLM+dedup, `semantic-vision-reaction.ts` =
person/drowsy, `speech-reaction.ts` = `speech_end`→STT→hearing percept→voice
assistant) → `alert.ts` / `voice-loop.ts`. Wired in `src/server/index.ts` when
`CODEBUDDY_SENSORY=true`; camera reactions require
`CODEBUDDY_SENSORY_CAMERA=true` + `CODEBUDDY_SENSORY_TOKEN`, and all sidecars
must send the same value in `BUDDY_SENSE_TOKEN`.
