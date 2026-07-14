# buddy-vision — the robot's semantic eye and live ear

Python sidecars for camera and microphone. `watch.py` watches a camera and emits
**semantic events** (`person_entered` / `person_lost` / `drowsy`) to Code
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
| `person_entered` / `person_observed` / `person_lost` | MediaPipe FaceLandmarker by default, or optional YOLOv8 person detection (`BUDDY_VISION_PERSON_BACKEND=yolo`). A loss means `unknown`, never proof that the room is empty. |
| `people_observed` | One bounded aggregate emitted after the per-track batch. A positive detector count proves visible presence; zero detections means `unknown`, never an empty room. |
| `camera_alive` / `camera_unavailable` | Low-rate camera liveness refresh and explicit read/open failure. |
| `motion` | Rate-limited keyframe for the brain's local VLM scene refresh. |
| `drowsy` | `eyeBlink` blendshape closed ≥ `BUDDY_VISION_DROWSY_SECS` (Vigil) |

A cheap motion gate (frame-diff) skips inference when nothing moves. On a
transition: a JPEG keyframe is saved, the event is pushed to the bridge, and a
line is appended to `~/.codebuddy/companion/events.jsonl` (audit/stats).
Motion refreshes and semantic transitions use separate bounded JPEG rings with
atomic replacement rather than accumulating one file per event.

Each presence episode gets a random, process-local `presenceEpisodeId`. A
deterministic greedy IoU association preserves approximate detector continuity
through short occlusions. It is not a name, face identity or biometric
re-identification; crossings and large movements may rotate an episode. Set
`BUDDY_VISION_MAX_PERSONS=1..8` (default `1`, canary recommendation `4`) to bound
the FaceLandmarker and tracker together. Per-track events carry only confidence
and a strict normalized 2D box (`x`, `y`, `width`, `height`). No crop, embedding,
landmark, depth or identity crosses the bridge. Drowsiness is deliberately
suppressed when several faces are visible because blink attribution would be
ambiguous. One `people_observed` aggregate is emitted last so the final visible
detector count repairs occupancy after per-track transitions in the same frame.
Each inference batch emits at most one human-facing arrival or total-loss event;
additional arrivals are ordinary observations and partial losses remain internal
`person_track_lost` uncertainty updates, avoiding duplicate companion messages.

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
`BUDDY_VISION_DROWSY_SECS`, `BUDDY_VISION_PERSON_GRACE`,
`BUDDY_VISION_MAX_PERSONS` (1..8, default 1),
`BUDDY_VISION_TRACK_IOU` (0.05..0.9, default 0.2),
`BUDDY_VISION_HEARTBEAT_SECS`, `BUDDY_VISION_CAMERA_FAILURE_GRACE`,
`BUDDY_VISION_OBSERVATION_SECS`, `BUDDY_VISION_MOTION_EVENT_SECS`,
`BUDDY_VISION_MOTION_FRAME_SLOTS`, `BUDDY_VISION_SEMANTIC_FRAME_SLOTS`,
`BUDDY_VISION_EVENTS_LOG_MAX_BYTES`, `BUDDY_EAR_DEVICE`,
`BUDDY_EAR_RMS_ON`, `BUDDY_EAR_RMS_OFF`, `BUDDY_EAR_MIN_MS`,
`BUDDY_EAR_MAX_MS`, `BUDDY_EAR_HANG_MS`, `BUDDY_EAR_WAV_DIR`.

Camera liveness and presence refresh intervals are clamped to 10 seconds so
they cannot exceed the brain's 15-second factual TTL. Brain-side egress knobs
are `CODEBUDDY_VISION_CONTEXT_PRIVACY` and the separate default-off
`CODEBUDDY_VISION_TELEGRAM_PHOTO`.

## Brain side (Code Buddy)
`src/sensory/sensory-bridge.ts` (WS ingress) → event bus → reactions
(`vision-reaction.ts` = motion→VLM+dedup, `semantic-vision-reaction.ts` =
person/drowsy, `speech-reaction.ts` = `speech_end`→STT→hearing percept→voice
assistant) → `alert.ts` / `voice-loop.ts`. Wired in `src/server/index.ts` when
`CODEBUDDY_SENSORY=true`; camera reactions require
`CODEBUDDY_SENSORY_CAMERA=true` + `CODEBUDDY_SENSORY_TOKEN`, and all sidecars
must send the same value in `BUDDY_SENSE_TOKEN`.

The local VLM emits a bounded `scene_described` summary without image bytes or
paths. It remains `local-only` by default. Set
`CODEBUDDY_VISION_CONTEXT_PRIVACY=cloud-ok` on the brain process only after an
explicit privacy decision if Telegram or another cloud-routed model should use
that short-lived, unverified visual context. Known secrets, PII and private
paths are redacted heuristically before cloud projection; the local VLM is also
instructed not to transcribe OCR or identities. This is not a proof that a scene
contains no sensitive meaning, so the default remains local. Raw keyframes are
accepted only from the configured camera spool and never enter the cognitive
workspace. Telegram receives text only unless the separate
`CODEBUDDY_VISION_TELEGRAM_PHOTO=true` consent is set.
Raw VLM image inference is loopback-only by default; a non-loopback endpoint is
accepted only over HTTPS with the separate `CODEBUDDY_VISION_REMOTE_IMAGE=true`
consent.
