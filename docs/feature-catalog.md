# Code Buddy features

Computed status after rebasing on P8 and the P9 follow-up: **185 proven, 8 failed, 145 unknown**, across all 338 entries. The tables below cover the 91 curated entries; historical traces with changed sources do not establish the current revision. Use `buddy catalog status --json` for recalculated status.

This catalogue covers **91 curated user-facing capabilities** in the current source checkout. “Wired” means the source files and declared entrypoint checks exist. “Tested locally” means a real command or agent turn ran under an isolated HOME and has a trace. No feature is claimed as deployed from this checkout. Benefits describe what the wired capability is intended to offer; live evidence covers only the scenario named in its trace.

Evidence: [static wiring audit](preuves/verification-statique.md) · [catalogue status trace](preuves/p5-catalog-status-2026-09-29.log).

## Agent and tools

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `resource-catalog-tool` — Outil de sélection des ressources | Find available resources for an agent task. | **Tested locally** | [Run trace](preuves/p5-resource-catalog-tool-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#resource-catalog-tool) |
| `cli-code-explorer` — Code Explorer integration | Inspect code relationships and session sync. | **Tested locally** | [Run trace](preuves/p9r2-cli-code-explorer-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#cli-code-explorer) |
| `cli-tools` — Tool availability | Inspect effective tools and tool profiles. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-tools-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-tools) |
| `cli-autonomous-code` — Guarded coding cell | Run a guarded autonomous coding contract. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-autonomous-code.log); [Wiring checks](preuves/verification-statique.md#cli-autonomous-code) |
| `cli-dev` — Developer workflows | Run guided plan, implementation and verification flows. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-dev.log); [Wiring checks](preuves/verification-statique.md#cli-dev) |
| `cli-skills` — Installed skills | List installed skill packages and their origin. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-skills-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-skills) |
| `cli-bundles` — Skill bundles | Group skills under a named command. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-bundles-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-bundles) |
| `cli-lsp` — LSP diagnostics | Inspect language-server diagnostics. | **Tested locally** | [Run trace](preuves/p9r1-cli-lsp-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#cli-lsp) |
| `tool-web-search` — Web search | Retrieve web search results for an agent task. | **Tested locally** | [Run trace](preuves/p8-tool-web-search.log); [Wiring checks](preuves/verification-statique.md#tool-web-search) |
| `tool-browser` — Browser automation | Navigate pages through an agent browser tool. | **Tested locally** | [Run trace](preuves/p7-tool-browser.log); [Wiring checks](preuves/verification-statique.md#tool-browser) |
| `tool-deep-research` — Deep research | Prepare a sourced multi-step research report. | **Tested locally** | [Run trace](preuves/p8-tool-deep-research.log); [Wiring checks](preuves/verification-statique.md#tool-deep-research) |
| `tool-verify` — Verification tool | Ask the agent to verify a concrete result. | **Tested locally** | [Run trace](preuves/p9-tool-verify-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#tool-verify) |
| `agent-loop` — Agent tool loop | Continue a request across model replies and tool results. | **Tested locally** | [Run trace](preuves/p5-agent-loop-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#agent-loop) |
| `tool-read-file` — File reading | Let the agent read a workspace file before answering. | **Tested locally** | [Run trace](preuves/p5-tool-read-file-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#tool-read-file) |
| `context-tool-selection` — Tool selection | Select task-relevant tools while retaining tool search. | **Tested locally** | [Run trace](preuves/p7-context-tool-selection.log); [Wiring checks](preuves/verification-statique.md#context-tool-selection) |

## Providers and failover

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-auth-profile` — Authentication profiles | Manage provider authentication profiles. | **Evidence needs renewal** | [Historical trace](preuves/p8-cli-auth-profile.log); [Wiring checks](preuves/verification-statique.md#cli-auth-profile) |
| `provider-ollama` — Local Ollama provider | Use a locally served model without a paid API key. | **Tested locally** | [Run trace](preuves/p5-provider-ollama-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#provider-ollama) |
| `provider-failover` — Provider failover | Switch to a configured provider when an eligible failure occurs. | **Tested locally** | [Run trace](preuves/p9-provider-failover-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#provider-failover) |
| `provider-chatgpt-oauth` — ChatGPT OAuth provider | Use a ChatGPT authenticated Responses backend. | **Unproven here** | [Wiring checks](preuves/verification-statique.md#provider-chatgpt-oauth) |
| `provider-gemini-cli` — Gemini CLI provider | Use a local Gemini CLI subprocess as a model route. | **Tested locally** | [Run trace](preuves/p9-provider-gemini-cli-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#provider-gemini-cli) |
| `provider-agy-cli` — AGY CLI provider | Use an AGY CLI subprocess as a model route. | **Unproven here** | [Wiring checks](preuves/verification-statique.md#provider-agy-cli) |

## Context and memory

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-curator` — Local curator | Review proposed maintenance for memory, skills and costs. | **Evidence needs renewal** | [Historical trace](preuves/p6-cli-curator.log); [Wiring checks](preuves/verification-statique.md#cli-curator) |
| `cli-identity` — Agent identity files | Manage local agent identity and user files. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-identity-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-identity) |
| `cli-session` — Saved sessions | Manage stored conversations and resumes. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-session-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-session) |
| `cli-user-model` — User preference model | Review a structured model of work preferences. | **Evidence needs renewal** | [Historical trace](preuves/p6-cli-user-model.log); [Wiring checks](preuves/verification-statique.md#cli-user-model) |
| `context-compaction` — Context compaction | Keep long conversations within a model context budget. | **Tested locally** | [Run trace](preuves/p6-context-compaction.log); [Wiring checks](preuves/verification-statique.md#context-compaction) |
| `memory-ckg` — Collective knowledge graph | Recall shared knowledge through the CKG. | **Tested locally** | [Run trace](preuves/p6-memory-ckg.log); [Wiring checks](preuves/verification-statique.md#memory-ckg) |
| `context-checkpoints` — Session checkpoints | Create checkpoints and rewind agent changes. | **Tested locally** | [Run trace](preuves/p7-context-checkpoints.log); [Wiring checks](preuves/verification-statique.md#context-checkpoints) |

## Fleet

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `fleet-cli` — Commandes de la flotte | Inspect and operate the multi-agent fleet from the terminal. | **Evidence needs renewal** | [Historical trace](preuves/p6-fleet-cli.log); [Wiring checks](preuves/verification-statique.md#fleet-cli) |
| `cli-ruche` — Signed coordination | Exchange signed coordination messages. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-ruche.log); [Wiring checks](preuves/verification-statique.md#cli-ruche) |
| `cli-device` — Remote device nodes | Manage SSH, ADB and local device nodes. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-device-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-device) |
| `cli-nodes` — Companion app nodes | Manage connected desktop and mobile nodes. | **Evidence needs renewal** | [Historical trace](preuves/p8-cli-nodes.log); [Wiring checks](preuves/verification-statique.md#cli-nodes) |
| `fleet-peer-chat` — Peer chat | Send a model request to a connected fleet peer. | **Evidence needs renewal** | [Historical trace](preuves/p6-fleet-peer-chat.log); [Wiring checks](preuves/verification-statique.md#fleet-peer-chat) |
| `fleet-peer-tools` — Peer read-only tools | Request an allowed read-only tool on a peer. | **Evidence needs renewal** | [Historical trace](preuves/p6-fleet-peer-tools.log); [Wiring checks](preuves/verification-statique.md#fleet-peer-tools) |
| `fleet-peer-sessions` — Multi-turn peer sessions | Continue a conversation with a fleet peer across turns. | **Evidence needs renewal** | [Historical trace](preuves/p6-fleet-peer-sessions.log); [Wiring checks](preuves/verification-statique.md#fleet-peer-sessions) |

## Server and API

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `http-health` — Route HTTP de santé | Check the HTTP server health endpoint. | **Tested locally** | [Run trace](preuves/p9r1-http-health-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#http-health) |
| `cli-gateway-pairing` — Gateway pairing approval | Approve or reject gateway device pairing. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-gateway-pairing.log); [Wiring checks](preuves/verification-statique.md#cli-gateway-pairing) |
| `cli-acp` — Editor agent protocol | Expose an agent over ACP stdio to an editor. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-acp.log); [Wiring checks](preuves/verification-statique.md#cli-acp) |
| `cli-proxy` — OpenAI-compatible proxy | Expose an OpenAI-compatible proxy to clients. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-proxy.log); [Wiring checks](preuves/verification-statique.md#cli-proxy) |
| `cli-token` — API token | Mint a signed API access token. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-token-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-token) |
| `cli-pair` — Android pairing | Pair an Android authenticator locally. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-pair.log); [Wiring checks](preuves/verification-statique.md#cli-pair) |
| `cli-devices` — Android devices | List and revoke paired authenticators. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-devices.log); [Wiring checks](preuves/verification-statique.md#cli-devices) |
| `http-chat` — Chat HTTP API | Send a chat request over HTTP. | **Evidence needs renewal** | [Historical trace](preuves/p7-http-chat.log); [Wiring checks](preuves/verification-statique.md#http-chat) |
| `http-sessions` — Sessions HTTP API | Inspect and manage saved sessions over HTTP. | **Evidence needs renewal** | [Historical trace](preuves/p7-http-sessions.log); [Wiring checks](preuves/verification-statique.md#http-sessions) |
| `http-memory` — Memory HTTP API | Read and update agent memory over HTTP. | **Evidence needs renewal** | [Historical trace](preuves/p7-http-memory.log); [Wiring checks](preuves/verification-statique.md#http-memory) |
| `http-a2a` — A2A task API | Exchange agent tasks over the A2A endpoint. | **Evidence needs renewal** | [Historical trace](preuves/p5-http-a2a-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#http-a2a) |

## Cowork

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cowork-studio` — App Studio | Iterate on an app in the desktop studio. | **Tested locally** | [Run trace](preuves/p9r1-cowork-studio-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#cowork-studio) |
| `cowork-video-studio` — Video Studio | Organize video work in a desktop view. | **Tested locally** | [Run trace](preuves/p9r1-cowork-video-studio-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#cowork-video-studio) |
| `cowork-desktop-chat` — Desktop chat | Continue a session in the Cowork desktop workspace. | **Failed live run** | [Failure trace](preuves/p9r1-cowork-desktop-chat-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#cowork-desktop-chat) |
| `cowork-desktop-assistant` — Desktop assistant | Open the companion view in Cowork. | **Tested locally** | [Run trace](preuves/p9r1-cowork-desktop-assistant-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#cowork-desktop-assistant) |
| `cowork-desktop-settings` — Desktop settings | Adjust Cowork settings in the desktop window. | **Tested locally** | [Run trace](preuves/p9r1-cowork-desktop-settings-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#cowork-desktop-settings) |

## Self-improvement and DGM

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-improve` — Empirical improvement | Run guarded learning experiments. | **Evidence needs renewal** | [Historical trace](preuves/p6-cli-improve.log); [Wiring checks](preuves/verification-statique.md#cli-improve) |
| `cli-evolve` — Evolution experiments | Propose and review code variants through explicit commands. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-evolve.log); [Wiring checks](preuves/verification-statique.md#cli-evolve) |
| `dgm-learning-cycle` — Learning cycle | Try a bounded learning cycle from the improve command. | **Evidence needs renewal** | [Historical trace](preuves/p6-dgm-learning-cycle.log); [Wiring checks](preuves/verification-statique.md#dgm-learning-cycle) |
| `dgm-authored-tools` — Authored tool experiments | Evaluate proposed agent tools with the improve command. | **Evidence needs renewal** | [Historical trace](preuves/p6-dgm-authored-tools.log); [Wiring checks](preuves/verification-statique.md#dgm-authored-tools) |
| `dgm-evolve-propose` — Evolution proposals | Inspect a proposed code-evolution experiment. | **Evidence needs renewal** | [Historical trace](preuves/p9-dgm-evolve-propose-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#dgm-evolve-propose) |
| `dgm-capability-benchmark` — Capability benchmark | Measure a selected model on a curated capability scenario. | **Evidence needs renewal** | [Historical trace](preuves/p7-dgm-capability-benchmark.log); [Wiring checks](preuves/verification-statique.md#dgm-capability-benchmark) |

## Sensory and companion

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `telegram-channel` — Canal Telegram | Connect conversations through Telegram. | **Evidence needs renewal** | [Historical trace](preuves/p7-telegram-channel.log); [Wiring checks](preuves/verification-statique.md#telegram-channel) |
| `cli-speak` — Speech synthesis | Generate spoken output from text. | **Evidence needs renewal** | [Historical trace](preuves/p9-cli-speak-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#cli-speak) |
| `cli-assistant` — Voice assistant | Configure the Lisa voice assistant. | **Evidence needs renewal** | [Historical trace](preuves/p8-cli-assistant.log); [Wiring checks](preuves/verification-statique.md#cli-assistant) |
| `cli-heartbeat` — Heartbeat engine | Inspect and configure periodic agent wakeups. | **Evidence needs renewal** | [Historical trace](preuves/p8-cli-heartbeat.log); [Wiring checks](preuves/verification-statique.md#cli-heartbeat) |
| `cli-screen` — Screen capture | Capture or watch desktop activity. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-screen.log); [Wiring checks](preuves/verification-statique.md#cli-screen) |
| `cli-companion` — Companion settings | Configure companion behaviour and voice. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-companion.log); [Wiring checks](preuves/verification-statique.md#cli-companion) |
| `sensory-voice-loop` — Voice conversation loop | Turn heard speech into a spoken companion response. | **Unproven here** | [Wiring checks](preuves/verification-statique.md#sensory-voice-loop) |

## Video and media

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-film` — Film production | Assemble scene clips into a film. | **Evidence needs renewal** | [Historical trace](preuves/p6-cli-film.log); [Wiring checks](preuves/verification-statique.md#cli-film) |
| `tool-image-generate` — Image generation | Request image generation through a configured provider. | **Evidence needs renewal** | [Historical trace](preuves/p9-tool-image-generate-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#tool-image-generate) |
| `tool-video-generate` — Video generation | Request a video clip through a configured backend. | **Evidence needs renewal** | [Historical trace](preuves/p9-tool-video-generate-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#tool-video-generate) |
| `tool-understand-video` — Video understanding | Extract information from video with configured media tools. | **Evidence needs renewal** | [Historical trace](preuves/p9-tool-understand-video-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#tool-understand-video) |
| `media-film-assemble` — Film assembly | Assemble prepared clips with transitions and audio. | **Tested locally** | [Run trace](preuves/p6-media-film-assemble.log); [Wiring checks](preuves/verification-statique.md#media-film-assemble) |
| `media-video-stitch` — Video clip stitching | Combine prepared clips with transitions. | **Evidence needs renewal** | [Historical trace](preuves/p6-media-video-stitch.log); [Wiring checks](preuves/verification-statique.md#media-video-stitch) |

## Security

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-security` — Security audit | Audit the local project and profile security. | **Evidence needs renewal** | [Historical trace](preuves/p6-cli-security.log); [Wiring checks](preuves/verification-statique.md#cli-security) |
| `cli-groups` — Group chat security | Configure group chat access controls. | **Evidence needs renewal** | [Historical trace](preuves/p8-cli-groups.log); [Wiring checks](preuves/verification-statique.md#cli-groups) |
| `cli-policy` — Policy diagnostics | Inspect and repair policy findings by domain. | **Evidence needs renewal** | [Historical trace](preuves/p6-cli-policy.log); [Wiring checks](preuves/verification-statique.md#cli-policy) |
| `cli-secrets` — Encrypted secrets vault | Manage credentials in the local encrypted vault. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-secrets.log); [Wiring checks](preuves/verification-statique.md#cli-secrets) |
| `cli-approvals` — Action approvals | Review pending tool and action approvals. | **Unproven here** | [Wiring checks](preuves/verification-statique.md#cli-approvals) |
| `security-sandbox` — Native shell sandbox | Confine shell commands when native sandbox mode is enabled. | **Tested locally** | [Run trace](preuves/p6-security-sandbox.log); [Wiring checks](preuves/verification-statique.md#security-sandbox) |
| `security-skill-firewall` — Skill firewall | Scan skills for risky capabilities before use. | **Tested locally** | [Run trace](preuves/p5-security-skill-firewall-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#security-skill-firewall) |

## CLI and workflows

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `catalog-status` — Catalogue des états et preuves | Inspect the evidence level of tracked features before presenting them. | **Tested locally** | [Run trace](preuves/p9r2-catalog-status-2026-09-30.log); [Wiring checks](preuves/verification-statique.md#catalog-status) |
| `cli-daemon` — Background daemon | Run Code Buddy as a managed background process. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-daemon.log); [Wiring checks](preuves/verification-statique.md#cli-daemon) |
| `cli-trigger` — Event triggers | Configure event-driven agent responses. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-trigger-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-trigger) |
| `cli-widgets` — Conversation widgets | Manage inline conversation widgets. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-widgets-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-widgets) |
| `cli-hub` — Skills marketplace | Search and manage shared skills. | **Unproven here** | [Wiring checks](preuves/verification-statique.md#cli-hub) |
| `cli-triage` — Support bundle | Create a redacted local diagnostic bundle. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-triage-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-triage) |
| `cli-hermes` — Hermes profile | Inspect the native Hermes-style agent profile. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-hermes-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-hermes) |
| `cli-config` — Configuration | Inspect effective configuration and missing settings. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-config.log); [Wiring checks](preuves/verification-statique.md#cli-config) |
| `cli-run` — Run observability | Inspect traces and replay agent runs. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-run-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-run) |
| `cli-cron` — Scheduled jobs | Create and manage scheduled jobs. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-cron.log); [Wiring checks](preuves/verification-statique.md#cli-cron) |
| `cli-insights` — Usage insights | Inspect token, cost and activity metrics. | **Evidence needs renewal** | [Historical trace](preuves/p7-cli-insights.log); [Wiring checks](preuves/verification-statique.md#cli-insights) |
| `cli-deploy` — Web deployment workflow | Prepare a web deployment through a CLI workflow. | **Evidence needs renewal** | [Historical trace](preuves/p8-cli-deploy.log); [Wiring checks](preuves/verification-statique.md#cli-deploy) |
| `cli-provision` — Project provisioning | Prepare database and authentication for a generated project. | **Evidence needs renewal** | [Historical trace](preuves/p5-cli-provision-2026-09-29.log); [Wiring checks](preuves/verification-statique.md#cli-provision) |
| `cli-update` — Update channels | Inspect available update channels. | **Evidence needs renewal** | [Historical trace](preuves/p8-cli-update.log); [Wiring checks](preuves/verification-statique.md#cli-update) |

## Limits

Most capabilities need a service, a second peer, media, hardware, credentials, or an Electron session before a live verdict is possible. See the per-feature reason in the [static audit](preuves/verification-statique.md) and the [mission report](reports/2026-09/RAPPORT-INVENTAIRE-FONCTIONNALITES-2026-09-27.md). The automatic CLI/tool discovery adds more names with **unknown** implementation status; they are not part of these 91 claims.

## Limitations observed in the P9 follow-up

Exact OCR fails on the `P9 TEXT 42` fixture: the engine returns `PO TEXT 42`. The oracle requires exact text after whitespace normalization; image width cannot validate recognition. [Vision/OCR failure](preuves/p9r1-tool-vision_analyze-2026-09-30.log), [OCR tool](preuves/p9r1-tool-ocr-2026-09-30.log).

ASCII rendering of `graph TD; A[P9_START]-->B[P9_END]` fails with `No nodes found in flowchart`. Echoing Mermaid source in metadata does not establish rendering. [Failure trace](preuves/p9r1-tool-diagram-2026-09-30.log).

The QR SVG cannot be decoded: an independent decoder recovers the control payload but returns `null` for the tool output. [QR failure](preuves/p9r1-tool-qr-2026-09-30.log).

ToT reports `Solution Found` with score 1.00 but stops at “6 times 7” without producing 42. [Calculation failure](preuves/p9r1-tool-reason-2026-09-30.log).

Electron chat previously produced exact fixed-phrase replies. The latest unique-marker turn receives `I detected an attempt to override my instructions. I cannot comply.`; the user prompt cannot validate the oracle. [Latest chat failure](preuves/p9r1-cowork-desktop-chat-2026-09-30.log). Studio views, settings and Assistant inspection cover their limited scenarios, not application generation, film production or a voice loop.

CodeExplorer requires the external `code-explorer` binary (executed version: 0.1.1). The [delivered replay](preuves/P9-REJEU.md) creates two source files, their MCP configuration and their index in a fresh project on every run. The [dedicated tool evidence](preuves/p9r2-tool-code_explorer_ask-2026-09-30.log) explicitly initializes MCP. This proves definition lookup; session synchronization remains unverified.

The catalogue trace now preserves the complete CLI JSON (`features`); counts are measured separately. The aggregate excerpt in the P9R1 trace was a reformatted summary rather than raw stdout.
