# Screen capture + AI — landscape, what Code Buddy has, and use cases

**Date: 2026-06-08.** Goal: give Code Buddy real-time awareness of *what's happening on the machine* by recording the screen/a window and exploiting AI on top — and find concrete use cases. Target env: Linux (X11/Wayland), ffmpeg, local Ollama.

## What Code Buddy ships today

`src/capture/` + `buddy screen` (commit `3863a68f`):

- **`ScreenRecorder`** — single-frame and video capture via ffmpeg: `x11grab` (Linux/X11), `avfoundation` (macOS), `gdigrab` (Windows); region/window + display targeting. Wayland is detected and refused (avoids black frames). Verified live: a real 1920×1080 PNG via x11grab.
- **`ScreenWatcher`** — the "real-time awareness" loop: periodic capture → **idle-frame dedup** (fingerprint diff, only surface changed frames) → optional **OCR** (tesseract) → **secret/PII redaction via the existing `src/fleet/privacy-lint.ts`** before anything is stored or sent to a model → `Observation`.
- **CLI**: `buddy screen capture | record | watch | list-windows`.
  - `buddy screen watch --ocr --interval 5` ≈ the local-first foundation below.
- **Webcam** — `camera_snapshot` grabs a frame (ffmpeg/v4l2), and **`camera_analyze`** feeds that frame to a local vision model (default `ollama/gemma4:12b`) and returns a description. Validated against a real Logitech BRIO.
- **Computer use** — the desktop-automation stack (AT-SPI accessibility element enumeration + nut-js mouse/keyboard + screenshots) is exposed as **MCP tools**: `desktop_screenshot` / `desktop_snapshot` are read-only and always on; `desktop_click` / `desktop_type` / `desktop_move_mouse` / `desktop_key` actuate the desktop and are gated behind `CODEBUDDY_MCP_DESKTOP_CONTROL=1`. On Linux this prefers nut-js when xdotool/xclip are absent. See [`tools-reference.md`](tools-reference.md#computer-use-desktop-automation-over-mcp).

This is intentionally the **portable, cheap** path (capture + dedup + OCR + redact), not fragile per-frame video — see the feasibility note at the end.

## 1. Landscape (researched)

| Project | What it records | Index | How it uses AI | Local? | License |
|---|---|---|---|---|---|
| **[screenpipe](https://github.com/mediar-ai/screenpipe)** | Event-driven shots (app switch/click/scroll/typing-pause/clipboard + ~5s idle) + accessibility tree; audio 30s chunks | SQLite + FTS5; a11y text, Tesseract OCR fallback (~300MB/8h) | NL search API, timeline, **"pipes"** = scheduled markdown agents with YAML data gates, **MCP server** exposing screen memory | Yes (Whisper local, Ollama agents) | MIT |
| **[OpenRecall](https://github.com/openrecall/openrecall)** | Periodic screenshots (`mss`, every 3s, WebP) | Local SQLite + numpy embeddings; doctr OCR; sentence-transformers | Keyword + **semantic** timeline search | 100% local | AGPL-3.0 |
| **Rewind.ai / Limitless** (commercial, Mac; acq. Meta 2025) | Continuous, ~3750× compressed; mic + auto-detected calls | Local index | "Ask Rewind" NL Q&A; meeting intelligence | Local-first | proprietary |
| **MS Recall** (Win11 Copilot+) | Screenshots every 3–5s | OCR + on-disk vector DB, encrypted in VBS enclave (TPM) | Semantic timeline ("find by meaning"); NPU on-device | Local (NPU) | proprietary |
| **[Khoj](https://github.com/khoj-ai/khoj)** | Docs/notes (RAG reference) | pgvector + sentence-transformers | Classic RAG, agents, scheduled automations | Local via Ollama | AGPL-3.0 |
| **[self-operating-computer](https://github.com/OthersideAI/self-operating-computer)** | Screenshots → model decides clicks | — | **Vision-LLM operates the screen**: OCR→clickable hashmap, or **Set-of-Mark** (YOLOv8 numbered overlay) | cloud/local VLM | MIT |
| **[Open Interpreter](https://github.com/openinterpreter/open-interpreter)** | Computer API screenshots + control | — | NL→code; clicks via open "Point" model; "Local III" fully local | any LLM | AGPL-3.0 |
| **[glass](https://github.com/pickle-com/glass)** / pluely | Real-time screen+audio (ephemeral) | context window | Live "sees what you see" assistant | local-capable | open |

## 2. Reusable techniques (ranked for Linux + local Ollama)

1. **Periodic screenshot + perceptual dedup** (OpenRecall): grab every ~3s, store only if MSSIM < 0.9 vs previous (skips idle). Cross-platform (X11 + Wayland via `mss`/portals), no ffmpeg. *The cheapest reliable foundation — Code Buddy's `ScreenWatcher` does the dedup; MSSIM is a future upgrade over the byte-fingerprint.*
2. **Event-driven over fixed-FPS** (screenpipe): trigger on app-switch/click/typing-pause + idle timer; pair frames with the **accessibility tree** (cleaner/cheaper than OCR; AT-SPI on Linux).
3. **OCR → embeddings → hybrid index**: doctr/Tesseract OCR; embed with Ollama `nomic-embed-text`; SQLite FTS5 (keyword) + vector store (semantic), fused with RRF.
4. **Vision-LLM on *sampled* frames only** (llava/qwen2-vl via Ollama) — gate hard on "interesting" frames.
5. **Coordinate grounding for action** (self-operating-computer): OCR→coords hashmap or Set-of-Mark — only if Code Buddy should *act on* the screen.
6. **ffmpeg `x11grab` for true video — Wayland is the gotcha** (needs `wf-recorder`/PipeWire portal). *`ScreenRecorder` covers X11; Wayland video is a later backend.*
7. **Privacy as a first-class gate**: per-app/window/time exclusion, encryption at rest, **redaction before indexing**. *Code Buddy reuses `privacy-lint` for redaction — the standout win.*
8. **Markdown scheduled "pipes"** + **MCP/API exposure** of the index.

## 3. Code Buddy use cases (ranked: value × Linux/local feasibility)

**Tier 1 — high value, high feasibility (build first; pure local)**
1. **Proactive terminal/IDE error-watcher** → on detecting a stack trace via OCR, feed it to the existing **`AutoRepairMiddleware` (priority 150)** + fault localizer. The screen becomes a new *trigger source* for machinery Code Buddy already runs.
2. **Continuous work-journal → auto-memory**: dedup+OCR over the day; a scheduled local-Ollama summarizer writes a recap into `.codebuddy/CODEBUDDY_MEMORY.md` (auto-memory writeback), surfaced via `/memory recent`.
3. **Privacy-redacted screen index (reuse `privacy-lint`)** — already wired in `ScreenWatcher`; add per-app/window exclusion.
4. **Semantic "what did I see?" recall tool**: OCR → Ollama embeddings → SQLite FTS5 + vector hybrid, exposed as a normal tool.

**Tier 2 — high value, medium feasibility**
5. **Bug-repro from frames**: capture the repro sequence, a local VLM + OCR describe the steps + error, the agent diagnoses — checkpoint via `SessionFacade` rewind.
6. **Fleet-shared read-only screen memory**: expose the index as a tool with `fleetSafe: true` (`src/tools/metadata.ts`), callable via `peer.tool.invoke` (3 security gates + fail-closed `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`). One machine's screen history becomes fleet context.
7. **Autonomous fleet watches a long-running on-screen task**: the always-on autonomy daemon samples the screen during a build/train/deploy; frame-diff "no change for N min" or a failure banner becomes a **wake condition** → re-run, alert via `peer.chat`, or queue a fleet task.
8. **Companion "look at my screen"**: voice trigger ("explain this error/graph/dialog") samples the active window through the companion vision path, answered with full tool access.

**Tier 3 — valuable, heavier**
9. **Scheduled "pipes"**: `~/.codebuddy/screen-pipes/*.md` run on a schedule against the index (standup gen, time-by-project, "did I leave a secret visible in a screenshare?").
10. **Screen-grounded self-operation** (Set-of-Mark/coord-hashmap) — gated hard behind `bypassPermissions` + Confirmation Service.
11. **Continuous-video + per-frame VLM** — highest fidelity, lowest Linux feasibility (Wayland forks capture; per-frame VLM is GPU-heavy). Later milestone.

## Screenpipe — install, auth, and the `screen_memory` tool

Code Buddy ships a thin HTTP client (`src/integrations/screenpipe/screenpipe-client.ts`) and a
read-only `screen_memory` tool that queries a locally-running [screenpipe](https://github.com/mediar-ai/screenpipe)
instance, so the agent can answer "what did I see / say / hear?" from your screen+audio history —
local-first, no cloud.

### Install + run (Linux)

```bash
# system deps for audio capture + encode
sudo apt install -y libasound2-dev ffmpeg

# record screen + audio 24/7 (data lives in ~/.screenpipe, REST API on :3030)
npx -y screenpipe@latest record
```

The recorder indexes OCR text and audio transcripts into a local SQLite DB and serves a search API
on `http://localhost:3030`.

### Auth (Bearer token)

Recent screenpipe builds require a Bearer token on the local API. Export it so the `screen_memory`
tool authenticates:

```bash
export SCREENPIPE_API_KEY=$(screenpipe auth token)
```

When `SCREENPIPE_API_KEY` is set (or `apiKey` is passed to `ScreenpipeClient`), every request carries
`Authorization: Bearer <key>`. When it is unset, requests are sent unauthenticated — older / no-auth
local instances keep working unchanged.

### The `screen_memory` tool

`screen_memory` is **read-only** and **PII-redacted**: every hit is passed through `src/fleet/privacy-lint.ts`
before it reaches the model, so secrets (tokens, IBAN, SSN, credit cards…) are stripped, not surfaced.
It calls screenpipe's `/search` endpoint and normalizes the snake_case results.

| Env var | Purpose | Default |
|---|---|---|
| `SCREENPIPE_URL` | Base URL of the local screenpipe API | `http://localhost:3030` |
| `SCREENPIPE_API_KEY` | Bearer token for the local API (omit for no-auth instances) | _(unset)_ |

### Alternative: the first-class MCP server

screenpipe also publishes an MCP server that exposes screen memory directly:

```bash
npx -y screenpipe-mcp@latest
```

You can wire it through Code Buddy's MCP client via `CODEBUDDY_MCP_COMMAND`. We keep the **HTTP client
the default** because it already PII-redacts via `privacy-lint` before anything reaches the model —
the MCP path returns raw hits, so reserve it for cases where you want screenpipe's full tool surface
and are handling redaction yourself.

### License note

screenpipe is **source-available** — free for personal / local CLI / MCP use; a paid license is only
required for **commercial embedding, redistribution, or SaaS**. Code Buddy only acts as a **client** to
a screenpipe instance you run yourself (it does not bundle or redistribute screenpipe), so there's no
licensing blocker for users.

## Feasibility note (the load-bearing Linux constraint)

The **Wayland-vs-X11 capture split** is the key constraint: `x11grab`/`scrot` die on a pure Wayland session (GNOME 40+/KDE) — design for the `mss`/portal path for portability. Per-frame VLM is heavy even on local Ollama; gate it behind the dedup/event layer. The high-feasibility foundation is **periodic capture + dedup + OCR + redact** (what Code Buddy ships); continuous video + per-frame VLM is the low-feasibility end. **Biggest single reuse win: point `privacy-lint` at any screen-OCR pipeline before indexing** — done.

## 4. High-speed encode — VideoLAN libraries & what we integrated

Researched "high-speed libraries from the VLC creators" for the capture path. Honest verdict first:

- **libVLC from Node is dead** — the only binding (**WebChimera.js**) is officially **abandoned** (~4 yrs stale). Skip it; libVLC's value is playback/streaming, not recording.
- **x264 (VideoLAN) and x265 are only reachable from Node via FFmpeg/libav** — there is no standalone Node binding. **dav1d (VideoLAN) is an AV1 *decoder*** — irrelevant to an encode-heavy recorder.
- So the real win is **not a new library** — it's using the **iGPU's hardware encoder** through the ffmpeg path we already have.

**Integrated (commit on this branch): VAAPI GPU encode.** `ScreenRecorder` / `buddy screen record` now take `--codec`:

| Codec | Use | ffmpeg path | Verified |
|---|---|---|---|
| `libx264` (default) | portable, any box | software, `-preset ultrafast` | ✅ |
| `h264_vaapi` | **fast, low CPU** (~8.7× vs libx264) | GPU: `-vaapi_device /dev/dri/renderD128 -vf format=nv12,hwupload -c:v h264_vaapi -qp 24` | ✅ live on Radeon 890M (VCN4) |
| `av1_vaapi` | **smallest files** (~30–50% vs H.264) for "record everything" | `… -c:v av1_vaapi -qp 30` (needs Mesa 24.1+/LLVM 20+) | flags built; gated on Mesa |

Plus `--scale 1280` (downscale before encode) and `--qp`. The real "record-everything" compression is **low fps + downscale + dedup**, not the codec alone (the "Rewind 3750×" number is delta/dedup, not magic) — the codec buys ~30–50%.

**Library reference (Node integration paths):**

| Package | Role | Node path | Maturity (2026) | Verdict |
|---|---|---|---|---|
| ffmpeg subprocess (current) | encode via libx264/VAAPI | spawn | n/a | **keep** — zero native modules |
| [`node-av`](https://github.com/seydx/node-av) | in-process libav (encode/decode/VAAPI), TS | N-API (prebuilt) | **v6, FFmpeg 8.1, Jun 2026, MIT** | adopt **later** for in-process frame pipelines (no PNG round-trip) |
| [`beamcoder`](https://github.com/Streampunk/beamcoder) | in-process libav | N-API | stale (FFmpeg 5.0) | prefer node-av |
| [`node-screenshots`](https://github.com/nashaofu/node-screenshots) | native screen grab (the Node "mss") | N-API (Rust) | active (Feb 2026) | adopt for the **watcher's** high-freq frame path |
| [`sharp`](https://github.com/lovell/sharp) / [`@julusian/jpeg-turbo`](https://github.com/julusian/node-jpeg-turbo) | WebP/JPEG encode + downscale | mature | — | replace the watcher's PNG+sha1 with WebP + perceptual hash |
| WebChimera.js (libVLC) | — | — | **ABANDONED** | **skip** |

**Next perf steps (not done): ** switch the watcher's frame path from `ffmpeg single-frame PNG + sha1` to `node-screenshots → sharp WebP + perceptual hash` (cheaper grab, smaller frames, robust dedup); adopt `node-av` only if the subprocess disk round-trips become the bottleneck.

> Sources: x264 (VideoLAN, GPL), dav1d (VideoLAN, decoder), SVT-AV1, node-av (MIT), node-screenshots (MIT), sharp (Apache-2.0), WebChimera.js (abandoned). AMD AV1 VAAPI: phoronix / Mesa 24.1 VCN4. AV1-vs-H264 compression: getstream/gumlet. Plus §1 projects (screenpipe MIT, OpenRecall AGPL, Khoj, self-operating-computer MIT, …).
