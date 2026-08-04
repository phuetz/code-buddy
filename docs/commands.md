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
| `/memory [list|recent|context|remember|replace|forget|recall|candidates|accept|reject]` | Bounded Hermes-style persistent memory management and review-gated long-term memory candidates |
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
| `/companion status\|setup\|live` | Configure/check Buddy as a ChatGPT-backed voice companion and build a live-session preflight |
| `/companion evaluate` | Score Buddy's companion readiness and record self-improvement suggestions |
| `/companion radar` | Compare Buddy against Hermes, OpenClaw, Lisa, and open companion systems |
| `/companion impulses` | Build proactive companion impulses from readiness, senses, missions, and safety state |
| `/companion missions sync\|list\|run-next` | Turn radar gaps into a local companion mission board and prepare the next mission brief |
| `/companion safety recent\|stats` | Inspect Buddy's local safety ledger for senses, missions, tools, and data actions |
| `/companion camera status\|snapshot` | Check/capture the local webcam bridge for Buddy vision |
| `/companion percepts recent\|stats` | Inspect Buddy's local sensory journal |
| `/companion continuity init\|status\|refresh\|verify` | Manage the integrity-protected companion lineage across model, machine, and future body migrations |
| `/companion migration export\|verify\|restore` | Create and restore an AES-256-GCM encrypted companion migration bundle; restoration is a dry run unless `--apply` is supplied |

### Maison

```bash
buddy maison status [--json]
buddy maison mode <normal|free-day|focus|rest|cooking|guests|away|silent> [--for 2h]
buddy maison silence [--for 8h] | resume | holidays [year]
buddy maison timer start <45s|10m|2h> <label>
buddy maison timer list | cancel <id> | acknowledge <id>

buddy maison food status [--reveal] [--json]
buddy maison food allergens
buddy maison food add <kind> <ingredient|allergen|tag> <value> [--confirm]
buddy maison food verify <recipe.json>
buddy maison food suggest <recipes.json> [--inventory override.json]
buddy maison food plan list|next|add|status|remove
buddy maison food inventory list|add|remove
```

`food suggest` utilise par défaut l'inventaire Maison actif et ignore les faits non confirmés pour le
classement. `--inventory` fournit un remplacement explicite. Les cibles privées du profil alimentaire ne
sont jamais imprimées par `status` sans `--reveal`.

### Autonomy

| Command | Description |
|:--------|:------------|
| `/goal <text>` | Set a standing goal and start the Ralph loop — after each turn a judge model checks completion and auto-continues until done, paused, or the turn budget (default 20) is spent |
| `/goal status\|pause\|resume\|clear` | Inspect or control the goal loop (`resume` resets the budget; aliases `stop`/`done` clear) |
| `/subgoal <text>` | Add a numbered acceptance criterion mid-loop (judge then requires evidence for every criterion) |
| `/subgoal remove <n>\|clear` | Manage subgoals (bare `/subgoal` lists them) |
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
buddy mcp list | test <name> | audit [name] [--all] [--json]
buddy mcp enable <name> | disable <name>
buddy mcp profile create <name> <server...> [-d description]
buddy mcp profile list [--json] | use <name> | delete <name>
buddy campaign status | overview [--json]
buddy campaign library templates|styles|pillars|viral [--search text]
buddy campaign transcribe <youtube-url> [-o transcript.json]
buddy campaign draft --content-file post.md --platforms linkedin,instagram
buddy campaign submit <post-id> | analytics [--post id]
```

`buddy mcp audit` connects only for the duration of the probe and reports the
full provider-facing tool catalog in exact characters/bytes plus an estimated
token count. The heaviest tools are listed individually. Use `enable` and
`disable` to change the highest-priority configuration source without deleting
the server or expanding normal runtime context.

MCP profiles are project-local, data-driven sets stored in
`.codebuddy/mcp-profiles.json`. Activating a profile enables exactly its listed
servers and disables the others, which keeps unrelated tool schemas out of the
mission context. Profiles reference server names; they never duplicate commands,
URLs, headers, or secrets.

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

### Media — Krea 2 LoRA (character / style)

```bash
buddy lora lisa                              # init projet Lisa (trigger ohwx lisa)
buddy lora init <name> [--trigger …] [--character …]
buddy lora validate <name|path> [--fill-captions]
buddy lora pack <name|path> [--out file.zip]
buddy lora train cloud <name|path> [--steps 1000] [--resolution 768|1024]
buddy lora train local <name|path>           # config AI-Toolkit + train-local.sh (pas de multi-Go auto)
buddy lora install <file.safetensors> [--name id] [--comfy-root DIR]
buddy lora list
buddy lora status
buddy lora selfie [--mood tender|playful|bold|…] [--tier safe|sensual|explicit] [--scene …] [--no-telegram]
buddy lora selfie-cache --tier safe|sensual|explicit [--per-style 5] [--styles studio,tender]
```

Train **cloud** : opt-in `CODEBUDDY_LORA_TRAIN=true` + `FAL_KEY` (fal `krea-2-trainer`, ~$0.003/step).
Install : copie vers ComfyUI `models/loras`.
**Selfie** : génère un portrait Lisa (trigger LoRA) + `sendPhoto` Telegram. Doc : [krea-lora.md](./krea-lora.md).

**Cache à trois niveaux** : stocke les variantes dans
`.codebuddy/lora/lisa/selfie-cache/<niveau>/<style>/`. `safe` et `sensual`
(non explicite, zones intimes couvertes) sont générables directement. `explicit`
reste verrouillé sauf si une route commerciale vérifiée active explicitement
`CODEBUDDY_ADULT_CONTENT_ENABLED=true` avec contrôle 18+, consentement, modération
et journal d'audit.

### Research and Orchestration

```bash
buddy research "<topic>" [--workers N] [--rounds N] [--report file.md]
  [--wide] [--checkpoint state.json | --resume state.json] [--json]
