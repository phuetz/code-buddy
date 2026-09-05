<div align="center">

# Code Buddy 2

**A local-first AI coding agent that can also run as a fleet, a desktop app, and a companion.**
It reads your repository, writes code, runs commands, and you can watch it work — on your machine,
at $0 with [Ollama](https://ollama.com) or a ChatGPT subscription.

<p>
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/v/@phuetz/code-buddy.svg?style=flat-square&color=ff6b6b&label=version" alt="npm version"/></a>
  <a href="https://github.com/phuetz/code-buddy/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://github.com/phuetz/code-buddy/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI on main"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BSL_1.1-feca57.svg?style=flat-square" alt="License: Business Source License 1.1"/></a>
</p>

[What 2.0 is](#what-20-is) ·
[Install](#install) ·
[First run](#first-run) ·
[Opt-in](#opt-in) ·
[Not ready](#not-ready) ·
[License](#license) ·
[Documentation](#documentation)

<p>
  <a href="docs/qa/code-buddy-studio/cowork-demo-moneyshot.mp4"><img src="docs/qa/code-buddy-studio/cowork-demo-moneyshot.gif" alt="A local model reasons, then uses a tool to create a real file — no cloud API bill" width="760"/></a>
  <br/>
  <sub>A local model reasons on screen, then uses a tool to create a real file. No cloud API bill.</sub>
</p>

</div>

---

## What 2.0 is

1.x was a terminal coding agent: 64 providers behind one router — cloud, gateway and local
runtimes — and 220+ tools selected per query. 2.0 keeps all of that unchanged and adds five
surfaces around it. Every one of them is **opt-in**: with its environment variable unset, behavior
is the same as 1.8.0. There is no `BREAKING CHANGE` in the 2.0 range.

- **A multi-AI fleet hub.** Peers running `buddy server` observe each other's events and call each
  other's models: one-shot `peer.chat`, multi-turn `peer.chat-session.*`, and `peer.tool.invoke`
  for remote **read-only** tools. That last one passes three ordered gates — an allowlist, a
  per-tool `fleetSafe` flag, and a workspace root that **fails closed** when unset, so a
  misconfigured peer cannot expose its disk. See [Fleet](docs/fleet-guide.md).

- **Cowork, a desktop GUI.** An Electron app with a visual workflow runner, a media library and a
  video studio. It is a separate package needing Node.js ≥ 22 — see [Cowork](docs/cowork.md).

- **Ten opt-in innovations.** Speculative writes validated in a ghost worktree before touching
  your files, per-turn time-travel sessions, falsifiable intent specs, pull-only knowledge-graph
  federation between peers, a capability self-benchmark, recoverable ("zoom-in") compaction,
  generative widgets, on-screen error watching, signed skill packages, and read-only multi-repo
  search. Index: [`docs/cb2/README.md`](docs/cb2/README.md).

- **A self-improvement loop with four learnable surfaces.** The agent can propose *lessons*,
  *tools* it writes itself, *skills*, and *execution strategies* — and each proposal is
  **empirically gated**: applied to a snapshot, re-scored, and rolled back on regression or no
  gain. Authored tools face held-out cases hidden from the proposer, so a tool that hardcodes the
  visible answers is rejected. A strategy is a schema-checked JSON in which no field can disable a
  guard. The loop never edits the agent's own `src/` — that is a scanned invariant.

- **A council that learns which model to trust.** Several models answer under a
  falsifiable-output contract, a judge scores them, and a scoreboard records which model wins
  which kind of task. The judge abstains rather than guess.

- **A perception layer.** A Rust sense daemon (audio, vision, screen, UI focus, heartbeat) feeds
  events to the agent over a loopback-only bridge; speech, camera reactions and spoken reminders
  build on it. It stays silent until you turn it on.

<p align="center">
  <img src="buddy-sense/docs/architecture.svg" alt="Sense modules feed a thalamus that coalesces events and broadcasts them to a WebSocket bridge" width="720"/>
</p>

---

## Install

Three commands (Node.js ≥ 18):

```bash
npm i -g @phuetz/code-buddy   # the package is scoped; `code-buddy` alone is not on npm
buddy login                   # ChatGPT subscription — no API key, $0 marginal cost
buddy                         # start chatting
```

`buddy login` also accepts `xai`. To stay entirely local instead, skip it, start
[Ollama](https://ollama.com), and run `buddy onboard`. Either way `buddy doctor` tells you in one
line whether you are ready, and `buddy doctor --fix` can point a running Ollama at a suitable
installed model and say why it chose it.

The published package can lag this repository. To track the source instead:

```bash
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy && npm install
npm run build && npm link
```

The **Cowork** desktop app is a separate step needing Node.js ≥ 22: `buddy install-gui`, then
`buddy gui`. Details in [Getting started](docs/getting-started.md).

---

## First run

A real task, start to finish. `buddy loop` plans, edits, runs your verification command, and stops
only when that command exits 0 — the model's word is not the proof:

```bash
buddy loop "make the failing tests pass" --verify-cmd "npm test"
```

Other paths worth knowing on day one:

```bash
buddy try                             # 60-second demo: writes FizzBuzz + a test, runs it, verifies
buddy -p "explain the entry point"    # one-shot, headless — good for scripts and CI
buddy research "map this repository"  # parallel research workers
buddy cost --latency                  # measured per-model TTFT/TTFM, read-only
```

<p align="center">
  <img src="docs/assets/showcase-try.gif" alt="buddy try — the agent writes FizzBuzz and a test, runs it, independently verifies" width="760"/>
</p>

### Parallel sub-agents and self-improvement

In a session, `/batch <goal>` splits independent work across multiplexed sub-agents; each unit is a
real bounded agent, not a bare completion. `CODEBUDDY_BATCH_CONCURRENCY` caps how many run at once
(default `1`).

`buddy improve status` reports the local self-improvement state. `buddy improve cycle|tools|skills`
is **propose-only** by default; to keep an empirically validated result you must opt in with
`CODEBUDDY_SELF_IMPROVE=true` *and* pass `--apply`. Without the variable, `--apply` refuses and
names it.

---

## Opt-in

Nothing below is needed to chat with a local model. Defaults stay off.

| Switch | What it turns on |
| --- | --- |
| `CODEBUDDY_PROVIDER=ollama` | Force the local Ollama path (no API key). |
| `CODEBUDDY_MAX_CONTEXT` | Override the context window for every consumer, including the Ollama server itself. |
| `CODEBUDDY_SELF_IMPROVE=true` | Let the agent author its own tools and skills behind empirical gates. It never edits `src/`. |
| `CODEBUDDY_SHADOW_WORKSPACE` | Validate proposed writes in a ghost worktree *before* touching your files. |
| `CODEBUDDY_TIMELINE` | Per-turn timeline; `buddy replay` inspects, restores or forks a session. |
| `CODEBUDDY_INTENTS` | Falsifiable versioned specs, so "done" stays re-provable later. |
| `CODEBUDDY_CONTEXT_ZOOM` | Compaction becomes recoverable — the agent can re-expand a summarised segment. |
| `CODEBUDDY_WORKSPACE` | Read-only search and read across several repositories. |
| `CODEBUDDY_SELF_BENCH` | Track capability over time and flag regressions. |
| `CODEBUDDY_CKG_SYNC` | Pull-only knowledge-graph sync between fleet peers (fail-closed on both sides). |
| `CODEBUDDY_COLLECTIVE_MEMORY` | Inject the shared cross-agent knowledge graph into context. |
| `CODEBUDDY_DIFF_REVIEW` | Review every proposed diff before it is applied; an unreviewable diff is rejected, not applied. |
| `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` | Required for remote read-only tools between peers. Unset ⇒ every `peer.tool.invoke` fails closed. |
| `CODEBUDDY_SENSORY=true` | Perception and companion wiring on `buddy server`. |
| `CODEBUDDY_SENSORY_ERRORWATCH` | Offer help when an error appears on screen — debounced, capped, never acts on its own. |
| `CODEBUDDY_TTS_VOICE` | Spoken replies. Unset ⇒ the agent may hear, but stays silent. |
| `CODEBUDDY_INCLUDE_INTEROP_CONTEXT` | Also load interoperability context files (`CLAUDE.md`, `GEMINI.md`, `CONTEXT.md`, `INSTRUCTIONS.md`) into the system prompt. |
| `JWT_SECRET` | Required by the HTTP server in production. |
| `buddy --yolo` or `/yolo on` | Full autonomy with guardrails. Setting `YOLO_MODE=true` alone only warns; it does not arm it. |

Signed skill exchange, generative widgets, council-learned routing and kernel sandboxing have
their own gates, listed in [`docs/cb2/README.md`](docs/cb2/README.md) and
[Security](docs/security.md).

---

## Not ready

Honest limits for a first-time visitor:

- **The npm release can lag this tree.** Check `buddy --version` after installing; the source
  checkout above is what this page describes.
- **Only the Linux CI legs are blocking.** macOS and Windows run best-effort — their results are
  visible but do not gate a green build. Interactive-shell execution on macOS is a known open
  issue.
- **The test toolchain needs Node ≥ 20** even though the shipped CLI declares `>= 18`. That
  affects contributors, not users.
- **Cowork** is a separate install (Node.js ≥ 22, `buddy install-gui`), not part of the three
  commands above.
- **Film production** needs `ffmpeg`; without a local voice binary, scenes stay silent rather than
  getting a fake voice-over.
- **`buddy loop` needs a model that really calls tools.** A very small model can stall or give up
  without ever turning the test suite green.
- **Fleet** is two processes and a JWT, not one flag. Remote tools expose nothing until the
  workspace root is set.
- **Voice and robot paths** need extra local binaries (speech-to-text, text-to-speech, optionally
  a camera). They do not come from `npm install`.
- **`better-sqlite3` is native.** It is optional and degrades cleanly, but Cowork rebuilds it
  against Electron headers.

---

## License

Business Source License 1.1 — see [LICENSE](LICENSE). Self-host and personal / non-commercial use
are free; providing Code Buddy as a commercial service to third parties is not permitted. Converts
to Apache 2.0 on 2030-08-31. Bundled Python skills stay MIT (see their `SKILL.md`).

---

## Documentation

- **[Getting started](docs/getting-started.md)** — first run, headless mode, sessions.
- **[Release notes 2.0.0](docs/RELEASE-NOTES-2.0.0.md)** — what changed since 1.8.0.
- [Install](docs/install.md) — published npm, Docker/VPS, the one-command installer.
- [Commands](docs/commands.md) · [Features](docs/features.md) · [Security](docs/security.md)
- [Cowork Desktop](docs/cowork.md) · [Fleet](docs/fleet-guide.md) · [Code Buddy 2 features](docs/cb2/README.md)
- [Honest comparison](docs/honest-comparison.md) — where other agents are still ahead.

[Report a bug](https://github.com/phuetz/code-buddy/issues) ·
[Discuss](https://github.com/phuetz/code-buddy/discussions) ·
[Star on GitHub](https://github.com/phuetz/code-buddy)
