# Commands

## Slash Commands (In-Chat)

### Session and Model

| Command | Description |
|:--------|:------------|
| `/help` | Show help |
| `/model [name]` | Change model |
| `/switch <model\|auto>` | Mid-conversation model switching |
| `/profile [id]` | Switch connection profile |
| `/mode [mode]` | Change security mode (`suggest`, `auto-edit`, `full-auto`) |
| `/cost` | Show cost dashboard |
| `/compact [level]` | Compress conversation context |
| `/config [key] [value]` | View/set configuration |
| `/config set <key> <value>` | Set config value (dot-notation) |

### Reasoning

| Command | Description |
|:--------|:------------|
| `/think off\|shallow\|medium\|deep\|exhaustive` | Set reasoning depth |
| `/think status` | Show reasoning config and last result |
| `/think <problem>` | Run Tree-of-Thought on a problem |
| `/megathink` | Deep reasoning (10K tokens) |
| `/ultrathink` | Exhaustive reasoning (32K tokens) |

### Development

| Command | Description |
|:--------|:------------|
| `/pr [title] [--draft]` | Create GitHub/GitLab PR from current branch |
| `/lint [run\|fix\|detect]` | Auto-detect and run project linters (eslint, ruff, clippy, golangci-lint, rubocop, phpstan) |
| `/bug [severity]` | Run bug finder with optional severity filter |
| `/conflicts` | Resolve Git merge conflicts |
| `/replace` | Codebase-wide find and replace |
| `/watch start\|stop\|status` | File watcher trigger |
| `/vulns` | Dependency vulnerability scanner |
| `/coverage` | Coverage target configuration |
| `/transform modernize\|typescript\|async\|functional\|es-modules` | Code transformation |
| `/suggest` | Proactive suggestions by category |

### Agents and Orchestration

| Command | Description |
|:--------|:------------|
| `/batch <instruction>` | Decompose goal into parallel units, spawn agents |
| `/team start\|add\|status\|stop\|task\|send\|inbox` | Agent Teams coordination |
| `/btw <question>` | Side question without tools or history modification |

### Memory and Knowledge

| Command | Description |
|:--------|:------------|
| `/memory` | Memory management |
| `/lessons list\|add\|search\|graph\|stats` | Lessons management |
| `/tools [list\|info]` | List available tools |

### Voice

| Command | Description |
|:--------|:------------|
| `/speak <text>` | Speak text with current TTS provider |
| `/tts on\|off\|auto` | TTS control |
| `/tts provider <name>` | Switch TTS provider |
| `/tts voice <voice>` | Set voice |
| `/voice-code` | Voice-to-code pipeline |
| `/companion status\|setup` | Configure/check Buddy as a ChatGPT-backed voice companion |
| `/companion evaluate` | Score Buddy's companion readiness and record self-improvement suggestions |
| `/companion radar` | Compare Buddy against Hermes, OpenClaw, Lisa, and open companion systems |
| `/companion impulses` | Build proactive companion impulses from readiness, senses, missions, and safety state |
| `/companion missions sync\|list\|run-next` | Turn radar gaps into a local companion mission board and prepare the next mission brief |
| `/companion safety recent\|stats` | Inspect Buddy's local safety ledger for senses, missions, tools, and data actions |
| `/companion camera status\|snapshot` | Check/capture the local webcam bridge for Buddy vision |
| `/companion percepts recent\|stats` | Inspect Buddy's local sensory journal |

### Autonomy

| Command | Description |
|:--------|:------------|
| `/yolo on\|off\|safe\|status` | YOLO mode control |
| `/yolo allow "<cmd>"` | Add command to auto-execute list |
| `/yolo deny "<cmd>"` | Block a command pattern |
| `/autonomy suggest\|confirm\|auto\|full\|yolo` | Autonomy level |
| `/send on\|off\|inherit` | Message send policy override |

### Other

