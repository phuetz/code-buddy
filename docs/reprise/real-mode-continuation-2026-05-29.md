# Real-mode test continuation - post-merge main (2026-05-29)

> Goal: "codex a merge dans main, continue les tests en mode reel pour finaliser code buddy et cowork".
> Context: `origin/main` == `tmp-self-improve-default` at the start of the pass (`4ba05910`).
> Rule added during the pass: real tests only for validation claims; no mock-only sign-off.

## Exit Criteria

This pass was intentionally a test-and-harden pass, not a broad feature pass.

1. Merged main builds and typechecks.
2. CLI autonomous L2 eval suite runs through the real built CLI, real git repos, real edits, and real verification.
3. Cowork Electron e2e runs in real Playwright/Electron.
4. One Cowork chat path hits the real ChatGPT backend.
5. Any real breakage found is fixed or logged with a concrete repro.

## Results

### Step 1 - Build / typecheck on merged main

Passed:

- `npm run build` -> exit 0.
- `npm run typecheck` -> exit 0.
- `cd cowork && npm run typecheck` -> exit 0.

Verdict: merged main builds clean.

### Step 2 - CLI L2 autonomous eval regression

Real finding: the old L2 eval command was no longer a valid real-mode signal.

The current eval tasks live under `eval/tasks/<task>/contract.json`, but older handoff docs still referenced the removed `eval/tasks/*.json` shape. Running the current contracts directly also exposed a real harness bug: contracts pointed `repo` at the Code Buddy checkout, so the runner treated the task as self-improvement and requested interactive approval. In a non-TTY run, that could drain the event loop and exit 0 with empty output.

Fixes landed:

- `eval/run-task.mjs` now creates a fresh temporary git repository for each task, copies the sandbox fixture into it, rewrites the runtime contract to that isolated repo, runs the real `node dist/index.js autonomous-code ...` command, checks the real git status, and cleans up.
- `ConfirmationService` now fails closed with a visible denial when approval is required but no interactive terminal or remote approval channel exists.
- `runAgenticCodingCell` accepts a validated `--require-approval` approval-decision file as the explicit approval source for self-improvement runs, instead of falling back to an unanswerable prompt.
- Regression coverage was added for the non-interactive approval behavior and the approval-decision-file path.

Real validation:

- `npm test -- --run tests/utils/confirmation-service.test.ts tests/agent/autonomous/agentic-coding-runner-security.test.ts` -> 29 passed.
- `npm run typecheck` -> exit 0.
- `node --check eval/run-task.mjs` -> exit 0.
- `npm run build` -> exit 0.
- `node eval/run-task.mjs` -> all then-current real tasks passed:
  - `cost-limit` -> blocked, no file touched.
  - `failing-verification` -> blocked, no file touched.
  - `invalid-find` -> blocked, no file touched.
  - `multiple-edits` -> verified, touched only `eval/sandbox/target.txt` in the temp repo.
  - `simple-edit` -> verified, touched only `eval/sandbox/target.txt` in the temp repo.

### Step 3 - Cowork real-mode e2e

Passed:

- `cd cowork && npx playwright test e2e/cowork-smoke.spec.ts --reporter=list` -> 29 passed in real Electron/Playwright.
- `cd cowork && COWORK_REAL_GPT55=1 npx playwright test e2e/chat-real-gpt55.spec.ts --reporter=list --timeout=240000` -> 1 passed in 3.5 minutes.

The real ChatGPT spec exercised Cowork against the ChatGPT Codex backend with model `gpt-5.5` and updated the evidence screenshot:

- `docs/qa/code-buddy-studio/screenshots/public-real-gpt55-cowork-chat.png`

## Frictions / Risks

- Fixed: L2 evals were not isolated and could silently no-op in non-interactive self-improvement approval.
- Fixed: required approval decision files now provide an explicit noninteractive self-improvement approval path.
- Fixed in the continuation pass: normal user checkouts with known runtime `.codebuddy/*` churn no longer block strict dirty-tree preflight. Project configuration changes such as `.codebuddy/settings.json` still block.

### Step 4 - Continuation: runtime `.codebuddy` churn preflight

The preflight used `git status --short`, which can collapse a fully untracked `.codebuddy` directory to `?? .codebuddy/`. That made it impossible to distinguish harmless runtime artifacts from meaningful project configuration changes.

Fixes landed:

- `collectGitStatus` now asks Git for `--untracked-files=all` so the preflight sees individual files.
- Known generated runtime artifacts are filtered consistently in the runner and the L2 harness:
  - `.codebuddy/CODEBUDDY_MEMORY.md`
  - `.codebuddy/repoProfile.json`
  - `.codebuddy/code-graph.json`
  - `.codebuddy/code-graph-snapshot.json`
  - existing runtime prefixes such as `.codebuddy/cache/`, `.codebuddy/sync/`, `.codebuddy/tool-results/`.
- Configuration remains protected: `.codebuddy/settings.json` still blocks when it is outside `allowedPaths`.

Real validation:

