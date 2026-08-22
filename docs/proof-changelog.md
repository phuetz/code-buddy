# Proof refresh changelog

## 2026-08-22 — v1.8.0, code-under-test commit `82f7f3fa`

This refresh replaces the 2026-06-18/v1.6 capture with attempts made on the current worktree. No
paid API key was used, no full test suite was run, and the existing GUI screenshots were not
relabelled as new evidence.

| Area | 2026-06-18 capture | 2026-08-22 result |
|---|---|---|
| Local coding | Passing FizzBuzz on `qwen3.5-ctx32k` | Passing FizzBuzz on local `qwen3.8:27b`; independent exit `0`; 5:27.05; `$0.0000` |
| ChatGPT OAuth demo | Not shown | `buddy try` attempted; independent test failed under the required in-repo sandbox; exit `1`; 0:30.56 |
| Goal mode | Judge accepted `PROOF.txt` | Not reproduced: policy cancellation and incorrect 6-byte `WORKS\n`; judge continued; all bounded runs exited `1` |
| Cowork GUI | Real Electron/Ollama screenshots | Not re-run: Cowork dependencies/build absent; 2026-06-18 images retained with their original date |
| Autonomous fleet | One completed local tick | Reproduced: one completed local tick and real haiku artifact; 0:15.12 |
| Providers | 15-provider claim | 65 catalog entries counted, but only 64 unique IDs/CLI rows because `deepseek` is duplicated; 24 imported free-tier/trial entries plus OmniRoute = 25 advertised free-tier paths |
| Tests | “~27K tests” claim | 1,674 `*.test.ts` files counted; providers sample was 238/239 tests passing, exit `1`; full suite not run |
| Onboarding | Older `npm install -g` flow | Current `npm i -g`, `buddy onboard`, `buddy try`, `buddy doctor --fix`, and `buddy login` commands |

Potential bugs exposed by the refresh:

- `buddy try` mandates CommonJS `.js`; its independent check fails when the sandbox inherits an ESM
  package, while the agent's own summary can still claim the test passed.
- `buddy goal` did not auto-approve `write_file` in the headless `acceptEdits` invocation used here.
- The small local goal judge reached the correct `continue` verdict but printed incorrect hex bytes
  in its explanation.
- `tests/providers/codex-oauth.test.ts` hard-codes port `45431`, which collided with Ollama's live
  `llama-server` child process.
- `docs/providers/omniroute-free-catalog.md` announces 24 curated entries, but its main table has no
  data rows.
- `RUNTIME_PROVIDER_CATALOG` has 65 entries but only 64 unique IDs because `deepseek` is duplicated;
  `provider list` renders 64 rows.