| Command | Description |
|:--------|:------------|
| `/persona list\|use\|info\|reset` | Manage AI personas; use `/persona use companion` for Buddy's partner/voice-friendly mode |
| `/plugin <action>` | Owner-gated plugin management (local terminal only) |
| `/quota` | Rate limit / quota display per provider |
| `/telemetry on\|off\|errors-only` | Telemetry toggle |
| `/secrets-scan` | Run secrets detector |

## CLI Subcommands

### Dev Workflows

```bash
buddy dev plan "<objective>"       # Profile repo + produce task plan
buddy dev run "<objective>"        # Plan + implement + test + artifacts
buddy dev pr "<objective>"         # Dev run + generate PR summary
buddy dev fix-ci [--log <file>]    # Read CI logs + propose patch
buddy dev issue <url-or-number>    # GitHub issue -> branch -> code -> tests -> PR
buddy dev explain                  # Summarize repo conventions
```

### Daemon and Background

```bash
buddy daemon start [--detach] [--install-daemon] [--foreground]
buddy daemon stop | restart | status [--json] | logs [--lines N]
buddy heartbeat start | stop | status [--json] | tick
buddy trigger list | add | remove
buddy channels status [--json] [--config <path>]
buddy cron list [--json] | show <id> | pause <id> | resume <id> | run <id> [--json] | remove <id>
buddy cron add <name> --every <ms>|--cron <expr>|--at <iso> \
  [--message <text>] [--watchdog <json|@file>] [--pre-check <json|@file>] \
  [--deliver <type:id>...] [--format full|summary]
buddy cron update <id> [--name <name>] [--every <ms>|--cron <expr>|--at <iso>] \
  [--message <text>|--watchdog <json|@file>] [--pre-check <json|@file>|--clear-pre-check] \
  [--deliver <type:id>...] [--format full|summary] [--clear-delivery] [--json]
buddy skills list [--all] [--json] | doctor [--json] [--repair-missing --approved-by <reviewer>]
buddy skills usage [--json] | learning-usage [--json] | enable <name> | disable <name>
```

Installed skills can also be inspected by agents through the read-only
`skills_list` and `skill_view` tools, backed by the same SkillsHub lockfile as
`buddy skills list --json`.
`buddy skills doctor --repair-missing --approved-by <reviewer>` removes only
stale lockfile rows whose `SKILL.md` is already missing; integrity mismatches
remain review-only so local edits are not overwritten or deleted silently.

`buddy cron` authors scheduled jobs for the daemon's CronScheduler, including
no-LLM `--watchdog` monitors (disk/http/repo/build) and `--pre-check` gates
(file_changed/command) that skip expensive LLM runs when nothing changed.
Use `pause`, `resume`, `run`, and `update` for live job control without
starting the daemon tick loop. `CODEBUDDY_CRON_HOME` can point CLI smoke tests
at an isolated cron store.
The same persisted scheduler is available to agents through the built-in
`cronjob` tool for list/show/create/pause/resume/run/remove.
The REST cron job list and trigger endpoints load the same persisted job store
before responding, so Cowork sees the jobs authored by `buddy cron`.

`buddy daemon status --json` reports daemon liveness, PID, uptime, service
counts, restart count, and recommendations for Cowork or external harnesses.
The REST endpoint mirrors that shape with
`GET /api/daemon/status?format=report`.

`buddy channels status --json` reports configured and registered messaging
channels without printing secrets, so Cowork and parity checks can render
gateway readiness directly.

`buddy heartbeat status --json` reports the autonomous heartbeat engine state,
schedule config, counters, and recommendations in a Cowork-friendly shape.
The REST endpoint mirrors that shape with
`GET /api/heartbeat/status?format=report`.

### Research and Orchestration

