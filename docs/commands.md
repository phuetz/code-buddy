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
| `/persona list\|use\|info\|reset` | Manage AI personas |
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
buddy daemon stop | restart | status | logs [--lines N]
buddy heartbeat start | stop | status | tick
buddy trigger list | add | remove
```

### Research and Orchestration

```bash
buddy research "<topic>" [--workers N] [--rounds N] [--output file.md]
buddy flow "<goal>" [--max-retries N] [--verbose]
buddy hermes profile|agent|doctor|plan|hooks [dispatchProfile] [--json] [--markdown] [--plan-output file]
buddy tools browser-operator draft "<goal>" [--source-url URL] [--mode isolated|local] [--json]
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
buddy identity show | get | set | prompt
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
```

### Observability

```bash
buddy run list                      # List recent runs (most recent first, 30-run prune)
buddy run show <run-id>             # Show full event log for a run
buddy run search <query> [--json]   # Search run summaries, events, artifacts
buddy run recall-pack <query>       # Build a cited context handoff from runs
buddy run trajectory-export <run-id> # Export a redacted run trajectory for audit/evals
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
