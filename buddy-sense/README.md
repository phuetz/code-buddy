# buddy-sense

A parallel, event-driven **nervous system** in Rust — the perception layer for
[Code Buddy](https://github.com/phuetz/code-buddy) / the Lisa companion.

The human brain is massively parallel: sight, hearing, and the heartbeat all run
concurrently, gated by the brain, and memory consolidates in the background.
`buddy-sense` reproduces that: each **sense** runs concurrently, a **thalamus**
gates/coalesces the stream, and a **bridge** feeds events into Code Buddy's event
bus, where they trigger processing (and heartbeat-paced memory consolidation).

![architecture](docs/architecture.svg)

- **Senses** emit `SensoryEvent { modality, kind, ts_ms, salience, payload }` over
  bounded channels (backpressure).
- **Thalamus** (`bus.rs`): coalesces high-rate low-salience bursts, lets salient
  events bypass coalescing (an attention **gate** — note: it does not reorder by
  priority), keeps a per-modality ring buffer, and broadcasts (the "global
  workspace", GWT). The vital heartbeat is never coalesced.
- **Bridge** (`bridge.rs`): ships events as JSON over a WebSocket (loopback,
  Origin-checked, optional token) to Code Buddy's `sensory-bridge`.
- Heavy analysis (STT, vision models, OCR) is **delegated to Code Buddy** — the
  daemon stays light.

## The five senses

| Sense | File | Emits | Live capture |
|-------|------|-------|--------------|
| **audio** | `senses/audio.rs` | `speech_start/end` (energy VAD, or Silero neural) | `live-mic` (cpal) / WAV |
| **vital** | `senses/vital.rs` | `heartbeat` (uptime, load) — the autonomic rhythm | always on |
| **vision** | `senses/video.rs` | `motion` (→ Code Buddy `camera_analyze`) | detector core (frames fed) |
| **screen** | `senses/screen.rs` | `change` (xcap screen diff) | `live-screen` (xcap) |
| **ui** | `senses/ui.rs` | `app_focus`/`window_title`/`element_focus` (AT-SPI) | `live-ui` (atspi) |

## Heartbeat-paced memory ("dreaming")

The heartbeat is a pacemaker: every N beats, Code Buddy's `dreaming` consolidates
the short-term sensory buffer into long-term memory (salient dreams →
`CODEBUDDY_MEMORY.md`, the file the agent reads). The heartbeat-paced analogue of
OpenClaw's dreaming.

![dreaming](docs/dreaming.svg)

## Build & run

```bash
cargo test                                   # pure cores: thalamus, VAD, motion, mapper (no hardware)
cargo build
BUDDY_SENSE_BRIDGE_URL=ws://127.0.0.1:8129 \
  ./target/debug/buddy-sense path/to/audio.wav   # audio sense over a WAV (+ the heartbeat)
./target/debug/buddy-sense                   # heartbeat-only (pass a .wav for audio)
```

On the Code Buddy side: `CODEBUDDY_SENSORY=true buddy server` starts the bridge.

### Optional features (opt-in; the core builds + tests without them)

| Feature | Adds | System / model needs |
|---------|------|----------------------|
| `live-mic` | live microphone (cpal) | `libasound2-dev` |
| `live-screen` | live screen capture (xcap, X11/Wayland) | xcb libs |
| `live-ui` | live AT-SPI focus events (atspi/zbus) | a running a11y bus (none to build) |
| `neural-vad` | Silero neural VAD via ONNX Runtime | a model + onnxruntime — see [models/README.md](models/README.md) |

Built with tokio + tokio-tungstenite (+ optional cpal / xcap / atspi / vad-rs).
Local-only, $0. Permissive deps (MIT/Apache) — clean-room, no proprietary code.