```bash
buddy research "<topic>" [--workers N] [--rounds N] [--output file.md]
buddy flow "<goal>" [--max-retries N] [--verbose]
buddy hermes profile|agent|doctor|plan|toolsets|hooks|prompt-size|parity|tools-parity|tools [dispatchProfile] [--json] [--markdown] [--plan-output file]
buddy hermes providers status [--json]
buddy hermes portal status|tools|open [--json]
buddy hermes messaging status [--json] [--config <path>]
buddy hermes mobile status [query...] [--json]
buddy hermes trajectories status [query...] [--run-id <id>] [--json]
buddy hermes protocols status [--json]
buddy hermes protocols-smoke local [--json]
buddy hermes browser status [--json]
buddy hermes browser-smoke local-playwright [--json]
buddy hermes runtime status [--json]
buddy hermes runtime lifecycle daytona attach --target <sandbox> [--json]
buddy hermes runtime lifecycle daytona hibernate --target <sandbox> --execute [--json]
buddy hermes runtime-smoke local [--json]
buddy tools browser-operator draft "<goal>" [--source-url URL] [--mode isolated|local] [--json]
buddy tools skill-candidate list|inspect|install [candidatePath] [--approved-by name] [--json]
```

`buddy hermes plan` prints a short Hermes integration checklist for a
selected Fleet dispatch profile. The JSON form includes schema version,
generation time, summary, recommended next command, surface ids, and
checklist items for future Cowork/Manus-style UI surfaces that need
stable next-step metadata. Checklist items also include a kind and risk
badge so UI panels can distinguish read-only inspection, local artifact
writes, and interactive execution. Items that create files include
expected artifact paths for UI attachment previews, and every item
includes acceptance criteria for checklist rendering.
The Markdown form is useful for handoff notes, docs, and PR summaries.
`--plan-output` writes the selected representation to a file and infers
JSON/Markdown from `.json`, `.md`, or `.markdown` extensions when no
format flag is provided.
The plan also declares its interaction surfaces (`cli`, `cowork`, and
`shared-json`) so Cowork can render the same checklist and seed a Fleet
goal without parsing CLI prose.

`buddy hermes doctor [profile] [--json]` checks the active Hermes custom-agent
mapping, effective tool filter, active model, inferred provider, detected
credential source names, model capabilities, context/output limits, Nous
Portal readiness, and runtime backend inventory for local, OS sandbox, Docker,
WSL, SSH, Singularity/Apptainer, Modal, Daytona, and Vercel Sandbox. It also
embeds browser backend readiness for local Playwright, CDP, Browserbase,
Browser Use, Firecrawl, Camofox, and session recording. The JSON form is safe
for Cowork because it reports credential source names and smoke commands only,
never secret values.

`buddy hermes toolsets [profile] [--json]` prints the dedicated Fleet/Hermes
toolset catalog without the wider doctor payload. It shows all five dispatch
profiles, the active `fleet.hermes.*` toolset, profile guidance, policy group
boundaries, and representative allow/confirm/deny decisions for the preview
tool list. The JSON form is intended for Cowork and other cockpits that need to
render or compare toolset policy without parsing the doctor output.

`buddy hermes parity [--json|--markdown]` prints the machine-checkable official
Hermes parity manifest created from the 2026-05-30 source/docs audit. Each row
includes Code Buddy evidence paths, status, verification commands, notes, and
next-work hints so future parity work does not rely on prose archaeology.

`buddy hermes tools-parity [--json|--markdown]` (alias:
`buddy hermes tools`) prints the tool-level official Hermes parity manifest.
It compares upstream Hermes tool names from
`toolsets.py` and dedicated tool source files against the built-in Code Buddy
tool schemas, marking each row as exact, native equivalent, partial, or gap.
This is the fastest way to see whether an upstream Hermes capability exists as
an LLM-callable Code Buddy tool or only as a nearby CLI/runtime feature.

`buddy hermes providers status [--json]` prints a dedicated provider/model
readiness report without the wider doctor payload. It includes the active
model, inferred provider, tool-call/reasoning/vision capability flags,
context/output limits, credential source names, configured-provider counts, and
Nous Tool Gateway setup without printing secret values.

