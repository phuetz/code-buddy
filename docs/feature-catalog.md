# Code Buddy features

This catalogue covers **91 curated user-facing capabilities** in the current source checkout. “Wired” means the source files and declared entrypoint checks exist. “Tested locally” means a real command or agent turn ran under an isolated HOME and has a trace. No feature is claimed as deployed from this checkout. Benefits describe what the wired capability is intended to offer; live evidence covers only the scenario named in its trace.

Evidence: [static wiring audit](preuves/verification-statique.md) · [catalogue status trace](preuves/inventaire-catalog-status.log).

## Agent and tools

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `resource-catalog-tool` — Outil de sélection des ressources | Find available resources for an agent task. | **Wired** | [Wiring checks](preuves/verification-statique.md#resource-catalog-tool) |
| `cli-code-explorer` — Code Explorer integration | Inspect code relationships and session sync. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-code-explorer) |
| `cli-tools` — Tool availability | Inspect effective tools and tool profiles. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-tools) |
| `cli-autonomous-code` — Guarded coding cell | Run a guarded autonomous coding contract. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-autonomous-code) |
| `cli-dev` — Developer workflows | Run guided plan, implementation and verification flows. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-dev) |
| `cli-skills` — Installed skills | List installed skill packages and their origin. | **Tested locally** | [Run trace](preuves/inventaire-cli-skills.log); [Wiring checks](preuves/verification-statique.md#cli-skills) |
| `cli-bundles` — Skill bundles | Group skills under a named command. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-bundles) |
| `cli-lsp` — LSP diagnostics | Inspect language-server diagnostics. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-lsp) |
| `tool-web-search` — Web search | Retrieve web search results for an agent task. | **Wired** | [Wiring checks](preuves/verification-statique.md#tool-web-search) |
| `tool-browser` — Browser automation | Navigate pages through an agent browser tool. | **Wired** | [Wiring checks](preuves/verification-statique.md#tool-browser) |
| `tool-deep-research` — Deep research | Prepare a sourced multi-step research report. | **Wired** | [Wiring checks](preuves/verification-statique.md#tool-deep-research) |
| `tool-verify` — Verification tool | Ask the agent to verify a concrete result. | **Wired** | [Wiring checks](preuves/verification-statique.md#tool-verify) |
| `agent-loop` — Agent tool loop | Continue a request across model replies and tool results. | **Tested locally** | [Run trace](preuves/inventaire-agent-loop.log); [Wiring checks](preuves/verification-statique.md#agent-loop) |
| `tool-read-file` — File reading | Let the agent read a workspace file before answering. | **Tested locally** | [Run trace](preuves/inventaire-tool-read-file.log); [Wiring checks](preuves/verification-statique.md#tool-read-file) |
| `context-tool-selection` — Tool selection | Select task-relevant tools while retaining tool search. | **Wired** | [Wiring checks](preuves/verification-statique.md#context-tool-selection) |

## Providers and failover

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-auth-profile` — Authentication profiles | Manage provider authentication profiles. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-auth-profile) |
| `provider-ollama` — Local Ollama provider | Use a locally served model without a paid API key. | **Tested locally** | [Run trace](preuves/inventaire-provider-ollama.log); [Wiring checks](preuves/verification-statique.md#provider-ollama) |
| `provider-failover` — Provider failover | Switch to a configured provider when an eligible failure occurs. | **Wired** | [Wiring checks](preuves/verification-statique.md#provider-failover) |
| `provider-chatgpt-oauth` — ChatGPT OAuth provider | Use a ChatGPT authenticated Responses backend. | **Wired** | [Wiring checks](preuves/verification-statique.md#provider-chatgpt-oauth) |
| `provider-gemini-cli` — Gemini CLI provider | Use a local Gemini CLI subprocess as a model route. | **Wired** | [Wiring checks](preuves/verification-statique.md#provider-gemini-cli) |
| `provider-agy-cli` — AGY CLI provider | Use an AGY CLI subprocess as a model route. | **Wired** | [Wiring checks](preuves/verification-statique.md#provider-agy-cli) |

## Context and memory

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-curator` — Local curator | Review proposed maintenance for memory, skills and costs. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-curator) |
| `cli-identity` — Agent identity files | Manage local agent identity and user files. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-identity) |
| `cli-session` — Saved sessions | Manage stored conversations and resumes. | **Tested locally** | [Run trace](preuves/inventaire-cli-session.log); [Wiring checks](preuves/verification-statique.md#cli-session) |
| `cli-user-model` — User preference model | Review a structured model of work preferences. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-user-model) |
| `context-compaction` — Context compaction | Keep long conversations within a model context budget. | **Wired** | [Wiring checks](preuves/verification-statique.md#context-compaction) |
| `memory-ckg` — Collective knowledge graph | Recall shared knowledge through the CKG. | **Wired** | [Wiring checks](preuves/verification-statique.md#memory-ckg) |
| `context-checkpoints` — Session checkpoints | Create checkpoints and rewind agent changes. | **Wired** | [Wiring checks](preuves/verification-statique.md#context-checkpoints) |

## Fleet

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `fleet-cli` — Commandes de la flotte | Inspect and operate the multi-agent fleet from the terminal. | **Wired** | [Wiring checks](preuves/verification-statique.md#fleet-cli) |
| `cli-ruche` — Signed coordination | Exchange signed coordination messages. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-ruche) |
| `cli-device` — Remote device nodes | Manage SSH, ADB and local device nodes. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-device) |
| `cli-nodes` — Companion app nodes | Manage connected desktop and mobile nodes. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-nodes) |
| `fleet-peer-chat` — Peer chat | Send a model request to a connected fleet peer. | **Wired** | [Wiring checks](preuves/verification-statique.md#fleet-peer-chat) |
| `fleet-peer-tools` — Peer read-only tools | Request an allowed read-only tool on a peer. | **Wired** | [Wiring checks](preuves/verification-statique.md#fleet-peer-tools) |
| `fleet-peer-sessions` — Multi-turn peer sessions | Continue a conversation with a fleet peer across turns. | **Wired** | [Wiring checks](preuves/verification-statique.md#fleet-peer-sessions) |

## Server and API

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `http-health` — Route HTTP de santé | Check the HTTP server health endpoint. | **Tested locally** | [Run trace](preuves/inventaire-http-health.log); [Wiring checks](preuves/verification-statique.md#http-health) |
| `cli-gateway-pairing` — Gateway pairing approval | Approve or reject gateway device pairing. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-gateway-pairing) |
| `cli-acp` — Editor agent protocol | Expose an agent over ACP stdio to an editor. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-acp) |
| `cli-proxy` — OpenAI-compatible proxy | Expose an OpenAI-compatible proxy to clients. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-proxy) |
| `cli-token` — API token | Mint a signed API access token. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-token) |
| `cli-pair` — Android pairing | Pair an Android authenticator locally. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-pair) |
| `cli-devices` — Android devices | List and revoke paired authenticators. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-devices) |
| `http-chat` — Chat HTTP API | Send a chat request over HTTP. | **Tested locally** | [Run trace](preuves/inventaire-http-chat.log); [Wiring checks](preuves/verification-statique.md#http-chat) |
| `http-sessions` — Sessions HTTP API | Inspect and manage saved sessions over HTTP. | **Tested locally** | [Run trace](preuves/inventaire-http-sessions.log); [Wiring checks](preuves/verification-statique.md#http-sessions) |
| `http-memory` — Memory HTTP API | Read and update agent memory over HTTP. | **Tested locally** | [Run trace](preuves/inventaire-http-memory.log); [Wiring checks](preuves/verification-statique.md#http-memory) |
| `http-a2a` — A2A task API | Exchange agent tasks over the A2A endpoint. | **Wired** | [Wiring checks](preuves/verification-statique.md#http-a2a) |

## Cowork

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cowork-studio` — App Studio | Iterate on an app in the desktop studio. | **Wired** | [Wiring checks](preuves/verification-statique.md#cowork-studio) |
| `cowork-video-studio` — Video Studio | Organize video work in a desktop view. | **Wired** | [Wiring checks](preuves/verification-statique.md#cowork-video-studio) |
| `cowork-desktop-chat` — Desktop chat | Continue a session in the Cowork desktop workspace. | **Wired** | [Wiring checks](preuves/verification-statique.md#cowork-desktop-chat) |
| `cowork-desktop-assistant` — Desktop assistant | Open the companion view in Cowork. | **Wired** | [Wiring checks](preuves/verification-statique.md#cowork-desktop-assistant) |
| `cowork-desktop-settings` — Desktop settings | Adjust Cowork settings in the desktop window. | **Wired** | [Wiring checks](preuves/verification-statique.md#cowork-desktop-settings) |

## Self-improvement and DGM

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-improve` — Empirical improvement | Run guarded learning experiments. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-improve) |
| `cli-evolve` — Evolution experiments | Propose and review code variants through explicit commands. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-evolve) |
| `dgm-learning-cycle` — Learning cycle | Try a bounded learning cycle from the improve command. | **Wired** | [Wiring checks](preuves/verification-statique.md#dgm-learning-cycle) |
| `dgm-authored-tools` — Authored tool experiments | Evaluate proposed agent tools with the improve command. | **Wired** | [Wiring checks](preuves/verification-statique.md#dgm-authored-tools) |
| `dgm-evolve-propose` — Evolution proposals | Inspect a proposed code-evolution experiment. | **Wired** | [Wiring checks](preuves/verification-statique.md#dgm-evolve-propose) |
| `dgm-capability-benchmark` — Capability benchmark | Measure a selected model on a curated capability scenario. | **Tested locally** | [Run trace](preuves/inventaire-dgm-capability-benchmark.log); [Wiring checks](preuves/verification-statique.md#dgm-capability-benchmark) |

## Sensory and companion

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `telegram-channel` — Canal Telegram | Connect conversations through Telegram. | **Wired** | [Wiring checks](preuves/verification-statique.md#telegram-channel) |
| `cli-speak` — Speech synthesis | Generate spoken output from text. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-speak) |
| `cli-assistant` — Voice assistant | Configure the Lisa voice assistant. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-assistant) |
| `cli-heartbeat` — Heartbeat engine | Inspect and configure periodic agent wakeups. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-heartbeat) |
| `cli-screen` — Screen capture | Capture or watch desktop activity. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-screen) |
| `cli-companion` — Companion settings | Configure companion behaviour and voice. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-companion) |
| `sensory-voice-loop` — Voice conversation loop | Turn heard speech into a spoken companion response. | **Wired** | [Wiring checks](preuves/verification-statique.md#sensory-voice-loop) |

## Video and media

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-film` — Film production | Assemble scene clips into a film. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-film) |
| `tool-image-generate` — Image generation | Request image generation through a configured provider. | **Wired** | [Wiring checks](preuves/verification-statique.md#tool-image-generate) |
| `tool-video-generate` — Video generation | Request a video clip through a configured backend. | **Wired** | [Wiring checks](preuves/verification-statique.md#tool-video-generate) |
| `tool-understand-video` — Video understanding | Extract information from video with configured media tools. | **Wired** | [Wiring checks](preuves/verification-statique.md#tool-understand-video) |
| `media-film-assemble` — Film assembly | Assemble prepared clips with transitions and audio. | **Wired** | [Wiring checks](preuves/verification-statique.md#media-film-assemble) |
| `media-video-stitch` — Video clip stitching | Combine prepared clips with transitions. | **Wired** | [Wiring checks](preuves/verification-statique.md#media-video-stitch) |

## Security

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `cli-security` — Security audit | Audit the local project and profile security. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-security) |
| `cli-groups` — Group chat security | Configure group chat access controls. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-groups) |
| `cli-policy` — Policy diagnostics | Inspect and repair policy findings by domain. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-policy) |
| `cli-secrets` — Encrypted secrets vault | Manage credentials in the local encrypted vault. | **Tested locally** | [Run trace](preuves/inventaire-cli-secrets.log); [Wiring checks](preuves/verification-statique.md#cli-secrets) |
| `cli-approvals` — Action approvals | Review pending tool and action approvals. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-approvals) |
| `security-sandbox` — Native shell sandbox | Confine shell commands when native sandbox mode is enabled. | **Wired** | [Wiring checks](preuves/verification-statique.md#security-sandbox) |
| `security-skill-firewall` — Skill firewall | Scan skills for risky capabilities before use. | **Wired** | [Wiring checks](preuves/verification-statique.md#security-skill-firewall) |

## CLI and workflows

| Feature | User benefit | State | Evidence |
|---|---|---|---|
| `catalog-status` — Catalogue des états et preuves | Inspect the evidence level of tracked features before presenting them. | **Tested locally** | [Run trace](preuves/inventaire-catalog-status.log); [Wiring checks](preuves/verification-statique.md#catalog-status) |
| `cli-daemon` — Background daemon | Run Code Buddy as a managed background process. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-daemon) |
| `cli-trigger` — Event triggers | Configure event-driven agent responses. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-trigger) |
| `cli-widgets` — Conversation widgets | Manage inline conversation widgets. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-widgets) |
| `cli-hub` — Skills marketplace | Search and manage shared skills. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-hub) |
| `cli-triage` — Support bundle | Create a redacted local diagnostic bundle. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-triage) |
| `cli-hermes` — Hermes profile | Inspect the native Hermes-style agent profile. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-hermes) |
| `cli-config` — Configuration | Inspect effective configuration and missing settings. | **Tested locally** | [Run trace](preuves/inventaire-cli-config.log); [Wiring checks](preuves/verification-statique.md#cli-config) |
| `cli-run` — Run observability | Inspect traces and replay agent runs. | **Failed live run** | [Failure trace](preuves/inventaire-cli-run-echec.log); [Wiring checks](preuves/verification-statique.md#cli-run) |
| `cli-cron` — Scheduled jobs | Create and manage scheduled jobs. | **Tested locally** | [Run trace](preuves/inventaire-cli-cron.log); [Wiring checks](preuves/verification-statique.md#cli-cron) |
| `cli-insights` — Usage insights | Inspect token, cost and activity metrics. | **Tested locally** | [Run trace](preuves/inventaire-cli-insights.log); [Wiring checks](preuves/verification-statique.md#cli-insights) |
| `cli-deploy` — Web deployment workflow | Prepare a web deployment through a CLI workflow. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-deploy) |
| `cli-provision` — Project provisioning | Prepare database and authentication for a generated project. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-provision) |
| `cli-update` — Update channels | Inspect available update channels. | **Wired** | [Wiring checks](preuves/verification-statique.md#cli-update) |

## Limits

Most capabilities need a service, a second peer, media, hardware, credentials, or an Electron session before a live verdict is possible. See the per-feature reason in the [static audit](preuves/verification-statique.md) and the [mission report](reports/2026-09/RAPPORT-INVENTAIRE-FONCTIONNALITES-2026-09-27.md). The automatic CLI/tool discovery adds more names with **unknown** implementation status; they are not part of these 91 claims.
