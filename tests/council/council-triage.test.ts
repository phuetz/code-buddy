/**
 * Council triage gate — the cheap SINGLE-vs-COUNCIL stage in front of the
 * expensive multi-model fan-out (opt-in `CODEBUDDY_COUNCIL_TRIAGE`).
 *
 * Fully deterministic: a REAL ModelScoreboard on a tmp ledger, injected fake
 * chat clients, and an injected `selectTriageModel` — no network. The fan-out
 * is observed via a spy on `Promise.allSettled` (the pipeline uses it exactly
 * once, for the panel fan-out) plus the recorded answer prompts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { runCouncilPipeline } from '../../src/council/council-engine.js';
import { parseTriageDecision } from '../../src/council/triage.js';
import { ModelScoreboard } from '../../src/fleet/model-scoreboard.js';
import {
  type CouncilCandidate,
  type CouncilChatClient,
  type CouncilEngineDeps,
  type CouncilProgressEvent,
  type TriageModelSelection,
} from '../../src/council/types.js';

let tmpDir: string;
let ledger: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-triage-'));
  ledger = path.join(tmpDir, 'perf.jsonl');
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* ignore */
  }
});

// A code-flavoured task so the panel deterministically ranks coder-a + coder-b
// with gpt-5-arbiter as the neutral judge (matches council-engine.test.ts). The
// triage stage itself ignores the task content (its selector is injected).
const TASK = 'Refactor le module de parsing et corrige les bugs de la classe principale';

function candidate(provider: string, model: string): CouncilCandidate {
  return { provider, model, apiKey: 'k', costInputUsdPerMtok: 0 };
}

interface FakeBehaviors {
  /** Raw text returned to the triage CLASSIFY call (system = triage stage). */
  triage?: string | 'hang' | 'throw';
  answer?: string | (() => Promise<string>);
  judgeJson?: string;
  synthesis?: string;
}

function fakeClient(model: string, behaviors: FakeBehaviors): CouncilChatClient {
  return {
    async chat(messages) {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      if (system.includes('fast triage stage')) {
        if (behaviors.triage === 'hang') return new Promise<never>(() => {}); // never settles → timeout
        if (behaviors.triage === 'throw' || behaviors.triage === undefined) {
          throw new Error(`${model} triage call failed`);
        }
        return { content: behaviors.triage, promptTokens: 3, totalTokens: 6 };
      }
      if (system.includes('impartial judge')) {
        if (!behaviors.judgeJson) throw new Error(`${model} was not expected to judge`);
        return { content: behaviors.judgeJson, promptTokens: 5, totalTokens: 10 };
      }
      if (system.includes('synthesizer')) {
        if (!behaviors.synthesis) throw new Error('synthesis unavailable');
        return { content: behaviors.synthesis, promptTokens: 5, totalTokens: 10 };
      }
      const answer = behaviors.answer;
      if (!answer) throw new Error(`${model} has no answer configured`);
      const content = typeof answer === 'string' ? answer : await answer();
      return { content, promptTokens: 100, totalTokens: 200 };
    },
  };
}

/** Full council panel that works end-to-end when triage escalates. */
function councilClients(): Record<string, CouncilChatClient> {
  return {
    'coder-a': fakeClient('coder-a', { answer: 'answer A about the parser' }),
    'coder-b': fakeClient('coder-b', { answer: 'a very different take on incremental steps' }),
    'gpt-5-arbiter': fakeClient('gpt-5-arbiter', {
      judgeJson: '{"scores":{"A":0.9,"B":0.4},"winner":"A","why":"ok"}',
      synthesis: 'SYNTHESIZED',
    }),
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
    rng: () => 0.9999,
    timeoutMs: 500,
    exploreEpsilon: 0,
    now: () => new Date('2026-07-04T00:00:00.000Z'),
    ...overrides,
  };
}

const TRIAGE_MODEL: TriageModelSelection = {
  provider: 'triager-prov',
  model: 'fast-triager',
  isLocal: true,
  reason: 'latency-routed local',
};

