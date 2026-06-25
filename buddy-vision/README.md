# buddy-vision — the robot's semantic eye

A Python sidecar that watches a camera and emits **semantic events**
(`person_entered` / `person_left` / `drowsy`) to Code Buddy's sensory bridge.
Each detector is a **state machine** → one event per *transition*, never per
frame → no alert spam (the "Vigil" pattern). 100% local, `$0`, offline.

Sibling to `../buddy-sense/` (the Rust nervous system: audio / screen / motion).
Both feed the same bridge; the brain side lives in `../src/sensory/`.

## Setup
```bash
./setup.sh        # venv + face_landmarker.task model + 'ollama pull moondream'
```
(The venv and the model are git-ignored — only the source + recipe are tracked.)

## Run
Needs a `buddy server` with `CODEBUDDY_SENSORY=true` running (it hosts the bridge
on `ws://127.0.0.1:8129`).
```bash
BUDDY_SENSE_TOKEN=<token> BUDDY_SENSE_CAMERA_INDEX=0 .venv/bin/python watch.py
```

## Detectors
| event | how |
|-------|-----|
| `person_entered` / `person_left` | MediaPipe FaceLandmarker — face present/absent (absence grace) |
| `drowsy` | `eyeBlink` blendshape closed ≥ `BUDDY_VISION_DROWSY_SECS` (Vigil) |

A cheap motion gate (frame-diff) skips inference when nothing moves. On a
transition: a JPEG keyframe is saved, the event is pushed to the bridge, and a
line is appended to `~/.codebuddy/companion/events.jsonl` (audit/stats).

## Env
`BUDDY_SENSE_BRIDGE_URL` (ws://127.0.0.1:8129), `BUDDY_SENSE_TOKEN`,
`BUDDY_SENSE_CAMERA_INDEX`, `BUDDY_VISION_CAMERA_NAME`, `BUDDY_VISION_DETECTORS`
(person,drowsy), `BUDDY_VISION_FPS`, `BUDDY_VISION_MOTION`, `BUDDY_VISION_BLINK`,
`BUDDY_VISION_DROWSY_SECS`, `BUDDY_VISION_PERSON_GRACE`.

## Brain side (Code Buddy)
`src/sensory/sensory-bridge.ts` (WS ingress) → event bus → reactions
(`vision-reaction.ts` = motion→VLM+dedup, `semantic-vision-reaction.ts` =
person/drowsy) → `alert.ts` (Telegram). Wired in `src/server/index.ts` when
`CODEBUDDY_SENSORY=true` + `CODEBUDDY_SENSORY_CAMERA=true` + token.
