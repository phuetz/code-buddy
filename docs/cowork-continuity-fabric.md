# Cowork Continuity Fabric

The Continuity Fabric is Code Buddy's session-scoped desktop runtime layer. It
keeps concurrent conversations independent while making local, LAN and cloud
execution visible.

## Session Intelligence

Every Cowork session persists a small `SessionIntelligence` record alongside
its model:

- configuration-set and provider-profile references (never copied secrets);
- reasoning effort and fast mode;
- local/LAN/cloud execution location;
- first-signal and total-turn latency;
- latency budget and prompt-cache state.

Changing a model, effort or runtime in one tab no longer overwrites the global
configuration used by every other active session. Fast mode selects the best
configured low-latency runtime, preferring small local Ollama/LM Studio models.

The latency governor retains the latest 20 first-signal measurements for each
session. It exposes p50, p95 and consecutive budget breaches in the session bar
and in the multi-session runtime observatory. The history contains timings and
runtime references only—never prompts, responses or credentials.

Each timing is attributed to its configuration set and model. FAST ranks
runtimes using measured median latency once enough observations exist, with a
progressive five-sample confidence factor. New or unmeasured runtimes fall back
to the local/small-model heuristic, so cold-start routing remains deterministic.

The Activity rail also indexes JSON sessions from the CLI/channel store under
`~/.codebuddy/sessions`. Import is explicit and non-destructive: the source
transcript remains unchanged and Cowork records the copy as `cli-import`.

## Capability-scoped remote control

The `/desktop` WebSocket now negotiates a read-only control plane:

- `system.snapshot`
- `skills.list`
- `fleet.status`

Requests carry a correlation id and time out fail-closed. The JWT stays in the
Electron main process. Remote mutations are deliberately excluded until they
can be routed through the normal local approval service.

## Universal preview rail

Chat has one session-aware right rail for:

- working-session activity and queued messages;
- live App Studio preview;
- file preview;
- rendered artifacts;
- diff proofs and the Outcome Capsule handoff.

Opening a file or artifact automatically selects the corresponding rail tab.

## Voice realtime HUD

The voice overlay reports its current phase, STT duration, response-to-speech
latency and the active session latency budget. Pocket TTS remains resident,
Piper is the fallback, and barge-in remains enabled.

## Portable configuration

Keyboard bindings can be captured, reset, exported and imported. Code Buddy
TOML profiles can be exported as Ed25519-signed packages. Export is refused if
the profile embeds an API key, token, password or secret; credentials belong in
SecretRef or the encrypted credential store.
