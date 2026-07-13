# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Status: 1.1.0 GA** (tagged 2026-06-11). Multi-AI **fleet hub** (`peer.chat` + `peer.chat-session.*` + `peer.tool.invoke`) and the **Cowork** Electron GUI are the headline V1 features. ~27K Vitest tests. Read [`docs/getting-started.md`](docs/getting-started.md), [`docs/fleet-guide.md`](docs/fleet-guide.md), and [`CHANGELOG.md`](CHANGELOG.md). Keep this file short — it should capture what you *can't* derive by reading the source.

## Build, Test, Lint

```bash
npm install
npm run dev            # Bun dev mode
npm run dev:node       # tsx dev mode (use this on Windows if Bun misbehaves)
npm run build          # TypeScript build (tsc -> dist/)
npm run typecheck
npm run lint
npm run validate       # lint + typecheck + test — run before committing
npm test               # Vitest — ~27K tests, slow. Always prefer a path filter.
npm test -- tests/path/to/file.test.ts
npm run format         # Prettier write (format:check for CI-style check only)
npm run check:circular # madge circular-dependency check (scripts/check-circular-deps.ts)
npm run build:gui      # Cowork Electron GUI (cd cowork && npm run build)
npm run dev:gui        # Cowork dev (Vite + Electron)
```

Tests live in **`tests/`** only — there are no in-source `src/**/*.test.ts` files despite what `vitest.config.ts` would allow. Vitest with `pool: 'forks'` and `--max-old-space-size=8192`. `vitest.setup.ts` shims `globalThis.jest` → `vi` so legacy `jest.fn()` works. There is also a Jest-compat transform in `vitest.config.ts` that rewrites `jest.mock` → `vi.mock` and resolves `.js` imports back to source `.ts` files inside test specs.

## Testing Gotchas

- ESM project (`"type": "module"`). Use `import.meta.url` + `fileURLToPath` for `__dirname`. `@` alias → `./src` (see `vitest.config.ts`). Source imports need `.js` extensions even for `.ts` files.
- Use `logger` (`src/utils/logger.js`) not `console.*` in production — tests spy on `logger.warn`.
- **`BashTool`** tests: call `ConfirmationService.setSessionFlag('bashCommands', true)` first, and mock every transitive import (`safe-binaries`, `auto-sandbox`, `shell-env-policy`, `bash-parser`, `checkpoint-manager`, `audit-logger`, `command-validator`, `streaming-executor`). `execute()` has async pre-spawn logic, so defer mock process events with `setImmediate()` — don't emit synchronously.
- **CLI command tests:** Commander `parseAsync()` + `exitOverride()`, mock `console.log` / `process.exit`.
- **Channel adapter tests:** mock `global.fetch` for health checks, mock dynamic imports via virtual modules.
- **`DeviceNodeManager` tests:** mock `ssh-transport` / `adb-transport` / `local-transport` and `fs` (prevents `devices.json` bleed between tests). `pairDevice()` is async.
- **`AgentRegistry`** ships 9 built-in agents: PDF, Excel, DataAnalysis, SQL, Archive, CodeGuardian, SecurityReview, SWE, Verifier (independent fresh-context verifier — read/execute-only toolset, returns a CONFIRMED / NEEDS REVIEW verdict backed by evidence; delegated explicitly via `executeOn('verifier', …)`, never auto-triggers).
- **`better-sqlite3`** is a native module — three test files are skipped where Electron headers aren't available. If your test loads the DB layer, expect a rebuild step.

## Architecture

Terminal multi-provider AI coding agent. **15 providers** via OpenAI-compatible routing (Grok, Claude, GPT, Gemini, Ollama, LM Studio, AWS Bedrock, Azure, Groq, Together, Fireworks, OpenRouter, vLLM, Copilot, Mistral) + a separate Gemini native path. Core is an agentic loop where the LLM autonomously calls tools.

```
User → ChatInterface (Ink/React) → CodeBuddyAgent → LLM provider
                                         │
                                Tool calls (max 50, YOLO 400)
                                         │
                              Execute + confirm → results → loop
```

### Facades (`src/agent/facades/`)

`CodeBuddyAgent` delegates to:
- `AgentContextFacade` — token counting, `ContextManagerV2` compression, memory retrieval
- `SessionFacade` — save/load sessions, checkpoints, rewind
- `ModelRoutingFacade` — model selection, cost tracking, usage stats
- `InfrastructureFacade` — MCP servers, sandbox, hooks, plugins
- `MessageHistoryManager` — message storage, history truncation, export

### Key Entry Points

