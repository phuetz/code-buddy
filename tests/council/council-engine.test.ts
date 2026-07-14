/**
 * Council engine — the host-agnostic pipeline as data-in/data-out.
 *
 * Uses a REAL ModelScoreboard on a tmp ledger (no module mocks) and injected
 * fake chat clients, in the same style as the fleet peer tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { runCouncilPipeline } from '../../src/council/council-engine.js';
import { buildCouncilConductorPlan } from '../../src/council/conductor.js';
import { ModelScoreboard } from '../../src/fleet/model-scoreboard.js';
import {
  CouncilError,
  type CouncilCandidate,
  type CouncilChatClient,
  type CouncilEngineDeps,
  type CouncilProgressEvent,
} from '../../src/council/types.js';

let tmpDir: string;
let ledger: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-engine-'));
  ledger = path.join(tmpDir, 'perf.jsonl');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const TASK = 'Refactor le module de parsing et corrige les bugs de la classe principale';

function candidate(provider: string, model: string): CouncilCandidate {
  return { provider, model, apiKey: 'k', costInputUsdPerMtok: 0 };
}

/**
 * A per-model fake client. The judge/synthesis calls are dispatched on the
 * system prompt so the same "model" can both answer and judge.
 */
function fakeClient(
  model: string,
  behaviors: {
    answer?: string | (() => Promise<string>);
    judgeJson?: string;
    synthesis?: string | 'fail';
  },
): CouncilChatClient {
  return {
    async chat(messages) {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      if (system.includes('impartial judge')) {
        if (!behaviors.judgeJson) throw new Error(`${model} was not expected to judge`);
        return { content: behaviors.judgeJson, promptTokens: 5, totalTokens: 10 };
      }
      if (system.includes('synthesizer')) {
        if (behaviors.synthesis === 'fail' || !behaviors.synthesis) throw new Error('synthesis unavailable');
        return { content: behaviors.synthesis, promptTokens: 5, totalTokens: 10 };
      }
      const answer = behaviors.answer;
      if (!answer) throw new Error(`${model} has no answer configured`);
      const content = typeof answer === 'string' ? answer : await answer();
      return { content, promptTokens: 100, totalTokens: 200 };
    },
  };
}