`buddy hermes portal status [--json]` is the local Nous Portal readiness check.
It reports credential source names, subscription/docs URLs, Tool Gateway routing
configuration, and whether the official Firecrawl/FAL/TTS/Browser Use/Modal
catalog is currently routed through Nous or through Code Buddy's direct/local
providers. It never prints secret values. `portal tools` prints only the catalog
view, and `portal open` prints the subscription URL without launching a browser.

`buddy hermes messaging status [--json]` wraps the real channel gateway
readiness report in a Hermes-scoped command. It includes configured/enabled
channel counts, runtime connection/auth counts, and remediation hints without
printing tokens or webhook URLs. `--config <path>` points at an isolated
`.codebuddy/channels.json` file for setup checks.

`buddy hermes mobile status [query...] [--json]` wraps the real mobile
supervision contract in a Hermes-scoped readiness report. It shows the
implemented `/api/mobile` route mount, bearer or pairing-code auth policy,
read-only versus draft-only route counts, blocked operations, local approval
queue state, and copy/paste `buddy run mobile-*` commands. It does not start a
listener or print pairing codes; mobile execution and file mutations remain
local-operator-gated.

`buddy hermes trajectories status [query...] [--run-id <id>] [--json]`
wraps the real RunStore trajectory surfaces in a Hermes-scoped compatibility
report. It inventories redacted trajectory export, recall-pack compression,
Learning Agent retrospectives, golden workflow evals and policy evals, then
keeps upstream-style batch generation/compression marked partial. Pass a real
stored `--run-id` to prove export counts and redaction metrics without replaying
tools; pass a query to probe recall-pack matches.

`buddy hermes protocols status [--json]` prints a Hermes-scoped MCP/A2A/ACP
gateway readiness report. It inventories the SDK-backed MCP client, Code Buddy
MCP server, A2A HTTP routes, ACP HTTP routes, and the channel-to-A2A bridge,
while keeping packaged editor ACP parity marked partial. `buddy hermes
protocols-smoke local --json` runs a real local smoke: it starts a temporary
MCP stdio server through the SDK and opens loopback Express routes for A2A/ACP
without invoking an LLM task.

`buddy hermes browser status [--json]` prints a browser backend inventory for
local Playwright, remote CDP, Browserbase/Stagehand, Browser Use gateway,
Firecrawl, Camofox/Camoufox, and session recording. `buddy hermes browser-smoke
local-playwright --json` launches a real headless Chromium page and proves the
local Playwright backend can execute, instead of only checking package presence.

`buddy hermes runtime status [--json]` prints a dedicated runtime backend
inventory for local Node, native OS sandbox, Docker, WSL, SSH, Singularity or
Apptainer, Modal, Daytona, and Vercel Sandbox without requiring the larger
`hermes doctor` payload. `buddy hermes runtime lifecycle <backend> <action>
--target <id> --json` prints a provider-specific managed lifecycle plan for
`provision`, `hibernate`, `wake`, `attach`, and `teardown` without executing
destructive cloud operations. Add `--execute` only when the operator has set
`CODEBUDDY_HERMES_ALLOW_LIFECYCLE_EXEC=true` plus the backend-specific allow
flag such as `CODEBUDDY_HERMES_ALLOW_DAYTONA_LIFECYCLE=true`; interactive
attach actions require the additional
`CODEBUDDY_HERMES_ALLOW_INTERACTIVE_LIFECYCLE=true` guard. Daytona maps to CLI
`create/start/stop/ssh/delete` and captures `daytona list --format json` before
and after guarded execution; Modal maps attach to `modal shell` and
creation/termination to the Sandbox SDK, which remains plan-only; Vercel
Sandbox maps to the official `sandbox` CLI, including
`sandbox exec --interactive --tty <id> bash` for attach and `sandbox list --all`
for state snapshots. `buddy hermes runtime-smoke local --json` runs a real local
subprocess smoke for the selected backend.

