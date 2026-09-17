# Daily CLI / fleet QA recipes (portable)

Scripts take **CLI flags**. They discover the repo from their own location. Do not hardcode operator homes or Partage paths.

Label for LLM-shaped traffic from `deterministic-llm-fixture.mjs`:
**real Buddy/RPC with deterministic provider fixture — NOT a live LLM.**

JWT files belong in `--jwt-dir` (mode 0700). Never copy them into `--artifact`.

## 1. Fleet sessions F07/F08

```bash
node scripts/qa/deterministic-llm-fixture.test.mjs
node scripts/qa/fleet-session-oracle.mjs \
  --entry dist/index.js \
  --artifact "$ARTIFACT/fleet-oracle" \
  --jwt-dir "$JWT_DIR" \
  --work-root "$WORK_ROOT"
```

Requires a built `dist/index.js`. Stops only PIDs it spawned. Does not touch port 3000.

## 2. Slash persist (C03/C05/C12) and Unicode search (C11)

Default (throwaway HOME, parallel) stays compatible with older plans:

```bash
python3 scripts/qa/slash-menu-live.py \
  --entry dist/index.js \
  --plan scripts/qa/plans/slash-baseline-help.json \
  --output "$ARTIFACT/slash-baseline" \
  --workers 1
```

Same HOME across restarts (`--workers` forced to 1):

```bash
python3 scripts/qa/slash-menu-live.py \
  --entry dist/index.js \
  --plan scripts/qa/plans/slash-persist.json \
  --home "$HOME_DIR" \
  --project "$PROJECT_DIR" \
  --unicode-fixture \
  --output "$ARTIFACT/slash-persist" \
  --timeout 45
```

Restart cases set `"omitCliModel": true` so saved model/theme are not overridden by `--model` / env.

Handler execution requires an assistant card (`──── Code Buddy ` or known handler text), not the invocation left in the input box.

## 3. C14

`python3 scripts/qa/resource-catalog-live.py --entry dist/index.js --output DIR` remains catalogue/health only unless a RagChat service is explicitly provided (this lot does not).