- `src/index.ts` — CLI entry (Commander), lazy-loaded commands, `--profile` flag
- `src/agent/codebuddy-agent.ts` — main agentic loop, `executePlan()`
- `src/agent/execution/agent-executor.ts` — middleware pipeline, reasoning, tool streaming. **Single source of truth via `runTurnLoop` async generator (task #5 fusion done 2026-04-26).** `processUserMessageStream` is a thin `yield*` wrapper; `processUserMessage` is a thin sequential collector that consumes events and returns the new entries pushed to history. Per-turn injections, transcript repair, output sanitization, and the `__SESSIONS_YIELD__` signal all live in `runTurnLoop` — touch them in one place. Streaming-only events (`ask_user`, `tool_stream`, `token_count`, `reasoning`, `steer`) are silently dropped in the sequential collector (décision #3).
- `src/codebuddy/client.ts` — thin dispatcher that picks **exactly one** `Provider` strategy in the constructor: `GeminiNativeProvider` (baseURL is `generativelanguage.googleapis.com`), `ChatGptResponsesProvider` (ChatGPT OAuth / Codex Responses backend), `GeminiCliProvider` (wraps the local `gemini` binary as a subprocess; path from `GEMINI_CLI_PATH`), else `OpenAICompatProvider`. Strategies live under `src/codebuddy/providers/` (`provider-interface.ts` + one file each). Adding a new provider = one new strategy file + an `isXProvider` branch in the constructor. `defaultMaxTokens` comes from `getModelToolConfig(model).maxOutputTokens`. Anthropic-specific message hooks (`injectAnthropicCacheBreakpoints`, `injectJsonSystemPromptForAnthropic`) live in `provider-openai-compat-hooks.ts` and are called by both `chat()` and `chatStream()` on the OpenAI-compat strategy.
- `src/services/prompt-builder.ts` — **real** system prompt builder (not the deleted `src/agent/system-prompt-builder.ts`). Applies model-aware token-budget truncation.
- `src/codebuddy/tools.ts` — ~110 tool definitions + RAG selection
- `src/ui/components/ChatInterface.tsx` — React/Ink terminal UI

### Non-obvious Architecture Decisions

1. **Lazy loading** — Heavy modules are loaded via getters in `CodeBuddyAgent` and lazy imports in `src/index.ts`. Profile with `PERF_TIMING=true`.
2. **Model-aware limits** — `src/config/model-tools.ts` holds per-model capabilities (contextWindow, maxOutputTokens, patchFormat) with glob matching (`grok-3*`, `claude-*`). **Start here for any model-specific behavior.** System prompt is truncated to `(contextWindow − maxOutputTokens) × 50%`.
3. **RAG tool selection** — `src/codebuddy/tools.ts` filters tools per query via embeddings to reduce prompt tokens; cached after first round. BM25 fallback via `tool_search` and tool metadata in `src/tools/metadata.ts`.
4. **Context compression** — `ContextManagerV2` (`src/context/context-manager-v2.ts`) uses sliding window + summarization; budget from `getModelToolConfig(model).contextWindow`.
5. **Middleware pipeline** — `src/agent/middleware/` has composable before/after hooks. **Priorities matter:**

   | Middleware | Priority | Purpose |
   |---|---|---|
   | `TurnLimitMiddleware` | 10 | Enforce max turns per session |
   | `CostLimitMiddleware` | 20 | Enforce session cost budget |
   | `ContextWarningMiddleware` | 30 | Warn when nearing context limits |
   | `SessionDurationMiddleware` | 35 | Suggest a clean pause + snapshot past `CODEBUDDY_SESSION_PAUSE_HOURS` (12 h) |
   | `ReasoningMiddleware` | 42 | Auto-detect complex queries, inject `<reasoning_guidance>` |
   | `WorkflowGuardMiddleware` | 45 | Suggest plan init for complex first messages |
   | `AutoObservationMiddleware` | 50 | Capture auto-observations (registered separately, ~line 1503) |
   | `AutoRepairMiddleware` | 150 | Detect errors, invoke fault localizer, suggest repairs |
   | `QualityGateMiddleware` | 200 | Auto-delegate to CodeGuardian and SecurityReview agents |

   Register in `codebuddy-agent.ts` constructor (priority order shown above). Lower priority runs first. `VerificationEnforcementMiddleware` (155) **is** wired (`codebuddy-agent.ts:~393`) — it nudges "verify before finishing" once per task (its `hasWarned` latch, and every middleware's per-task counters, are cleared by `MiddlewarePipeline.resetForNewTask()` at the start of each turn). The table plus the separately-registered `AutoObservationMiddleware` is now the exhaustive wired set. Two unwired factory scaffolds — `LearningFirstMiddleware` and `ToolFilterMiddleware` — were **removed 2026-07-04 as redundant**: correction/lesson capture is already covered by `memory-consolidation.ts` (same `MEMORY_SIGNALS` lineage) + the self-improvement lessons path, and tool gating/failure handling by `OperatingModeManager` plan-mode enforcement + `AutoRepairMiddleware`.
6. **Confirmation service** — Singleton. Check order: permission mode → declarative rules → session flags → Guardian Agent.
7. **Per-turn context injection** — Each LLM turn appends `<lessons_context>` (before) and `<todo_context>` (after). Must be applied in both agent-executor paths.
8. **Pluggable ContextEngine** — Plugins can register a custom context pipeline via `PluginContext.registerContextEngine()`. If `ownsCompaction` is set, built-in auto-compact is skipped. Trust check blocks non-trusted plugins from owning compaction.
9. **Output sanitizer** (`src/utils/output-sanitizer.ts`) — strips model leakage tokens (`<think>`, `<|im_start|>`, `[INST]`, `<<SYS>>`, GLM-5/DeepSeek artifacts, zero-width chars) from LLM output. Wired into agent-executor + message-processor. Tests assert sanitized output, so don't bypass.
10. **Transcript repair** (`src/context/transcript-repair.ts`) — runs at all 3 `prepareMessages()` call sites in agent-executor. Removes orphaned tool results and injects synthetic results for lost tool_call pairs. Touch this if you change message construction or compaction.

### Reasoning

Two systems coexist:
- **Extended Thinking** (`src/agent/thinking/`) — provider-level (Grok `budget_tokens`). Levels: `off`/`minimal`/`low`/`medium`/`high`/`xhigh`.
- **ToT + MCTS** (`src/agent/reasoning/`) — modes `shallow`/`medium`/`deep`/`exhaustive`. MCTSr Q-value: `Q(a) = 0.5 * (min(R) + mean(R))`. Entry point: `reasoning-facade.ts`. User-facing: `/think` command and the `reason` tool. Reasoning middleware (priority 42) auto-detects complex queries and injects `<reasoning_guidance>`.

## Self-Improvement — `src/agent/self-improvement/`

An empirically-gated, Darwin-Gödel-Machine-style loop that improves the agent's **reversible learnable layer** — never its own `src/` (a hard, scanned invariant). All of it is **opt-in via `CODEBUDDY_SELF_IMPROVE=true`** (default off ⇒ zero behavior change; `propose-only` vs `auto-apply`).

- **Lessons path** (V1): `engine.ts runCycle()` scores a deterministic `capability-benchmark.ts` → picks the weakest scenario → `proposer.ts` drafts a lesson → `empirical-gate.ts validateProposal()` snapshots/applies/re-scores and **rolls back on regression or no gain** → `evolutionary-archive.ts` + git-versioned `learning-store.ts`. CLI: `buddy improve status|cycle|loop`.
- **Tools path** — the agent **authors its own tools**. `register_tool` (`src/tools/register-tool-handler.ts`) writes BOTH registries — `FormalToolRegistry` (callable) + legacy `ToolRegistry` (visible next turn) — so an authored tool is usable by the agent itself; authored tools are namespaced `authored__*` and run **sandboxed** (`authored-tool-runtime.ts`: throwaway cwd, RPC off). The generative loop: `tool-proposer.ts`/`llm-tool-proposer.ts` (sees a **redacted view — no held-out cases**) → `tool-gate.ts` G1 static scan (`authored-artifact-gate.ts`) → G3 **visible** behavioral cases → G4 **held-out** behavioral cases (the anti-reward-hacking defence: a tool that hardcodes the visible outputs fails fresh inputs → rejected) → `tool-engine.ts` keeps + archives. Behavioral scoring (`sandbox-scorer.ts`) never registers the tool, so a rejected proposal touches nothing. Kept tools persist to `.codebuddy/self-improvement/authored-tools.json` and reload at startup (`tool-skill-mutator.ts loadAuthoredTools`). CLI: `buddy improve tools [--apply]`.
- **Autonomy self-trigger:** when the autonomous loop (`autonomous-loop.ts tick()`) is idle and `CODEBUDDY_SELF_IMPROVE=true`, it runs one bounded self-improvement cycle (cooldown-gated, never-throws, archive-bounded so it stops once seed scenarios are covered). The hook is injected (testable) and defaults to the tool engine.
- **Skills path** — the agent authors its own SKILL.md (`skill-engine.ts` + `skill-proposer.ts`). A skill is procedural guidance (not a deterministic function), so the gate is honest about that: `skill-gate.ts` = static scan → **skill firewall** (`scanSkillFirewall` — the prompt-injection/exfiltration defence, since a skill is injected into context) → **coverage** (does it surface the expected guidance?). NO behavioral held-out (nothing to run). Installed **one level deep** at `.codebuddy/skills/<authored-name>/SKILL.md` (the registry's `findSkillFiles` only descends 1 level) with ensured frontmatter, via `skill-mutator.ts`.
- **Skill curation (Hermes-inspired)** — `skill-mutator.ts` also does `patch`/`update` (re-gated), `pin`/`unpin` (a `pinned:` frontmatter flag honoured before every destructive op), and `archive`/`restore` (recoverable, never `rm`). `skill-consolidator.ts` merges a cluster of authored skills into one "umbrella" but **coverage-gates** the merge — rejected if the umbrella drops any absorbed sibling's scenario coverage (our twist vs Hermes's LLM-judgment-only consolidation); absorbed siblings are archived with `absorbedInto` for audit, pinned ones skipped. All ops are restricted to `authored-*` skills (never user/bundled). CLI: `buddy improve skills [--apply]` and `skills-list|skills-pin|skills-unpin|skills-restore|skills-consolidate`. The default autonomy self-trigger tries tools then skills.
- **Skill import (external libraries)** — `src/skills/skill-importer.ts` brings external skills (a Hermes repo, any skills dir) in. The spine is the **firewall**: `scanSkillFirewall` scans each skill dir (SKILL.md + its scripts) and **quarantines** dangerous ones (verified live on the 75-skill Hermes repo — `red-teaming/godmode` and script-bearing skills are blocked; `review` skipped unless `--include-review`). It flattens nested layouts (Hermes nests 1–3 levels; OpenClaw is flat) to a flat `imported-<name>` (the registry's `findSkillFiles` walks 1 level). The remap is **source-agnostic**: tags come from top-level `tags` OR any `metadata.<source>.tags` (Hermes `metadata.hermes.tags`; OpenClaw carries none), `nativeEngine.triggers` are **derived from name + description keywords** (without triggers an imported skill scores below `minConfidence` and is undiscoverable — critical for OpenClaw which has no tags), and `prerequisites.commands`/`metadata.<source>.requires.bins` → `requires.tools`. Support dirs are copied (no symlinks); scripts are copied, **never run**; provenance is written (`imported:true`, `source`, pinned). `src/skills/skill-sources.ts` is the referential (named `dir`/`git` sources; `~/.hermes/skills` → `hermes` and the npm-global OpenClaw skills dir → `openclaw` are seeded by default). Verified live: Hermes (53/75 import, jailbreak quarantined) and OpenClaw (52/57) both import through the same gate. CLI: `buddy skills import (--dir|--source) [--apply] [--include-review]`, `skills imported`, `skills sources add|list|remove`. Imported skills are `imported-*` (the self-improvement engine only touches `authored-*`).
- **Safety invariants:** never edits `src/`; sandboxed scoring only; held-out hidden from the proposer (tools); skill firewall scan (skills); `authored__`/`authored-` namespaces can't shadow built-ins; append-only archive; opt-in default-off kill-switch.

## Fleet (Multi-AI Hub) — `src/fleet/` + `src/server/websocket/`

Stateful WebSocket mesh letting Code Buddy peers observe each other's events live and invoke each other's LLMs / read-only tools. Bridges live in `src/fleet/` and are wired in `src/server/index.ts` on every `buddy server` start.

> Parity vs Hermes Agent / OpenClaw (what's shipped, what's gated — no open code gap since 2026-07-03): [`docs/hermes-openclaw-parity.md`](docs/hermes-openclaw-parity.md) — canonical, supersedes the dated audits now in `docs/archive/2026-q2-hermes-audits/`.

- **`peer.chat`** (V1) — stateless one-shot LLM call to a peer (`peer-chat-bridge.ts`).
- **`peer.chat-session.start|continue|end|continue-stream|list`** (V1.2, Phase d.21–d.22) — multi-turn sessions, FIFO-serialised per `sessionId`, 30-min idle TTL (`CODEBUDDY_PEER_SESSION_IDLE_MS`), persisted to `~/.codebuddy/peer-sessions/*.json` (`peer-session-store.ts`). Privacy guard: `peer.chat-session.list` returns metadata only, never prompt/assistant content (asserted by test).
- **`peer.tool.invoke` + `.stream`** (V1.3, Phase d.23, `peer-tool-bridge.ts`) — remote read-only tool execution. **Three security gates** in order: allowlist (`CODEBUDDY_PEER_TOOL_ALLOWLIST`, default `view_file`/`list_directory`/`search`) → registry `fleetSafe: true` flag (`src/tools/metadata.ts`) → workspace root (`CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` must be set; **fails closed** with `PEER_WORKSPACE_NOT_CONFIGURED` if unset, so a misconfigured peer can't expose `/`). Anti-loop guards: `CODEBUDDY_PEER_MAX_DEPTH`, `CODEBUDDY_PEER_ROLE=leaf`.
- **`route_peer` tool + `/fleet route`** — `TaskRouter` (`task-router.ts`) classifies a prompt, gathers peer capabilities via `peer.describe`, applies privacy/cost/latency constraints, returns the recommended `peer_delegate` call. Privacy lint (`privacy-lint.ts`) detects SSN/IBAN/phone/credit-card before routing.
- **Slash UX:** `/fleet listen`, `/fleet send <peer> <method> <json>`, `/fleet history [--type glob] [--json]`, `/fleet status [--with-sessions]`, `/fleet chat start|say|end|list`, `/fleet route`, `/fleet describe`.

## Code Explorer — `src/plugins/code-explorer/`

**Code Explorer** (renamed from GitNexus) is an optional standalone Rust code-intelligence engine that pre-indexes repositories into a queryable knowledge graph. Code Buddy wires it through the MCP server configured in `.codebuddy/mcp.json`, the native `code_explorer_ask` tool, the bundled `code-explorer` skill, and the CKG ingestion bridge (`buddy research ingest-code`). Stale-index refresh stays opt-in via `CODEBUDDY_CODE_EXPLORER_AUTOINDEX=true`. See [`docs/code-explorer-integration.md`](docs/code-explorer-integration.md).

## Sensory nervous system — `buddy-sense/` (Rust) + `src/sensory/`

A brain-inspired perception layer (for the companion/robot vision). Diagrams: [`buddy-sense/docs/architecture.svg`](buddy-sense/docs/architecture.svg) + [`dreaming.svg`](buddy-sense/docs/dreaming.svg). **`buddy-sense/`** is a Rust monorepo subdir (tokio) with **five sense modules** emitting `SensoryEvent`s over bounded channels: **audio** (`senses/audio.rs`, energy VAD + optional Silero via `neural-vad`; WAV input — no live mic yet), **vital** (`senses/vital.rs`, the always-on heartbeat), **vision** (`senses/video.rs`, motion detector + **live camera capture** behind the `live-vision` feature — ffmpeg grabs grayscale frames, emits `vision/motion` + a JPEG keyframe), **screen** (`senses/screen.rs`, xcap diff, `live-screen`), **ui** (`senses/ui.rs`, AT-SPI focus, `live-ui`). **The default daemon spawns only the heartbeat** (+ audio when passed a WAV path); screen/ui run only under their live features. Senses feed a **thalamus** (`bus.rs`) that coalesces high-rate events and lets salient ones bypass coalescing (an attention **gate** — it does NOT reorder by priority; vital is never coalesced), then **broadcasts** (the "global workspace") → a WebSocket **bridge** (`bridge.rs`, token-aware, ping keepalive). (A per-modality ring buffer in the thalamus is Phase-2/3 scaffolding, not yet read by the binary; the real short-term memory lives on the Code Buddy side.) Heavy analysis (STT, vision, OCR) is delegated to Code Buddy. `cd buddy-sense && cargo test` (20 tests, no hardware). Opt-in Cargo features (core builds without them): `live-screen` (xcap), `live-ui` (atspi/zbus), `neural-vad` (Silero/ONNX — needs a model + onnxruntime, see `buddy-sense/models/README.md`; falls back to the energy VAD on any error). All deps permissive (MIT/Apache); `ui-events`/Screenpipe were NOT copied (clean-room — proprietary/stub).

The Code Buddy side (`src/sensory/`, opt-in `CODEBUDDY_SENSORY=true buddy server`, wired once in `src/server/index.ts`): **`sensory-bridge.ts`** — a loopback-only, Origin-checked `ws` server that re-emits frames onto `getGlobalEventBus()` as `sensory:perception` (clamps salience/ts); **`reactions.ts`** pushes every perception into **`sensory-memory.ts`** (short-term buffer); **`heartbeat-scheduler.ts`** fires treatments every N beats (a pacemaker; `CODEBUDDY_HEARTBEAT_EVERY`); **`dreaming.ts`** consolidates the short-term buffer into a dream journal + promotes salient dreams to persistent `CODEBUDDY_MEMORY.md` (`CODEBUDDY_DREAM_EVERY`); **`vision-reaction.ts`** / **`screen-reaction.ts`** run `camera_analyze`/percepts on motion/change (debounced, opt-in `CODEBUDDY_SENSORY_CAMERA`/`_SCREEN`); **`speech-reaction.ts`** closes the perception→cognition loop — on `speech_end` (the daemon tags the event with the source WAV), it transcribes (engine via `CODEBUDDY_SPEECH_ENGINE`: in-process Rust `sherpa-rs`, python `parakeet`, or `faster-whisper`) → a `hearing` percept (debounced, opt-in `CODEBUDDY_SENSORY_SPEECH`, with an `onHeard` hook for further action like an agent turn). **Deterministically tested** (CI, no hardware): the loopback bridge → event bus → reaction path (`tests/sensory/`) + the VAD/motion/thalamus/dreaming cores (~16 TS + 20 Rust tests). **Manually validated on the author's machine** (hardware-gated, NOT in CI): BRIO camera + gemma describe, X11 screen change via xsetroot, AT-SPI focus, Silero on real speech. `speech_end → STT → 'hearing' percept` is now wired (`speech-reaction.ts`); driving a full agent turn from the transcript is the `onHeard` hook's job (not auto-wired). Opt-in, loopback-only, never-throws.

**Robot vision (the eyes), operational** — `buddy-vision/` (Python sidecar, sibling to `buddy-sense/`): owns a camera (OpenCV) and runs **MediaPipe FaceLandmarker** state-machine detectors that emit ONE event per *transition* (no spam, the "Vigil" pattern): `vision/person_entered` / `vision/person_left` (face presence) and `vision/drowsy` (eyeBlink blendshape). Setup: `buddy-vision/setup.sh` (venv + `face_landmarker.task` + `ollama pull moondream`). On the Code Buddy side, **`vision-reaction.ts`** now describes the keyframe with a **real local vision model** (`CODEBUDDY_VISION_MODEL`, e.g. moondream — gemma is text-only) and **dedups** alerts (`CODEBUDDY_VISION_ALERT_COOLDOWN_MS`/`_SIM`); **`semantic-vision-reaction.ts`** turns person/drowsy events into a Telegram alert via **`alert.ts`** (`CODEBUDDY_SENSORY_ALERT_TOKEN`/`_CHAT`). Runs 24/7 as systemd user services `buddy-vision-brain` (buddy server) + `buddy-vision-eye` (watch.py); config in `~/.codebuddy/vision.env`. **Gotcha:** the bridge rejects WS connections carrying an `Origin` header → the Python client must use `create_connection(..., suppress_origin=True)`.

**Synthetic perception training ("train the brain") — `src/vision-train/` + `buddy vision-train`** (opt-in `CODEBUDDY_VISION_TRAIN=true`, CLI-only, fail-closed like `buddy science`). The keystone of "generate labeled scenes → train the robot brain": a hardware-agnostic loop that scores the robot's **real perception** (`object_detect`/YOLOv8) against **self-labeled** scenes to surface where perception is weak (the training signal). `curriculum.ts` = deterministic domain-randomized scenes (person count, lighting, framing) — each carries a text-to-image prompt AND ground-truth counts. `scorer.ts` (pure) = per-scene TP/FP/FN → aggregate per-label precision/recall + per-condition accuracy + ranked weak-spots. `engine.ts` = obtain→perceive→score with INJECTED generation + perception (per-scene fail-open). Two modes: **generate** (curriculum → `image_generate` → YOLO) and **folder** (`--images DIR --labels FILE`, no generation — hardware-agnostic). `--ckg` publishes weak-spots to the Collective Knowledge Graph (the brain retains them). Image generation gained a **local ComfyUI provider** (`CODEBUDDY_IMAGE_PROVIDER=comfyui`, `COMFYUI_URL` default `127.0.0.1:8188`) in `src/tools/media-generation-tool.ts` — offline GPU, workflow `/prompt`→`/history`→`/view`, params auto-tuned by checkpoint family (turbo/flux/sd). Perception env: `CODEBUDDY_YOLO_PYTHON` (an ultralytics-capable python), model auto-resolved from `~/vision_tests/yolov8n.pt`. **Validated live** on real YOLOv8 (bus.jpg/zidane.jpg). **Note (Ministar AMD):** local 3D (Stability Arbor/SV3D) is CUDA-only, and ComfyUI on the Strix Halo iGPU (ROCm) is currently too slow to generate — the loop is proven via folder mode + the provider is proven against the live ComfyUI API shape.

## Film production (chain clips into long-form video) — `src/tools/video/film-assemble.ts` + `film-project.ts` + `src/agent/film/film-producer.ts`

Turns the short clips `video_generate` makes into ONE longer film. Three layers, all ffmpeg-backed, with **pure/testable argv builders + injectable spawn** (like `frame-sample.ts`), fail-open, and a **`gl` engine that falls back to `xfade`** when the local ffmpeg lacks the `gltransition` filter:
- **Montage brick** (`assembleFilm`, `film-assemble.ts`): normalizes every clip to a common W×H/fps/SAR/pix_fmt first (mandatory before xfade), then welds with native ffmpeg `xfade`+`acrossfade` (engine `xfade`, ~50 transitions, default) or `gltransition` (engine `gl`). **Cumulative offset formula**: `offset_k = Σd[0..k] − ΣT[0..k]`, final ≈ `Σd − ΣT`. Optional looped **background music with ducking** (`sidechaincompress`) + **voiceover**. Saves to `.codebuddy/media-generation/films/` + a `.meta.json` sidecar carrying `prompt`/`provider:'film'`/`model:<engine>` so the film shows a real card in the **Cowork media library** (`cowork/src/main/media-library.ts` scans that tree recursively; continuity ref-frames go to `.codebuddy/film-work/` to stay OUT of it). Exposed to the agent as the **`video_stitch` tool** (`registry/multimodal-tools.ts` `VideoStitchTool`; def in `tool-definitions/multimodal-tools.ts`; `metadata.ts`).
- **Resumable project + quality gate** (`film-project.ts`): a `film.json` manifest (scenes/status/clipPath, audio, decision log — OpenMontage-style checkpoints) under `films/<name>/`, saved after every scene so one scene regenerates without redoing the film; `assessFilmQuality` = one ffmpeg pass (`blackdetect`+`volumedetect`) + ffprobe → pass/REVIEW (duration drift, silent audio, black frames), with PURE parsers.
- **End-to-end producer** (`film-producer.ts` + `buddy film` CLI): scene plan → generate a clip per scene (fixed **seed** + optional `--continuity` last-frame → next-scene reference for visual consistency, the hard long-form problem) → `assembleFilm` → quality gate. A scene may carry a **`narration`** string → synthesized to a spoken WAV via **Piper** (`src/tools/video/narration.ts`, offline/$0, `CODEBUDDY_TTS_VOICE`), the scene is auto-**sized to fit the voice**, and the narration is baked silence-padded into the clip (so boundary crossfades only touch silence); background music is auto-ducked under it. Fail-open: no Piper/voice ⇒ narration skipped, render unaffected.
- **Prompt → video (Video Studio)** — `buddy film from-prompt "<sujet>"` (`src/agent/film/video-studio.ts` `produceVideoFromPrompt`): an LLM plans scenes (`src/agent/film/scene-planner.ts`, one-shot JSON via `resolveCommandProvider` + `CodeBuddyClient` + `generateJsonWithRetry`, $0 via ChatGPT-OAuth) → per scene: Piper narration → a **premium 1080p clip** (`src/tools/video/scene-render.ts`: rounded/shadow framing on a gradient via ImageMagick, Ken Burns, vignette) with **karaoke captions** (`src/tools/video/subtitles.ts`, ASS `\k` timed from the KNOWN text — never STT, which garbles proper nouns) and, for "diagram" scenes, a real **Mermaid render** (`src/tools/video/mermaid-render.ts`, `mmdc` + auto Chromium, fail-open to a text card) → `assembleFilm` + music bed → quality gate → media library. Every heavy dep injectable; `onProgress` for the CLI + the Cowork **Video Studio** panel (rail 🎬, `cowork/src/main/film/` + `renderer/components/videostudio/`). Rendering is **aspect-aware** (title/caption sizes + image framing scale with W×H); `buddy film from-prompt --short` produces a punchy **vertical 9:16** social short (1080×1920, ~3 scenes, terse narration via the planner's `style:'short'`). Every heavy dep injected (unit-tested without a provider/ffmpeg). Reference: [OpenMontage](https://github.com/calesthio/OpenMontage). Tests: `tests/tools/video/film-assemble.test.ts` + `film-project.test.ts` (real ffmpeg render/quality gated on presence), `tests/tools/video-stitch-tool.test.ts`, `tests/agent/film-producer.test.ts`.

## Cowork — Desktop GUI (`cowork/`)

Electron app, separate `package.json`, Node ≥22, Vite + React + better-sqlite3, Playwright for e2e. Architecture in `cowork/ARCHITECTURE.md`.

- Build: `npm run build:gui` (or `cd cowork && npm run dev` for live).
- Tests: `cd cowork && npm test` (vitest) and `npm run test:e2e` (Playwright).
- `better-sqlite3` is rebuilt against Electron headers via `npm run rebuild` (called from `postinstall`).
- **Dual-`mainWindow` regression** (rc.8, commit `751f7eb6`): `cowork/src/main/index.ts` and `cowork/src/main/window-management.ts` each owned a `let mainWindow: BrowserWindow | null = null`. Only the former was set; `getMainWindow()` (used by `ipc-main-bridge.ts:sendToRenderer()`) always returned `null`, silently dropping every main→renderer IPC push. Fixed by exporting `setMainWindow()` and calling it after `BrowserWindow` creation. **If you add another module that needs `mainWindow`, import the setter, don't redeclare the variable.**
- **`@phuetz/ai-providers` inlined** into `src/providers/_shared/` (commit `5757b197`) — don't reintroduce the workspace symlink.
- **`JWT_SECRET` runtime fallback**: auth throws at module-load under `NODE_ENV=production` if missing; `ServerBridge` mints a 64-byte hex secret at boot if none persisted. Persistent secrets go through Settings → Embedded server (`SettingsServer.tsx`).
- Visual workflow execution wraps the core `Orchestrator` (`src/orchestration/orchestrator.ts`) with a 4-agent pool (`cowork/src/main/workflows/workflow-bridge.ts`). Two runtime bugs fixed before ship: `processQueue` deadlock after `queueTask` (use `task_created` listener + `queueMicrotask`) and `workflow_started` listener-order issue (use `prependListener` so the run-scoped capture handler populates the instanceId↔workflowId map first).
- Linux dev loop: see `cowork/DEV-LINUX.md` — skip `npm run build`, use `npx vite build` (~30 s), boot Electron with `--no-sandbox --disable-gpu`.

## Adding a Tool

1. Create class in `src/tools/` returning `Promise<ToolResult>` (`{ success, output?, error? }`).
2. Add OpenAI function definition in `src/codebuddy/tools.ts`.
3. Add execution case in `CodeBuddyAgent.executeTool()`.
4. Register in `src/tools/registry/` via the right factory.
5. Add metadata in `src/tools/metadata.ts` (keywords + priority — used by RAG selection and BM25 `tool_search`). Set `fleetSafe: true` only for read-only tools you want exposed via `peer.tool.invoke`.

Codex-style aliases (`shell_exec`, `file_read`, `browser_search`, …) live in `src/tools/registry/tool-aliases.ts`.

## Edit Tool Matching

`str_replace` tries 5 strategies in cascade: **exact** → **flexible** (trim-normalized, preserves indent) → **regex** (tokenized on `():[]{}<>=,;`, joined with `\s*`) → **fuzzy** (Levenshtein, 10% threshold) → **LCS fallback** (90% similarity). Before any write/edit, content is scanned for omission placeholders (`// ... rest of code`, `// remaining methods ...`) — if present in `new_string` but not `old_string`, the edit is blocked.

## JIT Context

When a tool touches a path, the system walks upward to the project root loading any `CODEBUDDY.md` / `CONTEXT.md` / `INSTRUCTIONS.md` / `AGENTS.md` / `README.md` (and in `.codebuddy/` or `.claude/` subdirs). Max 4KB per discovery. `.codebuddy/settings.json → codebuddyMdExcludes` takes glob patterns to skip. CODEBUDDY.md supports `@path/to/file` imports (relative, `@~/…`, `@//…`), recursive to 5 levels.

## Auto-Memory Writeback

Persistent memory lives at `.codebuddy/CODEBUDDY_MEMORY.md` (project) and `~/.codebuddy/memory.md` (user). The agent writes back preferences, decisions, and gotchas across sessions (see `src/memory/persistent-memory.ts`). User-facing surface: `/memory recent`, `/memory show`, `buddy --init` (also generates an `AGENTS.md` for cross-CLI compatibility — read by Claude Code, Gemini CLI, Cursor, Codex).

## Collective Knowledge Graph engine — `buddy-memory/` (Rust) + `src/memory/collective-knowledge-graph.ts`

The CKG is the **shared, cross-agent** memory (distinct from the per-session writeback above): a typed graph (`lesson`/`decision`/`fact`/`discovery` nodes; `related_to`/`supersedes`/`supports`/`contradicts`/… edges) with **bi-temporal supersede**, **cross-agent corroboration** (a fact independent agents agree on gains confidence + rank), and **hybrid recall** (multilingual embeddings + keyword + salience + MMR, **no LLM at retrieval**). Store = append-only JSONL ledger (`~/.codebuddy/collective/ckg-ledger.jsonl`, O_APPEND atomic → cross-process safe). Injection is gated by `CODEBUDDY_COLLECTIVE_MEMORY`; fed by `buddy research ingest|recall|stats|ingest-code` + the autonomous research-ingest daemon.

**`buddy-memory/`** is the optional **Rust engine** backing it — an **in-tree Rust sidecar, exactly like `buddy-sense/`** (spawned over newline JSON-RPC stdio; the TS class is a thin client in `buddy-memory-client.ts`). It mirrors Code Explorer's architecture: ledger write-ahead + snapshot fast-load (`<ledger>.snap`, no full O(N) replay on cold start) + an ONNX embedder (`embeddings` cargo feature; copies Code Explorer's `OnnxEmbedder` since gitnexus's `mod onnx` is private — so deps stay permissive/MIT, no PolyForm taint). **Opt-in via `CODEBUDDY_CKG_ENGINE=rust`** and the binary being built; otherwise the in-process TS implementation runs unchanged. Both share the same ledger, so switching is seamless and falls back on any engine error. Build: `cd buddy-memory && cargo build --release --features embeddings`. Status: Phases 1–3 done (model+ledger+JSON-RPC, hybrid semantic recall, snapshot+parity); Phase 4 = sub-linear recall index + default cutover.

## Config Files

- `src/config/model-tools.ts` — **start here for model-specific behavior**. Per-model caps with glob matching.
- `src/config/constants.ts` — `SUPPORTED_MODELS`, `TOKEN_LIMITS`
- `src/config/toml-config.ts` — config profiles (`[profiles.<name>]` deep-merged; `buddy --profile <name>`). Also `[model_pairs]` for architect/editor split.
- `src/config/advanced-config.ts` — effort levels (low/medium/high) → temperature + token params
- `.codebuddy/settings.json` — local model + thinking-level defaults (current repo: `gpt-5.5` + `high`)

## Coding Conventions

- TypeScript strict, avoid `any`. `noUncheckedIndexedAccess` is **on**; `exactOptionalPropertyTypes` is **not yet on** (TODO in `tsconfig.json`). `noUnusedLocals`/`noUnusedParameters` are intentionally off — delegated to ESLint.
- Single quotes, semicolons, 2-space indent
- Files kebab-case (`text-editor.ts`); React components PascalCase (`ChatInterface.tsx`)
- Conventional Commits (`feat(scope): description`) — enforced by `commitlint.config.js`
- ESM — imports need `.js` extension even from `.ts` sources
- Path aliases (`@agent/*`, `@tools/*`, etc.) are declared in `tsconfig.json` but **not actually used in source** — relative imports are the norm. Don't introduce them in new code unless you're starting a sweep.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GROK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | Provider auto-detect |
| `GROK_BASE_URL` / `GROK_MODEL` | Custom endpoint / default model |
| `CODEBUDDY_LLM_EXTRA_HEADERS` | JSON object of extra HTTP headers applied to every OpenAI-compat LLM call (gateways/observability proxies: Helicone, Portkey, corp proxies). Transport-managed headers (`host`, `content-type`, …) are dropped; invalid JSON disables with a warning |
| `CODEBUDDY_SLACK_BLOCK_KIT` | `true` renders agent markdown as Slack Block Kit on `send()` (headers/dividers/code + markdown tables as **native `table` blocks**, prose→mrkdwn); `text` stays as the notification fallback; oversized tables fall back to a code section (Slack caps 100×20/10k chars); default off = plain text unchanged |
| `CODEBUDDY_MAX_TOKENS` | Override response token limit |
| `CODEBUDDY_AUTOCOMPACT_PCT` | Auto-compact threshold as % of context window |
| `MORPH_API_KEY` | Enables fast file editing |
| `YOLO_MODE` / `MAX_COST` | Full autonomy ($10 default, $100 YOLO) |
| `JWT_SECRET` | Required in production for API server |
| `OLLAMA_HOST` / `VLLM_BASE_URL` | Bundled provider auto-detect |
| `CODEBUDDY_BROWSER_DEV_ORIGINS` | csv of extra **loopback-only** origins the agent browser may visit (e.g. `http://localhost:5173`); non-loopback entries are rejected loudly. Normal path: the `app_server` tool registers/unregisters the origin of the dev server it spawned (port must be free pre-spawn — never adopts a pre-existing service). `src/security/dev-origins.ts`; `web_test` is the one-call verify report (console+page errors, server logs, snapshot, screenshot, assertions) |
| `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` | **Required to enable** `peer.tool.invoke` — fail-closed when unset |
| `CODEBUDDY_PEER_TOOL_ALLOWLIST` | csv override for default `view_file,list_directory,search` |
| `CODEBUDDY_PEER_SESSION_IDLE_MS` / `CODEBUDDY_PEER_MAX_DEPTH` / `CODEBUDDY_PEER_ROLE` | Fleet limits |
| `CODEBUDDY_FLEET_MAX_CONCURRENCY` | Peer capacity → live `utilization` in heartbeats + daemon saturation backpressure (`src/fleet/fleet-load.ts`) |
| `CODEBUDDY_COUNCIL_ROUTING` | **Opt-in (default off = strict no-op)**: lets the council's `ModelScoreboard` feed the MAIN chat model routing. When `true`, `ModelRoutingFacade.autoRouteIfEnabled` adds a CONSERVATIVE tie-break: it only arbitrates between `selectModel`'s `recommendedModel` and its already-surfaced `alternativeModel`, and only switches when the scoreboard has real run history showing the alternative is stronger for the inferred task category (empty/unseen scoreboard ⇒ silent fallback). Never overrides a hard constraint (cost/capacity/pinned/`/switch`/vision — all upstream). Off = no scoreboard read, no latency |
| `CODEBUDDY_COUNCIL_TIMEOUT_MS` / `CODEBUDDY_COUNCIL_EXPLORE` / `CODEBUDDY_COUNCIL_POOL` | Council per-model timeout (45s), ε-exploration seat probability (0.1), and candidate pool mode (`full` = every active provider expanded to its catalog/installed models via `src/providers/active-llm-model-pool.ts`; `registry` = legacy one-model-per-provider). The pipeline lives in `src/council/` (engine, data-in/data-out), `src/commands/council.ts` is only the CLI presenter. Scoreboard ledger is JSONL (`~/.codebuddy/fleet-model-performance.jsonl`, legacy `.json` auto-migrated); the judge abstains instead of guessing, only NEUTRAL (non-panel) verdicts train routing, and fan-out failures are recorded (`failed: true`) so dead catalog models stop being re-seated. Model strengths come from ONE place: `getModelStrengths()` in `src/config/model-tools.ts` (config booleans are authoritative; `inferStrengths`/`deriveStrengths`/`cfgToStrengths` are delegates). A CLI council run with a real disagreement signal proposes a human-gated lesson candidate (`buddy lessons`) when run inside a project. Deliberation quality: members answer under a falsifiable-output contract (VERDICT/CLAIMS/WOULD CHANGE MY MIND), the judge returns DUAL scores (`task` picks the winner, `role` trains role routing so critics aren't punished for critiquing), a dead judge is penalised and replaced within the run, the synthesis follows a mandatory arbitration structure (verbatim minority quote when the score spread >0.3), and each run logs a Deliberation Health Index to `~/.codebuddy/council-deliberation-health.jsonl` (`src/council/deliberation-health.ts`) |
| Search keys | `BRAVE_API_KEY`, `EXA_API_KEY`, `PERPLEXITY_API_KEY`, `OPENROUTER_API_KEY`, `FIRECRAWL_API_KEY` |
| `FINNHUB_API_KEY` | Optional, most-reliable source for the `stock_quote` tool (`src/tools/stock-quote.ts`). When set, tried FIRST; otherwise the tool falls back to free/no-key **Yahoo Finance → Nasdaq API → Stooq** ($0 default — Nasdaq works from datacenter IPs where Yahoo/Stooq rate-limit; US symbols). `stock_quote` emits a `data:{type:'stock'\|'market',…}` payload that renders the curated stock widget inline. Base URLs overridable via `CODEBUDDY_YAHOO_FINANCE_BASE` / `CODEBUDDY_NASDAQ_BASE` / `CODEBUDDY_STOOQ_BASE` / `CODEBUDDY_FINNHUB_BASE` (loopback tests) |
| `SEARXNG_URL` | Self-hosted SearXNG meta-search endpoint (e.g. `http://localhost:8888`), no API key. When set, **preferred first** in `WebSearchTool`'s auto provider chain (`src/tools/web-search.ts`): SearXNG → Brave MCP → Brave API → Perplexity → Serper → DuckDuckGo. Queries `{SEARXNG_URL}/search?format=json`. Unset ⇒ never tried, chain byte-identical to the historical order. Deliberately not run through the SSRF guard (a trusted, operator-configured endpoint like `OLLAMA_HOST`) — just requires a well-formed http(s) URL, else disabled with a warning |
| `PICOVOICE_ACCESS_KEY` | Porcupine wake word (text-match fallback if absent) |
| `CODEBUDDY_SPEECH_ENGINE` | STT engine for the speech loop: `sherpa-rs` (**in-process Rust**, sherpa-onnx offline transducer — no python, ~110 ms warm; spawns `buddy-sense stt` built `--features stt`), `parakeet` (python sherpa_onnx worker), `faster-whisper` (**default**), or `auto` (prefers sherpa-rs when its binary is built, then parakeet, then faster-whisper). `sherpa-rs` falls back to faster-whisper unless `CODEBUDDY_SPEECH_FALLBACK=false`. See `src/sensory/speech-reaction.ts` + `buddy-sense/src/senses/stt.rs` |
| `CODEBUDDY_SPEECH_STT_BIN` / `BUDDY_SENSE_STT_MODEL_DIR` / `BUDDY_SENSE_STT_THREADS` | Override the `buddy-sense` stt binary path (else auto-resolved under `buddy-sense/target/{release,debug}/`), the Parakeet model dir, and decode threads for the `sherpa-rs` engine. The loader needs the prebuilt sherpa-onnx `.so` (copied next to the binary) — the TS worker sets `LD_LIBRARY_PATH` to the binary's dir automatically |
| `CODEBUDDY_SENSORY_SPEAK` | Close the voice loop: `speech_end → STT → think → speak`. **Requires `CODEBUDDY_TTS_VOICE`** (else the robot hears but stays silent — server logs loud) |
| `CODEBUDDY_SENSORY_SPEAK_MODEL` | Pin the spoken-reply model. **Default unset/`auto` → latency-routed**: `selectFastestModel` (`src/fleet/model-selector.ts`) picks the lowest-latency capable LLM among active providers (reuses the council's registry + `ModelScoreboard` measured latency + a size heuristic). Set to a model id to override. |
| `CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY` | `true` restricts voice routing to models served by your **local runtime endpoints** (Ollama / LM Studio). Note: a local OpenAI-compat gateway can itself proxy to a cloud model, so this is a routing preference, **not a hard egress guarantee** |
| `CODEBUDDY_SENSORY_SPEAK_ROUTE_TTL_MS` | Cache window for the per-utterance voice model selection (default 60000) — avoids re-probing providers (and any inline xAI token refresh) on every spoken turn |
| `CODEBUDDY_SENSORY_SPEAK_ACT` | **Voice COMMANDS** (opt-in, default off). When `true`, a spoken utterance drives a REAL agent turn (`makeAgentReply`, `src/sensory/agent-reply.ts`) that can investigate and—under a higher posture—act, then speaks a condensed result. Off → today's chatty companion reply |
| `CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE` | Voice ACT posture: `plan` (**default**, read-only — reads/search only, writes+shell denied), `dontAsk`/`bypassPermissions` (can edit/run — still behind the static command validator + secret/deploy guard). Applied via the same `PermissionModeManager` `ConfirmationService` consults. Run the speaking actor in its own process (the posture is process-global) |
| `CODEBUDDY_VOICE_TO_TELEGRAM` | `true` → `sayNow` (reminders/announcements) also sends the spoken line as a **Telegram voice note** (`sendTelegramVoice`, `src/sensory/alert.ts`: Piper→OGG/Opus via `synthesizeToOgg` → `sendVoice`), so the robot's voice reaches your phone when you're away from the speakers. Reuses `CODEBUDDY_SENSORY_ALERT_TOKEN`/`_CHAT` + `CODEBUDDY_TTS_VOICE`; falls back to text; never-throws |
| `CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL` | Pin the model for the voice-command **agent turn** (distinct from the fast reply model). Unset → fastest tool-calling model, which can be a tiny model whose context truncates and whose answers are wrong; for accurate commands pin a capable local model (e.g. `devstral-small-2:24b-instruct` or `qwen3.6:27b`) |
| `CODEBUDDY_ROBOT_NAME` | Robot mode (daemon): name that counts as **being addressed** (default `Buddy`, fuzzy-matched to survive STT mangling). The robot hears everything but **only replies when addressed** or in the post-address window — `respond-decider.ts` |
| `CODEBUDDY_USER_NAME` | Your name, interpolated into the `{{name}}` slot of the camera arrival opener (`src/sensory/arrival-opener.ts`). Unset → the opener drops the slot cleanly (no "Bonjour undefined"), just less personal. Not read anywhere else — no structured user-name source exists yet |
| `CODEBUDDY_SENSORY_GREET_LLM` / `_TIMEOUT_MS` | Camera arrival greeting: layer a fresh **LLM-generated** opener on top of the deterministic templates (`buildLlmArrivalOpener`). Opt-in `=true` (default off → the enriched deterministic pools, instant/$0). When on, the model is seeded with the time context, the recent lines to AVOID (persisted `recentSpoken` ring), and the last things heard (`readRecentCompanionPercepts`, so it can reference the conversation), routed via `resolveVoiceModel`. Falls back to the instant deterministic opener on timeout (`_TIMEOUT_MS`, default 4000) / error / empty — never blocks the greeting. `CODEBUDDY_ROBOT_NAME=lisa` sets the persona/tone |
| `CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS` | Post-reply window (default 30000) where follow-ups are treated as addressed (conversation continuity) |
| `CODEBUDDY_SENSORY_CHIME_IN` | `true` lets the robot speak **unprompted** when the conversation warrants it (cheap cue → rare high-bar LLM judge, error→silent). Default off (conservative — never butt into a human-human conversation) |
| `CODEBUDDY_SENSORY_RESPOND_DECISION_MODEL` | Pin the model for the rare chime-in judgment (else the fast reply model) |
| `CODEBUDDY_SENSORY_ALWAYS_RESPOND` | `true` bypasses the response gate — reply to **every** utterance (the pre-2026-06-26 behavior, for testing) |
| `CODEBUDDY_REMINDERS` | Enable reminders (`buddy server`): the robot announces due reminders aloud (`sayNow`/Piper) + Telegram, and you flag them done. Store: `~/.codebuddy/reminders.json` (hand-editable) + `reminder-log.jsonl` + `snoozes.json`/`pending-acks.json` (both restart-safe). Runner is independent of the sensory daemon (`src/companion/reminders.ts` + `reminder-runner.ts`). **Model:** recurring time-of-day by default, OR a **one-shot** `date:'YYYY-MM-DD'` that fires once then retires (a one-time event like "j'ai un train demain" must be dated — a time-only reminder recurs forever). **Voice:** create ("rappelle-moi … demain à 9h", "30 min avant …"), ack ("c'est fait"), snooze ("dans 10 min"/"plus tard"), manage ("supprime/désactive le rappel du train"), agenda ("qu'est-ce que j'ai demain / cette semaine"). **CLI:** `buddy remind add\|list\|agenda\|done\|rm` (`--date`, `--ahead N`). **Agent:** the `remind` tool (`src/tools/registry/remind-tools.ts`, dated + `leadMinutes` + idempotent) — the agent's proper path vs shelling the CLI |
| `CODEBUDDY_REMINDER_ACK_WINDOW_MS` | How long a fired reminder stays acknowledgeable (default 300000). A voice "c'est fait" binds ONLY to a reminder pending in this window — never to ambient speech / the chime-in LLM — and the bind is read back aloud |
| `CODEBUDDY_COMPANION_RELATIONAL` | The MySoulmate-inspired relational layer (opt-in, default off). When on, `defaultReply`/the arrival opener inject a relational context (`src/companion/relational-context.ts`): accepted user-model facts + Lisa's evolving mood/traits/rapport (`relationship-state.ts` — numeric state that drifts, anti-ratchet, NO gamification) + the recent-conversation episode + who's present; the reply also gets an emotion-aware tone shift (`reply-augment.ts` — soften on frustration) + anti-repetition, and each utterance drifts the traits. Env checked BEFORE the (heavy) import so default is untouched |
| `CODEBUDDY_COMPANION_PROACTIVE` / `_MIN_GAP_MS` | Proactive engine (`src/companion/proactive-engine.ts`, opt-in): Lisa reaches out FIRST — morning/evening/inactivity/milestone/followUp/encouragement — priority-scored, single winner, 12h cooldown, delivered spoken when present else a Telegram voice note when away. `_MIN_GAP_MS` (default 45000) is the **conductor** floor (`orchestrator.ts`): at most one companion voice per window across arrival/presence/proactive (reminders exempt) |
| `CODEBUDDY_EPISODE_JOURNAL` / `_EPISODE_EVERY` | Episodic journal (opt-in heartbeat treatment, `src/sensory/episodic-journal.ts`): consolidate the heard DIALOGUE into "what we talked about" (`episode:recent` in memory, referenced by the relational context), distinct from `dreaming.ts` (sensor stats). `_EVERY` beats, default 40 |
| `CODEBUDDY_MEMORY_FORGET` | Ebbinghaus forgetting pass over persistent memory during dreaming (opt-in, default off): retention `exp(−age/stability)` with `stability = base × (1 + accessCount)` — recall reinforces (`recall`/`getRelevantMemories` bump `accessCount`+`lastAccessedAt`, persisted via a meta comment in the memory .md). Faded entries are archived to a sibling `*.archive.md` **before** deletion (fail-closed: unwritable archive ⇒ nothing deleted) and are **restorable**: `/memory archived` lists them, `/memory restore <key>` re-remembers the latest archived version (curve restarts fresh) and removes its line from the archive (`listArchived`/`restoreFromArchive` on the manager); `preferences`/`decisions` categories and `pinned` tag never decay. Tunables: `_BASE_DAYS` (14), `_THRESHOLD` (0.05, clamped ≤0.9), `_MIN_AGE_DAYS` (7). `src/memory/memory-forgetting.ts` + `applyForgetting()` |
| `BUDDY_SENSE_ORGANS` | Runtime organ selection for the `buddy-sense` daemon (csv, e.g. `vital,vision,audio`; aliases tolerated). Picks which of the COMPILED-IN organs actually spawn (heavy senses stay compile-time features); unset/garbage → all available; `Vital` is autonomic and always kept. `src/organs.rs`, logged at boot |
| `CODEBUDDY_REMINDER_RENAG_MS` / `CODEBUDDY_REMINDER_RENAG_MAX` | Gentle re-nag gap (default 60000) and max re-nags (default 2) before a missed dose escalates to Telegram + logs `missed` |
| `CODEBUDDY_REMINDER_TICK_MS` | Reminder runner poll interval (default 60000) |
| `CODEBUDDY_SENSORY_RULES_FILE` / `CODEBUDDY_RULE_RUNS_FILE` | Override the sensory-rules store / run-log paths. Administer with `buddy rules list\|enable\|disable\|rm\|runs\|validate\|add` or the Cowork **Automations** panel. Edits **hot-reload** on a running server (`wireSensoryRules` mtime-cache); `validateRule` runs `isDestructive` at write-time so a dangerous shell/agent rule is rejected on save. `src/sensory/sensory-rules-engine.ts` |
| `CODEBUDDY_TTS_VOICE` / `CODEBUDDY_TTS_PIPER_MODEL` | Path to a Piper `.onnx` voice. Enables the `piper` TTS provider (`auto` picks it only when set) + the voice loop's synthesis |
| `OMNIPARSER_API_URL` / `OMNIPARSER_API_KEY` | Base URL (default `http://localhost:8000`) + optional Bearer for a self-hosted OmniParser v2 server, enabling `computer_control` `snapshot_with_screenshot` + `useOmniParser` (no-op if unreachable) |
| `CODEBUDDY_DIFF_REVIEW` | Pre-application diff-review gate (`src/review/`, default `off`; `static` = deterministic checks only, `full` = + LLM lens reviewers). A producer proposes FULL before/after content (`reviewAndApply()`), the gate returns a structured accept/reject/annotate verdict (fail-closed: an unreviewable diff is rejected with `failClosed: true`, never silently applied), accepted diffs land transactionally (CheckpointManager snapshot, all-or-nothing, TOCTOU base re-check via sha256) with `rollbackAppliedDiff()`. Audit JSONL at `.codebuddy/diff-reviews.jsonl`. Aggregation is an AND, never a vote — that's why it's a gate DOWNSTREAM of the council, not a council member. WIRED into ALL five write surfaces — `apply_patch`, `create_file`/`write_file` (alias), `str_replace` and `multi_edit` — via the shared `reviewGatedWrite()` (`src/review/write-gate.ts`) + the per-tool plumbing helper `maybeReviewGatedWrite()` (`src/tools/review-gate-helper.ts`): apply_patch dry-runs the patch to full content (`computePatchedFiles`, STRICTER than the legacy applier — any failed hunk fails closed instead of partially applying); str_replace/multi_edit gate AFTER their matching cascade resolved the fragment(s) to full resulting content; all gates run after the user confirmation (the review complements the human gate) and fail closed on paths outside the base directory; a reject/annotate returns the annotations as the tool error so the agent revises; `full` mode resolves a default reviewer from the model pool (dead models skipped). The off paths load none of the review graph. `CODEBUDDY_DIFF_REVIEW_REVISE=true` adds the automatic revision loop (`src/review/revision-loop.ts`, rounds capped by `CODEBUDDY_DIFF_REVIEW_REVISE_ROUNDS`, default 2): a revisable verdict (annotate, or merit reject — never failClosed/conflicts) is handed to a reviser LLM with the annotations, the revised diff re-enters the SAME gate, every round journaled with lineage (`revision N of <diff-id>`); reviser output is constrained to the original paths (extra paths dropped), forgotten files carried over, oversized files fail closed |
| `CODEBUDDY_COLLECTIVE_MEMORY` | Enable Collective Knowledge Graph injection into context (default off). `src/memory/collective-knowledge-graph.ts`. Same gate also activates Deep Research's Phase D CKG bridge (`buddy research --deep --ckg`, `src/agent/deep-research-ckg.ts`) — recalls prior collective knowledge into the report and ingests the run's deduped sources; `--ckg` opts in explicitly without setting the env var |
| `CODEBUDDY_CKG_ENGINE` | `rust` routes the CKG (ingest/recallHybrid) to the in-tree Rust engine `buddy-memory/`; unset → in-process TS (default, fallback on any engine error). Same shared ledger either way |
| `CODEBUDDY_BUDDY_MEMORY_BIN` | Override the `buddy-memory` binary (else `buddy-memory/target/{release,debug}` → `~/DEV/buddy-memory/...` → PATH) |
| `BUDDY_MEMORY_EMBED_MODEL` / `BUDDY_MEMORY_EMBED_TOKEN_TYPE` | Multilingual MiniLM `.onnx` for hybrid recall (default `~/.codebuddy/models/buddy-memory/model.onnx`, `tokenizer.json` beside it; needs the `embeddings` cargo feature) + whether the graph expects `token_type_ids` (default true) |
| `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Observability |
| `PERF_TIMING`, `CACHE_TRACE`, `VERBOSE` | Debug flags |

## Special Modes

- **YOLO** — 400 tool rounds, $100 cap, auto-approve with guardrails. `src/utils/autonomy-manager.ts`. `/yolo on|off|safe|status|allow|deny`.
- **Agent modes** — `plan`, `code`, `ask`, `architect` — each restricts available tools.
- **Permission modes** — `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions`. CLI: `--permission-mode <mode>`. Checked by `ConfirmationService` before every approval. `src/security/permission-modes.ts`.
- **Security modes** — `suggest` / `auto-edit` / `full-auto`.
- **Write policy** — `strict` (forces `apply_patch`) / `confirm` / `off`. `src/security/write-policy.ts`.
- **Plan mode** — `/plan` enters read-only research mode; write tools restricted to `.md` plan files.

## CLI & Slash Commands

Full list: `buddy --help` and `/tools` in-session. The ones most worth knowing:

```bash
buddy                       # Interactive chat
buddy --profile <name>      # Named config profile
buddy login                 # ChatGPT OAuth (no API key needed, $0 marginal cost via Codex Responses backend)
buddy whoami                # Show current auth + plan
buddy onboard               # Setup wizard
buddy doctor [--fix]        # Environment diagnostics + auto-migration
buddy server [--port N]     # Start HTTP server (3000) + Gateway WS (3001) — required for fleet
buddy dev plan|run|pr|fix-ci  # Golden-path workflows (forces WritePolicy.strict)
buddy run list|show|tail|replay  # Observability
buddy research "<topic>"    # Wide research (--deep: cited GPT-Researcher-style pipeline; --iterations N: gap-loop rounds; --perspectives N/--storm: STORM multi-perspective; --ckg: Collective Knowledge Graph bridge)
buddy flow "<goal>"         # Planning flow (plan → execute → synthesize)
buddy film generate|assemble|status <name>  # Long-form film producer: generate a clip per scene (video_generate) → montage with transitions + music → quality gate; resumable film.json manifest. `assemble` welds already-ready clips ($0, ffmpeg-only). See "Film production" below.
buddy loop "<goal>"         # Dev loop: plan→execute→VERIFY(Verifier)→judge→decide, until proven done or budget (--max-turns/--budget/--no-verify/--verify-cmd). Thin layer over `buddy goal` (src/agent/dev-loop/dev-loop.ts): the independent Verifier GATES "done" — a judge "done" is overridden to "continue" until CONFIRMED, so a claimed-but-unproven fix never passes. `--verify-cmd "<shell>"` swaps the LLM Verifier for a deterministic gate (exit 0 = CONFIRMED; `makeShellVerifier`) — $0, hermetic, ideal for "make the tests pass" loops. In-session equivalent: `/loop`. `goal` stays unchanged.
buddy backup create|verify|list|restore
buddy update [--channel …] [--tag main] [--from-source]
```

In-session slash commands (not exhaustive):
```
/think off|shallow|medium|deep|exhaustive|status|<problem>
/goal <text>|status|pause|resume|clear   # Standing goal + judge auto-continue loop (Ralph)
/loop <text>|status|pause|resume|clear   # Dev-loop: /goal + independent Verifier gate (done only passes once CONFIRMED). In-session `buddy loop`.
/batch <goal>                # Decompose into parallel sub-agents
/swarm <task>                # Team-lead UX (Korben-inspired)
/team start|add|status|...   # Agent Teams coordination
/fleet listen|send|history|status|chat|route|describe
/memory recent|show|search
/compact [level]
/config [set] <key> <value>  # Dot-notation, SecretRef, --dry-run, batch JSON
/switch <model|auto>         # Mid-conversation model switch
/btw <question>              # One-shot, no tools, no history mutation
/pr [title] [--draft]
/lint run|fix|detect
/plan                        # Read-only research mode
```

## HTTP Server (`src/server/`)

Started with `buddy server`. Default ports: **3000** HTTP, **3001** Gateway WS. CORS enabled, rate-limit 100 req/min, JWT required in production.

Routes worth knowing: `/api/health`, `/api/chat`, `/api/chat/completions` (OpenAI-compatible), `/api/sessions`, `/api/memory`, `/api/a2a/*` (Google A2A: AgentCard discovery + task lifecycle), `/__codebuddy__/canvas/:id`, `/__codebuddy__/a2ui/`.

Gateway WS events: `connect` (pre-auth), `hello_ok`, `auth`, `chat`, `session_create|join|leave|patch`, `presence`, `peer:*`. Origin-hardened (GHSA-5wcw-8jjv-m286): default `corsOrigins` is localhost-only, `trustedProxies` must be configured explicitly. Live API heartbeat at `/api/health.apiHeartbeat` (30s probe loop in `src/server/heartbeat-monitor.ts`).
