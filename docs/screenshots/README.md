# Screenshots — Visual changelog

Visual record of two consecutive sessions documented in this repo.
Captured live while building the integration; nothing staged, nothing
scripted.

The narrative goes from **Cowork desktop bootstrap fixes** (Phase d.21,
morning) to **ChatGPT Codex OAuth integration** (Phase d.23 → d.25,
evening), with the bug-investigation moments in-between.

---

## Part 1 — Cowork desktop boot crash investigation (Phase d.21)

The Cowork Electron GUI was crashing on first run. The session started
debugging the React side.

### 1.1 React error #185 — minified, no clue

The first hint: a useless minified production-mode error.

![Cowork React error 185](./cowork-react-error-185.png)

### 1.2 Maximum update depth exceeded — found via dev React build

After switching `vite mode=development` so React unminified, the real
diagnosis came out: an infinite re-render loop in Zustand selectors
returning new `[]` literals on every call.

![Cowork update depth exceeded](./cowork-update-depth.png)

Fix: stable `EMPTY_MESSAGES`, `EMPTY_TOOLS` constants for
`useSyncExternalStore` snapshots in `cowork/src/renderer/store/selectors.ts`.

### 1.3 CSP refused fonts — `data:` URLs blocked

Next layer: Content Security Policy was blocking inline base64 fonts.

![Cowork CSP fonts](./cowork-csp-fonts.png)

Fix: add `data:` to the `font-src` directive in `cowork/index.html`.

### 1.4 First successful boot

After ~5 layers of fixes (ESM `file://` paths on Windows, walk-up depth
for vite-bundled main, Buffalo_S download URL 404, etc.), the Cowork
GUI boots cleanly:

![Cowork first bonjour](./cowork-first-bonjour.png)

### 1.5 ESM bundled walk-up + bravo

![Cowork boot fixed](./cowork-boot-fixed.png)

### 1.6 But it's slow — 1m23s for "bonjour"

The Cowork agent uses an Ollama local model (`qwen2.5-coder:7b`). The
first message took **83 seconds** for a one-word answer.

![Cowork slow startup](./cowork-slow-1m23s.png)

This led to **Phase d.22 — smart prompt + tools gating** (separate PR):
small Ollama models drown in 73 KB of system prompt and hallucinate
JSON tool calls. Solution: query-aware gating, `promptProfile: 'lite'`
per model, force-off memory/lessons/workflow directives when
`supportsToolCalls === false`. After the fix the same `bonjour` runs
in ~9 seconds with a clean answer.

---

## Part 2 — ChatGPT Codex OAuth integration (Phase d.23 → d.25)

After the Cowork fixes shipped, attention turned to the headline
feature: **let the user log into ChatGPT directly and use their
Plus/Pro subscription** instead of paying per-token via the OpenAI
Platform API.

### 2.1 OAuth login flow

`buddy login` opens the browser to `auth.openai.com/oauth/authorize`,
the user signs in with their ChatGPT account, the callback returns to
`localhost:1455` with PKCE + state verification, and tokens persist to
`~/.codebuddy/codex-auth.json`. Account claims (email, plan,
account_id, FedRAMP) are extracted from the id_token.

![ChatGPT OAuth login](./chatgpt-oauth-login.png)

### 2.2 Backend rejects the model — `Instructions are required`

First chat attempts kept failing with HTTP 400. The Codex backend
enforces a non-empty `instructions` field (system prompt) — even on a
single-turn user message. Discovery in real time:

![Instructions are required](./backend-instructions-required.png)

Fix: ship a `DEFAULT_INSTRUCTIONS` fallback in
`provider-chatgpt-responses.ts` so the agentic loop can issue raw chat
requests without forcing every caller to thread a system prompt
through.

### 2.3 First working chat — `gpt-5.5` interactive

Once the model + instructions issues were fixed, the TUI lit up. Footer
shows the active model.

![TUI gpt-5.5 chat](./tui-gpt-5-5-chat.png)

### 2.4 Tool calling — `web_search` parallel

The agent invokes multiple tools per turn (`parallel_tool_calls: true`
in the Responses API). Here `gpt-5.5` fired two `web_search` calls for
weather data, ingested 6 sources, and synthesised the answer.

Cost remains `$0.0000` because the user's plan is flat-fee (Phase d.25
fix: cost-tracker zeroes for ChatGPT subscription models).

