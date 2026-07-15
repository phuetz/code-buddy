# Continuous self-benchmark

The P0 self-benchmark measures every selected active LLM against Code Buddy's existing curated capability scenarios. It stores longitudinal results, detects provider/model regressions, and publishes aggregate runs to the existing model scoreboard so latency and quality observations are available to routing consumers.

This feature is CLI-only and fail-closed. It has no heartbeat, daemon, cron, or autonomous-loop integration. Unless `CODEBUDDY_SELF_BENCH=true` is set, it performs no model discovery, LLM call, history read/write, or scoreboard update.

## Usage

Opt in for the current command invocation:

```bash
CODEBUDDY_SELF_BENCH=true buddy improve bench --run
```

The run can be bounded or filtered without changing the active-provider configuration:

```bash
CODEBUDDY_SELF_BENCH=true buddy improve bench --run --models gpt-5.5,grok-4 --scenarios 2
CODEBUDDY_SELF_BENCH=true buddy improve bench --run --provider ollama
```

Inspect the append-only history or the latest report without making LLM calls:

```bash
CODEBUDDY_SELF_BENCH=true buddy improve bench --history
CODEBUDDY_SELF_BENCH=true buddy improve bench --history gpt-5.5
CODEBUDDY_SELF_BENCH=true buddy improve bench --report
```

`--json` is available for machine-readable output. `--run`, `--history`, and `--report` may be combined; only `--run` invokes models.

## Configuration

| Variable                          |                                 Default | Purpose                                                                |
| --------------------------------- | --------------------------------------: | ---------------------------------------------------------------------- |
| `CODEBUDDY_SELF_BENCH`            |                                   unset | Must be exactly `true` to enable any operation.                        |
| `CODEBUDDY_SELF_BENCH_TIMEOUT_MS` |                                 `60000` | Wall-clock timeout for each model/scenario call.                       |
| `CODEBUDDY_SELF_BENCH_DROP`       |                                  `0.15` | Relative score-drop threshold for a regression.                        |
| `CODEBUDDY_SELF_BENCH_HISTORY`    | `~/.codebuddy/capability-history.jsonl` | History path override, primarily for hermetic tests and isolated runs. |

## Measurement and persistence

The implementation reuses `SEED_BENCHMARK_SCENARIOS` and `scoreBenchmark` from `capability-benchmark.ts`; it does not maintain a second scenario set or scoring formula. Each model response is treated as the retrievable guidance for the current scenario, producing a deterministic scenario score of 0 or 1.

History is append-only JSONL, with one record per model and scenario:

```json
{
  "runId": "…",
  "model": "…",
  "provider": "…",
  "scenario": "…",
  "score": 1,
  "latencyMs": 1234,
  "ts": "…",
  "benchVersion": "1",
  "status": "ok"
}
```

Each model run is also written through `ModelScoreboard.recordOutcome` as `taskType: "benchmark"`. The existing scoreboard ledger format is unchanged. The aggregate capability ratio becomes `quality`, and total scenario latency becomes `latencyMs`.

For each model, regression detection aggregates scenario records by run. The newest run is compared with the mean of up to five preceding runs. A regression is reported only when the relative decrease `(before - after) / before` is greater than the configured threshold. Fewer than two runs never produce a verdict.
