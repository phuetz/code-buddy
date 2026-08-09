import { describe, it, expect, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { selectFastestModel, type LlmCandidate } from '../../src/fleet/model-selector.js';
import { ModelScoreboard } from '../../src/fleet/model-scoreboard.js';

/** A fresh, file-backed scoreboard in a temp path (each test gets its own). */
let sbCounter = 0;
function emptyScoreboard(): ModelScoreboard {
  const file = path.join(os.tmpdir(), `cb-sb-test-${process.pid}-${sbCounter++}.json`);
  return new ModelScoreboard(file);
}

const QWEN_7B: LlmCandidate = {
  provider: 'ollama',
  model: 'qwen2.5:7b-instruct',
  apiKey: 'ollama',
  baseURL: 'http://127.0.0.1:11434/v1',
  isLocal: true,
  costInputUsdPerMtok: 0,
  strengths: ['tool-calling', 'fast', 'cheap', 'french'],
};
const GEMMA_31B: LlmCandidate = {
  provider: 'ollama',
  model: 'gemma4:31b',
  apiKey: 'ollama',
  baseURL: 'http://127.0.0.1:11434/v1',
  isLocal: true,
  costInputUsdPerMtok: 0,
  strengths: ['tool-calling', 'french'],
};
const GROK_FAST: LlmCandidate = {
  provider: 'grok',
  model: 'grok-3-fast',
  apiKey: 'xai-token',
  baseURL: 'https://api.x.ai/v1',
  isLocal: false,
  costInputUsdPerMtok: 0.5,
  strengths: ['tool-calling', 'fast', 'reasoning'],
};
const MOONDREAM: LlmCandidate = {
  provider: 'ollama',
  model: 'moondream:latest',
  apiKey: 'ollama',
  baseURL: 'http://127.0.0.1:11434/v1',
  isLocal: true,
  costInputUsdPerMtok: 0,
  strengths: ['vision'],
};
const EMBED: LlmCandidate = {
  provider: 'ollama',
  model: 'nomic-embed-text:latest',
  apiKey: 'ollama',
  baseURL: 'http://127.0.0.1:11434/v1',
  isLocal: true,
  costInputUsdPerMtok: 0,
  strengths: [],
};

describe('model-selector — latency-aware selection', () => {
  it('cold-start: picks the cloud "fast" model over big local ones (heuristic)', async () => {
    const sel = await selectFastestModel('Bonjour, qui es-tu ?', {
      taskType: 'french',
      candidates: [GEMMA_31B, QWEN_7B, GROK_FAST],
      scoreboard: emptyScoreboard(),
    });
    expect(sel?.model).toBe('grok-3-fast');
    expect(sel?.measured).toBe(false); // no scoreboard data → heuristic
  });

  it('localOnly keeps it on-box: smallest fast local wins', async () => {
    const sel = await selectFastestModel('Bonjour, qui es-tu ?', {
      taskType: 'french',
      localOnly: true,
      candidates: [GEMMA_31B, QWEN_7B, GROK_FAST],
      scoreboard: emptyScoreboard(),
    });
    expect(sel?.model).toBe('qwen2.5:7b-instruct'); // 7B heuristic < 31B
    expect(sel?.isLocal).toBe(true);
  });

  it('measured latency supersedes the size heuristic (a big model proven fast wins)', async () => {
    const sb = emptyScoreboard();
    // gemma:31b would lose on size, but it has REAL data showing it's fast here.
    sb.recordOutcome({
      at: '2026-06-26T00:00:00.000Z',
      taskType: 'french',
      model: 'gemma4:31b',
      provider: 'ollama',
      won: true,
      quality: 0.9,
      latencyMs: 900,
      costUsd: 0,
    });
    const sel = await selectFastestModel('Bonjour, qui es-tu ?', {
      taskType: 'french',
      localOnly: true,
      candidates: [GEMMA_31B, QWEN_7B],
      scoreboard: sb,
    });
    expect(sel?.model).toBe('gemma4:31b');
    expect(sel?.measured).toBe(true);
    expect(sel?.estLatencyMs).toBe(900);
  });

  it('aggregate latency (any task type) is used when the task type has no data', async () => {
    const sb = emptyScoreboard();
    sb.recordOutcome({
      at: '2026-06-26T00:00:00.000Z',
      taskType: 'code', // different task type than the query
      model: 'gemma4:31b',
      provider: 'ollama',
      won: true,
      quality: 0.9,
      latencyMs: 800,
      costUsd: 0,
    });
    const sel = await selectFastestModel('Bonjour', {
      taskType: 'french',
      localOnly: true,
      candidates: [GEMMA_31B, QWEN_7B],
      scoreboard: sb,
    });
    expect(sel?.model).toBe('gemma4:31b'); // 800ms measured (cross-task) < qwen heuristic
    expect(sel?.measured).toBe(true);
  });

  it('builds scoped and global latency rankings only once per selection', async () => {
    const sb = emptyScoreboard();
    const rankingSpy = vi.spyOn(sb, 'ranking');

    await selectFastestModel('Bonjour', {
      taskType: 'french',
      candidates: [GEMMA_31B, QWEN_7B, GROK_FAST],
      scoreboard: sb,
    });

    expect(rankingSpy).toHaveBeenCalledTimes(2);
    expect(rankingSpy.mock.calls).toEqual([['french'], []]);
  });

  it('capability floor: never picks a vision-only or embedding model for chat', async () => {
    const sel = await selectFastestModel('Bonjour', {
      taskType: 'french',
      localOnly: true,
      // moondream (1B vision) + embed would "win" on size — must be filtered out.
      candidates: [MOONDREAM, EMBED, QWEN_7B],
      scoreboard: emptyScoreboard(),
    });
    expect(sel?.model).toBe('qwen2.5:7b-instruct');
  });

  it('requireToolCalling drops models without that strength', async () => {
    const noTools: LlmCandidate = { ...QWEN_7B, model: 'weirdmodel', strengths: ['french'] };
    const sel = await selectFastestModel('Bonjour', {
      taskType: 'french',
      requireToolCalling: true,
      candidates: [noTools, GROK_FAST],
      scoreboard: emptyScoreboard(),
    });
    expect(sel?.model).toBe('grok-3-fast');
  });

  it('freeOnly excludes paid cloud models', async () => {
    const sel = await selectFastestModel('Bonjour', {
      taskType: 'french',
      freeOnly: true,
      candidates: [GROK_FAST, QWEN_7B], // grok nominal $0.5 → excluded
      scoreboard: emptyScoreboard(),
    });
    expect(sel?.model).toBe('qwen2.5:7b-instruct');
  });

  it('returns null when no candidate qualifies', async () => {
    const sel = await selectFastestModel('Bonjour', {
      taskType: 'french',
      candidates: [MOONDREAM, EMBED], // both fail the chat floor
      scoreboard: emptyScoreboard(),
    });
    expect(sel).toBeNull();
  });

  it('drops candidates with no apiKey', async () => {
    const noKey: LlmCandidate = { ...QWEN_7B, apiKey: undefined };
    const sel = await selectFastestModel('Bonjour', {
      taskType: 'french',
      candidates: [noKey, GROK_FAST],
      scoreboard: emptyScoreboard(),
    });
    expect(sel?.model).toBe('grok-3-fast');
  });
});