function makeDeps(
  candidates: CouncilCandidate[],
  clients: Record<string, CouncilChatClient>,
  overrides: Partial<CouncilEngineDeps> = {},
): CouncilEngineDeps {
  return {
    loadRegistry: async () => candidates,
    scoreboard: new ModelScoreboard(ledger),
    clientFactory: (c) => {
      const client = clients[c.model];
      if (!client) throw new Error(`no fake client for ${c.model}`);
      return client;
    },
    peers: [],
    rng: () => 0.9999, // identity judge shuffle, and never below default ε
    timeoutMs: 500,
    exploreEpsilon: 0,
    now: () => new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('runCouncilPipeline', () => {
  it('runs a collective council: neutral judge, synthesis, and learning with stable provenance', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      'coder-a': fakeClient('coder-a', { answer: 'extract the parser into a strategy class' }),
      'coder-b': fakeClient('coder-b', { answer: 'totally different wording about incremental refactoring steps' }),
      'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {
        judgeJson: '{"scores":{"A":0.9,"B":0.3},"winner":"A","why":"plus concret"}',
        synthesis: 'SYNTHESIZED COUNCIL ANSWER',
      }),
    };
    const deps = makeDeps(candidates, clients);
    const events: CouncilProgressEvent[] = [];

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps, (e) => events.push(e));

    expect(result.taskType).toBe('code');
    expect(result.plan.mode).toBe('collective');
    expect(result.answers.map((a) => a.displayName)).toEqual(['coder-a', 'coder-b']);
    expect(result.answers[0]!.role?.id).toBe('architect');

    // Neutral judge, parsed verdict.
    expect(result.verdict.kind).toBe('judged');
    expect(result.verdict.neutral).toBe(true);
    expect(result.verdict.judgeModel).toBe('gpt-5-arbiter');
    expect(result.verdict.winnerIdx).toBe(0);

    // Fix #4: collective runs ignore lexical divergence — role-specialised
    // answers use different words, yet confidence stays high on a clear margin.
    expect(result.consensus.score).toBeLessThan(0.25);
    expect(result.signals.confidence).toBe('high');

    expect(result.synthesis).toBe('SYNTHESIZED COUNCIL ANSWER');
    expect(result.finalText).toBe('SYNTHESIZED COUNCIL ANSWER');

    // Learning recorded with source-accurate provider + stable role ids.
    expect(result.learned).toBe(true);
    const sb = new ModelScoreboard(ledger);
    expect(sb.runCount('code', 'coder-a')).toBe(1);
    expect(sb.winRate('code', 'coder-a')).toBe(1);
    expect(sb.winRate('code', 'coder-b')).toBe(0);
    const stats = sb.ranking('code');
    expect(stats.find((s) => s.model === 'coder-a')!.provider).toBe('prov-a');
    expect(sb.roleScore('code', 'architect', 'coder-a')).toBeGreaterThan(0);

    expect(events.some((e) => e.type === 'panel')).toBe(true);
    expect(events.some((e) => e.type === 'conductor')).toBe(true);

    // Deliberation health computed and handed to the sink.
    expect(result.health.judgeAlive).toBe(1);
    expect(result.health.seatSurvival).toBe(1);
    expect(result.health.stanceDivergence).toBeGreaterThan(0.5); // different wordings
    expect(result.health.dhi).toBeGreaterThan(0);
  });

  it('hands the health record to the injected sink', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      'coder-a': fakeClient('coder-a', { answer: 'answer A' }),
      'coder-b': fakeClient('coder-b', { answer: 'answer B' }),
      'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {
        judgeJson: '{"scores":{"A":0.9,"B":0.4},"winner":"A","why":"ok"}',
        synthesis: 'MERGED',
      }),
    };
    const sink: unknown[] = [];
    const deps = makeDeps(candidates, clients, { healthSink: (h) => sink.push(h) });

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);
    expect(sink).toHaveLength(1);
    expect(sink[0]).toEqual(result.health);
  });

  it('penalises a judge whose CALL fails — the dead judge stops being re-seated', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      'coder-a': fakeClient('coder-a', { answer: 'answer A' }),
      'coder-b': fakeClient('coder-b', { answer: 'answer B' }),
      // No judgeJson configured → the judge call throws (transport-like failure).
      'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {}),
    };
    const deps = makeDeps(candidates, clients);

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(result.verdict.kind).toBe('abstained');
    expect(result.verdict.judgeCallFailed).toBe(true);
    expect(result.health.judgeAlive).toBe(0);
    expect(result.health.dhi).toBe(0);
    const sb = new ModelScoreboard(ledger);
    expect(sb.consecutiveRecentFailures('gpt-5-arbiter')).toBe(1);
    expect(sb.ranking('code')).toHaveLength(0); // failure invisible in quality stats
  });

  it('replaces a dead judge within the same run — the deliberation is not wasted', async () => {
    const candidates = [
      candidate('prov-a', 'coder-a'),
      candidate('prov-b', 'coder-b'),
      candidate('prov-j', 'gpt-5-arbiter'), // dies on the judge call
      candidate('prov-k', 'gpt-5-backup'), // healthy second neutral judge
    ];
    const clients = {
      'coder-a': fakeClient('coder-a', { answer: 'answer A' }),
      'coder-b': fakeClient('coder-b', { answer: 'answer B' }),
      'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {}), // judge call throws
      'gpt-5-backup': fakeClient('gpt-5-backup', {
        judgeJson: '{"scores":{"A":0.9,"B":0.4},"winner":"A","why":"ok"}',
        synthesis: 'MERGED BY BACKUP',
      }),
    };
    const deps = makeDeps(candidates, clients);

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(result.verdict.kind).toBe('judged');
    expect(result.verdict.judgeModel).toBe('gpt-5-backup');
    expect(result.synthesis).toBe('MERGED BY BACKUP');
    expect(result.health.judgeAlive).toBe(1);
    // The dead judge was still penalised on its way out.
    expect(new ModelScoreboard(ledger).consecutiveRecentFailures('gpt-5-arbiter')).toBeGreaterThanOrEqual(1);
  });

  it('records role quality so specialised roles are not punished for holding their role', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      'coder-a': fakeClient('coder-a', { answer: 'direct proposal' }),
      'coder-b': fakeClient('coder-b', { answer: 'conditional critique with breaking conditions' }),
      'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {
        // The critic (B) loses the task vote but holds its role perfectly.
        judgeJson:
          '{"scores":{"A":{"task":0.9,"role":0.8},"B":{"task":0.3,"role":0.95}},"winner":"A","verified":"","why":"A answers the task"}',
        synthesis: 'MERGED',
      }),
    };
    const deps = makeDeps(candidates, clients);

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(result.learned).toBe(true);
    expect(result.verdict.roleScores).toEqual([0.8, 0.95]);
    const sb = new ModelScoreboard(ledger);
    // roleScore is role-quality-dominant: the losing critic still ranks high
    // for the implementer seat it held (role id from the conductor plan).
    const criticRole = result.answers[1]!.role!.id;
    expect(sb.roleScore('code', criticRole, 'coder-b')).toBeCloseTo(0.7 * 0.95 + 0.3 * 0, 5);
  });

  it('uses a panel member as display-only judge when no neutral judge exists — and never learns from it', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b')];
    const clients = {
      'coder-a': fakeClient('coder-a', {
        answer: 'answer A',
        judgeJson: '{"scores":{"A":0.9,"B":0.2},"winner":"A","why":"self-serving"}',
        synthesis: 'MERGED',
      }),
      'coder-b': fakeClient('coder-b', { answer: 'answer B' }),
    };
    const deps = makeDeps(candidates, clients);

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(result.verdict.kind).toBe('judged');
    expect(result.verdict.neutral).toBe(false);
    expect(result.verdict.judgeModel).toBe('coder-a');
    expect(result.learned).toBe(false);
    expect(result.learnSkipReason).toContain('juge non neutre');
    expect(new ModelScoreboard(ledger).runCount('code', 'coder-a')).toBe(0);
  });

  it('falls back to a labelled concatenation when the judge abstains and synthesis fails', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      'coder-a': fakeClient('coder-a', { answer: 'answer A' }),
      'coder-b': fakeClient('coder-b', { answer: 'answer B' }),
      'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {
        judgeJson: 'definitely not json',
        synthesis: 'fail',
      }),
    };
    const deps = makeDeps(candidates, clients);

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(result.verdict.kind).toBe('abstained');
    expect(result.verdict.winnerIdx).toBeNull();
    expect(result.signals.confidence).toBe('low');
    expect(result.signals.reasons).toContain('judge abstained');
    expect(result.synthesis).toBeNull();
    expect(result.finalText).toContain('--- coder-a');
    expect(result.finalText).toContain('--- coder-b');
    expect(result.learned).toBe(false);
    expect(result.learnSkipReason).toContain('juge abstenu');
  });

  it('grants the ε-exploration seat to the least-observed candidate', async () => {
    const candidates = [
      candidate('prov-a', 'coder-a'),
      candidate('prov-b', 'coder-b'),
      candidate('prov-c', 'coder-c'),
      candidate('prov-j', 'gpt-5-arbiter'),
    ];
    const clients = {
      'coder-a': fakeClient('coder-a', { answer: 'answer A' }),
      'coder-b': fakeClient('coder-b', { answer: 'answer B' }),
      'coder-c': fakeClient('coder-c', { answer: 'answer C' }),
      'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {
        judgeJson: '{"scores":{"A":0.9,"B":0.4},"winner":"A","why":"ok"}',
        synthesis: 'MERGED',
      }),
    };
    const deps = makeDeps(candidates, clients, { exploreEpsilon: 1 });
    const events: CouncilProgressEvent[] = [];

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps, (e) => events.push(e));

    const panel = events.find((e): e is Extract<CouncilProgressEvent, { type: 'panel' }> => e.type === 'panel')!;
    expect(panel.explored).toBeDefined();
    expect(result.answers.map((a) => a.displayName)).toContain(panel.explored!);
  });

  it('drops failing models and throws a typed error when the whole panel fails', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b')];
    const clients = {
      'coder-a': fakeClient('coder-a', { answer: async () => Promise.reject(new Error('boom-a')) }),
      'coder-b': fakeClient('coder-b', { answer: async () => Promise.reject(new Error('boom-b')) }),
    };
    const deps = makeDeps(candidates, clients);
    const events: CouncilProgressEvent[] = [];

    await expect(runCouncilPipeline(TASK, { count: 2 }, deps, (e) => events.push(e))).rejects.toMatchObject({
      name: 'CouncilError',
      code: 'all-failed',
    });
    expect(events.filter((e) => e.type === 'answer_failed')).toHaveLength(2);

    // C1: failures are recorded unconditionally so a dead model stops being
    // re-seated — penalized in selection, invisible in quality stats.
    const sb = new ModelScoreboard(ledger);
    expect(sb.runCount('code', 'coder-a')).toBe(1);
    expect(sb.selectionBias('code', 'coder-a')).toBeLessThan(0);
    expect(sb.ranking('code')).toHaveLength(0);
  });

  it('throws a typed error when no LLM is active', async () => {
    const deps = makeDeps([], {});
    await expect(runCouncilPipeline(TASK, {}, deps)).rejects.toBeInstanceOf(CouncilError);
    await expect(runCouncilPipeline(TASK, {}, deps)).rejects.toMatchObject({ code: 'no-candidates' });
  });

  it('folds fleet peers into the judged set with their conductor roles', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      'coder-a': fakeClient('coder-a', { answer: 'local answer' }),
      'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {
        judgeJson: '{"scores":{"A":0.8,"B":0.6},"winner":"A","why":"ok"}',
        synthesis: 'MERGED',
      }),
    };
    const peerPrompts: string[] = [];
    const deps = makeDeps(candidates, clients, {
      peers: [
        {
          id: 'peerX',
          listener: {
            request: async (_method, params) => {
              peerPrompts.push(String(params?.prompt ?? ''));
              return { text: 'remote answer', modelRequested: 'qwen', usage: { total_tokens: 7 } };
            },
          },
        },
      ],
    });

    const result = await runCouncilPipeline(TASK, { count: 1, fleet: true }, deps);

    expect(result.answers.map((a) => a.displayName)).toEqual(['coder-a', 'peerX:qwen']);
    expect(result.answers[1]!.source).toEqual({ kind: 'peer', peerId: 'peerX', model: 'peerX:qwen' });
    expect(result.answers[1]!.role).toBeDefined();
    expect(peerPrompts[0]).toContain('Code Buddy Council');
  });

  it('starts Fleet peers in the same wave while a local model is still running', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-j', 'gpt-5-arbiter')];
    let releaseLocal!: () => void;
    const localGate = new Promise<void>((resolve) => (releaseLocal = resolve));
    let peerStarted = false;
    const deps = makeDeps(
      candidates,
      {
        'coder-a': fakeClient('coder-a', {
          answer: async () => {
            await localGate;
            return 'local answer';
          },
        }),
        'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {
          judgeJson: '{"scores":{"A":0.8,"B":0.6},"winner":"A","why":"ok"}',
          synthesis: 'merged answer',
        }),
      },
      {
        peers: [
          {
            id: 'peer-parallel',
            listener: {
              request: async () => {
                peerStarted = true;
                return { text: 'peer answer', modelRequested: 'qwen' };
              },
            },
          },
        ],
      },
    );

    const run = runCouncilPipeline(TASK, { count: 1, fleet: true }, deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peerStarted).toBe(true);
    releaseLocal();
    const result = await run;
    expect(result.answers).toHaveLength(2);
  });

  it('aborts the local transport when a panel seat exceeds its deadline', async () => {
    const candidates = [candidate('prov-a', 'coder-a')];
    let aborted = false;
    const client: CouncilChatClient = {
      chat: async (_messages, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    };
    const deps = makeDeps(candidates, { 'coder-a': client }, { timeoutMs: 15 });
    await expect(runCouncilPipeline(TASK, { count: 1 }, deps)).rejects.toMatchObject({
      code: 'all-failed',
    });
    expect(aborted).toBe(true);
  });
});

describe('conductor role stability', () => {
  it('keeps stable role ids on extra seats (only the label is disambiguated)', () => {
    const plan = buildCouncilConductorPlan(TASK, 'code', 6);

    expect(plan.mode).toBe('collective');
    expect(plan.roles[4]!.id).toBe('architect');
    expect(plan.roles[4]!.label).toBe('Architect 5');
    expect(plan.roles[5]!.id).toBe('implementer');
  });
});