buddy meeting notes <transcript|audio|video> [--output prefix] [--force] [--json] [--language fr] [--ai|--no-ai]
buddy flow "<goal>" [--max-retries N] [--verbose]
buddy goal "<goal>" [--max-turns N] [--judge-model <model>] [-m <model>]   # headless Ralph loop: full agent + judge until done (exit 0) or paused (exit 1)
buddy loop "<goal>" [--max-turns N] [--budget USD] [--verify-cmd <shell>]  # plan → execute → independent proof gate → judge
buddy intent [graph|proofs|progress|integrity|outcomes|constitution|exchange|shadows] [--json] [--limit N] # durable intent, proof chain and sovereign execution views
buddy forge create|evaluate|compare|select ...                              # proof-gated Counterfactual Forge branches
buddy exchange constitution|bid|rank|rehearse|award|reject ...              # policy-gated multi-LLM/Fleet market and Shadow Twin
buddy capsule list|create|activate|revoke ...                               # proof-backed portable workflows from proven outcomes
buddy llm
buddy llm ensemble "<question>"
buddy council "<task>" [-n 3] [--models gpt,ollama] [--judge <model>] [--task-type code|reasoning|french|vision|general] [--fleet] [--no-conductor] [--no-synthesis] [--no-consensus]
buddy council --scoreboard
buddy hermes profile|agent|doctor|plan|toolsets|hooks|prompt-size|parity|tools-parity|tools [dispatchProfile] [--json] [--markdown] [--plan-output file]
buddy hermes status [dispatchProfile] [--json]
buddy hermes smoke [--json]
buddy hermes model status [--json]
buddy hermes providers status [--json]
buddy hermes portal status|tools|open [--json]
buddy hermes messaging status [--json] [--config <path>]
buddy hermes mobile status [query...] [--json]
buddy hermes trajectories status [query...] [--run-id <id>] [--json]
buddy hermes learning status [--json] [--limit N]
buddy hermes protocols status [--json]
buddy hermes protocols-smoke local [--json]
buddy hermes browser status [--json]
buddy hermes browser-smoke local-playwright [--json]
buddy hermes runtime status [--json]
buddy hermes runtime-smoke local [--json]
buddy tools browser-operator draft "<goal>" [--source-url URL] [--mode isolated|local] [--json]
buddy tools skill-candidate list|inspect|install [candidatePath] [--approved-by name] [--json]
```

`buddy council` is the multi-AI collective path. It routes the task to capable
models, assigns complementary conductor roles for complex work (architect,
implementer, reviewer, verifier, skeptic, etc.), runs the answers in parallel,
uses a neutral judge, synthesizes the role-specialized answers into one final
answer, reports lexical agreement plus a confidence signal, and updates the
model scoreboard by task type. `--fleet` adds connected Code Buddy peers as more council members;
`--no-conductor` restores the old direct fan-out where every model receives the
exact same prompt, and `--no-synthesis` keeps only the judge-selected best
answer. `buddy council --scoreboard` also shows role specialists when the ledger
has role history, so future runs can put stronger models on reviewer, verifier,
architect, and related roles. The research notes live in
[`docs/research/council-scientific-notes.md`](research/council-scientific-notes.md).

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
mapping, effective runnable tools, raw tool filter, active model, inferred provider, detected
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

`buddy hermes model status [--json]` prints the compact user-facing view for
the active model. It keeps only the current model, inferred provider,
credential source names, capability flags, context/output limits, configured
alternatives, and copy/paste next-step commands such as `buddy whoami`,
`buddy login`, `buddy hermes providers status --json`, and
`buddy hermes doctor safe --json`. Use it when the full provider matrix is too
noisy for setup troubleshooting or Cowork onboarding.

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
local-operator-gated. Pairing device labels are capped at 120 Unicode
characters; oversized labels are rejected before any bearer token is minted.

`buddy hermes trajectories status [query...] [--run-id <id>] [--json]`
wraps the real RunStore trajectory surfaces in a Hermes-scoped compatibility
report. It inventories redacted trajectory export, recall-pack compression,
Learning Agent retrospectives, golden workflow evals, policy evals, and native
trajectory-batch generation/compression. Pass a real stored `--run-id` to prove
export counts and redaction metrics without replaying tools; pass a query to
probe recall-pack and batch matches.

`buddy hermes learning status [--json] [--limit N]` summarizes the closed
learning-loop state from real local files. It reports recent run counts,
retrospective artifacts, lesson candidate counts, accepted/pending user-model
counts, Learning Agent skill usage scoring, pattern-library counts, review
gates, and safe next commands without printing private observation content.
The JSON includes `summary.inspectedRunLimit`, and its `runDoctor` command uses
the same `--limit` so stale-running counts are compared against the same
recent-run window.
Learning Agent skill-candidate samples include relative `candidatePath`,
`reviewManifestPath`, `inspectCommand`, and eligible `installCommand` fields;
generated commands quote candidate paths when needed without printing SKILL.md
bodies. The compact `buddy hermes status safe --json` overview mirrors only the
next review item as `readiness.skills.nextCandidate`, so Cowork can offer the
same action without fetching the full skills queue.

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
`hermes doctor` payload. `buddy hermes runtime-smoke local --json` runs a real
local subprocess smoke for the selected backend.

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
before becoming active workspace skills. Learning Agent candidates are visible
after the first real trajectory, but they are not install-eligible until the
same workflow has at least two successful observations and the pattern library
marks it reinforced.
The JSON list output includes a `summary` block with total, shown, eligible,
and not-yet-eligible counts so review UIs can show queue readiness without
reading candidate bodies. Each candidate item also includes review-safe
`candidatePath`, `reviewManifestPath`, and `inspectCommand` fields; eligible
items include an `installCommand` template. Generated commands quote candidate
paths when needed while keeping `candidatePath` as the raw structured value.

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
buddy assistant show
buddy assistant set <key> <value>
buddy assistant voice <pocket-name-or-sample>
buddy assistant voices
buddy assistant voicebox [--json] [--benchmark [text]] [--runs <1-5>]
buddy assistant voicebox-clone <name> <audio> --text <transcript> --consent [--language fr] [--select]
buddy assistant voicebox-preset <name> --voice <id> [--engine kokoro] [--language fr] [--select]
buddy assistant voicebox-model <download|cancel|unload|delete> <model-name> [--yes]
buddy assistant voicebox-delete <profile-id> --yes
buddy assistant latency [--json] [--query <text>] [--engine active|pocket|voicebox|both] [--runs <1-5>] [--segment-chars <32-240>]
buddy assistant quality [--apply] [--limit <n>]
buddy assistant benchmark [--model <name>] [--base-url <url>] [--runs <n>]
buddy assistant relational-benchmark [--json]
buddy assistant apply
buddy companion setup [--force] [--no-voice] [--no-set-model]
buddy companion status
buddy companion live [--no-record]
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

`buddy assistant relational-benchmark` est un auto-test déterministe des fixtures du
détecteur relationnel. Il n'appelle ni modèle ni surface réelle ; utilisez `assistant benchmark`
ou `assistant compare` pour évaluer les réponses d'un modèle.

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

`buddy companion live` is the MySoulmate-inspired preflight: it checks the
already-built companion layers as one integrated path instead of treating them
as isolated demos. It scores the required live-session checks (identity, ChatGPT
brain, camera, sensory server flags, voice-assistant behavior
(`ear.py` live microphone → `speech_end` → faster-whisper STT → response gate →
think/agent → speak, with voice actions kept in
`CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE=default` in an async-scoped guarded turn; explicit `buddy voice --mode plan` sessions stay read-only), token-gated camera
auth (`CODEBUDDY_SENSORY_TOKEN` must match `BUDDY_SENSE_TOKEN`), webcam/USB
microphone autodetection (`BUDDY_EAR_DEVICE=auto` via `arecord -l`), and the
Python `buddy-vision/watch.py` sidecar with `websocket-client` plus its
MediaPipe/YOLO backend), lists optional layers (presence, idle work, reminders,
Telegram voice, YOLO model, Fleet tools), gives the exact `buddy server`,
microphone sidecar, and `buddy-vision` commands to run, and records a `self`
percept unless `--no-record` is passed. STT comprehension defaults are tuned for
the French companion path and can be overridden with `CODEBUDDY_SPEECH_LANG`,
`CODEBUDDY_SPEECH_BEAM_SIZE`, `CODEBUDDY_SPEECH_VAD_FILTER`, and
`CODEBUDDY_SPEECH_INITIAL_PROMPT`. In live sensory mode, faster-whisper is kept
warm in a persistent worker to avoid reloading the model on every utterance;
override with `CODEBUDDY_SPEECH_WORKER=false`, `CODEBUDDY_SPEECH_MODEL=tiny|base|small`,
or the worker timeout variables when tuning for lower latency.

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
pass `--no-record` for a read-only brief. Hearing percepts now carry voice-loop
timings (`sttMs`, `decisionMs`, `actionMs`, `totalMs`) and capture details
(`device`, `peakRms`, `avgRms`, VAD thresholds); if STT or the full loop is too
slow, impulses raises `Reduce voice latency`, and if the signal is too close to
the VAD threshold it raises `Improve voice capture`.

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
counts. `hearing` percepts include the selected capture device, RMS signal
quality, and latency breakdown so real-time voice regressions can be diagnosed
from the journal. This is the Lisa-inspired backbone for future continuous voice, screen share,
proactive suggestions, and self-state panels.
`buddy companion self` writes Buddy's current model/auth/voice/camera readiness
as a `self` percept, giving the companion a small, inspectable proprioception
trail.
Cowork exposes the same journal in the Buddy companion titlebar panel, including
recent percept filters, self-state recording, and explicit camera snapshots for
the active project.

### Observability

```bash
buddy run list                      # List recent runs (most recent first, 30-run prune)
buddy run doctor [--json]           # Report stale running runs without mutating the run ledger
buddy run show <run-id>             # Show full event log for a run
buddy run search <query> [--json]   # Search run summaries, events, artifacts
buddy run index-doctor [--repair]   # Report/repair stale artifact index rows (pruned/moved runs)
buddy run lineage <run-id>          # Show the fork family tree of a run (ancestors + descendants)
buddy run recall-pack <query>       # Build a cited context handoff from runs
buddy run trajectory-export <run-id> # Export a redacted run trajectory for audit/evals
buddy run trajectory-batch [query]  # Export redacted trajectory batch + compressed context
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

`buddy run doctor [--json]` is read-only. It reports stale running run IDs,
ages, event counts, artifact counts, and only generic run sources; arbitrary
run channel labels are collapsed to `custom` so operator diagnostics can be
pasted into handoffs without exposing private channel names.

`buddy run trajectory-export <run-id> --json` exports the run objective,
selected context, tool calls, tool results, artifacts and final answer through
the same secret-redaction engine used by supervision payloads. Artifact content
is metadata-only by default; add `--include-artifact-content` for capped,
redacted previews.

`buddy run trajectory-batch [query] --json` collects matching stored runs (or
explicit `--run-id` values), exports each through the same redacted trajectory
boundary, and adds a bounded `compressed.text` context block for Hermes-style
research batches and future agents. It is read-only and does not replay tools.

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
