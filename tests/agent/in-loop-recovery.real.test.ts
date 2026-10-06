/**
 * REAL (no-mock) integration test for in-loop length-truncation recovery.
 *
 * No mocked chunks, no faked `finish_reason`. We boot the actual `buddy` CLI
 * against a real local Ollama model with a deliberately tiny output cap
 * (`CODEBUDDY_MAX_TOKENS`) and ask for a long verbatim output. The first
 * generation genuinely hits `finish_reason: 'length'`; the executor's in-loop
 * recovery then re-prompts "continue from where you stopped" until the answer
 * completes — which a single capped generation provably cannot do.
 *
 * Asserts the real observable outcome: the continuation fired repeatedly AND
 * the output progressed well past one generation's worth of lines.
 *
 * Skips automatically when Ollama (or the model) isn't reachable — it is a
 * real-model test, not a unit test.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const MODEL = process.env.CODEBUDDY_INLOOP_TEST_MODEL || 'qwen3.5-ctx32k:latest';

let ollamaReady = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    ollamaReady = Boolean(data.models?.some((m) => m.name === MODEL));
  } catch {
    ollamaReady = false;
  }
});

describe('in-loop recovery (real Ollama, no mocks)', () => {
  let workdir = '';
  beforeAll(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'inloop-real-'));
  });
  afterAll(() => {
    // best-effort; temp dir, fine to leave on failure
  });

  it(
    'continues a length-truncated answer until it completes',
    async (ctx) => {
      if (!ollamaReady) {
        ctx.skip();
        return;
      }

      const prompt =
        "/no_think Write this exact sentence 25 times, once per line, numbered 1 to 25, " +
        "like '1. The fox runs.' Write every line out literally with no code and no " +
        'abbreviation: The fox runs.';

      const result = spawnSync(
        path.join(REPO_ROOT, 'node_modules/.bin/tsx'),
        [path.join(REPO_ROOT, 'src/index.ts'), '-p', prompt, '--output-format', 'text'],
        {
          cwd: workdir,
          encoding: 'utf8',
          timeout: 280_000,
          env: {
            ...process.env,
            // De-test-mode the child: vitest sets NODE_ENV=test/VITEST, which
            // makes the logger silent (logger.ts) and would suppress the
            // recovery debug line — a test-env artifact perturbing a real run.
            NODE_ENV: 'development',
            VITEST: undefined,
            VITEST_POOL_ID: undefined,
            VITEST_WORKER_ID: undefined,
            DEBUG: '1',
            CODEBUDDY_PROVIDER: 'ollama',
            OLLAMA_HOST,
            GROK_MODEL: MODEL,
            // Tiny cap: a single generation can only emit ~2 lines, forcing
            // real finish_reason='length' truncation that recovery must continue.
            CODEBUDDY_MAX_TOKENS: '16',
            CODEBUDDY_MAX_LENGTH_CONTINUATIONS: '30',
          },
        },
      );

      const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

      // (1) The recovery mechanism actually engaged, more than once.
      const continuationCount = (out.match(/length-truncation continuation/g) ?? []).length;
      expect(continuationCount).toBeGreaterThanOrEqual(2);

      // (2) The output progressed past what one 40-token generation can produce.
      // A single capped generation yields ~2-3 numbered lines; recovery pushes
      // it well beyond. Highest "N. The fox" line reached must be >= 5.
      const lineNumbers = [...out.matchAll(/(?:^|\n)\s*(\d+)\.\s*The fox/g)].map((m) =>
        Number(m[1]),
      );
      const highest = lineNumbers.length ? Math.max(...lineNumbers) : 0;
      expect(highest).toBeGreaterThanOrEqual(5);
    },
    300_000,
  );
});
