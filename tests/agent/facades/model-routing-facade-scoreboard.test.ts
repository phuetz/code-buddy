/**
 * Item 1 — opt-in council-learned tie-break in the MAIN model routing.
 *
 * These tests exercise `ModelRoutingFacade.autoRouteIfEnabled` against the REAL
 * `selectModel` (this file deliberately does NOT mock `optimization/model-routing`,
 * unlike `model-routing-facade.test.ts`) so the `{recommendedModel, alternativeModel}`
 * ambiguity the tie-break arbitrates on actually exists.
 *
 * Guarantees under test:
 *   1. Flag OFF  → strict no-op: identical result, scoreboard never consulted.
 *   2. Flag ON + a clear scoreboard winner for the task category → routing
 *      prefers it (breaks the tie toward the historically-stronger model).
 *   3. Flag ON + empty scoreboard → silent fallback to the current routing
 *      (no crash, unchanged result).
 *
 * A hermetic tmp-file ModelScoreboard is injected — no real ledger, no council run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  ModelRoutingFacade,
  type ModelRoutingFacadeDeps,
} from '../../../src/agent/facades/model-routing-facade.js';
import { ModelScoreboard, type OutcomeRecord } from '../../../src/fleet/model-scoreboard.js';
import { inferTaskType } from '../../../src/fleet/model-capability-heuristics.js';

// A short, no-reasoning message → `selectModel` classifies it "simple":
//   recommendedModel = 'grok-3-mini', alternativeModel = 'grok-3'.
const MESSAGE = 'show the list';
const MODELS = ['grok-3-mini', 'grok-3', 'grok-3-reasoning'];
const RECOMMENDED = 'grok-3-mini';
const ALTERNATIVE = 'grok-3';

function buildFacade(): ModelRoutingFacade {
  const modelRouter = {
    updateConfig: vi.fn(),
    getTotalCost: vi.fn(() => 0),
    getEstimatedSavings: vi.fn(() => ({ saved: 0, percentage: 0 })),
    getUsageStats: vi.fn(() => new Map()),
  } as unknown as ModelRoutingFacadeDeps['modelRouter'];
  const costTracker = {} as unknown as ModelRoutingFacadeDeps['costTracker'];
  const f = new ModelRoutingFacade({ modelRouter, costTracker });
  f.setAutoRouting(true);
  return f;
}

let tmpFile: string;

function rec(over: Partial<OutcomeRecord>): OutcomeRecord {
  return {
    at: '2026-07-04T00:00:00.000Z',
    taskType: 'general',
    model: ALTERNATIVE,
    provider: 'grok',
    won: false,
    quality: 0.5,
    latencyMs: 1000,
    costUsd: 0,
    ...over,
  };
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-routing-'));
  tmpFile = path.join(dir, 'perf.jsonl');
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('council-routing tie-break (CODEBUDDY_COUNCIL_ROUTING)', () => {
  it('baseline: real selectModel routes "simple" → recommended, with alternative surfaced', () => {
    const f = buildFacade();
    const model = f.autoRouteIfEnabled(MESSAGE, MODELS, { env: {} as NodeJS.ProcessEnv });
    expect(model).toBe(RECOMMENDED);
    expect(f.getLastRoutingDecision()?.alternativeModel).toBe(ALTERNATIVE);
  });

  it('flag OFF → strict no-op: identical result AND the scoreboard is never consulted', () => {
    const f = buildFacade();
    const sb = new ModelScoreboard(tmpFile);
    const selectionBias = vi.spyOn(sb, 'selectionBias');
    const runCount = vi.spyOn(sb, 'runCount');

    // No env flag → OFF.
    const model = f.autoRouteIfEnabled(MESSAGE, MODELS, { env: {} as NodeJS.ProcessEnv, scoreboard: sb });

    expect(model).toBe(RECOMMENDED); // exactly what it returned before Item 1
    expect(selectionBias).not.toHaveBeenCalled();
    expect(runCount).not.toHaveBeenCalled();
  });

  it('flag ON + a clear scoreboard winner for the category → routing prefers the alternative', () => {
    const f = buildFacade();
    const taskType = inferTaskType(MESSAGE);

    const sb = new ModelScoreboard(tmpFile);
    // The alternative ('grok-3') is the historically-stronger AI for this task
    // category; the recommendation ('grok-3-mini') has no history.
    for (let i = 0; i < 6; i++) sb.recordOutcome(rec({ taskType, model: ALTERNATIVE, won: true }));

    const model = f.autoRouteIfEnabled(MESSAGE, MODELS, {
      env: { CODEBUDDY_COUNCIL_ROUTING: 'true' } as unknown as NodeJS.ProcessEnv,
      scoreboard: sb,
    });

    expect(model).toBe(ALTERNATIVE); // tie broken toward the learned winner
    const decision = f.getLastRoutingDecision();
    expect(decision?.recommendedModel).toBe(ALTERNATIVE);
    expect(decision?.reason).toContain('council-routing');
  });

  it('flag ON + empty scoreboard → silent fallback to current routing (no crash)', () => {
    const f = buildFacade();
    const sb = new ModelScoreboard(tmpFile); // empty ledger

    const model = f.autoRouteIfEnabled(MESSAGE, MODELS, {
      env: { CODEBUDDY_COUNCIL_ROUTING: 'true' } as unknown as NodeJS.ProcessEnv,
      scoreboard: sb,
    });

    expect(model).toBe(RECOMMENDED); // unchanged — no evidence to override with
  });

  it('flag ON but the alternative is NOT the winner → recommendation is kept', () => {
    const f = buildFacade();
    const taskType = inferTaskType(MESSAGE);

    const sb = new ModelScoreboard(tmpFile);
    // Here the RECOMMENDED model is the strong one; the alternative loses.
    for (let i = 0; i < 6; i++) sb.recordOutcome(rec({ taskType, model: RECOMMENDED, won: true }));
    for (let i = 0; i < 6; i++) sb.recordOutcome(rec({ taskType, model: ALTERNATIVE, won: false }));

    const model = f.autoRouteIfEnabled(MESSAGE, MODELS, {
      env: { CODEBUDDY_COUNCIL_ROUTING: 'true' } as unknown as NodeJS.ProcessEnv,
      scoreboard: sb,
    });

    expect(model).toBe(RECOMMENDED);
  });
});
