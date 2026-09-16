---
name: code-buddy
description: Drive Code Buddy (the `buddy` multi-provider AI coding-agent CLI) from the command line — run it headless on a single prompt, pin it to a free local Ollama model or a paid one, edit files autonomously, start the HTTP/fleet server, and run the autonomous fleet loop. Use when the user wants to invoke, test, script, or automate the `buddy` CLI; run Code Buddy headlessly or inside another agent; run it on local/free models; start the server or multi-AI fleet; run autonomous coding tasks; or when working inside the code-buddy repo and needing to actually RUN the agent (not just edit its source). Triggers on "use buddy", "run code buddy", "buddy --prompt", "headless code buddy", "code buddy on ollama", "buddy autonomy/fleet/server".
---

# Using Code Buddy (`buddy`)

Code Buddy is an agentic coding CLI: given a prompt it reads files, calls tools, edits code, runs commands, and can act fully autonomously. This skill is about **operating** that CLI correctly — the non-obvious parts are provider/model selection and headless flags.

## 1. Find the entrypoint

There is no single `buddy` binary guaranteed on PATH. Resolve in this order:

```bash
command -v buddy                      # global install (npm i -g @phuetz/code-buddy, or `npm link` in the repo)
./node_modules/.bin/tsx src/index.ts  # dev, from the repo root (no build needed) ← default inside this repo
node dist/index.js                    # built (after `npm run build`)
```

Inside this repo `buddy` is usually NOT linked — use `./node_modules/.bin/tsx src/index.ts`.

## 2. Headless one-shot (the default for scripting/agents)

```bash
buddy -p "<prompt>" --output-format text     # process one prompt and exit (alias: --print)
buddy -p "<prompt>" --output-format json     # machine-readable result
```

Headless mode auto-approves operations. Exit code reflects success/failure. `--output-format json` is best when another program parses the result.

## 3. Pick provider + model — THE critical gotcha

Provider auto-detection order (first wins): `CODEBUDDY_PROVIDER` env → an active ChatGPT login (`~/.codebuddy/codex-auth.json`) → `OLLAMA_HOST` → API keys. **An active ChatGPT login overrides `OLLAMA_HOST`** — so setting `OLLAMA_HOST` alone is NOT enough to use a local model.

**To force a free local Ollama model, set `CODEBUDDY_PROVIDER=ollama` explicitly:**

```bash
CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://localhost:11434 GROK_MODEL=qwen3.6:35b-a3b-q4_K_M \
  buddy -p "<prompt>" --permission-mode acceptEdits
```

- `GROK_MODEL` (or `--model <m>`) sets the model; `--base-url`/`GROK_BASE_URL` sets the endpoint.
- **For agentic work (editing files / tool calls) on local models, use `qwen3`+** — it emits structured tool calls. **`qwen2.5:7b` is chat-only** (it prints tool calls as text and can't edit). The helper `scripts/buddy-local.sh` bakes in these defaults.
- Paid/login models: omit `CODEBUDDY_PROVIDER`; `buddy login` (ChatGPT, $0 marginal) or set `GROK_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`. Check with `buddy whoami`.

## 4. Permission & safety

`buddy` can edit files and run shell commands. Control the blast radius:

- `--permission-mode <mode>` — `default` | `plan` (read-only research) | `acceptEdits` (auto-apply edits) | `dontAsk` | `bypassPermissions`.
- `--yolo` — full autonomy (400 tool rounds, cost cap). Only with a contained workspace.
- `--allowedTools "<glob,...>"` / `--disallowedTools "<glob,...>"` — restrict the tool surface.
- Run risky autonomous prompts with `cwd` set to a throwaway/sandbox dir so the agent can't touch unintended files.

## 5. Common recipes

```bash
# Ask without mutating anything (research/plan only)
buddy -p "Explain how the fleet bridge wires peers" --permission-mode plan

# Make a focused code change headless on a paid model, JSON result
buddy -p "Add input validation to parseConfig and a test" --permission-mode acceptEdits -o json

# Same, free + local (tool-capable model), via the helper
scripts/buddy-local.sh "Implement slugify in slugify.mjs so node slugify.check.mjs exits 0"

# Golden-path workflows (WritePolicy.strict / apply_patch)
buddy dev plan "<goal>"          # writes PLAN.md, exit 1 if empty
buddy dev run -y --type fix-tests
buddy dev pr                     # title/body + gh or local origin push
buddy dev fix-ci --log ci.log    # do not omit --log on a non-TTY

# Diagnose the environment
buddy doctor
```

## 6. Server, fleet, and autonomous loop

```bash
buddy server --port 3000          # HTTP + WebSocket `/ws` on ONE port — required for the multi-AI fleet
buddy autonomy run --watch        # continuous autonomous loop: claim + run colab tasks, free-first models
buddy autonomy install            # install it as an always-on systemd/launchd service
buddy colab status                # inspect the shared fleet task queue
buddy fleet status                # fleet routing + presence
```

A complete, runnable example of driving the **real agent autonomously over a task set** lives in the repo at `scripts/autonomy-lab/` (`tsx scripts/autonomy-lab/run.ts`).

## 7. Deeper reference

For the full command surface (50+ subcommands), every relevant flag, and detailed local-model setup, read **[references/cli-reference.md](references/cli-reference.md)**. Load it only when a needed command/flag is not covered above.
