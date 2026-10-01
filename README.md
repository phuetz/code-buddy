# Code Buddy 2

**A local-first terminal coding agent.** The model proposes actions; Code Buddy runs
repository tools under the configured permissions. Local execution needs an Ollama
model that supports tool calls; cloud providers are optional.

The release criterion for October 8 is a **fresh installation with a small local
model**, including the first coding task and verification of its result. That
criterion is **not proven by the traces on this branch**. A successful run on a
developer's machine, a component test or a GIF does not establish it.

[Français](README.fr.md) · [Install](#install) · [First run](#first-run) ·
[Opt-in](#opt-in) · [Not ready](#not-ready) · [License](#license)

<!-- proven-features:start -->
## Feature status

[`PROVEN 1/338 | NOT PROVEN HERE 337 | INCLUDING LATEST FAILED RUNS 9`](docs/PROVEN-FEATURES.md)
**1/338 features proven**; 337 not proven here, with reasons (including 9 latest failed runs, historical when the source digest is stale).
Each “proven” state covers the captured component scenario, with its scenario limit when recorded. This total does not validate a fresh installation.
[Statuses, reasons and traces by domain](docs/PROVEN-FEATURES.md) · [Français : état des fonctionnalités](docs/FONCTIONNALITES-PROUVEES.md)
<!-- proven-features:end -->

## Install

Node.js 20 is the declared CLI minimum; Node.js 22 or 24 is recommended in the
[installation guide](docs/install.md). The source is a 2.3.0 candidate; the npm
package may lag this checkout. Check the installed version.

```bash
npm i -g @phuetz/code-buddy
buddy --version
buddy doctor --offline
```

For local use, install and start [Ollama](https://ollama.com), make a tool-calling
model available, then configure it:

```bash
buddy onboard
buddy
```

See [Getting started](docs/getting-started.md) for configuration and
[source installation](docs/install.md). Cloud login is optional; each provider
has its own access requirements. A local model has no cloud API charge, but still
uses your hardware.

Cowork requires a source checkout and Node.js ≥ 22; it is absent from the npm
CLI package. From a built checkout, run `node dist/index.js install-gui`, then
`node dist/index.js gui`. See the [Cowork setup](docs/cowork.md).

## First run

In a disposable project, `buddy try` offers a coding exercise. Inspect the written
files and test output. A process exit code alone does not prove that the requested
result exists.

`buddy loop` accepts a verification command. Inspect its result and the files
changed before relying on the outcome:

```bash
buddy loop "make the failing tests pass" --verify-cmd "npm test"
```

```bash
buddy try
buddy -p "explain the entry point"
```

These are entry points to try, not a successful cold-install transcript. The
[feature index](docs/FONCTIONNALITES.md) states which scenarios have sufficient
captured evidence and why the others remain unproven here.

## Opt-in

`CODEBUDDY_PROVIDER=ollama` selects local routing. Optional mechanisms and their
configuration are described separately:

- [Cowork desktop](docs/cowork.md): separate Electron installation.
- [Fleet](docs/fleet-guide.md): peer models and read-only remote tools.
- [Memory and proposal mechanisms](docs/learning-mechanisms.md): inspectable
  artifacts and experimental proposal paths; no measured improvement claimed here.
- [Voice and perception](docs/FONCTIONNALITES-PROUVEES.md#domain-sensory): no
  demonstrated speech conversation on this branch.
- [Permissions and sandboxing](docs/security.md): the captured Linux bubblewrap
  probe covers one component scenario, not every agent command or platform.

In a session, `/batch <goal>` requests bounded sub-agents;
`CODEBUDDY_BATCH_CONCURRENCY` caps their concurrency. `buddy improve status`
inspects the experimental proposal mechanisms. They are **propose-only** by
default; applying a result requires `CODEBUDDY_SELF_IMPROVE=true` and `--apply`.
No retained improvement or productivity gain is established here.

Enabling an option or locating its code does not prove its user outcome. These
areas use the same statuses as the generated feature index.

## Not ready

- The fresh-install/small-model release criterion remains unproven here.
- The latest recorded LSP and video-understanding attempts failed because of
  missing prerequisites. Their source digests are stale; no current success or
  current failure is established by those attempts.
- The Telegram trace uses a simulated local Bot API, not a public Telegram account.
- Voice configuration does not prove synthesis, microphone capture or a spoken
  reply. The five Cowork entries have no execution trace in this catalogue.
- The proposal traces show rollbacks, rejected tools or empty archives, not a
  retained improvement or a measured productivity gain.
- No Windows, macOS, phone, camera or microphone validation is claimed by this
  documentary review. Consult the checks for the exact release you use.

## Existing illustrations

![Historical Cowork capture, illustration only; not a fresh-install proof](docs/screenshots/cowork-first-bonjour.png)

The [coding GIF](docs/assets/showcase-try.gif), [Cowork recording](docs/qa/code-buddy-studio/cowork-demo-moneyshot.mp4)
and [French presentation](https://youtu.be/2XgFHxBeI8Q) are secondary illustrations.
The presentation uses a synthetic voice and portrait. These media are not part of
the evidence count and do not validate a fresh installation.

LM Resizer is optional (`CODEBUDDY_LM_RESIZER=true`). The 0.2.4 native integration uses MCP `lm_resizer_tool_output` to process large observations after Code Buddy executes the command, with raw-output recovery and fallback on error. See the [tool reference](docs/tools-reference.md#lm-resizer).

## License

Business Source License 1.1 — see [LICENSE](LICENSE). Self-host and personal / non-commercial use
are free; providing Code Buddy as a commercial service to third parties is not permitted. Converts
to Apache 2.0 on 2030-08-31. Bundled Python skills stay MIT (see their `SKILL.md`).


## Documentation

- [Feature status, reasons and traces](docs/PROVEN-FEATURES.md) · [French](docs/FONCTIONNALITES-PROUVEES.md)
- [Getting started](docs/getting-started.md) · [Commands](docs/commands.md)
- [Source areas and limits](docs/features.md)
- [Changelog](CHANGELOG.md) · [2.3.0 release notes](docs/RELEASE-NOTES-2.3.0.md) · [2.3.0 preview](docs/whats-new-2.3.md)
- [2.2.0 release notes](docs/RELEASE-NOTES-2.2.0.md)

[Report a bug](https://github.com/phuetz/code-buddy/issues)