Research-script job artifacts can now select `sandboxPolicy.provider` values
`local`, `docker`, `wsl`, `remote`, `daytona`, or `vercel-sandbox`.
`remote` remains a Daytona alias for backward compatibility; Daytona executes
pre-staged remote files under `codebuddy-research/<job-id>/...` so it no
longer sends local paths into the sandbox. `vercel-sandbox`
uses the documented `sandbox exec --env KEY=VALUE <sandbox_id> <command>
[...args]` CLI shape. Set `sandboxPolicy.target` to the existing remote
workspace or sandbox id; the runner falls back to the job id only for legacy
artifacts. For Vercel Sandbox, the runner also uses `sandbox copy` to upload
the materialized script/input into `/home/sandbox/codebuddy-research/<job-id>`
before execution and copy `output.json` back afterward. Live configured-account
execution and Daytona upload/download automation remain guarded follow-up work.

`buddy hermes hooks [--json]` prints the canonical Hermes-style lifecycle
hook manifest. It maps Code Buddy's existing user/tool hooks onto
`before_tool_call`, `after_tool_call`, `before_memory_write`,
`after_run_complete`, and `before_scheduled_delivery`, including configured
handler counts and the current core touchpoint for each stage.

`buddy tools browser-operator draft` creates a side-effect-free
Manus-style browser session preview from an Internet Scout goal. It
does not start a browser. The JSON output includes the source scout plan
and Browser Operator draft with consent scopes, dedicated tab label,
planned action log, stop conditions, and proof export manifest.

`buddy tools skill-candidate` is the shared review queue for materialized
SKILL.md candidates. It supports both research-script candidates and Learning
Agent candidates under `.codebuddy/skill-candidates/learning/`; `install`
requires `--approved-by` and copies the reviewed file into `.codebuddy/skills/`.
Learning Agent candidates are generated with Hermes-style SKILL.md frontmatter
(`author`, `license`, `platforms`, `metadata.hermes`) so they are reviewable
before becoming active workspace skills.

### Knowledge and Memory

```bash
buddy knowledge list | show | search | add | remove | context
buddy lessons list | add | search | graph [--concept concept] [--no-keywords] [--json|--markdown|--mermaid] [--graph-output file] [--vault dir] | stats | clear | context
buddy todo list | add | done | update | remove | clear-done | context
```

`buddy lessons graph --graph-output` infers `json`, `markdown`, or
`mermaid` output from `.json`, `.md`, `.mmd`, or `.mermaid` extensions
when no explicit format flag is provided.
`--vault <dir>` writes an Obsidian-style folder with `index.md`,
`_concepts.md`, `_lessons.md`, `concepts/*.md`, `lessons/*.md`,
`graph.json`, `graph.mmd`, and `manifest.json`.
Vault pages include YAML frontmatter so Obsidian/plugins and future
Code Buddy UI surfaces can read page type, concepts, backlinks, and
graph metadata without reparsing prose.
`manifest.json` lists stable entrypoints and generated files for UI
loading, plus concept-to-file and lesson-to-file maps.

### Infrastructure

```bash
buddy server --port 3000
buddy hub search | install | uninstall | update | list | info | publish | sync
buddy mcp add <server> | list
buddy identity show | get | set | awaken | prompt
buddy nodes list | pair | approve | describe | remove | invoke | pending
buddy pairing status | list | pending | approve <code> | add <id> | revoke <id>
buddy groups status | list | block | unblock
buddy auth-profile list | add | remove | reset
buddy config show | validate | get
```

### Security

```bash
buddy security-audit [--deep] [--fix] [--json]
buddy secrets list | set | get | remove | rotate | audit | import-env
buddy approvals list | approve | deny | policy
buddy execpolicy check | check-argv | add-prefix | dashboard
```

### Deployment and Updates