![Tool calling parallel](./tool-calling-parallel.png)

### 2.5 Markdown output quality

Reading project context (`CODEBUDDY.md`, `CLAUDE.md`,
`.codebuddy/CONTEXT.md`), `gpt-5.5` produces structured markdown
explanations with code references, ASCII diagrams, and proper heading
hierarchy.

![Architecture explanation](./architecture-explanation.png)

(There's a duplicated entry visible in this screenshot — that's the
TUI streaming-handler bug from Phase d.25 Phase 1, fixed by disabling
`extractCommentaryToolCalls` for native-tool-calling backends. Without
the fix, the LLM mentioning tool names in markdown backticks like
`` `view_file` `` was misinterpreted as a hidden tool_call and split
the response into two visible TUI entries.)

---

## Part 3 — Self-audit (the meta moment)

Code Buddy reads its own provider source code and finds bugs in it.

### 3.1 `lessons_search` — reflex before audit

Asked `trouve un bug dans src/codebuddy/providers/provider-chatgpt-responses.ts`,
the LLM first calls `lessons_search` to check whether a similar issue
was already documented:

![Lessons search call](./lessons-search-call.png)

(Phase d.25 Phase 5 extends the `<lessons_directive>` to push
`lessons_add` AFTER a successful audit, so the captured pattern can
inform future runs.)

### 3.2 First bug found — stale `model` after auto-fallback

In `provider-chatgpt-responses.ts`, after the auto-fallback branch
mutates `body.model`, two downstream call sites (`parseSseStream`
label and `enrichError` reporting) keep using the stale local `model`
variable. Real bug, fixed on commit `7485e4f`.

![Self-audit bug 1](./self-audit-bug-1.png)

### 3.3 Second bug found — token tracking gap

In `streaming-handler.ts`, `tokenCount` was only computed when
`displayContent` was non-empty, so turns emitting only `tool_calls` or
only reasoning chunks never updated the running per-turn token count.
Fixed on commit `3e576d0`.

![Self-audit bug 2](./self-audit-bug-2.png)

The closure: the LLM that powers the integration finds bugs in the
integration code that supports it.

---

## Part 4 — Lisa companion on Telegram

The companion thread continues outside Cowork through the configured Telegram
channel, while preserving Lisa's identity and conversational context.

### 4.1 Natural companion conversation

![Lisa companion conversation on Telegram](./telegram-companion-chat.jpg)

### 4.2 Recursive reasoning and continuity

![Lisa companion recursive exchange on Telegram](./telegram-companion-recursive.jpg)

### 4.3 Assisted self-development

![Lisa companion self-development exchange on Telegram](./telegram-companion-selfcode.jpg)

---

## How to reproduce

```bash
npm install -g @phuetz/code-buddy

# OAuth login
buddy login                          # opens auth.openai.com in your browser
buddy whoami                         # ✅ connected · your.email@example.com · Plan: pro

# Use it
buddy                                # interactive TUI
buddy --print "explain this codebase" # one-shot

# Self-audit your own provider code
buddy
> trouve un bug dans <path/to/file.ts> et propose un fix
```

Default model is `gpt-5.5`. Override with `--model gpt-5.1-codex` or
`/switch <model>` in the TUI. Auto-fallback kicks in if the backend
rotates available slugs, unless you pinned `--model` explicitly.

## Current Cowork QA Captures

The full Cowork QA capture set lives under
[`docs/qa/code-buddy-studio/screenshots/`](../qa/code-buddy-studio/screenshots/).
The autonomous progress proof is generated by:

```bash
cd cowork
npx playwright test e2e/test-runner-autonomous-progress.spec.ts --reporter=list
```

![Cowork autonomous progress card](../qa/code-buddy-studio/screenshots/110-test-runner-autonomous-progress.png)

Validation matrix and privacy rules:
[Application Validation Guide](../application-validation-guide.md) and
[Autonomous Coding And Cowork Progress](../autonomous-coding-cowork-progress.md).

## Cross-references

- **PR #35** — Phase d.17 → d.24 wave (login OAuth, fleet, smart prompt gating)
- **PR #36** — Phase d.25 polish (memory load fix, TUI duplicate, cost zeroing, auto-fallback, self-audit fixes)
- **PR #37** — initial screenshot drop in this directory
- **PR #38** — three inline screenshots in main README "In action" section
