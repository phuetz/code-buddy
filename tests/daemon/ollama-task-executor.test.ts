import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalModelTaskExecutor } from '../../src/daemon/ollama-task-executor';
import type { ColabTask } from '../../src/fleet/colab-store';
import type { AutonomousModelChoice } from '../../src/agent/model-tier';

const TASK: ColabTask = {
  id: 'task-haiku',
  title: 'Write a haiku',
  status: 'in_progress',
  priority: 'low',
  description: 'About the 10-year robot',
  acceptanceCriteria: ['5/7/5 syllables'],
};

const LOCAL: AutonomousModelChoice = {
  model: 'qwen2.5:7b-instruct',
  baseUrl: 'http://localhost:11434/v1',
  tier: 'local',
  paid: false,
  reason: 'test',
};

function okResponse(content: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

describe('createLocalModelTaskExecutor', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'executor-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

  it('calls the tier endpoint, writes the artifact, and reports success', async () => {
    const fetchImpl = vi.fn(async () => okResponse('robot dreams in code'));
    const exec = createLocalModelTaskExecutor({ outputDir: dir, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 1000 });
    const result = await exec(TASK, LOCAL);

    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.objectContaining({ method: 'POST' }));
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/via local model qwen2.5:7b-instruct/);
    expect(existsSync(join(dir, 'task-haiku.md'))).toBe(true);
    expect(readFileSync(join(dir, 'task-haiku.md'), 'utf-8')).toContain('robot dreams in code');
  });

  it('fails cleanly on an HTTP error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, statusText: 'err' } as unknown as Response));
    const exec = createLocalModelTaskExecutor({ outputDir: dir, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await exec(TASK, LOCAL);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  it('fails when the model returns empty output', async () => {
    const fetchImpl = vi.fn(async () => okResponse('   '));
    const exec = createLocalModelTaskExecutor({ outputDir: dir, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await exec(TASK, LOCAL)).ok).toBe(false);
  });

  it('refuses a model choice with no endpoint', async () => {
    const exec = createLocalModelTaskExecutor({ outputDir: dir, fetchImpl: vi.fn() as unknown as typeof fetch });
    const result = await exec(TASK, { model: 'paid', tier: 'escalated', paid: true, reason: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no baseUrl/);
  });
});
