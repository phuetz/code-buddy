# Presence — face memory for Cowork

Recognises who is in front of the camera and surfaces the result to the
Code Buddy core agent so its system prompt can be personalised. The
agent then chooses an appropriate greeting register (formal / nickname /
neutral) based on conversational history — we don't hardcode the
greeting itself.

## Quick architecture

```
[webcam stream]                     ← navigator.mediaDevices.getUserMedia (renderer)
       ↓
[FaceDetector]                      ← MediaPipe BlazeFace, renderer/services/presence/
       ↓ crop 112×112 RGB
       ↓ via IPC presence:encode
[FaceRecognizer]                    ← InsightFace Buffalo_S ArcFace ONNX, main/presence/
       ↓ 512-dim embedding
       ↓ via IPC presence:match
[PresenceStore]                     ← JSON @ <userData>/presence-store.json
       ↓ cosine top-1
[PresenceBridge]                    ← event bus + writes <home>/.codebuddy/presence/current.json
       ↓ cross-process file
[presence-injector]                 ← src/memory/presence-injector.ts
       ↓ formats <presence> block
[memory-lifecycle-hooks::beforeExecute]
       ↓ injects into system prompt
[LLM]                               ← chooses greeting register
```

## Components

| File | Process | Role |
|---|---|---|
| `cowork/src/shared/presence/types.ts` | both | Shared types (PersonIdentity, FaceDetection, PresenceEvent) |
| `cowork/src/renderer/services/presence/face-detector.ts` | renderer | MediaPipe BlazeFace face detection (where + bounding box) |
| `cowork/src/main/presence/face-recognizer.ts` | main | ArcFace Buffalo_S ONNX inference (who) |
| `cowork/src/main/presence/presence-store.ts` | main | Persistent JSON identity store, cosine match |
| `cowork/src/main/presence/presence-bridge.ts` | main | IPC handlers + event bus + cross-process state file |
| `cowork/src/renderer/components/EnrollmentDialog.tsx` | renderer | UI: capture 5 face samples → enroll |
| `cowork/src/renderer/components/PresenceIndicator.tsx` | renderer | Status badge in header |
| `cowork/src/renderer/components/ModelInstallDialog.tsx` | renderer | UI: install Buffalo_S via file-picker or download |
| `cowork/src/renderer/services/presence/PresenceService.ts` | renderer | Continuous detection loop daemon (singleton) |
| `cowork/src/renderer/services/presence/face-utils.ts` | renderer | Shared `largestFace` + `cropFaceToRgbBytes` |
| `src/memory/presence-injector.ts` | core agent | Reads cross-process file, formats `<presence>` block |

## Setup

### 1. Install runtime dependencies

```bash
cd cowork
npm install
```

This pulls `@mediapipe/tasks-vision` (~ 1 MB on top of normal install)
and `onnxruntime-node` (native binding ~30 MB).

### 2. Install the Buffalo_S face recognition model

Buffalo_S is the small variant of InsightFace's ArcFace family. ~13 MB,
512-dim embedding output, 112×112 RGB input.

**Three paths, in order of preference:**

1. **In-app download** (recommended) — `ModelInstallDialog` is surfaced
   the first time the user clicks "Enroll". The dialog pre-fills a
   public HuggingFace mirror URL, the user confirms, the model is
   streamed to `<userData>/models/buffalo_s.onnx` with a progress bar.
   The URL is editable so any public `.onnx` mirror works. Magic byte
   (`0x08`) and size (5–50 MB) are validated; the file is written
   atomically via `.tmp` + rename. No silent network calls — the user
   always clicks "Télécharger" first.

2. **Helper scripts (CLI)** — pre-flight install before Enrollment:

   ```powershell
   # Windows
   powershell -ExecutionPolicy Bypass -File cowork\scripts\download-buffalo-s.ps1
   ```

   ```bash
   # macOS / Linux
   bash cowork/scripts/download-buffalo-s.sh
   ```

   The scripts are idempotent (skip download if a valid file is already
   there) and create the target directory if missing. Useful in CI or
   for ops handing pre-provisioned machines to users.

3. **Local file picker** — `ModelInstallDialog` also exposes a "Choose
   file" button. If the user already downloaded the model (e.g. from
   https://github.com/deepinsight/insightface/tree/master/python-package),
   they can point to the `.onnx` directly. Same validation pipeline.

**Cross-platform install path** (where all three methods write):
- **Windows**: `%APPDATA%\codebuddy-cowork\models\buffalo_s.onnx`
- **macOS**: `~/Library/Application Support/codebuddy-cowork/models/buffalo_s.onnx`
- **Linux**: `~/.config/codebuddy-cowork/models/buffalo_s.onnx`

### 3. Enroll your face

Open the EnrollmentDialog (mounted by the renderer once `App.tsx`
wiring is done), enter your name + optional aliases (e.g.
a configured name + `mon chéri, patron`), face the camera, click **Capturer**
five times. The store ends up with one identity averaged from the
5 samples.

## How the greeting register works

The LLM gets a `<presence>` block in its system prompt:

```xml
<presence>
  L’utilisateur est devant la caméra (confidence 91%).
  alias possibles: mon chéri, patron
  vu il y a 12s.
  Tu peux personnaliser ton ton et ton greeting en conséquence — choisis
  le registre que la conversation suggère, sans surjouer.
</presence>
```

We *don't* tell the LLM "say 'bonjour mon chéri'". We give it the menu
(name + alias list) and trust the model to pick the register from the
conversation history (formal session → "Bonjour", late-night
philosophical chat → "bonjour mon chéri"). This is the only place where
trusting the LLM beats hardcoding.

## What's wired today

- **Continuous detection loop**: `PresenceService` (singleton, started
  by `App.tsx` once per app lifecycle) runs detect → encode → match
  every 3 s by default. Self-aborts if no model installed or no
  identity enrolled — the camera light never turns on for nothing.
- **Visibility-aware**: pauses on `visibilitychange = hidden`, resumes
  on visible. The `MediaStream` is kept open across pause/resume to
  avoid a re-acquisition blink.
- **Opt-in toggle**: persisted via `localStorage`
  (`cowork.presence.enabled`); defaults to on but can be disabled and
  the lifecycle hook stops the daemon.
- **In-app model install**: download or file-picker, both with magic
  byte + size validation, atomic writes.

## Still on the roadmap (V1+)

- **Voice fingerprinting**: the speaker-verification side
  (`SpeakerVerifier` analogue of `FaceRecognizer`) lives on the V1
  roadmap. Audio capture infra reuses the renderer/services/presence/
  pattern.
- **Singleton store**: V0 supports multiple identities (you + your
  partner + …) but matches only the closest. Multi-person scenes (two
  faces in frame at once) just match the largest face.
- **Multi-window gating**: two BrowserWindows would race for the
  camera. We don't gate this today; in practice Cowork ships a single
  main window so it's a non-issue.

## Threshold tuning

`PresenceConfig.matchThreshold` defaults to 0.5 (ArcFace cosine).
Lower = more permissive (more false positives). Higher = stricter (more
"unknown" events). With Buffalo_S + frontal indoor lighting and 5
samples per identity, 0.5 typically gives < 1% false positive on
unknown faces and > 95% recall on the enrolled ones.

If you have to share Cowork between several people who look alike (or
identical twins), tighten to 0.6+ and re-enroll with more samples.
