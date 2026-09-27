# Code Buddy 2.3 — release candidate

**A coding agent you can run with a local model, inspect through its run ledger, and extend through a terminal or HTTP API.**

This repository is preparing **2.3.0**. The current checkout still reports **2.2.0** in `package.json`; the npm package may therefore lag these candidate features. Check `buddy --version` and the [changelog](CHANGELOG.md) before attributing a feature to an installed release. The evidence below comes from an isolated Linux HOME on 27 September 2026. It covers the named scenarios, not every configuration or platform.

[Français](README.fr.md) · [Five terminal recordings](docs/assets/demos/README.md) · [Feature evidence](docs/FEATURES.md) · [Getting started](docs/getting-started.md)

## Install

Node.js 20 or newer:

```bash
npm install -g @phuetz/code-buddy
```

For this candidate before 2.3.0 is published, [build from source](docs/getting-started.md) if you need the exact features and proofs below. The separate Cowork desktop app needs its [own install](docs/cowork.md).

## 60 seconds to try

With [Ollama](https://ollama.com/) running and `qwen3:4b-instruct` already downloaded, try an agent turn in a disposable directory. The initial model download is outside the 60-second walkthrough.

```bash
mkdir -p /tmp/buddy-first-run
printf '{"name":"demo","version":"1.0.0"}\n' > /tmp/buddy-first-run/package.json
OLLAMA_HOST=127.0.0.1:11434 buddy --directory /tmp/buddy-first-run --model qwen3:4b-instruct --compact --enabled-tools read_file --permission-mode dontAsk --max-tool-rounds 3 --output-format json -p 'Read package.json with the read_file tool and answer with only its version.'
```

Look for a `read_file` tool call and a final answer of `1.0.0` in the JSON. This exact pattern returned `7.3.1` from our fixture after a real Ollama tool call: [agent trace](docs/preuves/inventaire-agent-loop.log), [terminal recording](docs/assets/demos/agent.cast). The model can still choose a different path; inspect the tool call rather than trusting the final text alone. Use `buddy run list` and `buddy run replay <id>` to inspect a saved turn: [replay trace](docs/preuves/vitrine-cli-run.log).

## What has been exercised

The [catalogue](docs/catalog/README.md) tracks 91 curated capabilities. **45 have current local execution traces**; 46 remain untested in situation. A static connection in source is never called a successful run. These are ten concrete examples:

| Capability | What the trace actually shows |
|---|---|
| [Local Ollama agent turn](docs/preuves/inventaire-provider-ollama.log) | `qwen3:4b-instruct` called `read_file` and returned the fixture's version. |
| [Run replay](docs/preuves/vitrine-cli-run.log) | A recorded `read_file` call was replayed against the disposable file after a [replay bug fix](tests/commands/run-replay.test.ts). |
| [HTTP chat](docs/preuves/inventaire-http-chat.log) | A local `/api/chat` request received an Ollama response. |
| [HTTP session and memory APIs](docs/preuves/inventaire-http-sessions.log) | A fixture session was created and listed; [fixture memory](docs/preuves/inventaire-http-memory.log) was written and read. |
| [Security audit](docs/preuves/vitrine-cli-security.log) | JSON audit of an isolated profile and project completed; no fix was applied. |
| [Policy check](docs/preuves/vitrine-cli-policy.log) | Read-only diagnostics reported the evaluated domains. |
| [Tool profile](docs/preuves/vitrine-cli-tools.log) | The effective allowlist was resolved; it was an inspection, not a tool execution. |
| [Database/auth provisioning](docs/preuves/vitrine-cli-provision.log) | Local target planned 14 files in dry-run; no files were applied. |
| [JWT token](docs/preuves/vitrine-cli-token.log) | A synthetic-key token's HMAC, subject and 15-minute lifetime were verified independently. |
| [Catalogue status](docs/preuves/vitrine-catalog-status-rejeu.log) | Structured status returned all 91 curated entries; [state definitions](docs/catalog/README.md) explain the limits. |

[Five short asciinema recordings](docs/assets/demos/README.md) show the local agent, replay, provisioning plan, security audit and provider inspection. They are captured from real commands, with local paths replaced by placeholders.

## Comparison, with scope

The links in this table are each project's own documentation, checked on 27 September 2026. It is a guide to choosing a workflow, not a performance ranking. Code Buddy claims in the third column refer only to the traces above.

| Tool | Documented workflow | Code Buddy evidence and current gap |
|---|---|---|
| [Claude Code](https://code.claude.com/docs/en/overview) | Terminal, IDE, desktop and browser, with skills, hooks and MCP. | Our terminal and HTTP paths ran. Cowork is only wired in this catalogue; comparable cross-surface work is unverified here. |
| [Aider](https://aider.chat/docs/) | Terminal pair programming, Git commits and undo; it also documents an experimental [browser UI](https://aider.chat/docs/usage/browser.html). | The local agent/read/replay path ran. No matched code-edit or Git workflow benchmark was run, so there is no speed or quality claim against Aider. |
| [OpenCode](https://opencode.ai/docs/) | Terminal, desktop and web interfaces with configurable models, including [local providers](https://opencode.ai/docs/providers). | Ollama ran locally here. Code Buddy's desktop and broad provider routes have less direct evidence in this campaign. |
| [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) | Open-source terminal agent; OpenAI also documents its [SDK and app-server](https://developers.openai.com/fr-FR/blog/codex-as-a-platform). | Code Buddy's HTTP chat ran, but no equivalent SDK/app-server integration or head-to-head coding evaluation was run. |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/index.md) | Terminal agent with Google authentication, file editing and test execution. | Code Buddy's Ollama file-read turn ran. Google authentication and a matched editing task were not exercised here. |

Code Buddy is behind these projects in **verified breadth for this launch**: only 45 of its 91 curated entries have current traces, and several cover an inspection or dry-run rather than the full workflow. In particular, this campaign did not run Cowork, real peer dispatch, hosted provider authentication, or a production deployment. A small local model also [failed the `buddy try` coding demo](docs/preuves/vitrine-buddy-try-echec.log); its success must not be assumed. We have no independent comparative productivity benchmark.

## Documentation and contribution

- [Full English feature catalogue](docs/FEATURES.md) and [French catalogue](docs/FONCTIONNALITES.md)
- [Getting started](docs/getting-started.md), [commands](docs/commands.md), [security](docs/security.md), [fleet](docs/fleet-guide.md), [Cowork](docs/cowork.md)
- [Changelog](CHANGELOG.md) and [contributing guide](CONTRIBUTING.md)
- [Issues](https://github.com/phuetz/code-buddy/issues) and [discussions](https://github.com/phuetz/code-buddy/discussions)

## License

[Business Source License 1.1](LICENSE). Personal, non-commercial and self-hosted use are free under its terms; offering Code Buddy as a commercial service to third parties is restricted. The license converts to Apache 2.0 on 31 August 2030. Check individual bundled skill licenses in their `SKILL.md` files.
