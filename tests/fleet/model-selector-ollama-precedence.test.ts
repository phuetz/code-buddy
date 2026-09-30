import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ModelScoreboard } from '../../src/fleet/model-scoreboard.js';
import { selectFastestModel } from '../../src/fleet/model-selector.js';

vi.mock('../../src/providers/active-llm-registry.js', () => ({
  buildActiveLlmRegistry: vi.fn(async () => ({ all: [] })),
}));
vi.mock('../../src/fleet/capability-registry.js', () => ({
  getLocalCapabilities: vi.fn(async () => ({
    models: [{ provider: 'ollama', id: 'qwen2.5:7b-instruct', strengths: ['fast', 'french'] }],
  })),
}));

const scratch = mkdtempSync(join(tmpdir(), 'cb-selector-precedence-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('Ollama model selector endpoint', () => {
  it('keeps the explicit BASE_URL when HOST is also configured', async () => {
    const selected = await selectFastestModel('Bonjour', {
      localOnly: true,
      env: {
        OLLAMA_BASE_URL: 'http://127.0.0.1:11500/v1/',
        OLLAMA_HOST: 'http://127.0.0.1:11434',
      },
      scoreboard: new ModelScoreboard(join(scratch, 'scoreboard.jsonl'), {
        turnMetricsJournalPath: join(scratch, 'turns-absent.jsonl'),
      }),
    });

    expect(selected?.provider).toBe('ollama');
    expect(selected?.baseURL).toBe('http://127.0.0.1:11500/v1');
  });
});
