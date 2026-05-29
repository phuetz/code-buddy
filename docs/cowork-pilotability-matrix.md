# Cowork pilotability matrix — axis-B "definition of done"

Date: 2026-05-29. Source: `src/commands/slash/builtin-commands.ts` (135 builtin slash
commands) + `src/index.ts` CLI groups, traced through
`cowork/src/main/commands/slash-command-bridge.ts` (`resolveUiEffectAction` +
`COWORK_HEADLESS_ALLOW`) and `cowork/src/renderer/commands/slash-command-actions.ts`.

**This file is the falsifiable bar for "completely pilotable from Cowork."** Every
builtin slash command and CLI group has exactly one disposition below. "Done" =
every entry is `pilotable` or `deliberately-CLI-only` (with a reason). The
`route-to-<surface>` rows are the remaining implementation backlog.

> Reality check (verified 2026-05-29): the slash bridge — and 6 sibling IPC
> bridges — were **dead in-app** until the getter-sweep fix (handlers captured a
> `null` bridge registered before async boot). So pre-fix, *nothing* slash routed.
> Now `command.execute` + orchestrator/subagent/team/mention/skillMd/knowledge IPC
> work (proven by `cowork/e2e/slash-commands-smoke.spec.ts`).

## Disposition summary (135 slash commands)

| Disposition | Count | Meaning |
|---|---|---|
| 🟢 ui_effect-routed | 13 | Opens a real panel / applies an effect (S1/S4/S8/C1/C2) |
| 🟢 headless-allowlisted | 7 | Runs engine handler, renders output in chat (S0) |
| 🟢 prompt-forward | ~8 | Natural-language prompt → LLM answers in chat (commit, explain, refactor, docs, debug-issue, scan-todos, …) |
| 🟢 special-intercept | 2 | `/clear`, `/memory` (renderer) |
| 🟡 route-to-existing-surface (BACKLOG) | ~55 | Maps cleanly to an existing Cowork panel/settings-tab/toolbar — route via `resolveUiEffectAction` |
| 🟡 headless-safe-info (BACKLOG) | ~20 | Read-only/report command → add to `COWORK_HEADLESS_ALLOW` |
| 🔴 deliberately-CLI-only | ~30 | No operator-cockpit value, or TUI/OS-bound, or destructive — stays CLI by design |

## 🟢 Already pilotable (today)
- **ui_effect**: plan, config, model, lessons, permissions, parallel, swarm, companion, workflow, track, team, agents, fleet.
- **headless**: help, features, whoami, tools, cost, stats, status.
- **prompt-forward**: commit, explain, refactor, docs, debug-issue, scan-todos, generate-tests-as-prompt, address-todo (any backtick-prompt command).
- **special**: clear, memory.

## 🟡 BACKLOG — route to an EXISTING surface (the bulk of remaining work)
Each maps to a panel/settings-tab/toolbar that already exists → extend `resolveUiEffectAction` (+ dispatcher case) like C1/C2.

| Command(s) | Target surface |
|---|---|
| yolo, autonomy | YoloModeToggle / permission/autonomy controls |
| checkpoints, restore, undo, redo, timeline | checkpoint toolbar / timeline panel |
| branch, fork, branches, checkout, merge | BranchSwitcher |
| sessions | session list / SessionInsights |
| persona | PersonaSwitcherDialog |
| theme, avatar | Settings → general/appearance |
| vim, fast, dry-run, heal (self-healing), cache, prompt-cache | Settings → general |
| hooks | Settings → hooks tab |
| plugins, plugin | Settings → (plugins) |
| pipeline | Settings → workflows |
| skill, starter | SkillsBrowser |
| subagent, agent | SubAgentPanel / OrchestratorLauncher |
| think | reasoning trace viewer |
| pr, diff, review, conflicts, worktree | git/diff surfaces |
| security, guardian, security-review, vulns, secrets-scan, policy | Settings → rules / security review surfaces |
| knowledge-graph, remember | knowledge / memory editor |
| add, context, workspace | ContextPanel |
| search | global search dialog |
| voice, speak, tts | voice controls |
| export, save, export-list, export-formats | export dialog |
| approvals, batch-review, elevated | permission/approvals surfaces |
| switch, model-router, mode | model/mode selectors |
| tool-analytics | analytics / cost surface |
| identity | (C3 new identity panel) |
| cloud, trigger, heartbeat | (C3 / scheduler surfaces) |

## 🟡 BACKLOG — headless-safe info (add to allowlist)
Read-only/report; benign failure if realm differs. `shortcuts, history, log, quota, telemetry, coverage, bug` → add to `COWORK_HEADLESS_ALLOW`.

## 🔴 deliberately-CLI-only (legitimate "done")
Reason in parens. `init`/`reinit` (destructive workspace reset), `login`/`logout` (app handles auth UI), `reload` (process), `new` (TUI new-chat = Cowork sidebar), `compact` (history-dependent; engine auto-compacts), `btw` (TUI one-shot), `share`, `colab` (multi-IA file convention), `daily-reset`, `script`, `fcs` (FileCommander legacy), `dev` (golden-path CLI workflow), `transform`, `voice-code`, `suggest`, `ultraplan` (CLI best-of-N), `tdd`, `ai-test`, `watch`, `debug`, `test`/`lint`/`fix` (run via chat/agent or git surface), `infra`. Each: no incremental operator-cockpit value over chat/agent, or OS/process-bound.

## CLI groups (~40) — disposition
- 🟢 pilotable (panel/app): server/gui (app), spec, skills, lessons, user-model, cron/schedule (SettingsSchedule), provider/config (Settings), mcp (marketplace), companion, run (audit log).
- 🟡 route/new-panel (C3): secrets (vault), identity, device, knowledge, research, flow, hub, deploy, channels, daemon/trigger, backup, nodes, approvals, groups, pairing, autonomous-code, gitnexus, heartbeat.
- 🔴 CLI-only: completions, update, doctor, onboard, security-audit (one-off/OS).

## Acceptance
Done-for-axis-B = every 🟡 row is either implemented (→🟢) or reclassified 🔴 with a reason. Track C3 + the "route-to-existing-surface" batch close the 🟡 rows. The single-allowlisted **CLI-runner panel** (C3) can cover several 🟡 CLI groups (research/flow/hub/deploy/device-list) at once instead of bespoke panels.