```bash
buddy deploy platforms | init | nix
buddy update [--channel stable|beta|dev] [--check] [--force] [--tag <ref>]
buddy backup create | verify | list | restore [--only-config] [--no-include-workspace]
```

### Setup

```bash
buddy onboard          # Interactive setup wizard
buddy doctor [--fix]   # Environment diagnostics (--fix for auto-migration)
buddy speak [text] [--voice <name>] [--list-voices] [--speed <n>]
buddy companion setup [--force] [--no-voice] [--no-set-model]
buddy companion status
buddy companion self
buddy companion evaluate [--no-record]
buddy companion radar [--no-record]
buddy companion impulses [--no-record]
buddy companion missions sync [--no-record]
buddy companion missions list [--status <open|in_progress|done|dismissed>]
buddy companion missions run-next [--dry-run]
buddy companion missions start|done|dismiss <id>
buddy companion safety recent [--limit <n>] [--kind <sense|tool|mission|permission|data>] [--risk <low|medium|high>]
buddy companion safety stats
buddy companion camera status
buddy companion camera snapshot [--output <path>] [--device <device>] [--timeout-ms <ms>]
buddy companion percepts recent [--limit <n>] [--modality <name>]
buddy companion percepts stats
```

`buddy identity awaken` installs the Buddy companion identity into the current project's
`.codebuddy/SOUL.md` without overwriting an existing file unless `--force` is passed.
Use it with `/persona use companion` and Cowork's mic / voice-output controls for a
voice-first partner workflow. When voice output is enabled, clicking either
Cowork mic control interrupts active assistant speech before recording, giving
the companion a practical barge-in loop instead of a one-way monologue.

`buddy companion setup` is the one-command version: it installs `SOUL.md` and
`BOOT.md`, configures voice input plus TTS defaults, and sets the current project
model to the ChatGPT companion default when `buddy login` credentials are present.
`buddy companion status` shows the readiness of the ChatGPT brain route, identity
files, voice input, text-to-speech, the local camera bridge, and the
companion percept journal.

`buddy companion evaluate` turns that state into a small self-improvement loop:
Buddy scores brain/auth, identity, voice, TTS, camera, vision/hearing/screen/self
percepts, local memory, wake word readiness, and explicit safety boundaries. By
default it records a `self` evaluation plus the top `suggestion` percepts; pass
`--no-record` for a dry readout. Cowork exposes the same action in the Buddy
companion panel.

`buddy companion radar` is the competitive self-improvement pass. It compares
Buddy against source-backed profiles for Hermes Agent, OpenClaw, Lisa, and UNI:
Hermes for closed-loop skills, channels, cron, and remote runtimes; OpenClaw for
personal-agent integrations and always-on workflows; Lisa for browser-side
vision/hearing, multi-agent planning, checkpoints, and replayable computer
skills; UNI for real-time interrupted voice, camera, UI cards, impulses, and
local encrypted memory. The radar records the top gaps as `suggestion` percepts
unless `--no-record` is passed.

`buddy companion impulses` is Buddy's opt-in proactive check-in. It reads the
current readiness, recent sensory percepts, mission board, and safety ledger,
then returns a short "next useful move" prompt plus prioritized impulses such as
connect ChatGPT, refresh camera context, continue the active mission, or review
a safety event. By default it records the top impulses as `suggestion` percepts;
pass `--no-record` for a read-only brief.

`buddy companion missions sync` converts the radar gaps into
`.codebuddy/companion/missions.json`, a local mission board with P0/P1/P2
priorities and `open`, `in_progress`, `done`, or `dismissed` statuses. Use
`buddy companion missions list` to inspect it and `start`, `done`, or `dismiss`
to update a mission. Cowork shows the same board and can sync/start/finish
missions from the companion panel.

`buddy companion missions run-next` is the bridge from backlog to action. It
selects the current `in_progress` mission or the highest-priority open mission,
marks it `in_progress`, and writes an executable brief under
`.codebuddy/companion/mission-runs/`. The brief captures objective, competitor
inspiration, implementation lane, safety notes, and verification checklist. Pass
`--dry-run` to preview the selected mission and brief without writing files or
changing mission status.

