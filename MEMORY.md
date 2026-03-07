# Project Memory — Code Buddy (grok-cli)

## Project Identity
- Package: `@phuetz/code-buddy` v0.4.0
- CLI binary: `buddy` / `code-buddy`
- Terminal-based multi-provider AI coding agent (Grok, Claude, ChatGPT, Gemini, Ollama, LM Studio)

## Key Facts

### Test Runner
- **Vitest** (NOT Jest/ts-jest) — `package.json` scripts: `vitest run`
- `vitest.setup.ts` shims `globalThis.jest → vi` so legacy `jest.fn()` calls work in tests
- `vitest.config.ts`: `@` alias → `./src`, environment: `happy-dom`, coverage thresholds 70%
- Tests in `tests/` and in-source `src/**/*.test.ts`

### Module System
- ESM project (`"type": "module"` in package.json)
- Source imports use `.js` extension even for `.ts` files
- `__dirname` unavailable in ESM — use `import.meta.url` + `fileURLToPath` instead

### CLAUDE.md Status
- Updated 2026-02-27: fixed test runner from Jest/ts-jest → Vitest
- CLAUDE.md is the authoritative project guide; do not duplicate it here


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Test response


## Facts extracted 2026-03-07 (pre-compaction flush)

Follow-up response


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool


## Facts extracted 2026-03-07 (pre-compaction flush)

Using tool
