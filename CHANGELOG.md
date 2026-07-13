## [1.8.0](https://github.com/phuetz/code-buddy/compare/v1.7.0...v1.8.0) (2026-07-01)

### Features

* **evolve:** evolutionary self-improvement lands on `main` — `buddy evolve run|list|review|keep`: generate code variants in throwaway git worktrees, score them against an empirical fitness baseline, keep the best (human-gated `keep --confirm`, opt-in `CODEBUDDY_EVOLVE`, never auto-merges).
* **evolve:** research-grounded goals — `evolve run --source research` matches ingested scientific articles (from the collective knowledge graph) to the concerned Code Buddy feature and synthesizes ambitious, targeted improvement goals. Closes the loop: article → CKG → goal → variant.
* **evolve:** deliberate planning step — a real structured plan (approach + titled steps + rationale) drives each generation and is stored for audit; the planner is grounded in the CKG (`recallHybrid`).
* **evolve:** genealogy — parent/generation lineage on each variant, `evolve tree` + `evolve list --json`; the plan that produced a version is stored and shown.
* **evolve:** compounding (`--compound`, guarded) + fresh self-model (`--refresh-model`).
* **research:** administer the collective knowledge graph — `buddy research list` (indexed documents) and `buddy research topics list|add|remove|clear` (persistent auto-ingest subjects, unioned with the env).
* **cowork:** opt-in redesigned shell (`COWORK_NEW_SHELL`) — one calm nav (Chat · Plan · Activity · Files · Advanced/Labs), plan-then-act, embedded activity log with one-click undo + reviewable inline diffs, and an Evolution panel listing the generated versions.
* **companion:** relationship-aware presence (reunion after an absence + tenure milestones) and event follow-ups (mention a dated event → Lisa asks how it went), captured only on addressed turns.

### Bug Fixes

* **sensory:** sanitize text before TTS — mute leaked model tokens and foreign-script (CJK) garbage the voice can't pronounce; fix 5 real bugs in the voice/vision loop (respond-decider tier order, multi-word name matching, `resolveVoiceModel` fallback, permanent-deafness guard, prototype-chain guard).
* **cowork:** unbreak `vite build` (load model-inventory via `loadCoreModule` instead of a static core import); revive `/export` and `/save`; delete dead `Sidebar.tsx`.

## [1.7.0](https://github.com/phuetz/code-buddy/compare/v1.6.1...v1.7.0) (2026-06-26)

### Features