- `npm test -- --run tests/agent/autonomous/agentic-coding-runner.test.ts` -> 52 passed, using real temporary git repositories.
- `npm run typecheck` -> exit 0.
- `npm run build` -> exit 0.
- Real compiled CLI preflight against a temporary git repo:
  - runtime `.codebuddy` artifacts only -> `ready`, dirty count 0.
  - adding `.codebuddy/settings.json` -> `blocked`, dirty file `?? .codebuddy/settings.json`.
- `node eval/run-task.mjs` -> all then-current real tasks passed.

### Step 5 - Continuation: fail-fast eval harness setup

The L2 harness helper used to swallow every shell command failure and return stdout/stderr. That was useful for inspecting the CLI under test, but too permissive for setup commands such as `git init`, `git add`, `git commit`, or `git status`.

Fix landed:

- `eval/run-task.mjs` now fails fast by default when setup or git inspection commands fail.
- Only the `node dist/index.js autonomous-code ...` command is allowed to return captured output on failure, because that is the product command under test and may need JSON/error inspection.

Real validation:

- `node --check eval/run-task.mjs` -> exit 0.
- `node eval/run-task.mjs` -> all then-current real tasks passed.

### Step 6 - Continuation: shell-free eval command execution

The harness still assembled Git and CLI commands as shell strings. That worked on the current path, but made the real-mode signal more fragile on Windows paths with spaces and for future args containing spaces.

Fix landed:

- `eval/run-task.mjs` now uses `execFileSync(command, args)` for Git setup, Git status, and the product CLI invocation.
- The log still prints a readable reconstructed command, but execution no longer depends on shell quoting.
- The product CLI is launched through `process.execPath` so the same Node runtime is used even when Node lives in a path with spaces.

Real validation:

- `node --check eval/run-task.mjs` -> exit 0.
- `TEMP` / `TMP` redirected to a directory with a space, then `node eval/run-task.mjs simple-edit` -> passed. This also exercised `D:\Program Files\nodejs\node.exe`.
- `node eval/run-task.mjs` -> all then-current real tasks passed.

### Step 7 - Continuation: file paths with spaces in L2 evals

After shell-free execution, the harness still parsed `git status --porcelain` by splitting on whitespace. That silently loses path segments for files such as `eval/sandbox/target with space.txt`.

Fixes landed:

- Added a real L2 task, `space-path-edit`, that edits `eval/sandbox/target with space.txt`.
- The isolated eval repo now copies the full `eval/sandbox/` fixture instead of only `target.txt`.
- Modified-file parsing now keeps the whole porcelain path segment, including spaces.
- The regression discovered during the full run (`eval/...` becoming `val/...` after trimming status columns) was fixed by preserving the leading status columns until after path extraction.

Real validation:

- `node --check eval/run-task.mjs` -> exit 0.
- `node eval/run-task.mjs simple-edit` -> passed.
- `node eval/run-task.mjs space-path-edit` -> passed, modified `eval/sandbox/target with space.txt`.
- `node eval/run-task.mjs` -> all 6 real tasks passed.

### Step 8 - Continuation: deterministic task selection

The harness previously relied on filesystem directory order and accepted only the first task argument. That was usable, but awkward for focused real-mode checks and noisier in handoffs.

Fix landed:

- Task discovery is now sorted alphabetically for stable output.
- `node eval/run-task.mjs task-a task-b` can run multiple named tasks in one process.
- Unknown task names now fail before any repo setup and print the available task list.

Real validation:

- `node --check eval/run-task.mjs` -> exit 0.
- `node eval/run-task.mjs simple-edit space-path-edit` -> both tasks passed.
- `node eval/run-task.mjs not-a-task` -> exit 1 with `Unknown task(s): not-a-task` and the available task list.
- `node eval/run-task.mjs` -> all 6 real tasks passed.

### Step 9 - Continuation: NUL-delimited git status parsing

After adding the file-with-spaces case, the harness still used line-oriented `git status --porcelain` output. Spaces were covered, but Git's robust machine-readable form is the NUL-delimited status output.

Fix landed:

- `eval/run-task.mjs` now reads `git status --porcelain=v1 -z --untracked-files=all`.
- Modified-file parsing now consumes NUL-delimited records and handles rename/copy records by ignoring the source-side path for the changed-file count.

Real validation:

- `node --check eval/run-task.mjs` -> exit 0.
- `node eval/run-task.mjs simple-edit` -> passed.
- `node eval/run-task.mjs space-path-edit` -> passed.
- `node eval/run-task.mjs` -> all 6 real tasks passed.

## Verdict

The branch is healthier than at the start of the pass: build/typecheck are green, the CLI L2 eval is a real executable signal again, Cowork smoke passes in real Electron, the Cowork ChatGPT path passed against the real backend, strict preflight now tolerates Code Buddy's own runtime artifacts without hiding project configuration edits, and the eval harness no longer hides failed setup commands, depends on shell quoting, loses filenames containing spaces, produces unstable task ordering, or parses Git status through fragile line-oriented text.
