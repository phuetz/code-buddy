<div align="center">

# Code Buddy

**A local-first AI coding agent.** It reads your repository, writes code, runs commands, and you can watch it work — on your machine, at $0 with [Ollama](https://ollama.com).

<p>
  <a href="https://www.npmjs.com/package/@phuetz/code-buddy"><img src="https://img.shields.io/npm/v/@phuetz/code-buddy.svg?style=flat-square&color=ff6b6b&label=version" alt="npm version"/></a>
  <a href="https://github.com/phuetz/code-buddy/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://github.com/phuetz/code-buddy/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI on main"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BSL_1.1-feca57.svg?style=flat-square" alt="License: Business Source License 1.1"/></a>
</p>

[What it does today](#what-it-does-today) ·
[Install](#install) ·
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

## What it does today

Five one-command paths that exist in `buddy --help` and have been run against this source tree. Each needs a reachable local model (Ollama) or a `buddy login` session — not a paid API key.

**1. Local chat at $0** — start [Ollama](https://ollama.com), pull a small instruct model, then:

```bash
CODEBUDDY_PROVIDER=ollama buddy try
```

`buddy try` writes a FizzBuzz plus a test, runs it, and independently re-checks. With no provider it exits and prints setup commands; it does not silently call a paid API.

<p align="center">
  <img src="docs/assets/showcase-try.gif" alt="buddy try — the agent writes FizzBuzz and a test, runs it, independently verifies" width="760"/>
</p>

**2. A vertical short from a sentence** (needs `ffmpeg`; Piper narration is optional and skipped if the binary is missing):

```bash
buddy film from-prompt "A short explainer of a local coding agent" --short
```

**3. A dev loop gated by your tests** (exit 0 of the shell command is the proof, not the model's word):

```bash
buddy loop "make the tests pass" --verify-cmd "npm test"
```

**4. Two peers on one machine** — run this twice, on two ports:

```bash
JWT_SECRET=dev buddy server --port 3410
```

The second process uses another free port. Peers can call each other's models (`peer.chat`). Remote file tools stay **fail-closed** until `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` is set. Mint a join token with `buddy fleet token`.

**5. Voice companion** — push-to-talk, read-only posture (needs a microphone and a local speech stack):

```bash
buddy voice --mode plan
```

The 24/7 robot path is a different switch: `CODEBUDDY_SENSORY=true buddy server`, and it stays silent unless `CODEBUDDY_TTS_VOICE` is set.

Headless one-shot once a provider is configured: `buddy -p "explain the entry point of this repo"`.

---

## Install

Three commands, from this source tree (Node.js ≥ 18):

```bash
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy && npm install
npm run build && npm link
```

Then `buddy --help` and `buddy doctor`. `buddy doctor --fix` can point a running Ollama at a reachable model.

The published package is `@phuetz/code-buddy` (the unscoped name is not on npm). That channel can lag this repository — use the three commands above for what this page describes.

The **Cowork** desktop app is extra: Node.js ≥ 22, then `buddy install-gui` and `buddy gui`. Details: [Getting started](docs/getting-started.md).

---

## Opt-in

Nothing below is required to chat with a local model. Defaults stay off.

| Switch | What it turns on |
| --- | --- |
| `CODEBUDDY_PROVIDER=ollama` | Force the local Ollama path (no API key). |
| `CODEBUDDY_SENSORY=true` | Perception / companion wiring on `buddy server`. |
| `CODEBUDDY_TTS_VOICE` | Spoken replies. Unset ⇒ the robot hears (if STT is on) but does not speak. |
| `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` | Allow read-only remote tools between fleet peers. Unset ⇒ every `peer.tool.invoke` fails closed. |
| `CODEBUDDY_SELF_IMPROVE=true` | The agent may author its own tools/skills behind empirical gates. It does not edit `src/`. |
| `buddy --yolo` or `/yolo on` | Full autonomy. Setting `YOLO_MODE=true` alone only warns; it does not arm YOLO. |

Further extras (shadow workspace, time-travel sessions, widgets, …) are documented in [docs/cb2](docs/cb2/README.md) and are byte-identical to off when their env var is unset.

---

## Not ready

Honest limits for a first-time visitor:

- **`curl | sh` and `npm install -g`** install the last *published* release, which can lag this tree. This README describes the source checkout.
- **Cowork** is not the three-command CLI install. It needs Node.js ≥ 22 and `buddy install-gui`.
- **Film** needs `ffmpeg`. Without Piper, scenes are silent rather than a fake voice-over.
- **Loop** needs a model that actually calls tools. A tiny model can stall or exit without a green test.
- **Fleet** is two processes and a JWT, not a single magic flag. Remote tools do not expose your disk until the workspace root is set.
- **Voice / robot** need extra local binaries (STT, TTS, optional camera). They do not start from `npm install` alone.
- **Docker / VPS** is a separate 24/7 path (`docs/install.md`), not this page's first run.

---

## License

Business Source License 1.1 — see [LICENSE](LICENSE). Self-host and personal / non-commercial use are free; providing Code Buddy as a commercial service to third parties is not permitted. Converts to Apache 2.0 on 2030-08-31. Bundled Python skills stay MIT (see their `SKILL.md`).

---

## Documentation

- **[Getting started](docs/getting-started.md)** — first run, headless mode, sessions.
- [Install](docs/install.md) — published npm, Docker/VPS, the one-command installer.
- [Commands](docs/commands.md) · [Features](docs/features.md) · [Security](docs/security.md)
- [Cowork Desktop](docs/cowork.md) · [Fleet](docs/fleet-guide.md) · [Honest comparison](docs/honest-comparison.md)

[Report a bug](https://github.com/phuetz/code-buddy/issues) ·
[Discuss](https://github.com/phuetz/code-buddy/discussions) ·
[Star on GitHub](https://github.com/phuetz/code-buddy)
