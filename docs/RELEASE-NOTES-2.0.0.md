# Code Buddy 2.0.0 — Release Notes

**Released:** 2026-08-26 (version bump) · **Notes revised:** 2026-09-05
**Compare:** [`v1.8.0...v2.0.0`](https://github.com/phuetz/code-buddy/compare/v1.8.0...v2.0.0)
**Full detail:** [`CHANGELOG.md`](../CHANGELOG.md) — this page is a themed synthesis, not a
commit-by-commit transcript.

## Scale

| Measure | Value |
| --- | --- |
| Commits at the 2.0.0 version bump | 575 since v1.8.0 |
| Commits on this branch since v1.8.0 | 1814 (a September hardening campaign landed after the bump) |
| Breakdown (full range) | 661 `fix`, 537 `docs`, 234 `feat`, 170 `test`, 49 `chore` |
| `BREAKING CHANGE` footers / `!:` subjects | 0 |

2.0.0 is a **change of nature, not of interface**. Every headline capability is opt-in: with its
environment variable unset, behavior is the same as 1.8.0.

---

## Highlights

- **Multi-AI fleet hub.** Peers running `buddy server` observe each other's events and call each
  other's models and read-only tools: one-shot `peer.chat`, multi-turn `peer.chat-session.*`,
  and `peer.tool.invoke` behind three ordered gates (allowlist → registry `fleetSafe` flag →
  workspace root, which **fails closed** when unset).
- **Cowork desktop GUI.** An Electron app (separate package, Node.js ≥ 22) with a visual workflow
  runner, a media library, and a Video Studio panel.
- **Ten opt-in innovations** shipped as one campaign — shadow workspace, time-travel sessions,
  intent ledger, CKG federation, self-benchmark, context zoom-in, generative UI, perceptive pair,
  skill exchange, multi-repo workspace. Index: [`docs/cb2/README.md`](cb2/README.md).
- **A Darwin-Gödel-style self-improvement loop with four learnable surfaces** — lessons, tools,
  skills, and (new in this cycle) **execution strategies**. Every surface is empirically gated and
  rolled back on regression; none of it may edit the agent's own `src/`.
- **A council with a learning scoreboard** that judges answers across models and learns which
  model wins which task category.
- **A perception/companion stack** — Rust sense daemon, speech loop, camera reactions, reminders.

---

## New

### Fleet and multi-agent

- Multi-turn peer sessions (`peer.chat-session.start|continue|end|continue-stream|list`),
  FIFO-serialised per session, idle-TTL'd, persisted. `list` returns metadata only — never prompt
  or assistant content.
- Remote read-only tool execution (`peer.tool.invoke` + `.stream`) with anti-loop depth and role
  guards.
- `route_peer` / `/fleet route`: a task router that classifies a prompt, gathers peer
  capabilities, and applies privacy, cost and latency constraints; a privacy lint runs first.
- Lightweight multiplexed sub-agents (`/batch`, `/swarm`, `/team`) — a real bounded agent per unit
  instead of a bare completion, with inherited-but-reduced budgets and downward cancellation.
  Concurrency is configurable and still defaults to 1.

### Self-improvement (four surfaces)

- **Strategies** — the fourth surface: how the agent *executes* (round ceiling, cost cap,
  reasoning level, verification requirements, short directives) as a schema-validated JSON in
  which, by construction, no field can disable a guard. A five-stage gate ends in an **empirical**
  paired-replay test; nothing is kept on schema alone.
- **Tools and skills** the agent authors itself, gated by static scan, a prompt-injection
  firewall, visible cases, and — for tools — **held-out** cases hidden from the proposer.
- **Skill curation and import**: pin/archive/restore, coverage-gated consolidation, and import of
  external skill libraries through the same firewall, with dangerous skills quarantined.
  *Limite connue* : la déobfuscation (homoglyphes, césures, zero-width) n'est appliquée qu'à la classe `prompt-injection` (`src/security/skill-scanner.ts:337-338`) ; les autres classes (destructif, exfiltration, réseau, identifiants) restent comparées au texte brut, décision de politique en attente.
- **Self-benchmark**: capability scores per model over time, with moving-average regression
  detection feeding the council scoreboard.
- The capability benchmark used as fitness grew from 3 substring checks to 15 scenarios, each
  anchored to a documented invariant, with orthogonality and non-triviality tests.

### Council and routing

- `buddy council scoreboard import|best`, five literary task categories alongside code, reasoning
  and vision, and FR/EN inference from the prompt.
- Members answer under a falsifiable-output contract; the judge returns dual scores so critics are
  not punished for critiquing; a dead judge is penalised and replaced mid-run; each run logs a
  deliberation-health record.

### Platform

- Kernel-level sandboxing for `bash` (Bubblewrap → Landlock → macOS `sandbox-exec`), opt-in and
  **fail-closed**: if confinement cannot be applied, the command does not run unsandboxed.
- A pre-application **diff-review gate** wired into all five write surfaces, with a transactional
  apply, a TOCTOU base re-check, an audit journal, and an optional revision loop.
- Home-profile backup by allowlist: `buddy backup create|verify|restore --home`.
- Long-form film production (`buddy film`, `video_stitch`) and a prompt-to-video studio.
- A Rust CKG engine (`buddy-memory`) behind the collective knowledge graph, with snapshot
  fast-load and a sub-linear recall index; the TS implementation stays the fallback.

---

## Changed — behavior worth knowing

These are the changes most likely to be *noticed*. None of them break an interface.

1. **System-prompt composition.** The prompt was measured block by block and went from 203 674 to
   49 489 characters. `.codebuddy/TOOLS.md` (66 % of the total) is no longer injected — tools are
   already described by their function schemas. The **canonical startup files are `AGENTS.md` and
   `CODEBUDDY.md`**; the interoperability files (`CLAUDE.md`, `GEMINI.md`, `CONTEXT.md`,
   `INSTRUCTIONS.md`) are served by the just-in-time context loader, or admitted back into the
   startup prompt by opting in with **`CODEBUDDY_INCLUDE_INTEROP_CONTEXT=true`**. When
   truncation is still required it now removes **whole blocks by priority** (security > workspace
   > tools > style > context > examples) and logs what it dropped, instead of cutting blind
   mid-sentence.
2. **Headless cost is honest.** Cost is computed from the provider's returned `usage` with a
   per-model tariff, and reports three fields: `estimated`, `pricing`
   (`known` / `unknown` / `subscription`) and `billing` (`pay-per-use` / `subscription`). A
   subscription-backed run reports `total: 0` instead of a fabricated figure.
3. **Headless JSON names the model that actually answered.** When a provider silently substitutes
   a model, the output carries `model` = the effective model and `requestedModel` when they
   differ, and the fallback is announced once on stderr without needing verbose mode.
4. **`buddy backup` gained a home scope.** `--home` (or `--scope home|both`) backs up an allowlist
   of the user profile — settings, personas, memory, reminders, MCP, skills, the self-improvement
   store, the CKG ledger — with per-file and total size caps, refusing secret-shaped files even
   when asked, and keeping a `.bak` copy before any overwrite on restore.
5. **One server, one port.** `buddy server` opens a single port with `/ws` on it. The
   second-port convention is a *second process*, and the docs now say so.
6. **CORS is documented as what it is.** An unlisted origin gets a normal 200 without
   `Access-Control-Allow-Origin`; the 403 exists only on the WebSocket handshake. CORS is not an
   access control — the JWT and the network are.
7. **Model context resolution.** A hosted `/v1/models` catalogue no longer downgrades an explicit
   per-model declaration — only a local runtime (Ollama, LM Studio, vLLM) may lower one — and
   stub catalogue entries advertising no real capability are ignored. `CODEBUDDY_MAX_CONTEXT`
   overrides everything, and now actually reaches an Ollama server through its native chat
   endpoint (the OpenAI-compatible route silently ignores the context option).
8. **`js-yaml` moved back to a real dependency** (it is imported while loading configuration).
   `better-sqlite3` stays optional but now degrades cleanly instead of crashing.
9. **CI is green on the blocking target** and the build step runs *before* the tests.

---

## Fixed

Grouped by theme; 661 `fix` commits are not reproduced individually.

- **Installability.** On a package installed into an empty directory with no optional dependencies
  and no configuration, **22 of 103 commands crashed at startup — none do now**, including `loop`,
  `goal`, `research`, `flow` and `tools`. `sharp`, the bundled ripgrep binary and the ngrok native
  binary are now loaded lazily. `scripts/balayage-installation.sh` replays this check per release.
- **"Announced success without accomplishment."** A sustained campaign against the pattern where a
  run reports success it did not achieve: video montage reporting a render with no file, quality
  gates passing on a failed analysis, channels confirming a send that never happened, skills
  importing into an invisible folder, backup restore that never wrote bytes, a tool call rendered
  as prose being treated as a headless success.
- **Silent fallbacks closed.** Thirteen in the long-form video pipeline alone — the worst replaced
  a missing narration script with an automatic transcription. A media pipeline now fails loudly or
  produces correctly, never wrong in silence.
- **Caches blind to their own source.** Five video caches that ignored a change in the input they
  derived from, all invalidated by a fingerprint.
- **Streaming tool calls.** The first tool call of a turn could lose its arguments against
  providers that number calls from 1; deltas are now merged by index from the first chunk.
- **Headless permissions.** Read-only `git -C <path>` invocations were classified as requiring
  approval and therefore refused without a terminal, which prevented a headless run from reading
  `git status`; they now run sandboxed without escalation, while protected paths stay blocked
  after tilde expansion.
- **Context management.** Orphaned tool results after compaction, unmatched tool calls, budget
  recomputation on model change, segment-integrity checks on restore, multimodal content counted,
  multiple system messages preserved.
- **Robot and voice.** The companion answering its own echo (a half-duplex guard now independent
  of the capture layer's echo-cancellation claim, plus an "this is my own sentence" filter), a
  motion threshold below the sensor noise floor in the dark, a TTS usage lock held across an
  entire HTTP request, and choppy audio under CPU saturation.
- **Test hygiene.** Several suites were writing into the real user profile and the real
  repository — including one that created two full copies of the repo and one that atomically
  replaced a settings file with an empty temporary. Suites are now hermetic, with a global setup
  that fails if the two canonical files change during a run.

---

## Breaking changes

**None.** There is no `BREAKING CHANGE` footer and no `!:` subject in the entire
`v1.8.0..HEAD` range. The 2.0.0 major bump marks the change in scope, not an interface break; the
ten campaign features are inert unless their environment variable is set.

One operational note that is *not* a breaking change but can surprise: the **test toolchain** no
longer runs on Node 18 (Vitest 4 and Vite 7 require Node ≥ 20). The shipped CLI still declares
`engines.node >= 18`; this affects contributors running the suite, not users installing the
package.

---

## Known issues

- **Only the Ubuntu CI legs are blocking.** macOS and Windows run best-effort
  (`continue-on-error` when the OS is not `ubuntu-latest`, `.github/workflows/ci.yml`). Their
  results are surfaced but do not gate a green CI — a deliberate, visible choice rather than a
  silent removal of coverage; the non-Linux jobs still run the full suite and report pass/fail.
- **macOS PTY.** Interactive shell execution can fail on macOS runners with
  `PTY execution failed: posix_spawnp failed`. This was **deliberately not fixed blind**: from a
  Linux host it is not possible to distinguish a `node-pty`/ABI defect from a runner image,
  permission or spawn-option problem. Reproducing it on a macOS runner is still open.
- **Windows test suite is sharded** because Node runs out of heap on the full file set.
- **`better-sqlite3` is a native module.** A few test files are skipped where Electron headers are
  unavailable, and the Cowork app rebuilds it against Electron headers on install.
- **The published npm release can lag this source tree.** Check `buddy --version` after
  installing.

---

## Upgrading

Nothing to migrate. Install or update, then verify:

```bash
npm i -g @phuetz/code-buddy
buddy --version        # 2.0.0
buddy doctor           # one-line readiness check
```

New capabilities stay off until you opt in — see the table in the
[README](../README.md#opt-in) and the per-feature docs in [`docs/cb2/`](cb2/README.md).