* **companion:** reminders — the robot reminds you (meds…) and you flag them done ([f239327](https://github.com/phuetz/code-buddy/commit/f2393275ff91f0b47f17c1832dd0565bafe2ad41))
* **cowork:** Automations panel — administer reminders + rules from the GUI (thin client) ([fe99899](https://github.com/phuetz/code-buddy/commit/fe99899c2677cf17659ef4f8e1f09f2529fce5ba))
* **cowork:** code blocks -> live Artifact preview + copy buttons everywhere (Lisa-inspired) ([8d8aa68](https://github.com/phuetz/code-buddy/commit/8d8aa68260d16b5910c2a31b31561feaeea7aa7d))
* **cowork:** React live preview in the Artifact panel (Phase 2) ([5a12973](https://github.com/phuetz/code-buddy/commit/5a1297332b75331d2dd01be89778fbf8cabda02b))
* **fleet:** council --fleet — several machines collaborate on one question (token recipe) ([3f9b6da](https://github.com/phuetz/code-buddy/commit/3f9b6daf0e9a4a97e9c0d271bca4c8c2fc83ad5b))
* **rendering:** complete the unified layer — ansi + plain renderers + façade ([a28d03d](https://github.com/phuetz/code-buddy/commit/a28d03d339ae9b5cf8d652f438eb1821c3d7bac8))
* **sensory:** administer triggerable actions — rules CRUD + write-validate + HOT-RELOAD ([68f0e3e](https://github.com/phuetz/code-buddy/commit/68f0e3e30691fb166bb202ea4bd2c6b70ee3a650))
* **sensory:** close the voice loop — hear → think → speak (Piper TTS + local LLM) ([0de62df](https://github.com/phuetz/code-buddy/commit/0de62df59f049a1f388db7b0558224465c4d36c6))
* **sensory:** robot listens like a human — reply only when addressed or warranted ([b866649](https://github.com/phuetz/code-buddy/commit/b866649f9423ab1b808d6ede5552329dd77c4ea9))
* **sensory:** the robot's voice follows you — Telegram voice notes when away ([2084dfb](https://github.com/phuetz/code-buddy/commit/2084dfbf3003370220c09a0394f88ec4f3b08495))
* **vision:** anti-spam dedup — alert only on a meaningfully changed scene (Phase 2a) ([ce0d125](https://github.com/phuetz/code-buddy/commit/ce0d12590573aaa0ce33afc61b5766421fcd0424))
* **vision:** event->action rules engine (Phase 2c) — a camera event triggers code, safely ([a48e11a](https://github.com/phuetz/code-buddy/commit/a48e11a96fc06f58a7f0845a807f3adfe4832e12))
* **vision:** robot eyes — live camera motion sense + local-VLM understanding + Telegram alert ([07e61a5](https://github.com/phuetz/code-buddy/commit/07e61a531e2085db60d7c1e189599807610567a8))
* **vision:** semantic event detection — person/drowsy reactions + shared alert (Phase 2b) ([9be3e99](https://github.com/phuetz/code-buddy/commit/9be3e99b17d7f6cdfd007b052720dbd7af895678))
* **voice:** Cowork defaults to voice piloting; spoken return stays switch-gated ([90787b5](https://github.com/phuetz/code-buddy/commit/90787b503ec3cd5c4ff4bc468d38fded28e2a691))
* **voice:** harden voice ACT — capable agent-turn model knob + process-global posture warning ([5689539](https://github.com/phuetz/code-buddy/commit/56895398167aef4c99d3d6b019a4be73ba046aa2))
* **voice:** latency-route the spoken reply to the fastest capable LLM ([144be78](https://github.com/phuetz/code-buddy/commit/144be78d04c0345fc1e736247ad7524520135c4b))
* **voice:** voice commands — speak an instruction, the agent acts, the result is spoken ([ed5ab72](https://github.com/phuetz/code-buddy/commit/ed5ab727b4a5d2275b3b44ee422befdaf8d0c47c))

### Bug Fixes

* **companion:** harden the reminder ack — reject lookalike affirmations (health safety) ([2abc19d](https://github.com/phuetz/code-buddy/commit/2abc19d72e0a896f827e08b1fc291abfbb8979f5))
* **sensory:** engagement window is bounded per-address, not sticky ([150a9e7](https://github.com/phuetz/code-buddy/commit/150a9e75f32481a112900773b973946be042b984))
* **vision:** swallow EPIPE on a shell action's stdin (a command that ignores stdin would crash the host) ([b6fe1a4](https://github.com/phuetz/code-buddy/commit/b6fe1a4ac896a72c899d3611745db3b06f5b5fb6))

# Changelog

All notable changes to Code Buddy are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches `1.0.0`.

---

## [Unreleased]

### Added
- **Lisa partage le même contexte frais entre voix, Telegram et Cowork.** Le cache structuré
  (date, résumé, source et URL) alimente maintenant les trois surfaces. Les bulletins simples restent
  instantanés, tandis que les demandes d'analyse et leurs suivis elliptiques passent au raisonnement
  avec la même preuve. Le miroir Telegram d'une réponse vocale ajoute des sources datées et
  cliquables sans faire lire les URL à voix haute; les chaînes Web sont neutralisées comme données
  non fiables avant injection dans le prompt.
- **Several Code Buddy machines collaborate on one question — `council --fleet`.** The fleet WS mesh
  (`peer.chat` across machines) was real but only proven cross-host once and never as a repeatable
  two-instance test; the collaboration verbs (`council`/`swarm`) were in-process. Now `buddy council
  "<task>" --fleet` **folds connected fleet peers into the SAME judged set**: it asks each connected
  machine's Code Buddy via `peer.chat` (parallel, per-peer timeout, a slow/absent peer is dropped —
  never crashes the council), then the existing judge + consensus + model-scoreboard score all
  answers — local and remote — together (source-agnostic). New `buddy fleet token` mints a scoped
  JWT (`peer:invoke` + `fleet:listen`) so another machine can join via `/fleet listen --jwt` —
  closing the auth gap (`--no-auth` deliberately does NOT grant `peer:invoke`; the fleet requires a
  token). **Proven live across two real server processes** on one box ($0 local Ollama): two
  machines (qwen2.5:7b + gemma4) each answered and were judged together
  (`scripts/fleet-council-2proc-smoke.ts`); a real Tailscale multi-machine run uses the same recipe
  (`docs/fleet-guide.md`).
- **The robot's voice follows you — voice notes to Telegram/phone when you're away.** New
  `sendTelegramVoice(text)` (`src/sensory/alert.ts`) synthesizes the line to OGG/Opus (reusing the
  existing `synthesizeToOgg` Piper→ffmpeg pipeline — the format Telegram voice notes require) and
  POSTs `sendVoice`, falling back to text on any failure (never-throws, no-op without the alert
  token). With `CODEBUDDY_VOICE_TO_TELEGRAM=true`, `sayNow` (so every reminder/announcement) also
  pushes the spoken line to your phone — independent of the home speakers, so a missing audio device
  doesn't block it. Live-proven: a real voice note delivered to Telegram in ~1.3s.
- **Administer the robot's behaviors — reminders + triggerable actions (sensory rules).** Reminders
  already had CRUD; the sensory **rules** engine (event → shell/webhook/alert/agent) had none —
  hand-edited JSON, loaded once at startup (restart to take effect), the destructive check only at
  fire-time. Now: a **core** CRUD-lite (`listSensoryRules`/`upsertSensoryRule`/`toggleSensoryRule`/
  `removeSensoryRule`/`readRuleRuns` + `validateRule` running the **same `isDestructive` gate at
  write-time**, so a dangerous rule is rejected on save, not at 3am) with **live hot-reload**
  (`wireSensoryRules` mtime-caches the file and reloads before matching — an admin edit takes effect
  on the running robot with **no restart**, proven live). Two thin clients over that core:
  `buddy rules list|enable|disable|rm|runs|validate|add`, and a Cowork **Automations** settings panel
  (reminders + rules with enable/disable/done/delete + a recent-fires view, delegating to the core via
  `automations.*` IPC — no duplicate I/O). Depth = manage + observe; creating complex rules stays
  JSON-edit (now validated + hot-reloaded), no rule-builder.
- **Reminders — the robot reminds you (meds…) and you flag them done.** Opt-in
  (`CODEBUDDY_REMINDERS=true`). Due reminders are announced **aloud** (new `sayNow` — the missing
  proactive-speech primitive, Piper, `$0`) **and** to **Telegram**; no acknowledgement → gentle
  re-nag (1–2×) → Telegram escalation + a logged "missed". **Safety-first ack (this is health):** a
  spoken "c'est fait" marks a reminder done **only** when one is pending in its bounded ack window
  (`CODEBUDDY_REMINDER_ACK_WINDOW_MS`), **never** from ambient speech or the chime-in LLM, and the
  bind is **read back aloud** so a mis-bind is correctable. Create three ways — `buddy remind
  add "<label>" --at HH:MM [--days 1,3,5]` (+ `list`/`done`/`rm`), the hand-editable
  `~/.codebuddy/reminders.json`, or by voice ("rappelle-moi … à 9h"). Stored as JSON
  (`src/companion/reminders.ts` + `reminder-runner.ts`); runner is independent of the sensory
  daemon. (Live-proven: robot speaks a reminder via Piper in ~3s; CLI mutates the JSON + log.
  Telegram *delivery* is live; an interactive Telegram *button-ack* is the next step; voice
  create/ack are synthetic-tested — no live mic yet.)
- **Robot mode listens like a human — replies only when addressed or warranted.** In daemon mode the robot used to answer *every* utterance it heard. New `respond-decider.ts` adds a tiered, cheap-first gate between hearing and speaking (the percept is still recorded on every utterance — observation/memory stay continuous): **addressed** (robot name, fuzzy-matched for STT mangling → always replies) → **engagement window** (follow-ups within `CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS` reply without re-addressing — bounded *per address*, the window does NOT slide on cross-talk, so one address can't make it answer the room forever) → **silent** unless `CODEBUDDY_SENSORY_CHIME_IN=true`, which adds a cheap cue check then a rare high-bar LLM judge (error→silent, so it never butts into a human-human conversation). `CODEBUDDY_ROBOT_NAME` (default `Buddy`), `CODEBUDDY_SENSORY_ALWAYS_RESPOND=true` reverts to the old reply-to-everything behavior. NO LLM call on ambient speech. (Note: buddy-sense audio is still WAV-fed — there is no live-mic capture yet, so this is unit- + synthetic-event-tested, not demonstrable as a live always-listening robot.)
- **Voice COMMANDS — speak an instruction, the agent acts, the result is spoken (CLI + Cowork).**
  Opt-in (`CODEBUDDY_SENSORY_SPEAK_ACT=true`). A spoken utterance now drives a REAL agent turn via
  `makeAgentReply` (`src/sensory/agent-reply.ts`) instead of a chatty reply, then a condensed 1–2
  sentence FR summary is spoken back. Safety rides the EXISTING gate (no parallel one): the turn runs
  under a permission posture — **default `plan` (read-only)**, opt-in `dontAsk`/`bypassPermissions` to
  edit/run (still behind the static command validator + secret/deploy guard). New `buddy voice
  [--mode]` push-to-talk subcommand (record → faster-whisper → agent turn → Piper). Cowork gains a
  **command mode** toggle on the mic (push-to-talk that EXECUTES via the existing `continueSession`
  path — risky tool calls still raise the existing `PermissionDialog`), and spoken replies are now
  **condensed** (`condenseForSpeech`) instead of reading a whole markdown answer aloud. Never-throws,
  `$0` on local models. (Deferred: the `/listen` TUI slash — stdin conflicts with Ink; the Cowork
  "voice can act" autonomy toggle — pending a permission-mode realm check.)
- **Voice loop is latency-routed for fluidity.** A spoken reply now goes to the **lowest-latency capable LLM** instead of a hardcoded model — a companion that takes 16s to answer breaks the spell. New `selectFastestModel` (`src/fleet/model-selector.ts`) **reuses the council's "which LLM is best" system** (active-LLM registry + `ModelScoreboard` *measured* latency + `inferStrengths`/`inferTaskType`, now shared via `fleet/model-capability-heuristics.ts`) but with a **latency objective gated by a capability floor** (never a vision-only or embedding model for chat). It enumerates **every** probed local model (the registry collapses each local provider to one), prefers measured latency over a size heuristic, and treats cost as a tie-break (a flat-fee subscription model like `grok-3-fast` can be both fastest and `$0`-marginal). `CODEBUDDY_SENSORY_SPEAK_MODEL` stays authoritative (pin a model); `=auto`/unset routes; `CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY=true` keeps it on-box. Proven live: router picked a model replying in **1.1s** vs **23.2s** for a proven-slow big model it avoided. Never-throws.
- **Robot vision — "the eyes" (experimental, operational).** `buddy-vision/` (Python sidecar, sibling to `buddy-sense/`) watches a camera and emits **semantic** events into the sensory bus — `person_entered` / `person_left` and `drowsy` (MediaPipe FaceLandmarker; each detector a **state machine → one event per transition**, no spam). On the Code Buddy side, `semantic-vision-reaction.ts` turns these into a Telegram alert (photo + caption); `vision-reaction.ts` now describes the keyframe with a **real local vision model** (`CODEBUDDY_VISION_MODEL`, e.g. moondream — gemma is text-only) and **dedups** repeat scenes. `buddy-sense`'s vision sense gained live camera capture (`live-vision`). Built for remote watch; all local, `$0`. Setup: `buddy-vision/setup.sh`.
- **Event→action rules engine.** A camera (or any sensory) event can now **trigger code**: a declarative `~/.codebuddy/sensory-rules.json` maps events to actions — **shell / webhook / Telegram alert / agent** — with a per-rule cooldown + time-of-day window and an audit log (`companion/rule-runs.jsonl`). Security: the camera sees the world (adversarial input), so event data reaches shell/agent actions **only via env (`VISION_*`) + stdin, never interpolated** into the command, and destructive commands (rm -rf / dd / sudo / fork-bomb) are hard-blocked. Opt-in: `CODEBUDDY_SENSORY_RULES=true` + token. `src/sensory/sensory-rules-engine.ts` + `sensory-action-executor.ts`; example in `buddy-vision/sensory-rules.example.json`.
- **Unified rendering core finished.** `src/rendering/ansi.ts` (markdown→ANSI terminal) + `plain.ts` (markdown→clean plain text) complete the `render(md, 'telegram'|'ansi'|'plain')` façade started in 1.6.1.

---

## [1.6.1] — 2026-06-25

### Added
- **Unified rendering core (`src/rendering/`)** — parse markdown once (`marked` AST) and render per surface. First renderer: `renderTelegramHtml` → Telegram's robust HTML subset.

### Changed
- **Telegram replies now render markdown** instead of showing it raw. Bold/italic/inline-code/code-blocks/links/blockquotes render as Telegram HTML (`<b> <i> <code> <pre> <a> <blockquote>`), with `& < >` escaped. **Wide comparison tables** render as a mobile-friendly vertical layout (bold row title + `Header : value`); narrow tables keep the aligned monospace grid. Output is split into ≤4096-char chunks with always-balanced tags, and falls back to plain text if Telegram ever rejects the HTML. (Terminal/Ink ANSI + plain renderers to follow.)

---

## [1.6.0] — 2026-06-24

### Added
- **`buddy council "<task>"` — capability-aware multi-LLM router + ensemble + learning.** Lists your usable LLMs, routes the task to the best-suited models by capability (and by their historical win rate), asks several in parallel, an impartial judge keeps the best answer, a consensus score flags divergence, and a per-(task-type × model) scoreboard (`~/.codebuddy/fleet-model-performance.json`) learns which AI is best over time and biases future routing. Per-model timeout so a slow local model can't block. Flags: `-n/--count`, `--models`, `--judge`, `--task-type`, `--no-consensus`, `--scoreboard`. Also in Telegram channels: send `council <task>` (the `/council` slash form is routed too).
- **Two-way voice over Telegram** — inbound voice notes transcribed locally (faster-whisper); replies optionally synthesized back as voice notes (Piper → ffmpeg OGG/Opus). Fully local, `$0`; degrades to text when engines are absent.
- **Image / artifact delivery** — the channel agent can generate charts/files and send them to the chat as photos (`TelegramClient.sendImageFile`, multipart `sendPhoto`); the handler detects image paths in replies and delivers them.
- **Remote tool-approval over messaging channels** — tools needing confirmation now ask `/approve <id>` / `/deny <id>` over Telegram (wires the previously-dormant `RemoteApprovalService` into `ConfirmationService`), so a non-interactive daemon asks the user instead of failing closed.
- **Per-bot personas + isolated memory** — run multiple bots from one process, each with its own system prompt/model and its own conversation history + `remember` memory (`~/.codebuddy/bots/<botId>/`).
- **Conversation persistence** — channel conversations restore from disk on a cold agent and save after each turn (survive daemon restarts), via a per-chat cached agent.
- Channel providers may now be `chatgpt-oauth` and `gemini-cli` (flat-fee subscription brains); opt-in Code Explorer nudge + `code-explorer` safe-listing.

### Changed
- MCP deferred-schema threshold is configurable via `CODEBUDDY_MCP_DEFER_THRESHOLD` (deferred param-less stubs were skipped by some models).

### Fixed
- **MCP init no longer hangs on one unresponsive server** — `ensureServersInitialized` wraps each server in a per-server timeout (`CODEBUDDY_MCP_INIT_TIMEOUT_MS`, default 15s); previously a single hung server blocked *all* MCP tools from loading.
- Telegram channel starts from `channels.json` / server intake (correct `token` field); the channel agent is provider-agnostic + context-adaptive (minimal prompt + RAG tools) instead of the legacy ~73KB prompt.

---

## [1.2.0] — 2026-06-18

Post-1.0 work tracked in the V1.1 roadmap: OpenAPI spec (WS8-T2),
GitNexus integration (WS2), central Policy Engine + PII lint (WS5). See
`claude-et-patrice/propositions/` and the V1.x roadmap section of
[`docs/fleet-guide.md`](docs/fleet-guide.md).

### Added — Multi-LLM registry: list, auto-failover & ensemble (2026-06-18)

- **`buddy llm`** — lists the LLMs you're actually logged into (ChatGPT OAuth,
  xAI/Grok OAuth, env keys, reachable local Ollama/LM Studio), which is primary,
  and the failover order.
- **Auto-failover across your live logins** — `[llm] enabled` /
  `CODEBUDDY_LLM_FAILOVER=1` auto-populates the client's cross-provider fallback
  list from the registry, so a failing primary transparently continues on the next
  active LLM. Resilience order by default (capable/subscription first, local last);
  also `free-first` / `manual`. **OFF by default** — single-provider behavior is
  unchanged. Reuses the existing `chatWithProviderFallback` loop — no new failover
  logic.
- **`buddy llm ensemble|consensus|race <prompt>`** — run several active LLMs at once
  and aggregate (wires the previously-orphaned `ParallelExecutor`); shows each
  model's own answer plus the synthesis.
- Proven live (`$0`): primary Grok 404 → auto-failover → ChatGPT answered; and
  ChatGPT + Grok + Ollama answered one prompt together, synthesized at 100%.

### Added — xAI / Grok subscription login at runtime (2026-06-18)

- **`buddy login xai`** now works end to end: the runtime consumes the stored OAuth
  token (`getValidXaiAccessToken`) in provider detection, so `buddy -p` routes to
  Grok on `api.x.ai/v1` with **no API key** (flat-fee SuperGrok plan). Default model
  `grok-4-latest`; ChatGPT / `GROK_API_KEY` still take precedence, and xAI only
  overrides when its token actually resolves (a stale login never strands a working
  provider). Proven live on a real SuperGrok plan.

### Fixed (2026-06-18)

- **bash / reason tools** — a malformed tool call with no `command` / `problem`
  (common from weaker local models) used to crash on `.trim()` / `.length`; now a
  clear, recoverable error so auto-repair can re-prompt.
- **Onboarding** — the Cowork wizard rendered a literal `{{appName}}` (i18n
  interpolation), and local-provider setup now uses the actually-installed model.
- **MCTS** — `findBestSolution` could return `null` even with a scored node; falls
  back to the best non-pruned derived node.

### Added — computer use, vision & Screenpipe (2026-06-14)

- **`camera_analyze` tool** — captures a webcam frame (`captureCameraSnapshot`,
  ffmpeg/v4l2) and returns a natural-language description from a local vision
  model (default `ollama/gemma4:12b` via the Ollama `/v1` endpoint). Closes the
  loop past `camera_snapshot` (PNG-only) and `vision_analyze` (local metadata/OCR
  only). Validated against a real Logitech BRIO + gemma4.
- **Desktop automation over MCP** — `CodeBuddyMCPServer` now exposes the
  desktop-automation stack as MCP tools: `desktop_screenshot` and
  `desktop_snapshot` (accessibility/AT-SPI element enumeration) are read-only and
  always exposed; `desktop_click` / `desktop_move_mouse` / `desktop_type` /
  `desktop_key` actuate the real desktop and are **gated behind
  `CODEBUDDY_MCP_DESKTOP_CONTROL=1`** (fail-closed). Cross-platform "computer use"
  backed by Code Buddy's own validated stack rather than a Windows-only framework.
- **Screenpipe `screen_memory`** — the client now sends an optional
  `Authorization: Bearer` header (`SCREENPIPE_API_KEY`) required by recent
  Screenpipe `/search`; validated end-to-end (real OCR recall). See
  [`docs/screen-capture-and-ai.md`](docs/screen-capture-and-ai.md).

### Added — real channel transports (2026-06-14)

- **irc / nostr / mattermost / nextcloud-talk** were in-process stubs (their
  `start()` only flipped a flag). They now have **real network transports**, each
  wired to the shared `ReconnectionManager` (exponential backoff + jitter) and
  proven against a local loopback mock server:
  - **irc** — TCP/TLS client (RFC 1459/2812 subset): 001-gated registration,
    PING/PONG, PRIVMSG parsing, JOIN/QUIT, reconnect on drop.
  - **nostr** — WebSocket relay client (NIP-01 REQ/EVENT), per-relay reconnect.
    `send()` builds a real unsigned kind-1 event but returns an honest error
    (publishing needs a Schnorr signer).
  - **mattermost** — WebSocket event stream (`/api/v4/websocket`,
    `authentication_challenge` → `hello`, `posted`-event parse) + REST
    `POST /api/v4/posts` for outbound; bounded auth-handshake timeout.
  - **nextcloud-talk** — HTTP long-poll (Spreed chat API) + REST send.
- **feishu/Lark** — refused to fake the proprietary Lark long-connection
  (Protobuf framing, SDK-only): implemented real REST outbound
  (`tenant_access_token` → `im/v1/messages`) and made `connect()` honest
  (`inbound: lark-sdk-required`). Live inbound needs `@larksuiteoapi/node-sdk`.
- Live multi-platform delivery still requires each platform's tokens/accounts.

### Fixed (2026-06-14)

- **camofox** — reworked from the wrong Chrome-CDP assumption to the correct
  `camoufox server` + `playwright.firefox.connect()` path (Camoufox is Firefox,
  not Chrome). Validated end-to-end (real page round-trip) at the repo-pinned
  Playwright 1.58.2.
- **desktop-automation (Linux)** — `createNativeProvider` now prefers
  `NutJsProvider` when xdotool/xclip/wmctrl are absent (and registers it under the
  `native` key) instead of silently falling back to the mock provider; fixed an
  ImageMagick `import` headless hang (`-window root`) and an AT-SPI interpreter
  probe that cached a transient timeout permanently.
- **OpenClaw migrator (security)** — all archive review slices are now written
  owner-only (`0600`) and the pre-migration backup root is `0700` (it aggregates
  device credentials + tokens).
- **transport hardening** — fixed a mattermost connect-hang (no auth timeout), an
  IRC unbounded line-buffer (OOM), and a `camera_analyze` body-read that ran
  outside its abort timeout.
- **runtime SSH** lifecycle validated on localhost (real `ssh` round-trips).

### Added — more local gap closures (2026-06-14)

- **Nostr publishing** — real BIP-340 Schnorr signing (`@noble/curves`): `send()`
  now signs and publishes a real kind-1 event and awaits the relay `OK` ack
  (sign→verify round-trip tested). nsec/hex secret keys supported.
- **Browser Use — local execution** — when no managed key/gateway is set, the
  runner now drives a *local* `browser-use` (pip) + local Ollama + Chromium
  (installed and validated end-to-end here). The managed gateway stays optional.
- **Mobile-supervision HTTPS** — optional TLS for the server that hosts
  `/api/mobile` (`CODEBUDDY_HTTPS=1` + `CODEBUDDY_TLS_CERT`/`CODEBUDDY_TLS_KEY`,
  or an `openssl` dev self-signed cert) via Node built-ins; HTTP default and the
  dispatch product-gate unchanged.
- **Feishu/Lark real-time inbound** — wired to the official
  `@larksuiteoapi/node-sdk` WSClient via an *optional* runtime import (not a core
  dependency); degrades to the honest send-only state when the SDK is absent.

> Parity vs Hermes Agent / OpenClaw: **15 covered / 4 covered-partial / 1 partial
> / 0 gap** — see [`docs/hermes-openclaw-parity.md`](docs/hermes-openclaw-parity.md).

## [1.1.0] — 2026-06-11

### Added — `/goal` Ralph loop, parité Hermes Agent (2026-06-11)

- **`/goal <text>`** — standing goal with judge-gated auto-continue
  (1:1 port of Hermes Agent's goal system, `hermes_cli/goals.py`).
  After each turn an auxiliary LLM judge replies
  `{"done": bool, "reason": str}`; on `continue` a plain user-role
  continuation prompt is auto-submitted (no system-prompt mutation,
  prompt cache intact) until the goal is done, the turn budget is
  exhausted (default 20), the user pauses/clears it, or Esc interrupts
  (auto-pause). Subcommands: `status | pause | resume | clear`
  (aliases `stop`, `done`). A real user message mid-loop preempts the
  continuation; the judge then evaluates after that turn.
- **`/subgoal <text>`** — numbered acceptance criteria added mid-loop
  (`remove <n>`, `clear`, bare to list); the judge then requires
  specific evidence for every criterion.
- **Robustness** — judge is fail-open (transport errors → continue);
  3 consecutive unparseable judge replies auto-pause with a config
  hint; per-session persistence under `~/.codebuddy/goals/` survives
  `--resume`/`--continue` (cleared goals keep an audit tombstone).
- **Config** — `goals.{maxTurns,judgeModel,judgeMaxTokens,judgeTimeoutMs}`
  in `settings.json`; env `CODEBUDDY_GOAL_MAX_TURNS`,
  `CODEBUDDY_GOAL_JUDGE_MODEL` (route the judge to a free local model).
  New module `src/goals/`.
- **`buddy goal "<text>"`** — headless Ralph loop: runs the full agent
  (tools included) in-process, judge-gated continuation until done
  (exit 0) or paused (exit 1). `--max-turns`, `--judge-model`, `-m`.
- **Colab board goal-mode** (Hermes kanban goal-mode parity) —
  `buddy fleet tasks add --goal-mode [--goal-max-turns N]`: the
  autonomous worker's successful attempt must now pass the judge
  (acceptanceCriteria become strict numbered criteria); "continue"
  re-opens the task with a continuation nudge (persisted turn budget,
  default 5); budget exhausted → task **blocked for human review**
  instead of spinning. Judge "continue" never escalates the model
  ladder. New tick outcomes `goal_continue` / `goal_blocked`.
- **Peer-session goal parity** (Hermes gateway semantics) —
  `peer.chat-session.goal` RPC (set/status/pause/resume/clear/
  subgoal-add/-list/-remove/-clear); after each `continue`/
  `continue-stream` the judge runs server-side and the response carries
  `goal: {status, verdict, reason, message, continuationPrompt?}` —
  the **caller drives the loop**. Setting a new goal while one is
  active is rejected (`GOAL_ACTIVE`). Goal state persists in the
  peer-session store (survives restarts, follows the session TTL);
  metadata-only `fleet:chat-session:goal` broadcasts.
- **Judge cost tracking** — every goal-judge call records its token
  usage in the session cost ledger (`getCostTracker().recordUsage`).
  ~115 tests across `tests/goals/`, `tests/commands/`, `tests/daemon/`,
  `tests/fleet/`.

### Added — WS3 « Mémoire & continuité du run » (2026-06-10)

The continuity workstream from the modernization plan, V1.1's first lot:

- **Session-end flush (WS3-T1)** — at session end Code Buddy writes
  `.codebuddy/HANDOFF.md` (last goal/state, files touched, heuristic
  open-risks list, resume pointers — sync-safe for exit handlers) and
  proposes review-gated lesson candidates from the transcript (approval
  stays human; approved lessons are re-injected per turn). Feature flag
  `SESSION_END_FLUSH` (default on), wired in dispose, headless (15 s
  cap) and interactive SIGINT/SIGTERM paths.
- **Periodic context snapshot (WS3-T2)** — `ContextManagerV2` snapshots
  long sessions every `CODEBUDDY_SNAPSHOT_INTERVAL_MIN` (45 min default)
  to `.codebuddy/context-snapshot.json` + `context_snapshot` run event.
- **Pause suggestion (WS3-T3)** — `SessionDurationMiddleware` (priority
  35): past `CODEBUDDY_SESSION_PAUSE_HOURS` (12 h default) it takes a
  fresh snapshot and suggests a clean pause + `buddy --continue`
  (warn-only, hourly cadence, `pause_suggested` run event).
- **Shared guard-rail** — new `redactSecrets()` in `fleet/privacy-lint`:
  every WS3 memory write is privacy-linted on full text *before*
  truncation; the lesson auto-proposer now drops candidates containing
  secret/PII material.

### Fixed — 1.0.0 validation campaign follow-ups (2026-06-10)

- **MCP stdio servers no longer leak stderr into the CLI** (`9a57b3d0`)
  — the SDK default (`stderr: 'inherit'`) let noisy MCP servers break
  the `--quiet`/pipeable-JSON headless contract; now piped and drained
  to the logger.
- **22 stale tests realigned** (`00f505b7`) — docs inventories after
  the readme rebranding, the OpenClaw WS fixture brought up to the
  a7354b11 paired-device handshake + 2026.6.x `node.pair.*` methods,
  Cowork demo/skills/parity assertions following the product.
- **QA report** ([`docs/qa/v1.0.0-validation.md`](docs/qa/v1.0.0-validation.md),
  `f05008ba`) — GA confirmed; open findings: Ollama `num_ctx` guard
  (V1.1), 9 machine-coupled tests to `skipIf` (V1.1).
- **Docs** — local-model agentic checklist in
  [`docs/providers.md`](docs/providers.md) (provider forcing, `qwen3*`
  tool support, Ollama `num_ctx`), FAQ updated to GA status.

---

## [1.0.0] — 2026-06-10 🎉

**General availability.** Multi-AI fleet hub (`peer.chat` +
`peer.chat-session.*` + `peer.tool.invoke`), the Cowork desktop GUI,
15 providers, ~30K tests. Everything below this heading up to
`[1.0.0-rc.1]` shipped between rc.1 and GA.

### V1 GA blockers closed (2026-06-10)

The three remaining GA audit blockers are done; what's left open
(OpenAPI spec, GitNexus integration, Lessons/Context Engine v2, Policy
Engine) is reclassified to the V1.1 roadmap and no longer blocks the tag.

- **WS8-T3 — DB migration e2e test** (`ae98e424`) —
  `tests/database/migration-e2e.test.ts` proves "upgrade an old install
  through all migrations cleanly" against the real better-sqlite3 layer:
  v1/v2 database files walked to the current `SCHEMA_VERSION` with data
  preserved, FTS rebuilt + triggers functional, fresh-install full
  chain, idempotent re-init; plus the legacy JSON→SQLite import
  end-to-end (dry-run, expired-cache skip, `deleteAfterMigration`
  renames, corrupted-file resilience).
- **WS8-T4 — Feishu webhook security fix** (`a2c2857e`) — the webhook
  signature was computed as HMAC-SHA256 keyed by the verification
  token; per the Lark Open Platform spec it is the plain SHA-256 of
  `timestamp + nonce + encrypt_key + body`, so every genuine Feishu
  request was rejected. Now spec-conform, decrypt-first (token check
  also covers encrypted events), timing-safe comparisons, fail-closed
  when no secret is configured, full-body debug dump removed from logs.
  10 tests cover the verification chain.
- **WS8-T1 — `docs/deployment.md`** (`3478fd9e`) — production guide:
  checklist (JWT fail-closed, CORS, trusted proxies), env-var
  reference, systemd units, Docker, Kubernetes manifests walkthrough,
  nginx WS upgrade, monitoring endpoints, upgrade/rollback procedure.

### Added — Gateway device pairing (OpenClaw/Hermes-style approval flow)

- **`DevicePairingStore`** (`src/gateway/device-pairing.ts`) — transport-agnostic
  pending → approve/reject → scoped-token registry modelled on OpenClaw's
  `~/.openclaw/devices/{paired,pending}.json` and Hermes' pairing. Tokens are
  minted once on approval and only their SHA-256 hash is persisted (plaintext
  never hits disk); list/get views are token-free; device files are written 0600.
- **Wired into the production gateway** (`src/server/websocket/handler.ts`) as an
  **opt-in gate** (`CODEBUDDY_GATEWAY_REQUIRE_PAIRING=true`, default off — the
  existing JWT/api-key auth paths are untouched). When enabled, a paired device
  authenticates with its scoped token; an unknown device is queued for approval
  (`PAIRING_PENDING`); an already-paired device with a bad token is rejected
  (`DEVICE_TOKEN_INVALID`) and never re-queued.
- **Operator CLI** `buddy gateway-pairing pending|list|approve|reject|revoke`
  (mirrors `openclaw devices …`). Approval prints the device token once.
- Verified end-to-end against the real `setupWebSocket` server (connect → pending
  → approve → authenticate → reject-bad-token). Unit + CLI tests included.

### Added — Gateway handshake: protocol negotiation + capability discovery

- The Code Buddy Gateway `connect` → `hello_ok` handshake now mirrors the strong
  patterns from the OpenClaw and Hermes gateways:
  - **Protocol-version negotiation** (`src/gateway/protocol.ts`): clients may send
    `minProtocolVersion`/`maxProtocolVersion` (the legacy single `protocolVersion` still
    works); the gateway negotiates against its supported range
    (`GATEWAY_MIN_PROTOCOL_VERSION..GATEWAY_MAX_PROTOCOL_VERSION`), returns the agreed
    `protocolVersion` + a `protocolCompatible` flag, and echoes its preferred version
    when there is no overlap (OpenClaw `minProtocol`/`maxProtocol` → `protocol`).
  - **Capability discovery**: `hello_ok.capabilities.methods` advertises the registered
    handler names so clients can discover what the gateway supports (OpenClaw
    `features.methods` / Hermes capability discovery).
  - **Server identity**: `hello_ok.server.{version,connId}` (OpenClaw `server.{version,connId}`).
  - **Honest pairing**: replaced the dead `paired: skipPairing ? true : true` no-op with a
    real `isPairedDevice()` seam + a `requirePairing` config flag (default off, fully
    backward compatible) so OpenClaw/Hermes-style pairing approval can be layered in later.
  - Pure, fully unit-tested negotiation/builder helpers (`tests/gateway/protocol.test.ts`).

### Added — Spec pipeline Commit 3 — `buddy spec next` (autonomous-runner bridge)

- **`buddy spec next`** — the execution end of the BMAD-inspired pipeline. Takes the
  next **approved** story and feeds it to the autonomous coding runner
  (`runAgenticCodingCell`). The story's runner-contract fields (`allowedPaths`,
  `verification`, `riskLevel`, filled by the Commit-2 sharding step) populate an
  `AgenticCodingTaskContract` directly — no translation step. Durable lineage
  **story → run → outcome**.
  - Transitions `approved → in_progress` (recording `runId`) **only after** the contract
    validates, so an insufficient story stays `approved`. Terminal mapping: `verified`
    → `completeStory` (verification = evidence); `blocked`/`validation_failed`/
    `verification_failed` → `blockStory`; scaffold-only (`ready`/`previewed`/`edited`)
    leaves it `in_progress` with an explicit next step — never a false completion. A
    thrown run is caught and blocks the story so it is never stranded `in_progress`.
  - `--fleet <none|read-only-help|delegated-slices>` lets the per-story coding agent
    delegate to fleet peers — collaboration compounds across the pipeline. Other flags:
    `--story`, `--allowed-path`, `--verify`, `--risk`, `--edit-proposal-file`, `--apply`,
    `--run-verification`, `--output`, `--dry-run`.
  - Runner lazy-imported (286KB, never inflates boot). Per-run artifacts under
    `.codebuddy/specs/<id>/runs/<runId>/` (`task.json` + `report.json`). 8 new tests.
  - Note: when `repo === cwd` the runner forces `riskLevel: high` (self-improvement
    guard), so in-repo `spec next` runs gate to scaffold/preview unless edits are
    explicitly supplied (`--edit-proposal-file --apply`) and the gate clears.
  - Completes the loop: **plan (multi-agent, gated) → approve → implement (autonomous,
    fleet-collaborative) → verify → done.**
  - **Launchable from Cowork:** an approved story's card gains **Preview** (`--dry-run`,
    shows the contract) and **Run ▸** buttons. The `spec.next` IPC shells out to the
    core CLI as a child process (`ELECTRON_RUN_AS_NODE`), buffers output, and reads the
    run result on exit — the CLI stays the source of truth and the main loop never
    blocks. Output + final status surface in the panel. 3 new Cowork tests.

### Added — Spec pipeline Commit 2 — `buddy spec plan` (agentic, phased, review-gated)

- **`buddy spec plan start / continue / status`** — the multi-agent planning layer
  of the BMAD-inspired spec pipeline. Specialist personas hand work off to each
  other (Analyst/PM draft the PRD → Architect designs `architecture.md` →
  Scrum-Master shards into draft stories), with a **human review gate between each
  phase**. State lives on the existing `SpecProject.phase` enum; each invocation
  advances exactly one phase, writes its artifact under
  `.codebuddy/specs/<id>/`, and exits for review.
  - `continue --by <reviewer>` reads the (possibly human-edited) artifact back from
    disk, records the approval (`SpecProject.planApprovals`), then runs the next
    persona. `--auto` on `start` chains every phase non-interactively but still
    requires `--by` (same gate, batched).
  - Sharded stories carry **runner-contract fields** (`allowedPaths`,
    `verification`, `riskLevel`) so the upcoming `buddy spec next` (Commit 3) can
    build an `AgenticCodingTaskContract` with no translation step.
  - Personas are LLM-agnostic (`src/spec/spec-planner.ts`, injected `SpecLlmCall`);
    the CLI (`src/commands/spec-plan.ts`) builds the provider from settings,
    mirroring `buddy flow`. Tolerant JSON parsing falls back to one coarse story so
    the command never hard-crashes on model output.
  - 19 new tests (store artifacts/approvals/story-fields, planner personas + parse
    fallback, CLI phase lifecycle). See [`docs/spec-pipeline.md`](docs/spec-pipeline.md).
  - **Administrable from Cowork:** the phase machine is extracted to a UI-agnostic
    core runner (`src/spec/spec-plan-runner.ts`) shared by the CLI and a new
    `spec.planStart` / `spec.planContinue` / `spec.planStatus` IPC. The Cowork
    SpecPanel gains a "Plan (agents)" section — start a plan from a goal, see the
    phase + artifact presence, and advance one phase with a reviewer — plus the new
    story contract fields (risk / paths / checks) on each card. LLM client built from
    Cowork config like the Fleet aggregator. 5 new Cowork IPC tests.

### Added — Fleet V1.3 partial (Phase d.23) — `peer.tool.invoke`

- **`peer.tool.invoke` + `peer.tool.invoke.stream`** — read-only remote
  tool invocation via the fleet WebSocket. A peer Code Buddy can ask
  another peer to execute a tightly-scoped read tool against THIS
  peer's filesystem and stream the result back. Pattern is OpenClaw
  `node.invoke` extended to tools.
  - V1 allowlist (hardcoded, override via env `CODEBUDDY_PEER_TOOL_ALLOWLIST`):
    `view_file`, `list_directory`, `search` (ripgrep). All three already
    carry `fleetSafe: true` in `src/tools/metadata.ts`.
  - **Three security gates**, in order: allowlist → registry `fleetSafe`
    flag → workspace root (every path arg is `realpath`'d and checked
    against `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT`). **Fail-closed when
    the workspace env is unset** so a misconfigured peer cannot
    accidentally expose `/`.
  - Streaming variant uses `ctx.emitChunk` → `peer:chunk` frames
    (16 KB chunks for `view_file`, line-by-line for `search`).
  - Anti-loop guards (`CODEBUDDY_PEER_MAX_DEPTH`, `CODEBUDDY_PEER_ROLE=leaf`)
    inherited from the dispatcher — no new wiring.
  - Audit log via `logger.info('[fleet] peer.tool.invoke', meta)` on
    every invocation (success and failure), with shape
    `{ event, from, traceId, depth, tool, stream, ok, error?, durationMs }`.
  - R4 audit hardening: `view_file` now reads only a capped prefix,
    `list_directory` caps entries and reports truncation, stream output
    is sanitized before live terminal display, and the WebSocket
    loopback path is covered by `tests/fleet/fleet-loopback-smoke.test.ts`.
  - Fleet provider routing now detects `/login chatgpt` OAuth credentials
    as `chatgpt-oauth`, advertises Codex subscription models at zero
    marginal cost, and lets `peer.chat` use the ChatGPT Codex Responses
    backend before falling back to paid API providers.
  - `list_peers({ includeCapabilities: true })` now enriches connected
    peers with `peer.describe` provider/model summaries so the LLM can
    choose between ChatGPT OAuth, Ollama, Gemini CLI, and paid APIs before
    calling `peer_delegate`.
  - New `route_peer` LLM tool wraps Fleet `TaskRouter`: it classifies a
    prompt, gathers peer capabilities via `peer.describe`, applies privacy
    and cost/latency constraints, and returns the recommended peer/model
    plus a ready `peer_delegate` next call.
  - New `/fleet route <prompt>` command exposes the same router to the
    human CLI, with privacy/cost/latency/context filters, `--json`, and
    `--delegate` for a one-shot routed `peer.chat` call.
  - New `/fleet describe [peer]` command wraps `peer.describe` with a
    compact human summary plus `--json` for scripts.
  - Reprise operator checklists added under `docs/reprise/` for CLI
    smoke validation and the minimal Fleet scenario Patrice can replay.
  - New module `src/fleet/peer-tool-bridge.ts` (~280 LOC,
    standalone executors using `fs/promises` + `@vscode/ripgrep`).
    18 unit tests in `tests/server/peer-tool-bridge.test.ts`.
  - Client convenience: `FleetListener.invokeTool(name, args, opts)` +
    `invokeToolStream(name, args, onChunk, opts)`.
  - Wired alongside `peer-chat-bridge` in `src/server/index.ts`.
  - Docs: [`docs/fleet-guide.md`](docs/fleet-guide.md) — section
    "`peer.tool.invoke` + `peer.tool.invoke.stream` — Phase (d).23 / V1.3".
  - Out of scope for V1 (kept for future phases): mutating tools
    (Edit/Write/Bash) — require explicit per-call approval; permission
    modes on the peer side; multi-workspace; cancellation cross-WS;
    JWT scope `peer:tool:invoke`; MCP-tool exposure.
  - **Behavior note** — the bridge is wired unconditionally on every
    `buddy server` start (no env feature flag). Safe by fail-closed
    default: with no `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` set, every
    invocation rejects with `PEER_WORKSPACE_NOT_CONFIGURED` and
    nothing else changes. Existing deployments need no migration.
  - **Test coverage scope** — unit tests dispatch directly via
    `dispatchPeerRequest`, while `tests/fleet/fleet-loopback-smoke.test.ts`
    starts a real Gateway WebSocket server and exercises `/fleet tool`
    over the loopback transport in both buffered and streamed modes.
    Cross-host E2E with a real DARKSTAR fleet gateway remains the
    intended Phase 2-3 follow-up.

### Added — Fleet V1.2 (Phase d.21)

- **`peer.chat-session.start/.continue/.end`** — multi-turn
  conversations between fleet peers, with state held in-memory on the
  peer that hosts the LLM client. Where `peer.chat` (d.15) is a
  stateless one-shot, this trio lets a caller open a session, append
  turns that build on prior context, and close it explicitly.
  - Idle TTL 30 min (override via `CODEBUDDY_PEER_SESSION_IDLE_MS`),
    reset on each `continue`. Opportunistic GC — no setInterval timer.
  - Concurrent `continue` calls on the same sessionId serialise FIFO
    via per-session promise chains so assistant messages can't
    interleave on shared history.
  - Failed turns roll back the user message they appended, so a
    retry stays consistent with what the model has actually seen.
  - Error codes: `SESSION_NOT_FOUND`, `SESSION_EXPIRED`,
    `CLIENT_UNAVAILABLE`. `traceId` echoed in every response.
  - New module `src/fleet/peer-session-bridge.ts` (~250 LOC),
    17 unit tests in `tests/fleet/peer-session-bridge.test.ts`.
  - Wired alongside `peer-chat-bridge` in `src/server/index.ts`.
  - Docs: [`docs/fleet-guide.md`](docs/fleet-guide.md) — section
    "`peer.chat-session.*` V1.2 (Phase d.21)".
  - Limitations carried into V1.3: no tools (separate
    `peer.tool.invoke` design), no cross-restart durability
    (saga-store backing is a possible follow-up).

### Added — Fleet V1.2.1 (`/fleet chat` slash helper)

- **`/fleet chat start|say|end|list`** — UX wrapper around
  `peer.chat-session.*` so users don't have to copy `sessionId` between
  turns. Aliases default to `<peer>-1`, `<peer>-2`, … and can be set
  with `--name <alias>`. The "active" session resolves to the unique
  one when there's only one open, or to the last `start` otherwise;
  `--session <alias>` overrides on `say`/`end`.
  - Errors propagate cleanly from the server: `SESSION_NOT_FOUND` /
    `SESSION_EXPIRED` purge the local handle so the user sees the error
    once and can restart cleanly.
  - `/fleet stop <peer>` and `/fleet stop --all` auto-purge any chat
    sessions tied to the peer being closed (server-side will TTL out).
  - Implementation in `src/commands/handlers/fleet-handler.ts` (~280
    LOC for the new sub-action + state). 18 unit tests in
    `tests/fleet/fleet-chat-helper.test.ts`.

### Added — /fleet history --type + --json

- **`--type <glob>`** — filter the rendered history by event-type
  pattern (e.g. `fleet:agent:tool*` or `fleet:peer:*`). The glob
  supports `*` only; everything else is escaped, so it's safe with
  literal `:` in event names. The filter operates on the in-memory
  ring after the size cap so older filtered-out events don't get
  hidden.
- **`--json`** — emit the rendered slice as a JSON array (one object
  per event with `peer`, `at`, `type`, `hostname`, `agentId`,
  `payload`). Lets `/fleet history --json | jq` workflows feed into
  external tooling. Empty result becomes `[]` (no header), which is
  what jq users expect.
- Both flags combine cleanly. New `compileTypeFilter()` helper in
  `src/commands/handlers/fleet-handler.ts` converts the glob to a
  RegExp anchored at both ends. 5 new tests in
  `tests/fleet/fleet-handler.test.ts`.

### Added — /fleet status --with-sessions

- New flag on `/fleet status` that fans out `peer.chat-session.list`
  to every connected peer in parallel (5 s timeout each) and prints
  the open sessions inline under each peer block. Slow peers don't
  serialise the command — total elapsed ≈ max(per-peer latency), not
  sum.
- Output per peer block adds either `Chat sessions (N):` with one
  line per session (sessionId, turn count, idle, model), `Chat
  sessions: (none open on this peer)`, or `Chat sessions:
  (unreachable — <error>)` when the RPC failed (timeout, peer dropped
  the method, etc.).
- 5 new tests in `tests/fleet/fleet-chat-helper.test.ts` covering
  baseline `/fleet status` unchanged, populated session list, empty
  list, unreachable peer, and parallelism (slow + fast peer total
  near max not sum).

### Added — Fleet peer.chat-session.list

- **Read-only snapshot RPC** — `peer.chat-session.list` returns the
  in-memory sessions on a peer with metadata only: `sessionId`,
  `turnCount`, `model?`, `ageMs`, `idleMs`, `expiresInMs`. Useful for
  `/fleet status --with-sessions` and external monitors that want to
  know which conversations are open without sniffing content.
- **Privacy guarantee**: a test asserts the response NEVER contains
  the words `systemPrompt`, `messages`, or `content`, and NEVER
  exposes the actual prompt / assistant text the session is carrying.
- Calls `purgeExpired` before returning so callers never see ghosts.
- 5 new tests in `tests/fleet/peer-session-bridge.test.ts` covering
  empty state, multi-session metadata, privacy assertion, idle-purge
  before report, and `traceId` echo.

### Added — Fleet peer.chat-session.continue-stream

- **Streaming variant of `peer.chat-session.continue`** — mirrors the
  Phase d.19 `peer.chat-stream` pattern but reuses the session's
  multi-turn history. Each assistant delta is pushed via
  `ctx.emitChunk`; the final response carries the aggregated text +
  usage so transports without streaming support still get a usable
  answer. Same FIFO serialisation per session and same persistence /
  observability hooks as the non-streaming `continue`.
- Error handling: if the stream throws before producing any delta the
  user message is rolled back (consistent with `continue`); if some
  text was emitted before the error, it's persisted as the assistant
  message so the next turn sees what the model already said.
- 9 new bridge tests in `tests/fleet/peer-session-bridge.test.ts`
  covering delta forwarding, no-transport aggregation, multi-turn
  history accumulation across streaming + non-streaming, missing
  params, server errors with zero / partial deltas, and the
  `fleet:chat-session:turn` event.

### Added — Fleet privacy-lint PII patterns

- **SSN, IBAN, phone, credit-card detection** added to
  `src/fleet/privacy-lint.ts`. The router now flags prompts containing
  US Social Security numbers (with the SSA-reserved prefix block
  list), IBANs (FR/DE/etc., with or without space grouping), phone
  numbers (E.164 international + French national format), and credit
  card numbers (Visa/MC/Amex/Discover/JCB/Diners) validated through a
  Luhn checksum to keep false positives down.
- `pii-ssn` and `pii-credit-card` are high-confidence; `pii-iban` and
  `pii-phone` are low-confidence (caller decides whether to block or
  just downgrade `privacyTag` to `'sensitive'`).
- 10 new unit tests in `tests/fleet/privacy-lint.test.ts` covering
  positive cases, SSN reserved prefixes, Luhn rejection, and
  no-false-positive on benign sentences with numbers.

### Added — Fleet V1.2-saga + observability (Phase d.22)

- **Cross-restart session durability** — `peer.chat-session.*` state
  now persists to `~/.codebuddy/peer-sessions/<sessionId>.json` using
  the same lockfile + atomic-rename pattern as the saga store. On
  peer restart, sessions younger than `CODEBUDDY_PEER_SESSION_IDLE_MS`
  are re-hydrated before the RPC methods are registered; older
  entries are purged. Closes the V1.2 limitation explicitly deferred
  in the previous release.
  - New module `src/fleet/peer-session-store.ts` (~180 LOC) with
    `save / load / loadAll / delete / purgeExpired` and a
    test-injectable singleton (`_setPeerSessionStoreForTests`).
  - 14 unit tests in `tests/fleet/peer-session-store.test.ts`
    (round-trip, atomic write, corrupt-file resilience, TTL purge).
  - `wirePeerSessionBridge` is now `async`; the boot path in
    `src/server/index.ts` was updated accordingly.
- **`fleet:chat-session:*` observability events** — start / turn / end
  emitted on the fleet bus so `/fleet listen` consumers and
  `/fleet history` see chat-session activity.
  - `fleet:chat-session:start` carries `{ sessionId, model? }`.
  - `fleet:chat-session:turn` carries `{ sessionId, turnCount,
    elapsedMs, usage }`.
  - `fleet:chat-session:end` carries `{ sessionId, reason: 'end' |
    'expired' }` (so listeners distinguish explicit close vs TTL
    purge).
  - **Privacy guard**: payloads are metadata only — no prompt content,
    no assistant text, no system prompt. A unit test scans the
    aggregated payload blob for the words `prompt` / `messages` /
    `content` and the actual conversation strings to enforce this.
  - 3 new event types + wrappers in
    `src/server/websocket/fleet-bridge.ts`.
- 10 new unit tests in `tests/fleet/peer-session-bridge.test.ts`
  (hydrate at wire, persist on start/continue/end, history replay
  after restart, all 4 event paths, privacy assertion).

---

## [1.0.0-rc.8] — 2026-05-09 (afternoon)

**Cowork hardening session** — eight commits aimed at making the
end-to-end experience trustworthy after the rc.7 ship. Highlights:

### Fixed — critical regression

- **Dual-`mainWindow` bug** (commit `751f7eb6`). `cowork/src/main/index.ts`
  and `cowork/src/main/window-management.ts` each kept their own
  `let mainWindow: BrowserWindow | null = null`. Only the former was
  ever set; the latter's `getMainWindow()` (used by
  `ipc-main-bridge.ts:sendToRenderer()`) always returned `null`, so
  every IPC push from main to renderer (`stream.message`,
  `session.status`, `trace.step`, …) was silently dropped. The chat
  UI froze on "processing" forever; the only recovery was clicking
  "Repair transcript" which re-fetched messages over a different
  channel. Fixed by exporting `setMainWindow()` from
  `window-management.ts` and calling it after the BrowserWindow is
  created. The bridge now emits an error log if a future regression
  reintroduces the same shape.

### Fixed — server lifecycle

- **`@phuetz/ai-providers` inlined** (commit `5757b197`) into
  `src/providers/_shared/`. The workspace symlink was a footgun on
  any host that didn't have the sibling repo cloned (e.g. fresh
  Ministar Linux): `loadCoreModule('tools/registry/index.js')` failed
  silently because `utils/retry.js` couldn't resolve the import.
- **Core DB initialization before startServer** (commit `cc2d2260`).
  `ServerBridge.start()` now calls `getDatabaseManager().initialize()`
  before `startServer()` so `/api/health.checks.database` doesn't
  return 'error' on first boot.
- **Runtime JWT_SECRET fallback**. Auth middleware throws at
  module-load under `NODE_ENV=production` if the env var is missing.
  ServerBridge mints a 64-byte hex secret at boot if none is
  persisted (single-user fallback; tokens don't survive a Cowork
  restart unless the user persists a secret in Settings → Server).
- **`health.checkApi` accepts every provider** (commit `cc2d2260`).
  The original check returned 'error' for any user not setting
  `GROK_API_KEY`. Now accepts `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `GEMINI_API_KEY`, `XAI_API_KEY`, or any loopback `OPENAI_BASE_URL`
  (Ollama / LM Studio).

### Added — UX

- **Live API heartbeat monitor** (commit `f14cc8c4`). `/api/health.apiHeartbeat`
  now shows real `lastCheck` + `latencyMs` + status. A 30 s probe
  loop in `src/server/heartbeat-monitor.ts` pings the configured
  provider and stamps `updateApiHeartbeat`.
- **Settings → Embedded server** (commit `b7ca5fb4`). New
  `SettingsServer.tsx` lets users configure port, host, websocket,
  and a persistent JWT secret. Apply triggers a stop/start cycle.
- **Cold-start indicator + elapsed counter** (commit `0765e3e9`).
  The "processing" spinner now shows live elapsed seconds and an
  italic sub-line at 5 s+ ("Loading model or generating thinking")
  + a warning at 30 s+ ("Cold start in progress"). Particularly
  useful with Ollama qwen3.6:35b which routinely takes 60–120 s on
  first run.
- **Help icon (?) in titlebar** + keyboard shortcuts dialog rewrite
  (commits `e419862a`, `cbaeada9`). 24 shortcuts across 6 sections
  with autofocus search, filter, and platform-aware glyphs (⌘/⌥/⇧).
- **Power button (⏻) in titlebar** (commit `45c4bb60`). Toggles the
  embedded HTTP server; visual indicator shows running/stopped/error.
- **Tool selector V2 in WorkflowEditor** (commit `4094d60b`).
  Combobox with autofocus search, grouping by category, keyboard
  navigation, and inline descriptions.
- **ApprovalDialog enriched** (commit `59859753`). When a workflow
  approval payload includes the upcoming tool name + JSON input, the
  dialog renders a preview and flags destructive patterns
  (rm -r[Rf], chmod 777, eval, sudo, mkfs, fork bomb, curl|bash,
  `git push --force`, DROP DATABASE, …).
- **Hooks `agent` dry-run** (commit `f5629cdc`). The last mock branch
  in `hooks-bridge.ts:test()` is closed: `agent` handlers now spawn
  a real sub-agent via `dryRunSubAgent()` with a 10 s timeout.

### Added — docs

- `cowork/docs/architecture.md` — mermaid diagram of main/preload/
  renderer + bridges + core, listing every IPC namespace, persistent
  state path, and the dual-mainWindow regression.
- `cowork/docs/dev-linux.md` — iterative dev loop on Linux: skip
  `npm run build`, use `npx vite build` (~30 s), boot Electron with
  `--no-sandbox --disable-gpu`, electron-rebuild instructions, and
  common gotcha table.

### Tests

- 12 hooks dry-run cases (3 command + 5 http + 4 prompt + 3 agent).
- Cowork E2E smoke driven via CDP confirmed all chat + workflow
  paths in real Electron after the mainWindow fix.

---

## [1.0.0-rc.7] — 2026-05-09

**Cowork visual workflows now executable** — closes the gap identified
by the Cowork audit (`journal/ministar-ubuntu-grok-cli.md`). The
WorkflowEditor saved DAGs but the runtime was a noop. Now wraps the
core `Orchestrator` (`src/orchestration/orchestrator.ts`) with a
4-agent pool that fulfils tool/approval steps. Validated end-to-end
through Electron on Linux + DISPLAY=:10.0 + CDP-driven test injection.

### Added — Cowork (workflow execution)

- **WorkflowEditor V1 execution** (`cowork/src/main/workflows/`):
  - `workflow-bridge.ts` (rewrite, ~440 LOC) — replaces the previous
    `WorkflowEngine` wrapper that mapped every tool node to `noop`.
    Now compiles the visual DAG, registers a 4-agent worker pool
    against the core `Orchestrator`, dispatches `task_assigned`
    events to a `CoworkToolAgent`. Two runtime bugs caught by an
    advisor pass and fixed before ship: the `processQueue` deadlock
    after `queueTask` (fixed via `task_created` listener +
    `queueMicrotask`), and the listener-order issue where the
    `workflow_started` global handler fired before the run-scoped
    capture handler had populated the instanceId↔workflowId map
    (fixed via `prependListener`).
  - `dag-compiler.ts` (new, ~280 LOC) — Kahn topo-sort + automatic
    branch detection for `parallel` (≥2 outgoing edges) and
    `condition` (true/false labelled edges).
  - `cowork-tool-agent.ts` (new, ~180 LOC) — fulfils `tool_invoke`
    (delegates to `FormalToolRegistry.execute`) and `approval_wait`
    (suspends until renderer signals via `workflow.approve` IPC,
    with configurable timeout).
  - `ApprovalDialog.tsx` (new, ~95 LOC) — modal driven by
    `pendingApprovals[0]` from the store, with countdown timer +
    Approve/Reject buttons.
  - `WorkflowEditor.tsx` Inspector enriched: per-node-type config
    (tool: dropdown of toolName + JSON input ; condition: expression ;
    approval: message + timeout). Runtime overlay: each node's
    stroke colours by status (running = pulsing blue, completed =
    green, failed = red).

- **WorkflowEditor V0.5 — loop nodes + convergence** (commit
  `2dd2d987`):
  - New `WorkflowNodeType = 'loop'` with `body` + `exit` outgoing
    edges; iteration is delegated to the core engine. Documented
    one-tick lag in the README + integration test.
  - `parallel` and `condition` blocks can now rejoin on a shared
    "join" node before continuing the main chain. The
    `findJoinTarget` helper validates branches all converge on the
    same node (or all flow to `end`); heterogeneous topologies throw
    `CompilationError`.

- **`registerBuiltinTools(registry)` export in
  `src/tools/registry/index.ts`** (commit `6c5e39f6`) — synchronous
  counterpart of `createAllToolsAsync()` that does NOT initialize
  MCP. Called by `WorkflowBridge.ensureOrchestrator()` so visual
  workflow tool nodes find their tools (the registry singleton was
  empty when accessed from outside a CodeBuddyAgent session).

### Added — Cowork (Hooks dry-run)

- **HTTP hook dry-run** (`cowork/src/main/hooks/hooks-bridge.ts`):
  `test()` now POSTs a synthetic body (`{tool:'sample',
  event:'PreToolUse', dryRun:true, cwd}`) with header
  `X-CodeBuddy-Hook-DryRun: 1`, AbortController-driven timeout, body
  capped at 64 KB, user-supplied `handler.headers` forwarded. The
  Test button in `SettingsHooks.tsx` now appears for both `command`
  and `http` types.

### Added — Server (cherry-pick from `feat/face-memory-cowork`)

- **Channel-A2A bridge** (`src/server/channel-a2a-bridge.ts`, 220 LOC,
  cherry-pick `f3b9b984`) — auto-loads channels from
  `.codebuddy/channels.json` and forwards inbound messages to the
  A2A router via HTTP self-call. Replaces the standalone
  `scripts/telegram_a2a_spoke.py` wrapper.

### Added — Cowork (presence)

- **Buffalo_S downloader scripts** (`cowork/scripts/download-buffalo-s.{ps1,sh}`,
  cherry-pick `15e1e9f8`) — idempotent CLI installers for the
  ArcFace ONNX model, complementing the in-app
  `ModelInstallDialog`. README rewritten to document all three
  install paths (in-app dialog, helper scripts, manual file picker).

### Tests

- **34 new Vitest cases** for the workflow pipeline:
  - 15 dag-compiler (linear, parallel, conditional, approval, loop,
    convergence + all rejection paths)
  - 8 cowork-tool-agent (tool_invoke, approval_wait lifecycle)
  - 6 workflow-bridge integration with a real `Orchestrator` core
    (covers the deadlock + listener-order regressions, V0.5 loop
    3-iter, V0.5 parallel-join)
  - 5 hooks-bridge HTTP dry-run (200, 404, timeout, invalid URL,
    custom headers)
- **9 new server/channel-a2a-bridge tests** (cherry-picked).

### Notes

- `rc.7` is **not tagged in this commit** — `release.yml` triggers on
  `v*` and would publish the *root* package (`@phuetz/code-buddy`),
  not Cowork. To release Cowork separately, either narrow the trigger
  in `release.yml` to `v*-cowork` or publish manually from the cowork
  workspace.

---

## [1.0.0-rc.6] — 2026-05-08

**Sixth release candidate** — multi-Claude fleet activation +
embodiment closure + V0.5 multi-agent enforcement. Eleven features
shipped over the May 7-8 session, organised in three stacked branches.

### Added — Cowork (face memory + UX)

- **Presence V0.5 — live titlebar identity** (`cowork/src/renderer/components/PresenceIndicator.tsx`).
  Main-process `PresenceBridge` events (`presence:detected/left/unknown/enrolled`)
  forwarded to the renderer via a new `presence:event` IPC channel. Zustand
  slice `currentPresence` drives a live "🟢 👋 {name} ({pct}%)" badge,
  unknown-face badge, and enrolled-count fallback.

- **Presence V0.6 — proactive greeting toast**. PresenceService tracks
  `lastGreetedPersonId`; first detection of a new person fires
  `addNotification({ title: '👋 Bonjour', body: '{name} est devant la caméra.' })`.
  Reset on `presence:left` so returning persons get re-greeted. Reset on
  service `stop()`.

- **Auto-download Buffalo_S UX** — `EnrollmentDialog` probes
  `presence.hasModel()` at open; if missing, opens `ModelInstallDialog`
  before taking the camera. The reactive fallback at the encode call
  site stays as a safety net.

- **OrchestratorLauncher wiring** (Phase d.17 frontend) — modal trigger
  for the multi-agent orchestrator, surfaced via the Sparkles button
  in Titlebar and Cmd/Ctrl+Shift+M.

### Added — Fleet & multi-AI orchestration (Phases (d).17 → (d).20)

- **Phase (d).17 — `peer_delegate` + `list_peers` LLM tools**. Two new
  tool-registry entries that let the LLM autonomously delegate a
  one-shot question to a connected fleet peer Code Buddy and read the
  response back in its tool result. Wraps `peer.chat` (Phase d.15).
  Anti-loop guards: `CODEBUDDY_PEER_ROLE=leaf` refusal, per-turn cap
  (default 5, env `CODEBUDDY_PEER_DELEGATE_MAX_PER_TURN`), depth cap
  via existing `MAX_DEPTH_EXCEEDED`. `<fleet>` system-prompt nudge
  injected when peer count > 0 (zero tokens otherwise). Refacto:
  `activeListeners` Map promoted to `src/fleet/fleet-registry.ts`
  singleton (17 references migrated, 43/43 fleet-handler regression
  tests intact). 28 new tests.

- **Phase (d).18 — Autonomous Fleet Protocol v0.1 (native TS port)**.
  `src/agent/autonomous/{fleet-task-types,fleet-tick-handler}.ts`
  ports the operational python wrapper
  `claude-et-patrice/tools/heartbeat_tick.py` (proven over 6 cycles
  on 2026-05-02). Pull → FLEET_PAUSE check → pickTask (priority
  cascade, critical SKIPPED for autonomous) → atomic claim → in-process
  agent run → scope guard → worklog → mark completed → push.
  TOML `[autonomous_fleet]` block + boot wiring in `codebuddy-agent.ts` +
  `/fleet autonomous status|tick-now` slash sub-commands. 26 new tests
  covering all outcomes (FLEET_PAUSE, dirty repo, claim_lost,
  out_of_scope rollback, timeout, priority threshold).

- **Phase (d).19 — `peer.chat-stream` V1.1**. Wire-level: new
  `peer:chunk` frame + `emitChunk` in `PeerMethodContext`. Server-side
  `peer.chat-stream` method calls `client.chatStream()` and pushes
  deltas via `ctx.emitChunk` while still returning the aggregated text
  in the final `peer:response`. Client-side
  `FleetListener.requestStream(method, params, onChunk, options)`
  routes per-request `peer:chunk` frames to the callback. Falls back
  to local aggregation when transport doesn't support streaming.
  9 new tests.

- **Phase (d).20 — Autonomous v0.2: Ollama spokes**.
  `resolveProviderFromEnv()` public helper on
  `peer-chat-client-factory.ts` returns `{ provider, apiKey, baseUrl,
  model, isLocal }` for non-`peer.chat` consumers (e.g.
  `CodeBuddyAgent`). New `FleetTask.preferLocal` hint +
  `WorklogFileEntry.{provider, model}` for cost audit. New
  `[autonomous_fleet].llm_provider` TOML field
  (`'cloud'` default V0.1 / `'auto'` / explicit provider id) +
  `resolveTickProvider()` priority cascade
  (`preferLocal` → `llm_provider` → GROK fallback). `/fleet autonomous status`
  shows resolved provider preview. 12 new routing tests.

### Added — Wake dormant code (Phase (d).21, three ships)

- **NotificationManager wake** (Tier D-1).
  `src/agent/proactive/notification-default-sink.ts` exposes
  `notify()` / `notifyQuick()` helpers that apply `shouldSend()` gates
  (channel allowlist, quiet hours, rate limit) and log via
  `logger.info`/`warn`. `wireDefaultNotificationSink()` boot-time
  registration. `agent-executor` fires a notification after every tool
  completion (low priority on success, high on failure). 8 new tests.

- **progress-tracker wake** (Tier D-2).
  `src/agent/planner/progress-default-sink.ts` exposes a process-level
  singleton + log-based default sink that emits at 25/50/75/100
  thresholds (avoids per-tool log spam).
  `agent-executor.runTurnLoop()` calls `progress.start(maxToolRounds)`
  at loop entry and `progress.update()` per tool completion. 8 new
  tests.

- **V0.5 metrics TTL enforcement** (Tier C-3). Replaces the warn-only
  branch in `enhanced-coordination.ts:enablePersistence()` with
  `await clearMetrics()` + `initializeMetrics()` reset when
  `ageDays > metricsTtlDays`. Stale metrics no longer bias allocation
  across process restarts. 5 new tests; existing
  `persistence-integration.test.ts` updated to assert the new
  enforcement behaviour.

### Tests

- 75+ new tests across the three branches; full session test count
  growth is 27,366 / 27,366 + audit follow-ups in V1.0.0 final.
- TypeScript clean (root + cowork); existing fleet/agent regression
  suites (43 + 44 + 18 + …) all green.

---

## [1.0.0-rc.5] — 2026-05-04

**Fifth release candidate** — convergence Manus AI. Two ships post-rc.4
that complete the persistence trilogy (auto-memory + lessons + writing
discipline) and adopt Manus AI's structured prompt blocks pattern. Both
ships followed the now-established "wake dormant code via system
directive + RAG always-include" recipe — 7th and 8th iterations of the
session pattern.

The session as a whole: 4 release candidates (rc.2 = 6 ships, rc.3 = 3
ships, rc.4 = 4 ships, rc.5 = 2 ships) = 15 functional commits + 4
release commits + 2 audit docs. The releases pattern is now an operating
rhythm: ship narrow → bump version → repeat.

### Added
- **`<writing_rules>` system prompt directive** — proactive output
  discipline inspired by Manus AI's structured prompt blocks pattern
  (gist `renschni/4fbc70b...`, May 2026 reverse-engineering of Manus AI).
  Complements `output-sanitizer.ts` (post-hoc strip) by instructing
  the LLM BEFORE generation: never emit control tokens (`<|im_start|>`,
  `<think>`, GLM-5 brackets, etc.), no zero-width chars, markdown
  structure (code fences with language hint, file:line references for
  navigability), no meta-commentary ("As an AI..."), no gratuitous
  emoji, prefer "I don't know" over fabrication. Always-on (no
  memoryEnabled gate — output discipline is universal). 4 new tests in
  `tests/services/prompt-builder.test.ts`. The 7th iteration of the
  "system directive narrow ship" pattern this session — closes the
  Manus AI structured-blocks gap (Option B; Option A = full refactor
  with `<browser_rules>`/`<shell_rules>`/`<system_capability>` blocks
  remains deferred V1.x as it requires extensive validation).

- **Lessons feature activation (Manus AI-inspired)** — system-prompt
  `<lessons_directive>` + RAG always-include for `lessons_add` /
  `lessons_search` + removal of the complexity gate that dropped lessons
  context on trivial multi-round queries. Mirror of the `a2a4f72`
  auto-memory activation pattern. The Manus AI-inspired feature
  (`src/agent/lessons-tracker.ts`, 405 lines) was complete but dormant —
  the LLM never proactively called the tools because no system directive
  told it WHEN. This ship surfaces the 4 categories
  (RULE / PATTERN / CONTEXT / INSIGHT) with explicit triggers ("after
  user correction", "before similar tasks search lessons first"), and
  differentiates `lessons_add` from `remember` (lessons = actionable
  patterns + rules; remember = facts + preferences). 4 new tests in
  `tests/services/prompt-builder.test.ts`. The 6th iteration of the
  "wake dormant code" pattern this session — completes the persistence
  trilogy: auto-memory (facts) + lessons (patterns) + ICM (cross-session
  episodic, managed elsewhere).

---

## [1.0.0-rc.4] — 2026-05-04

**Fourth release candidate**. Four ships post-rc.3 focused on the
**conversational subagent surface**: a fresh audit of Claude Code's
source (now available locally), Phase A+C implementation closing the
audit, two new user-facing slashes (`/subagent` for discovery,
`/swarm` for one-command team-lead spawning inspired by Korben's
article on Claude Code's hidden Swarms mode).

The releases pattern of the session continues: rc.2 (6 ships), rc.3
(3 ships), rc.4 (4 ships). All narrow, all tested, all building on
existing infrastructure rather than inventing new modules.

### Added
- **`/swarm <task>` slash command** — UX wrapper around the existing
  `MultiAgentSystem` (V0.4) that exposes the team-lead pattern in one
  memorable command. Forces strategy=parallel for the run, delegates
  to `/agents run`, restores the user's previous strategy in a finally
  block. Inspired by Korben's article on Claude Code's hidden Swarms
  mode (`tengu_brass_pebble` flag + `claude-sneakpeek` patch) — Code
  Buddy ships the infrastructure built-in (`WorkflowOrchestrator` +
  `ParallelSubagentRunner`, max 10 workers), so no patching needed.
  Sub-actions: `/swarm <task>` (dispatch), `/swarm stop`, `/swarm status`,
  `/swarm help`. Two new internal helpers exported from agents-handler:
  `_peekActiveStrategy` / `_setActiveStrategy` (underscore-prefixed,
  not for user-facing slash). 11 new tests (mocking handleAgents +
  strategy state). Documentation added to `getting-started.md` under
  "Local swarm (no peers needed)" — pointers from Fleet section so
  users discover both options together.

- **`/subagent` slash command + `code-reviewer` hardening** — surfaces
  the `PREDEFINED_SUBAGENTS` registry to users. `/subagent list` shows
  the 7 predefined subagents (Explore, code-reviewer, debugger, etc.)
  with their tools whitelist + disallowedTools blacklist; `/subagent
  info <name>` shows full details including system prompt preview.
  Read-only handler (no spawn — main agent handles spawning via tool).
  Closes the UX gap that left the `Explore` subagent shipped in `4ae5a07`
  invisible to users (`/agent` is for custom agents, `/agents` for
  MultiAgentSystem; `/subagent` is the new third surface for the
  conversational subagents). Bonus: `code-reviewer` now has the same
  `disallowedTools` blacklist treatment as Explore (defense-in-depth
  against custom configs that might extend the whitelist), plus a
  short READ-ONLY MODE statement at the top of its system prompt.
  11 new handler tests + 1 new code-reviewer test.

- **`Explore` subagent (read-only-strict) + `disallowedTools` field on
  `SubagentConfig`** — implements **Phase A + Phase C** of the Claude Code
  subagent audit (`AUDIT-CLAUDE-CODE-SUBAGENT-2026-05-04.md`). Reuses the
  existing `src/agent/subagents.ts` infrastructure (already had
  `SubagentManager`, `ParallelSubagentRunner`, whitelist filtering — turns
  out Code Buddy's subagent infra was more mature than I'd realized).
  Three reinforcements:
  1. New `disallowedTools?: string[]` field on `SubagentConfig` —
     defense-in-depth blacklist applied AFTER the whitelist filter in
     `Subagent.run()`. Pattern from Claude Code's
     `BuiltInAgentDefinition.disallowedTools` (exploreAgent.ts:67-73).
  2. New `"Explore"` (capital-E) entry in `PREDEFINED_SUBAGENTS` with
     a strict READ-ONLY MODE system prompt (adapted from Claude Code's
     `exploreAgent.ts:13-57`), `tools: ["view_file", "search"]` whitelist,
     and `disallowedTools: ["bash", "str_replace_editor", "create_file",
     "apply_patch", "delete_file"]` blacklist.
  3. Legacy `"explorer"` lowercase alias kept for backward compat AND
     gets the same hardening (was a silent loophole pre-rc.4: bash was
     in the whitelist so `mkdir`/`rm` worked on a "read-only" agent).
  10 new tests (`tests/agent/subagents-explore-readonly.test.ts`).
  60/60 existing subagent tests still pass. Phase B (architectural
  enforcement layer) deferred — the whitelist+blacklist combo covers
  enforcement needs for V1.

### Audit shipped
- **Claude Code subagent + plan mode audit**
  (`claude-et-patrice/propositions/AUDIT-CLAUDE-CODE-SUBAGENT-2026-05-04.md`,
  268 lines) — 3rd iteration of the audit-doc pattern, this time with
  direct access to the Claude Code source (`D:\CascadeProjects\claude-code-source-code-main`).
  Audited 4 zones: plan mode workflow phasé (⚠️ partial), structured user
  questions (✅ complete parity), subagent specialization (⚠️ partial — the
  central gap), background scheduling (⚠️ partial). Identifies 3-phase
  adaptation roadmap; **Phase A + Phase C shipped in this release** via
  the Explore subagent + disallowedTools field above. Pattern produced
  5 ships across the 3 audits done this session.

### Notes for V1 final (1.0.0)
Same items as rc.3, narrowed by what shipped here:
- Live smoke test of `peer.chat` with ≥2 providers on ≥2 hosts still
  pending (operator validation, hub-pull blocker on Ministar Linux)
- `withStreamRetry` activation by default deferred until ≥1 week of
  opt-in observation without regressions
- Migration of `agent-executor.ts:636` and `:844` to `getCuratedHistory()`
  deferred (would close the latent compression-without-repair gap)
- Phase B of the subagent audit (architectural enforcement layer)
  deferred — the whitelist+blacklist combo covers V1 needs
- Vue agrégée des 7 sources mémoire deferred
- Mode `buddy init --update` deferred
- `/swarm` shared task board between subagents deferred (TodoWrite is
  main-agent only)

---

## [1.0.0-rc.3] — 2026-05-04

**Third release candidate**. Three follow-up ships after rc.2 closing the
final Gemini CLI audit recommendation, surfacing the auto-memory feature
in `/status`, and turning `getting-started.md` into an actionable
playbook so new users (and other Claudes discovering the project) can
be productive in 5 minutes.

### Added
- **`MessageHistoryManager.getComprehensiveHistory()` /
  `getCuratedHistory()`** (`d7472e1`) — explicit raw-vs-curated
  distinction at the facade layer (`src/agent/facades/message-history-manager.ts`).
  Closes the **third and final** Gemini CLI audit recommendation
  (`AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md` reco #3) — all 3 of 3
  recommendations now shipped (recos #1 + #2 closed in rc.2 via
  `cd653ab`/`2a06864`/`7ec4bc0`). Comprehensive returns raw stored
  history (debug, audit). Curated applies `repairToolCallPairs()` from
  `src/context/transcript-repair.ts` — orphan tool_results removed,
  lost tool_calls get synthetic `[result lost during compaction]` stubs.
  Compression is intentionally NOT applied (model-specific, lives in
  `ContextManagerV2`). Internal state never mutated. **Additive only**:
  no existing callers migrated (deferred V1.0.0 final to limit blast
  radius). Posed the foundation for the T6 test backlog: 9 new tests in
  `tests/agent/facades/message-history-manager.test.ts` — first
  dedicated test file for this facade.
- **`/status` Memory section** (`0afc199`) — extended the existing
  `handleStatus` (`src/commands/handlers/missing-handlers.ts:837`)
  with a one-line Memory dashboard cell showing `N project • N user •
  last update: …`. Surfaces the auto-memory writeback (rc.2 `a2a4f72`)
  without typing `/memory recent`. Silent skip on missing data
  (memory section is best-effort, never blocks the rest of the
  dashboard from rendering). 4 new tests covering empty state,
  populated state with relative time, error fallback, and footer hint.
- **`docs/getting-started.md` extensions** (`dc1f7eb`) — entry doc
  extended from 122 → 244 lines. Three new sections close the
  "Code Buddy utilisable + les Claudes peuvent l'utiliser pour
  dialoguer" gap Patrice explicitly flagged:
  - **Auto-memory** — explains the proactive `remember` writeback
    with concrete examples and inspection commands. Mirrors the
    Claude Code MEMORY.md UX pattern.
  - **Talking to other Claudes (Fleet)** — 30-second quickstart
    (`buddy server` listener side, `/fleet listen ws://...` peer side).
    Calls out the two stated objectives (real-time inter-AI
    collaboration + pilot local LLMs from any peer over Tailscale).
    Points to `fleet-guide.md` for depth.
  - **Troubleshooting** — 9 issues with diagnosis + fix (401, ESM,
    slow startup, stale lock files, permission prompts, memory not
    persisting, fleet AUTH_FAILED, fleet drops, ripgrep, mid-stream
    errors). Plus pointers to `buddy doctor`, `fleet-guide.md`,
    CHANGELOG, GitHub Issues.

### Notes for V1 final (1.0.0)
Same items as rc.2, narrowed by what shipped here:
- Live smoke test of `peer.chat` with ≥2 providers on ≥2 hosts still
  pending (operator validation, hub-pull blocker on Ministar Linux)
- `withStreamRetry` activation by default deferred until ≥1 week of
  opt-in observation without regressions
- Migration of `agent-executor.ts:636` and `:844` to `getCuratedHistory()`
  deferred (would close the latent compression-without-repair gap but
  touches the agentic loop core)
- Vue agrégée des 7 sources mémoire deferred
- Mode `buddy init --update` deferred
- `/memory recent` color polish deferred (small follow-up)

---

## [1.0.0-rc.2] — 2026-05-04

**Second release candidate**. Six narrow ships during a single session
focused on three axes Patrice flagged: agentic loop hardening, memory
management ("très important"), and cross-CLI fleet alignment.

### Added
- **Auto-memory writeback** (`a2a4f72`) — system-prompt directive teaches
  the LLM when to call the `remember` tool; RAG selector force-includes
  it in the always-available list. The LLM now proactively persists user
  preferences, architectural decisions, and non-obvious gotchas to
  `.codebuddy/CODEBUDDY_MEMORY.md` (project) or `~/.codebuddy/memory.md`
  (user) without explicit user intervention. Same UX pattern as Claude
  Code's auto-managed `MEMORY.md`. Gated on `memoryEnabled +
  persistentMemory` being wired (no-op when the markdown backend is
  absent).
- **`/memory recent [N] [scope?]`** (`b2424cc`) — recency view on the
  persistent memory store. Shows the last N entries (default 10, max 50)
  sorted by `updatedAt` desc, with relative timestamps ("2 minutes ago")
  and category. Scope filter (`project` | `user`) optional. UX surface
  for the auto-memory feature: Patrice can see in one command what the
  LLM just persisted and `/memory forget` what is noise.
- **`AGENTS.md` cross-CLI scaffold** (`841bd0b`) — `buddy --init` now
  generates `AGENTS.md` at the project root. This is the emergent
  cross-CLI convention file read by Claude Code, Gemini CLI 0.20+,
  Cursor, Codex, and Code Buddy itself (already wired in
  `jit-context.ts` and `bootstrap-loader.ts`). Minimal "30-second
  first-glance" guide with build/test/lint commands, conventions,
  architecture, and pointers to `.codebuddy/CONTEXT.md` /
  `.codebuddy/CODEBUDDY.md` for detail. Idempotent (skip on re-run,
  `--force` overwrites). Lives at root so it is committed alongside
  the codebase, not gitignored under `.codebuddy/`.
- **`withStreamRetry` helper** (`cd653ab`) — pure async-generator wrapper
  with exponential backoff retry on retryable network errors
  (ECONNRESET, ETIMEDOUT, "socket hang up", undici stream terminated).
  Default predicate covers Node network codes + undici / fetch error
  names; non-retryable errors (auth, validation, 4xx semantic) propagate
  immediately. AbortSignal-aware. Standalone module
  (`src/codebuddy/stream-retry.ts`), 26 tests covering happy path,
  retry-then-succeed, exhaustion, custom predicate, exponential backoff
  timing (with fake timers), abort during retry wait. Derived from the
  comparative audit Gemini CLI vs Code Buddy
  (`AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md`, recommendation #1).
- **`processUserMessageWithStreamingEvents`** (`7ec4bc0`) — new
  collector method on `agent-executor.ts` that returns
  `{ entries, streamingEvents }`, allowing sequential callers to access
  streaming-only events (`ask_user`, `tool_stream`, `token_count`,
  `reasoning`, `steer`) that the existing `processUserMessage` silently
  drops. Backward compat: existing method unchanged. Closes Gemini CLI
  audit recommendation #2.

### Changed
- **`CodeBuddyClient.chatStream`** (`2a06864`) — wraps the dispatch
  (Gemini-native or OpenAI-compat strategy) in a generator factory and
  applies `withStreamRetry` when opt-in is active. Opt-in resolution
  order: per-call `ChatOptions.streamRetry` (boolean or
  `{ maxAttempts, initialDelayMs, maxDelayMs }`) wins when explicitly
  set (including `false`), else env var `CODEBUDDY_STREAM_RETRY=1`,
  else no retry. Default off — full backward compat. Trade-off
  documented: a retried stream restarts from the beginning, so callers
  see duplicated chunks across the retry boundary (matches Gemini CLI
  behavior; true delta-resume requires LLM-level support not available
  today). 6 wirage tests on top of the 26 helper tests.
- **`ChatOptions`** — new optional `streamRetry?: boolean | {…}` field
  documenting the per-call opt-in path and the env var fallback.

### Fixed
- **`alwaysInclude` propagation in tool selector** — `getRelevantTools`
  in `src/codebuddy/tools.ts` accepted the option but silently dropped
  it before reaching `selectRelevantTools` (the convenience function in
  `src/tools/tool-selector.ts:778` only forwarded `maxTools`). Strategy
  callers like `tool-selection-strategy.ts` thought their `alwaysInclude`
  list was honored — silently was not. Fixed by extending the
  `selectRelevantTools` signature with `alwaysInclude?: string[]` and
  propagating through `getRelevantTools`. Latent bug, surfaced while
  shipping auto-memory (`remember` had to be force-included for RAG to
  always show it).

### Audit follow-ups closed
Post-Gemini-CLI-source audit
(`claude-et-patrice/propositions/AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md`):
- Reco #1 (mid-stream retry exponential backoff) — helper `cd653ab` +
  wirage `2a06864`
- Reco #2 (streaming events visibility in sequential mode) — `7ec4bc0`
- Reco #3 (history curation explicit `getComprehensiveHistory` vs
  `getCuratedHistory`) — deferred V1.x

### Notes for V1 final (1.0.0)
- Live smoke test of `peer.chat` with ≥2 providers on ≥2 hosts still
  pending (operator validation, hub-pull blocker on Ministar Linux)
- `withStreamRetry` activation by default deferred until ≥1 week of
  opt-in observation without regressions
- Vue agrégée des 7 sources mémoire deferred (Persistent + Enhanced +
  Lessons + Decision + KG + ICM + Auto-capture)
- Mode `buddy init --update` (preserve user edits via marker comments)
  deferred — needs structural markers in generated files
- Smoke test E2E auto-memory deferred (full agent boot too costly)

---

## [1.0.0-rc.1] — 2026-05-04

**Release candidate**. Signal that Code Buddy is approaching its first
stable major release. The core feature set is now complete:
- Multi-provider AI agent (15 providers via OpenAI-compat routing,
  plus native Gemini, plus Ollama/local)
- Multi-agent orchestration (V0.4.1 with conflict auto-resolve,
  adaptive allocation, WorkflowOrchestrator)
- **Multi-AI fleet hub** (Phases (d).1 → (d).16a) — peers can
  `/fleet listen` to each other's events and `/fleet send peer.chat`
  to invoke each other's LLMs over WebSocket
- Comprehensive test plan T1-T5 closed (CRITIQUE-priority modules
  at ≥93% coverage)
- Two source-comparative audits (OpenClaw v2026.3.x → v5.2 + Claude
  Code source compaction) feeding actionable improvements
- 27 500+ tests passing across the repo

### Added in 1.0.0-rc.1 (V1-readiness phases)
- **V1.1** (`50dd511`): Initial CHANGELOG.md (Keep-a-Changelog format)
  covering 0.4.x → 0.5.0 → 0.5.0-fleet-infrastructure → 0.5.1-fleet
- **V1.2** (`a968695`): `docs/fleet-guide.md` — comprehensive guide for
  the multi-AI hub: 2 stated objectives (real-time inter-AI collaboration
  + pilot local LLMs), all slash commands, all peer-rpc methods, env
  config, lab examples, smoke test recipe, security model, V1.x roadmap
- **V1.3** (`b3fc4e8`): Wire adaptive auto-compact helper as opt-in
  config flag `useAdaptiveBuffer`. Default false (backward compat).
  Closes the loop on audit fix #1.
- **V1.4** (`a74bbb1`): Underscore-prefix 8 pre-existing unused-var
  lint warnings (server/index.ts catch params + smart-compaction.ts
  unused fn args). Mechanical fix, 0 behavior change.
- **V1.5** (this commit): Version bump 0.5.0 → 1.0.0-rc.1.
  README.md mentions the fleet hub in the lead paragraph.
  CLAUDE.md header notes the V1 RC status. CHANGELOG.md adds this
  entry.

### Notes for V1 final (1.0.0)
Going from rc.1 to 1.0.0 requires:
- Live smoke test of `peer.chat` with at least 2 different providers
  on at least 2 different hosts (operator validation)
- Optional: rate cap (d).16b if burn-rate problems are observed live
- Optional: audit Gemini CLI source / Codex source for one more round
  of comparative improvements
- Operator decision (Patrice) on the cut date

The rc.1 ship is intentional: signal the V1 intent without
pre-committing to "stable" before live multi-host validation.

---

### Backlog (not yet shipped)

- **Streaming `peer.chat-stream`** (V1.1) — current `peer.chat` is one-shot
  request/response. Streaming will let consumers see tokens as they arrive.
- **Multi-tour `peer.chat-session`** (V1.2) — `start` / `continue` / `end`
  for stateful conversations between peers.
- **Rate cap `peer.chat`** ((d).16b) — deferred until burn-rate problems
  observed live; the Gemini Ultra quota (~50M tokens/month) is generous
  enough to test without one for now.
- **Audit Gemini CLI source / Codex source** — applies the same
  comparative-audit pattern (used for Claude Code source) to other
  open-sourced agent runtimes.
- **Live smoke tests** for `peer.chat` with real provider keys (manual
  validation by the operator after each release).

---

## [0.5.1-fleet] — 2026-05-04

The fleet inter-Claude shipped its first **business method**: peers
can now ask each other's LLM a one-shot question via
`/fleet send <peer> peer.chat`. Plus two follow-up fixes derived from
a comparative audit against Claude Code source code (publicly released
~one month ago, ~50,000 GitHub forks).

### Added

- **Peer RPC routing — Phase (d).15** (`4876142`):
  - `peer:request` / `peer:response` WS frames with id-correlation map
  - Built-in methods registered at boot: `peer.describe`, `peer.ping`,
    `peer.echo`
  - `FleetListener.request(method, params, options?)` API with
    REQUEST_TIMEOUT (default 30s), AUTH_FAILED, NOT_OPEN, DISCONNECTED
    error codes
  - New `peer:invoke` ApiScope (paired with the existing `fleet:listen`)
- **Env-driven multi-provider peer.chat client wiring — Phase (d).16a**
  (`568ceda`):
  - `createPeerChatClientFromEnv()` factory auto-detects which provider
    keys are present at server boot, in priority order:
    `CODEBUDDY_PEER_PROVIDER` override → `OLLAMA_HOST` → `GROK_API_KEY`
    → `ANTHROPIC_API_KEY` → `GOOGLE_API_KEY`/`GEMINI_API_KEY` →
    `OPENAI_API_KEY`. Local first to spare cloud quotas.
  - `wirePeerChatBridge()` now accepts a `providerInfo` second arg,
    surfaced via `peer.describe.peerChatProvider` so remote Claudes can
    discover which LLM lives behind a given peer.
  - `apiVersion` bumped from `d.15` to `d.16` in `peer.describe`.
- **Adaptive auto-compact threshold helper** (post-audit fix #1,
  `09d47d7`):
  - New `src/context/auto-compact-threshold.ts`. Pure module exposing
    `computeAutoCompactThreshold(maxContextTokens, model?, options?)`
    and `pickBufferTokens(model, options?)`.
  - Per-model buffer table (Claude Opus 16K, Sonnet 13K, Haiku 8K,
    Gemini Pro 13K, Flash 10K, Grok-3 12K, Grok-4 14K, etc.) with
    case-insensitive substring matching.
  - Resolution priority: explicit `bufferTokens` > per-call
    `bufferTokensByModel` > env `CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS`
    > default table > fallback.
  - Helper not yet wired into `ContextManagerV2.shouldAutoCompact`
    (deferred to V1.3 to stay narrow).

### Fixed

- **Tool pair preservation in truncation** (post-audit fix #3,
  `c05b5ea`): when `SmartCompactionEngine.truncateMessages` cuts the
  conversation between an assistant `tool_use` and its matching
  `tool_result`, downstream `validateToolCallOrder()` would silently
  strip the orphan. New pure helper `preserveToolPairs(kept, original)`
  re-injects the missing parent in original-order position. Pair
  integrity > strict budget compliance.

### Changed

- `peer.describe` payload now includes `peerChatProvider`
  (`{ provider, model, isLocal } | null`) so consumers can probe which
  LLM/model a peer will use before sending `peer.chat`.

### Tests

- 11 new tests for `peer-chat-bridge` ((d).15)
- 18 new tests for `peer-chat-client-factory` ((d).16a)
- 12 new tests for `tool-pair-preserver` (audit fix #3)
- 33 new tests for `auto-compact-threshold` (audit fix #1)

Total **874+ tests across `tests/server/` + `tests/gateway/` +
`tests/fleet/` + `tests/context/`**. Typecheck clean. Lint clean on
all touched files.

### Source audit

The comparative audit Claude Code source vs Code Buddy
SmartCompactionEngine is archived in
[`claude-et-patrice/propositions/AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md`](https://github.com/phuetz/claude-et-patrice).
3 actionable improvements identified — #3 and #1 shipped, #2 (preview
mode before apply, M scope) deferred to `1.0.0` final.

---

## [0.5.0-fleet-infrastructure] — 2026-05-03

The day the inter-Claude fleet became real. 16 narrow phases shipped
in a single working day, plus 5 critical-priority test files. The
hardware setup (DARKSTAR PC 3090, MINISTAR G7 PT, Ministar Linux Ryzen
AI 9 HX 470) and Tailscale mesh (`100.x.x.x` private network) became
the first operational multi-AI hub on the lab.

### Added — Fleet inter-Claude (Phases (d).1 → (d).14)

- **Phase (d).1** (`d108d9b`): Server-side `fleet:*` event broadcast
  surface gated on the new `fleet:listen` ApiScope. WS plumbing only.
- **Phase (d).2** (`1fa6798`): `agent-executor` broadcasts tool exec
  events (`tool_started`, `tool_completed`, `tool_error`) to the fleet.
- **Phase (d).3** (`8632314`): `MultiAgentSystem` broadcasts workflow
  lifecycle events (`start`, `event`, `complete`).
- **Phase (d).4** (`1ff86f7`): Subagent session events (`spawn`,
  `message`) added to the fleet bus.
- **Phase (d).5** (`fa7432c`): Receiver side. `FleetListener` client +
  `/fleet listen` slash command.
- **Phase (d).6** (`98664d8`): `FleetListener` auto-reconnect with
  exponential backoff via the shared `ReconnectionManager`.
- **Phase (d).7** (`783157f`): Server-side broadcast backpressure with
  drop-on-overflow. Per-client `bufferedAmount` ceiling.
- **Phase (d).8** (`263dcf1`): Mirror of (d).7 for the Gateway WS
  surface (`src/gateway/ws-transport.ts`).
- **Phase (d).9** (`24f3031`): Peer presence beacon — periodic
  `fleet:peer:heartbeat` + `lastSeen` tracker + `⚠ stale` flag in
  `/fleet status`.
- **Phase (d).10** (`9b623b1`): Compaction lifecycle notices —
  `fleet:peer:compacting:start` / `:complete` bridged from
  `SmartCompactionEngine` events.
- **Phase (d).11** (`acc918a`): In-memory event history ring +
  `/fleet history [N] [--peer <name>]` slash.
- **Phase (d).12** (`f2a7a5a`): Multi-peer fan-in. `/fleet listen` can
  now hold N concurrent peers via a `Map<peerId, ActiveListener>`.
  Replaces the V0.4.1 single-peer singleton. New `--name <id>` arg.
- **Phase (d).13** (`6ede944`): Peer RPC routing. `/fleet send <peer>
  <method>` for active request/response between peers (mirror of
  OpenClaw's `node.invoke`, audited 2026-05-04).
- **Phase (d).14** (`9ca5b7e`): Role taxonomy + spawn depth cap +
  trace propagation. `CODEBUDDY_PEER_ROLE=main|orchestrator|leaf`,
  `CODEBUDDY_PEER_MAX_DEPTH` (default 3), `traceId` propagation
  end-to-end. Closes recursive-spawn risk.

### Added — Test plan T1-T5 (CRITIQUE coverage)

Audit-driven test plan, 5 zones identified as critical-without-coverage:

- **T1 — `permission-modes.ts`** (`9e9cd8f`): 38 tests, **100%
  coverage** all axes (statements / branches / funcs / lines).
- **T2 — `agent-context-facade.ts`** (`f9daa2b`, re-cadré ex-T3): 27
  tests, 100% lines, 91% branches. Lazy-init contract validated.
- **T3 — `model-routing-facade.ts`** (`88e4ea0`): 39 tests, 100% all
  axes. resolveModelForIntent priority cascade fully exercised.
- **T4 — `prompt-builder.ts`** (`a80d0ef`): 22 tests, 93% lines.
  Truncation budget guard validated incl. 32K hard cap edge.
- **T5 — `infrastructure-facade.ts`** (`3f4a224`): 17 tests, 96% lines.
  initializeMCP fire-and-forget paths covered.

Note on T2 re-cadrage: the original test plan T2 was `write-policy.ts`,
but it was already at 100% coverage with 19 existing tests (audit false
negative). Promoted T3 to T2 and shifted the rest.

### Source audits (2026-05-03)

Two comparative audits informed the design choices:

- **OpenClaw `v2026.3.14` → `v2026.5.2`** (general-purpose agent,
  ~25k tokens): identified 3 alignement bricks for inter-AI harmony —
  presence beacon (mirrored in (d).9), compaction notices (mirrored
  in (d).10), role taxonomy (mirrored in (d).14).
- **OpenClaw `node.*` RPC pattern** (Explore agent, ~15k tokens):
  request/response correlation map, `node.invoke` envelope, capabilities
  discovery — all mirrored in (d).13.

---

## [0.5.0] — 2026-04-27 to 2026-05-02

Multi-agent V0.3 → V0.4.1 phases + A2A protocol POC + Ollama spoke
infrastructure. Set the stage for the fleet inter-Claude work that
followed.

### Added — Multi-agent V0.3 → V0.4.1

- **Phase H+I+J+K (V0.3)**: Sessions wake-up, ConfirmationService gates,
  per-task checkpoint resume, persistent workflow state.
- **Phase L (V0.4)** (`647ba58`): Cost tracking + budget cap with
  graceful workflow interrupt.
- **Phase M (V0.4.1)** (`9ae6a65`): Conflict auto-resolve, narrow
  scope (`prefer-reviewer` / `code_overlap`), losing tasks blocked.
- **Phase N (V0.4.1)** (`62c31ef`): Adaptive allocation cross-session
  persistence (`~/.codebuddy/agents/metrics.json` schema v0.4).
- **Phase O (V0.4.1)** (`3bfe829`): `WorkflowOrchestrator` for
  concurrent + queued workflows.

### Added — A2A protocol POC (Niveau 1 → 3)

- POC Niveau 1: Spoke registration via `POST /api/a2a/agents/register`
  + heartbeat. Hub at Ministar Linux `100.98.18.76:3000`.
- POC Niveau 2 (`6bf7349`): Cross-host task router forwarding to remote
  spokes via HTTP.
- POC Niveau 3 (`677a146`): Skill-based routing dispatch on
  `/tasks/send`. Smart skill selection (`074fd3d`).

### Added — Ollama spoke infrastructure

- `world-model/scripts/ollama_a2a_spoke.py` (Python wrapper, ~150 LOC):
  transforms a local Ollama instance into an A2A-compliant spoke that
  registers with the hub and answers task forwards.
- Defensive fixes: cross-platform hostname, `--name`/`--url` overrides,
  nested A2A text payload extraction.

### Added — OpenClaw alignment audit (waves 1-4)

7 phases per wave, each ~3-5 commits, importing the most relevant
patterns from OpenClaw `v2026.3.x` releases — context engine pluggable,
ACPX sessions, browser batch + profiles, Slack Block Kit, Gateway TLS
skip, backup CLI, Docker timezone, env blocklist, transcript repair,
cron session binding, gateway health monitor, plugin describeMessageTool,
Feishu cards + reasoning, output sanitizer, gateway WS origin
hardening (GHSA-5wcw-8jjv-m286), image content pruning, provider
plugin onboarding, `config set` command, per-agent params,
`doctor --fix`, `CODEBUDDY_CLI` env, `update --tag`, `/btw` slash,
`sessions_yield`, Firecrawl, pluggable sandbox backends, extension
relay removal, provider-bundled plugins, `imageGenerationModel`
config, `/plugin` singular, multiple security fixes.

---

## [0.4.x] — 2026-mars

Pre-fleet era. ~1,300 commits worth of refactor work, Cowork desktop
GUI integration, RTK Windows fix, ICM bridge wiring, security audits
(2026-03-07, 2026-03-10, 2026-03-11), 60+ test files fixed. Audit
OpenClaw initial waves identified the path that led to 0.5.0.

Highlights:

- Code Buddy V4 status (V4.1 + V4.3 + V4.4 livrées, V4.2/V4.5+ déférés)
- Heartbeat tick (`tools/heartbeat_tick.py`) for autonomous fleet
- DailyReset reactivation
- 8 built-in agents: PDF, Excel, DataAnalysis, SQL, Archive,
  CodeGuardian, SecurityReview, SWE
- Multi-agent system foundations

The full pre-0.5 history is preserved in git log; this CHANGELOG
starts the structured record at 0.5.0.

---

## Notes for fleet Claudes

When pulling this branch on DARKSTAR / MINISTAR / Ministar Linux:

1. `git pull --rebase` to get the latest fleet phases + post-audit fixes
2. Restart your `codebuddy-a2a.service` (or equivalent) to pick up
   the new server-side handlers (peer-rpc, peer-chat-bridge,
   compaction-bridge, heartbeat-broadcaster)
3. Check the new env vars in `docs/fleet-guide.md` (if you want to
   activate `peer.chat` as a real LLM endpoint, set
   `GOOGLE_API_KEY` / `GROK_API_KEY` / `ANTHROPIC_API_KEY` /
   `OPENAI_API_KEY` or `OLLAMA_HOST`)
4. Smoke test cross-host: from one peer,
   `/fleet listen ws://<other-host>:3000/ws --auto-reconnect --api-key $K`
   then `/fleet send (default) peer.describe` should return the other
   peer's hostname + provider info.

Fleet is the major V1-defining feature. All other infrastructure is
mature and stable.