`buddy companion safety recent` reads `.codebuddy/companion/safety-ledger.jsonl`,
an append-only local ledger for sensitive companion events such as camera
snapshots, mission transitions, and mission-run briefs. `safety stats` prints
kind/risk/status counts so Buddy's growing autonomy stays inspectable.

`buddy companion camera snapshot` captures one webcam frame into `.codebuddy/camera/`
by default. It uses `ffmpeg` so it works without adding a new Node dependency; pass
`--device` when your OS exposes the camera under a different name or index. The
companion can also call the `camera_snapshot` tool when you ask Buddy to look,
inspect, read, or react to a physical scene. Successful snapshots also append a
`vision` percept to `.codebuddy/companion/percepts.jsonl`, so Buddy and Cowork can
build a stable sense-memory over what was seen.

`buddy companion percepts recent` prints the newest local sensory events, with
optional `--modality vision|hearing|screen|self|memory|tool|suggestion`.
`buddy companion percepts stats` shows the append-only store path and modality
counts. This is the Lisa-inspired backbone for future continuous voice, screen
share, proactive suggestions, and self-state panels.
`buddy companion self` writes Buddy's current model/auth/voice/camera readiness
as a `self` percept, giving the companion a small, inspectable proprioception
trail.
Cowork exposes the same journal in the Buddy companion titlebar panel, including
recent percept filters, self-state recording, and explicit camera snapshots for
the active project.

### Observability

```bash
buddy run list                      # List recent runs (most recent first, 30-run prune)
buddy run show <run-id>             # Show full event log for a run
buddy run search <query> [--json]   # Search run summaries, events, artifacts
buddy run index-doctor [--repair]   # Report/repair stale artifact index rows (pruned/moved runs)
buddy run lineage <run-id>          # Show the fork family tree of a run (ancestors + descendants)
buddy run recall-pack <query>       # Build a cited context handoff from runs
buddy run trajectory-export <run-id> # Export a redacted run trajectory for audit/evals
buddy run retrospective <run-id>    # Run the Learning Agent over a trajectory
buddy run golden-evals [fixture-id] [run-id] # List/evaluate golden workflow fixtures
buddy run policy-evals [policy-id] [run-id] # List/evaluate trajectory policy checks
buddy run mobile-snapshot <query>   # Build a redacted review-only mobile handoff
buddy run mobile-gateway-contract <query> # Describe safe mobile supervision routes
buddy run mobile-gateway-check <query> --action <action> --method GET|POST --path <path>
                                  # Evaluate one future mobile route against policy
buddy run mobile-gateway-review-draft <query> --action <action> --method GET|POST --path <path>
                                  # Build a local-only operator review draft
buddy run mobile-gateway-listener-shell <query>
                                  # Build the disabled loopback listener plan
buddy run mobile-pairing-state <query>
                                  # Build preview-only local pairing state
buddy run mobile-pairing-acceptance-plan <query>
                                  # Build no-network pairing acceptance plan
buddy run mobile-approval-queue <query>
                                  # Build local-only approval queue state
buddy run tail [--follow]           # Tail the active run; --follow streams as it grows
buddy run replay <run-id>           # Replay a run's tool events for debugging
```

Runs are persisted as JSONL in `.codebuddy/runs/`. Each run captures
the message thread, tool calls, results, errors, and timing. Combine
with `OTEL_EXPORTER_OTLP_ENDPOINT` for remote traces or `SENTRY_DSN`
for error reporting (see `docs/configuration.md`).

`buddy run trajectory-export <run-id> --json` exports the run objective,
selected context, tool calls, tool results, artifacts and final answer through
the same secret-redaction engine used by supervision payloads. Artifact content
is metadata-only by default; add `--include-artifact-content` for capped,
redacted previews.

