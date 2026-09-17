# Code Buddy 2.2.0

This release adds hosted ElevenLabs sign-in for MCP, makes several CLI commands dependable in scripts and extends fleet tooling.

## Scripts and automation

- Interrupting a headless run (`buddy -p`, loop, try) with Ctrl+C / SIGINT exits with code **130**. Standard output stays empty or valid JSON: shutdown progress is written to stderr and no terminal escape sequences are emitted outside a TTY. Interactive sessions and servers started under a supervisor such as systemd keep exit code 0 on SIGINT/SIGTERM.
- `buddy mcp add-json <name> <json> --yes` adds a server without the interactive confirmation. Without a TTY and without `--yes`, it exits with an explicit error instead of waiting.
- `buddy mcp add` and `add-json` close the connection probe once the server is added; the command returns instead of staying attached to a stdio server process.

## Integrations

- **ElevenLabs over MCP:** OAuth for the hosted server on `streamable_http`, with loopback PKCE, cancellation that frees the local port, bounded retries of token exchange and `tools/list`, and invalid tokens dropped without removing the configured client. The template is disabled by default.
- **Fleet:** the `peer_tool_invoke` agent tool reads or searches a connected peer (`view_file`, `list_directory`, `search`). The peer keeps its allowlist, fleet-safety and workspace-root checks; unrecognized peer errors are redacted.
- **Models:** local Lemonade Qwen3.6 GGUF ids and larger qwen2.5/llama3 models are recognized as tool-capable on OpenAI-compatible endpoints.

## Introspection

- `/status` shows the effective theme, and `buddy doctor --json` exposes it as `theme`.

## Install and verify

```sh
npm install -g @phuetz/code-buddy@2.2.0
buddy --version
buddy doctor --offline
```

Use Node.js 20 or newer.

## Validation and known limits

- CI on the release commit: Node 20 and 22 on Ubuntu, Windows and macOS, security audit, build and package.
- A daily CLI recipe exercised about forty everyday scenarios (headless text and JSON output, stdin pipes, session resume, approvals, configuration, local MCP servers, large and binary files, hooks, compaction, offline provider, per-project settings, paths with spaces and accents) against a real `buddy` process with a **deterministic model fixture, not a live model**. The answer quality of real models is not covered by these checks.
- The current main branch was built and run natively on Windows 10 (Node 24) in a path with spaces: install, `--version`, `doctor`, `mcp list`, headless text/JSON, `--continue` and file reading passed. On Windows, a forced `taskkill /F` during a response leaves a valid but empty session: the interrupted turn is not saved.
- Hosted ElevenLabs sign-in was exercised against local OAuth test servers; a real ElevenLabs account and a hosted client metadata document were not tested.
- On Windows, a system `OLLAMA_HOST` variable takes precedence over `GROK_API_KEY` during provider auto-detection; set `CODEBUDDY_PROVIDER` to choose explicitly.
- Help and error messages can mix English and French; there is no `--lang` option yet.
