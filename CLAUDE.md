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
- **`AgentRegistry`** ships 8 built-in agents: PDF, Excel, DataAnalysis, SQL, Archive, CodeGuardian, SecurityReview, SWE.
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

   Register in `codebuddy-agent.ts` constructor (priority order shown above). Lower priority runs first. Three more middleware exist with factory functions but aren't wired by default: `LearningFirstMiddleware` (35), `ToolFilterMiddleware` (50), `VerificationEnforcementMiddleware` (155) — check `src/agent/middleware/` before assuming the table is exhaustive.
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

> Parity vs Hermes Agent / OpenClaw (what's shipped, what's gated, the one open code gap): [`docs/hermes-openclaw-parity.md`](docs/hermes-openclaw-parity.md) — canonical, supersedes the dated audits now in `docs/archive/2026-q2-hermes-audits/`.

- **`peer.chat`** (V1) — stateless one-shot LLM call to a peer (`peer-chat-bridge.ts`).
- **`peer.chat-session.start|continue|end|continue-stream|list`** (V1.2, Phase d.21–d.22) — multi-turn sessions, FIFO-serialised per `sessionId`, 30-min idle TTL (`CODEBUDDY_PEER_SESSION_IDLE_MS`), persisted to `~/.codebuddy/peer-sessions/*.json` (`peer-session-store.ts`). Privacy guard: `peer.chat-session.list` returns metadata only, never prompt/assistant content (asserted by test).
- **`peer.tool.invoke` + `.stream`** (V1.3, Phase d.23, `peer-tool-bridge.ts`) — remote read-only tool execution. **Three security gates** in order: allowlist (`CODEBUDDY_PEER_TOOL_ALLOWLIST`, default `view_file`/`list_directory`/`search`) → registry `fleetSafe: true` flag (`src/tools/metadata.ts`) → workspace root (`CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` must be set; **fails closed** with `PEER_WORKSPACE_NOT_CONFIGURED` if unset, so a misconfigured peer can't expose `/`). Anti-loop guards: `CODEBUDDY_PEER_MAX_DEPTH`, `CODEBUDDY_PEER_ROLE=leaf`.
- **`route_peer` tool + `/fleet route`** — `TaskRouter` (`task-router.ts`) classifies a prompt, gathers peer capabilities via `peer.describe`, applies privacy/cost/latency constraints, returns the recommended `peer_delegate` call. Privacy lint (`privacy-lint.ts`) detects SSN/IBAN/phone/credit-card before routing.
- **Slash UX:** `/fleet listen`, `/fleet send <peer> <method> <json>`, `/fleet history [--type glob] [--json]`, `/fleet status [--with-sessions]`, `/fleet chat start|say|end|list`, `/fleet route`, `/fleet describe`.

## Sensory nervous system — `buddy-sense/` (Rust) + `src/sensory/`

A brain-inspired perception layer (for the companion/robot vision). Diagrams: [`buddy-sense/docs/architecture.svg`](buddy-sense/docs/architecture.svg) + [`dreaming.svg`](buddy-sense/docs/dreaming.svg). **`buddy-sense/`** is a Rust monorepo subdir (tokio) with **five sense modules** emitting `SensoryEvent`s over bounded channels: **audio** (`senses/audio.rs`, energy VAD + optional Silero via `neural-vad`; WAV input — no live mic yet), **vital** (`senses/vital.rs`, the always-on heartbeat), **vision** (`senses/video.rs`, motion detector + **live camera capture** behind the `live-vision` feature — ffmpeg grabs grayscale frames, emits `vision/motion` + a JPEG keyframe), **screen** (`senses/screen.rs`, xcap diff, `live-screen`), **ui** (`senses/ui.rs`, AT-SPI focus, `live-ui`). **The default daemon spawns only the heartbeat** (+ audio when passed a WAV path); screen/ui run only under their live features. Senses feed a **thalamus** (`bus.rs`) that coalesces high-rate events and lets salient ones bypass coalescing (an attention **gate** — it does NOT reorder by priority; vital is never coalesced), then **broadcasts** (the "global workspace") → a WebSocket **bridge** (`bridge.rs`, token-aware, ping keepalive). (A per-modality ring buffer in the thalamus is Phase-2/3 scaffolding, not yet read by the binary; the real short-term memory lives on the Code Buddy side.) Heavy analysis (STT, vision, OCR) is delegated to Code Buddy. `cd buddy-sense && cargo test` (20 tests, no hardware). Opt-in Cargo features (core builds without them): `live-screen` (xcap), `live-ui` (atspi/zbus), `neural-vad` (Silero/ONNX — needs a model + onnxruntime, see `buddy-sense/models/README.md`; falls back to the energy VAD on any error). All deps permissive (MIT/Apache); `ui-events`/Screenpipe were NOT copied (clean-room — proprietary/stub).

The Code Buddy side (`src/sensory/`, opt-in `CODEBUDDY_SENSORY=true buddy server`, wired once in `src/server/index.ts`): **`sensory-bridge.ts`** — a loopback-only, Origin-checked `ws` server that re-emits frames onto `getGlobalEventBus()` as `sensory:perception` (clamps salience/ts); **`reactions.ts`** pushes every perception into **`sensory-memory.ts`** (short-term buffer); **`heartbeat-scheduler.ts`** fires treatments every N beats (a pacemaker; `CODEBUDDY_HEARTBEAT_EVERY`); **`dreaming.ts`** consolidates the short-term buffer into a dream journal + promotes salient dreams to persistent `CODEBUDDY_MEMORY.md` (`CODEBUDDY_DREAM_EVERY`); **`vision-reaction.ts`** / **`screen-reaction.ts`** run `camera_analyze`/percepts on motion/change (debounced, opt-in `CODEBUDDY_SENSORY_CAMERA`/`_SCREEN`); **`speech-reaction.ts`** closes the perception→cognition loop — on `speech_end` (the daemon tags the event with the source WAV), it transcribes via faster-whisper → a `hearing` percept (debounced, opt-in `CODEBUDDY_SENSORY_SPEECH`, with an `onHeard` hook for further action like an agent turn). **Deterministically tested** (CI, no hardware): the loopback bridge → event bus → reaction path (`tests/sensory/`) + the VAD/motion/thalamus/dreaming cores (~16 TS + 20 Rust tests). **Manually validated on the author's machine** (hardware-gated, NOT in CI): BRIO camera + gemma describe, X11 screen change via xsetroot, AT-SPI focus, Silero on real speech. `speech_end → STT → 'hearing' percept` is now wired (`speech-reaction.ts`); driving a full agent turn from the transcript is the `onHeard` hook's job (not auto-wired). Opt-in, loopback-only, never-throws.

**Robot vision (the eyes), operational** — `buddy-vision/` (Python sidecar, sibling to `buddy-sense/`): owns a camera (OpenCV) and runs **MediaPipe FaceLandmarker** state-machine detectors that emit ONE event per *transition* (no spam, the "Vigil" pattern): `vision/person_entered` / `vision/person_left` (face presence) and `vision/drowsy` (eyeBlink blendshape). Setup: `buddy-vision/setup.sh` (venv + `face_landmarker.task` + `ollama pull moondream`). On the Code Buddy side, **`vision-reaction.ts`** now describes the keyframe with a **real local vision model** (`CODEBUDDY_VISION_MODEL`, e.g. moondream — gemma is text-only) and **dedups** alerts (`CODEBUDDY_VISION_ALERT_COOLDOWN_MS`/`_SIM`); **`semantic-vision-reaction.ts`** turns person/drowsy events into a Telegram alert via **`alert.ts`** (`CODEBUDDY_SENSORY_ALERT_TOKEN`/`_CHAT`). Runs 24/7 as systemd user services `buddy-vision-brain` (buddy server) + `buddy-vision-eye` (watch.py); config in `~/.codebuddy/vision.env`. **Gotcha:** the bridge rejects WS connections carrying an `Origin` header → the Python client must use `create_connection(..., suppress_origin=True)`.

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
| `CODEBUDDY_MAX_TOKENS` | Override response token limit |
| `CODEBUDDY_AUTOCOMPACT_PCT` | Auto-compact threshold as % of context window |
| `MORPH_API_KEY` | Enables fast file editing |
| `YOLO_MODE` / `MAX_COST` | Full autonomy ($10 default, $100 YOLO) |
| `JWT_SECRET` | Required in production for API server |
| `OLLAMA_HOST` / `VLLM_BASE_URL` | Bundled provider auto-detect |
| `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` | **Required to enable** `peer.tool.invoke` — fail-closed when unset |
| `CODEBUDDY_PEER_TOOL_ALLOWLIST` | csv override for default `view_file,list_directory,search` |
| `CODEBUDDY_PEER_SESSION_IDLE_MS` / `CODEBUDDY_PEER_MAX_DEPTH` / `CODEBUDDY_PEER_ROLE` | Fleet limits |
| `CODEBUDDY_FLEET_MAX_CONCURRENCY` | Peer capacity → live `utilization` in heartbeats + daemon saturation backpressure (`src/fleet/fleet-load.ts`) |
| Search keys | `BRAVE_API_KEY`, `EXA_API_KEY`, `PERPLEXITY_API_KEY`, `OPENROUTER_API_KEY`, `FIRECRAWL_API_KEY` |
| `PICOVOICE_ACCESS_KEY` | Porcupine wake word (text-match fallback if absent) |
| `CODEBUDDY_SENSORY_SPEAK` | Close the voice loop: `speech_end → STT → think → speak`. **Requires `CODEBUDDY_TTS_VOICE`** (else the robot hears but stays silent — server logs loud) |
| `CODEBUDDY_SENSORY_SPEAK_MODEL` | Pin the spoken-reply model. **Default unset/`auto` → latency-routed**: `selectFastestModel` (`src/fleet/model-selector.ts`) picks the lowest-latency capable LLM among active providers (reuses the council's registry + `ModelScoreboard` measured latency + a size heuristic). Set to a model id to override. |
| `CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY` | `true` restricts voice routing to models served by your **local runtime endpoints** (Ollama / LM Studio). Note: a local OpenAI-compat gateway can itself proxy to a cloud model, so this is a routing preference, **not a hard egress guarantee** |
| `CODEBUDDY_SENSORY_SPEAK_ROUTE_TTL_MS` | Cache window for the per-utterance voice model selection (default 60000) — avoids re-probing providers (and any inline xAI token refresh) on every spoken turn |
| `CODEBUDDY_SENSORY_SPEAK_ACT` | **Voice COMMANDS** (opt-in, default off). When `true`, a spoken utterance drives a REAL agent turn (`makeAgentReply`, `src/sensory/agent-reply.ts`) that can investigate and—under a higher posture—act, then speaks a condensed result. Off → today's chatty companion reply |
| `CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE` | Voice ACT posture: `plan` (**default**, read-only — reads/search only, writes+shell denied), `dontAsk`/`bypassPermissions` (can edit/run — still behind the static command validator + secret/deploy guard). Applied via the same `PermissionModeManager` `ConfirmationService` consults. Run the speaking actor in its own process (the posture is process-global) |
| `CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL` | Pin the model for the voice-command **agent turn** (distinct from the fast reply model). Unset → fastest tool-calling model, which can be a tiny model whose context truncates and whose answers are wrong; for accurate commands pin a capable local model (e.g. `devstral-small-2:24b-instruct` or `qwen3.6:27b`) |
| `CODEBUDDY_ROBOT_NAME` | Robot mode (daemon): name that counts as **being addressed** (default `Buddy`, fuzzy-matched to survive STT mangling). The robot hears everything but **only replies when addressed** or in the post-address window — `respond-decider.ts` |
| `CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS` | Post-reply window (default 30000) where follow-ups are treated as addressed (conversation continuity) |
| `CODEBUDDY_SENSORY_CHIME_IN` | `true` lets the robot speak **unprompted** when the conversation warrants it (cheap cue → rare high-bar LLM judge, error→silent). Default off (conservative — never butt into a human-human conversation) |
| `CODEBUDDY_SENSORY_RESPOND_DECISION_MODEL` | Pin the model for the rare chime-in judgment (else the fast reply model) |
| `CODEBUDDY_SENSORY_ALWAYS_RESPOND` | `true` bypasses the response gate — reply to **every** utterance (the pre-2026-06-26 behavior, for testing) |
| `CODEBUDDY_TTS_VOICE` / `CODEBUDDY_TTS_PIPER_MODEL` | Path to a Piper `.onnx` voice. Enables the `piper` TTS provider (`auto` picks it only when set) + the voice loop's synthesis |
| `OMNIPARSER_API_URL` / `OMNIPARSER_API_KEY` | Base URL (default `http://localhost:8000`) + optional Bearer for a self-hosted OmniParser v2 server, enabling `computer_control` `snapshot_with_screenshot` + `useOmniParser` (no-op if unreachable) |
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
buddy research "<topic>"    # Wide research
buddy flow "<goal>"         # Planning flow (plan → execute → synthesize)
buddy backup create|verify|list|restore
buddy update [--channel …] [--tag main] [--from-source]
```

In-session slash commands (not exhaustive):
```
/think off|shallow|medium|deep|exhaustive|status|<problem>
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
