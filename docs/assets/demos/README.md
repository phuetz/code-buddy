# Terminal recordings — 2.3.0 candidate

These five asciinema v2 recordings were captured from real Linux CLI executions on 27 September 2026 in an isolated HOME. Local absolute paths were replaced with `[REPOSITORY]` and `[ISOLATED_HOME]`; the recordings contain no credentials. Play one with `asciinema play docs/assets/demos/agent.cast` from the repository root.

| Recording | Result | Limit |
|---|---|---|
| [Local agent](agent.cast) | Ollama `qwen3:4b-instruct` called `read_file`, then answered `7.3.1`. | One fixture, one model, Linux. |
| [Run replay](replay.cast) | Re-read the recorded `package.json` after showing its tool event. | Only file-read replay tested. |
| [Provision plan](provision.cast) | Planned 14 files for a local database/auth overlay. | Dry-run; no files applied or database started. |
| [Security audit](security.cast) | JSON audit completed on a fixture project. | No remediation applied. |
| [Provider list](providers.cast) | Displayed configured/available provider status. | No hosted provider was authenticated. |

A separate [`buddy try --model qwen3:4b-instruct` execution](../../preuves/vitrine-buddy-try-echec.log) **failed**: it reached the tool-round limit without creating `fizzbuzz.test.js`. We excluded it from the successful recordings and from the 60-second walkthrough. The local read-file agent path above passed; that result does not imply this coding demo passes on the same model.