`buddy run retrospective <run-id> --force` runs the Learning Agent on the same
redacted trajectory. It writes a `learning-retrospective.*` run artifact,
updates `.codebuddy/learning/pattern-library.json`, proposes review-gated lesson
candidates, and materializes review-gated skill candidates under
`.codebuddy/skill-candidates/learning/`. Use `--dry-run` for read-only review.

`buddy run golden-evals --json` prints repeatable workflow fixtures for lead
discovery, code fixes, document workshops, Fleet review and scheduled runs.
`buddy run golden-evals <fixture-id> <run-id> --json` evaluates a redacted run
trajectory against that fixture's policy/artifact assertions without replaying
tools or contacting anyone.

`buddy run policy-evals --json` prints behavior-level safety checks for
safe/review no-mutation runs and public-data source URL preservation.
`buddy run policy-evals <policy-id> <run-id> --json` evaluates one redacted
trajectory export against those rules without replaying tools, mutating files,
or contacting anyone.

Cowork's Audit Log can copy the same redacted trajectory export from an
expanded run, copy golden-workflow and policy-eval reports for that run, review
those eval summaries locally without touching the clipboard, and mirrors the
recall-pack, mobile snapshot, gateway contract, local review-draft and disabled
listener-shell builders as copy-only actions from the current search. The
listener shell is artifact-only: it names the
future loopback binding and route handlers but does not start a server, dispatch
tools, or send outreach. Cowork also mirrors the preview pairing state as a
copy-only action: it emits a preview code, fingerprint, TTL and operator
checklist, but no listener accepts the code and no bearer token is issued.
The same Audit Log toolbar can review or copy the no-network pairing acceptance
plan: the future `POST /api/mobile/pairing/accept` endpoint, evidence
requirements and mutations are visible, but all endpoint/mutation flags remain
disabled.
Cowork and CLI also expose a local approval queue that classifies read-only
routes, pending draft approvals and blocked operations while keeping approval
mutation endpoints disabled. In Cowork the same queue can also be reviewed as
a local status panel before copying JSON, and each pending item can copy its
own local operator review draft.

## Global CLI Flags

| Flag | Short | Description | Default |
|:-----|:------|:------------|:--------|
| `--version` | `-V` | Show version | - |
| `--directory <dir>` | `-d` | Set working directory | `.` |
| `--api-key <key>` | `-k` | API key | - |
| `--base-url <url>` | `-u` | API base URL | - |
| `--model <model>` | `-m` | AI model | auto-detect |
| `--prompt <prompt>` | `-p` | Single prompt (headless mode) | - |
| `--profile <name>` | | Named config profile | - |
| `--max-tool-rounds <n>` | | Max tool execution rounds | 400 |
| `--max-price <dollars>` | | Session cost limit | $10 |
| `--security-mode <mode>` | `-s` | `suggest`, `auto-edit`, or `full-auto` | `suggest` |
| `--permission-mode <mode>` | | `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions` | `default` |
| `--output-format <fmt>` | `-o` | `json`, `stream-json`, `text`, `markdown` | `json` |
| `--context <patterns>` | `-c` | Glob patterns to load into context | - |
| `--continue` | | Resume most recent session | - |
| `--resume <id>` | | Resume specific session | - |
| `--auto-approve` | | Auto-approve all tool executions | false |
| `--dangerously-skip-permissions` | | Bypass permission checks (CI only) | false |
| `--yolo` | | Full autonomy mode | false |
| `--disallowed-tools <list>` | | Comma-separated tool blacklist | - |
| `--system-prompt <id>` | | `default`, `minimal`, `secure`, `architect`, or custom | `default` |
| `--vim` | | Vim keybindings | false |
| `--plain` | | Minimal formatting | false |
| `--no-color` | | Disable colors | false |
| `--browser` | `-b` | Launch browser UI | false |
| `--channel <name>` | | Start with a messaging channel | - |