describe('parseTriageDecision (falsifiable contract)', () => {
  it('accepts an explicit SINGLE verdict', () => {
    expect(parseTriageDecision('DECISION: SINGLE\nREASON: trivial').decision).toBe('single');
    expect(parseTriageDecision('DECISION: SINGLE\nREASON: trivial').reason).toBe('trivial');
    expect(parseTriageDecision('single').decision).toBe('single');
  });
  it('reads COUNCIL and defaults ambiguous / garbled output to COUNCIL (fail-safe)', () => {
    expect(parseTriageDecision('DECISION: COUNCIL\nREASON: hard').decision).toBe('council');
    expect(parseTriageDecision('hmm, maybe single or council?').decision).toBe('council');
    expect(parseTriageDecision('').decision).toBe('council');
    expect(parseTriageDecision('{not json at all}').decision).toBe('council');
  });
});

describe('runCouncilPipeline — triage gate', () => {
  // 1. Flag OFF → triage never runs, the current pipeline executes unchanged.
  it('OFF: never triages, runs the full fan-out (strict non-regression)', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const selectTriageModel = vi.fn(async () => TRIAGE_MODEL);
    const deps = makeDeps(candidates, councilClients(), { env: {}, selectTriageModel });
    const allSettled = vi.spyOn(Promise, 'allSettled');

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(selectTriageModel).not.toHaveBeenCalled();
    expect(allSettled).toHaveBeenCalled(); // fan-out ran
    expect(result.triaged).toBeUndefined();
    expect(result.answers.map((a) => a.displayName)).toEqual(['coder-a', 'coder-b']);
    expect(result.verdict.judgeModel).toBe('gpt-5-arbiter');
  });

  // 2. Flag ON + SINGLE → mono-model answer, fan-out NOT invoked, result marked.
  it('ON + SINGLE: answers with one model and never launches the fan-out', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      ...councilClients(),
      'fast-triager': fakeClient('fast-triager', {
        triage: 'DECISION: SINGLE\nREASON: factual arithmetic',
        answer: '2 + 2 = 4',
      }),
    };
    const selectTriageModel = vi.fn(async () => TRIAGE_MODEL);
    const deps = makeDeps(candidates, clients, {
      env: { CODEBUDDY_COUNCIL_TRIAGE: 'true' },
      selectTriageModel,
    });
    const allSettled = vi.spyOn(Promise, 'allSettled');
    const events: CouncilProgressEvent[] = [];

    const result = await runCouncilPipeline(TASK, { count: 3 }, deps, (e) => events.push(e));

    // The expensive fan-out was NEVER launched.
    expect(allSettled).not.toHaveBeenCalled();
    expect(selectTriageModel).toHaveBeenCalledTimes(1);

    // A well-formed, triage-marked CouncilResult.
    expect(result.triaged).toBe(true);
    expect(result.singleModel).toBe('fast-triager');
    expect(result.triageReason).toBe('factual arithmetic');
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]!.displayName).toBe('fast-triager');
    expect(result.finalText).toBe('2 + 2 = 4');
    expect(result.verdict.winnerIdx).toBe(0);
    expect(result.learned).toBe(false);
    expect(result.plan.mode).toBe('direct');

    // Progress event for UX visibility.
    const triageEvent = events.find((e): e is Extract<CouncilProgressEvent, { type: 'triage' }> => e.type === 'triage');
    expect(triageEvent).toEqual({ type: 'triage', decision: 'single', model: 'fast-triager', reason: 'factual arithmetic' });

    // No panel/conductor events — the council was never convened.
    expect(events.some((e) => e.type === 'panel')).toBe(false);

    // Nothing was written to the scoreboard by a triaged run.
    expect(new ModelScoreboard(ledger).ranking()).toHaveLength(0);
  });

  // 3. Flag ON + COUNCIL → full fan-out.
  it('ON + COUNCIL: escalates to the full deliberation', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      ...councilClients(),
      'fast-triager': fakeClient('fast-triager', {
        triage: 'DECISION: COUNCIL\nREASON: architecture trade-off',
        answer: 'should not be used',
      }),
    };
    const deps = makeDeps(candidates, clients, {
      env: { CODEBUDDY_COUNCIL_TRIAGE: 'true' },
      selectTriageModel: vi.fn(async () => TRIAGE_MODEL),
    });
    const allSettled = vi.spyOn(Promise, 'allSettled');
    const events: CouncilProgressEvent[] = [];

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps, (e) => events.push(e));

    expect(allSettled).toHaveBeenCalled(); // full fan-out ran
    expect(result.triaged).toBeUndefined();
    expect(result.answers.map((a) => a.displayName)).toEqual(['coder-a', 'coder-b']);
    expect(result.verdict.judgeModel).toBe('gpt-5-arbiter');
    expect(events.some((e) => e.type === 'triage' && e.decision === 'council')).toBe(true);
    expect(events.some((e) => e.type === 'panel')).toBe(true);
  });

  // 4. Flag ON but triage fails → FULL COUNCIL (the critical fail-safe).
  it('ON + unparsable verdict: falls back to the full council', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      ...councilClients(),
      'fast-triager': fakeClient('fast-triager', { triage: 'no idea, this is gibberish' }),
    };
    const deps = makeDeps(candidates, clients, {
      env: { CODEBUDDY_COUNCIL_TRIAGE: 'true' },
      selectTriageModel: vi.fn(async () => TRIAGE_MODEL),
    });
    const allSettled = vi.spyOn(Promise, 'allSettled');

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(allSettled).toHaveBeenCalled();
    expect(result.triaged).toBeUndefined();
    expect(result.answers.map((a) => a.displayName)).toEqual(['coder-a', 'coder-b']);
  });

  it('ON + triage call throws: falls back to the full council', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      ...councilClients(),
      'fast-triager': fakeClient('fast-triager', { triage: 'throw' }),
    };
    const deps = makeDeps(candidates, clients, {
      env: { CODEBUDDY_COUNCIL_TRIAGE: 'true' },
      selectTriageModel: vi.fn(async () => TRIAGE_MODEL),
    });
    const allSettled = vi.spyOn(Promise, 'allSettled');

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(allSettled).toHaveBeenCalled();
    expect(result.triaged).toBeUndefined();
    expect(result.answers).toHaveLength(2);
  });

  it('ON + triage times out: falls back to the full council', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      ...councilClients(),
      'fast-triager': fakeClient('fast-triager', { triage: 'hang' }),
    };
    const deps = makeDeps(candidates, clients, {
      env: { CODEBUDDY_COUNCIL_TRIAGE: 'true' },
      selectTriageModel: vi.fn(async () => TRIAGE_MODEL),
      timeoutMs: 40, // short so the timeout fires fast
    });
    const allSettled = vi.spyOn(Promise, 'allSettled');

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(allSettled).toHaveBeenCalled();
    expect(result.triaged).toBeUndefined();
    expect(result.answers).toHaveLength(2);
  });

  it('ON but no cheap model available: falls back to the full council', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const deps = makeDeps(candidates, councilClients(), {
      env: { CODEBUDDY_COUNCIL_TRIAGE: 'true' },
      selectTriageModel: vi.fn(async () => null), // selector found nothing
    });
    const allSettled = vi.spyOn(Promise, 'allSettled');

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(allSettled).toHaveBeenCalled();
    expect(result.triaged).toBeUndefined();
    expect(result.answers).toHaveLength(2);
  });

  it('ON + SINGLE verdict but empty answer: falls back to the full council', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const clients = {
      ...councilClients(),
      'fast-triager': fakeClient('fast-triager', {
        triage: 'DECISION: SINGLE\nREASON: trivial',
        answer: '   ', // whitespace-only → treated as no answer
      }),
    };
    const deps = makeDeps(candidates, clients, {
      env: { CODEBUDDY_COUNCIL_TRIAGE: 'true' },
      selectTriageModel: vi.fn(async () => TRIAGE_MODEL),
    });
    const allSettled = vi.spyOn(Promise, 'allSettled');

    const result = await runCouncilPipeline(TASK, { count: 2 }, deps);

    expect(allSettled).toHaveBeenCalled();
    expect(result.triaged).toBeUndefined();
    expect(result.answers).toHaveLength(2);
  });

  it('ON but --models pin set: honours explicit intent, skips triage', async () => {
    const candidates = [candidate('prov-a', 'coder-a'), candidate('prov-b', 'coder-b'), candidate('prov-j', 'gpt-5-arbiter')];
    const selectTriageModel = vi.fn(async () => TRIAGE_MODEL);
    const deps = makeDeps(candidates, councilClients(), {
      env: { CODEBUDDY_COUNCIL_TRIAGE: 'true' },
      selectTriageModel,
    });

    const result = await runCouncilPipeline(TASK, { count: 2, models: 'coder' }, deps);

    expect(selectTriageModel).not.toHaveBeenCalled();
    expect(result.triaged).toBeUndefined();
  });
});
