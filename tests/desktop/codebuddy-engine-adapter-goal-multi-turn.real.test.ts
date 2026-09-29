/**
 * REAL (no-mock) multi-turn proof for the Cowork desktop engine adapter's goal
 * loop. Previously this path was only proven "by composition" (headless loop +
 * runner-mapping + reducer e2e); here we drive the adapter directly.
 *
 * No mocked judge, no faked verdicts: a real `CodeBuddyEngineAdapter` runs a
 * real local-Ollama actor AND a real Ollama judge against a goal that cannot be
 * satisfied inside a 2-turn budget. We capture the `goal_status` engine events
 * off the real `onEvent` callback and assert `turnsUsed` climbs across turns and
 * the loop ends paused on budget exhaustion — exactly what the GoalBanner shows.
 *
 * The goal is intentionally tools-free (each actor turn is one fast generation)
 * and its completion marker is a word the actor is told never to emit, so the
 * real judge reliably returns "continue" each turn and the budget is what stops
 * the loop. Skips automatically when Ollama / the model isn't reachable.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const MODEL = process.env.CODEBUDDY_INLOOP_TEST_MODEL || 'qwen3.5-ctx32k:latest';

let ollamaReady = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return;
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    ollamaReady = Boolean(data.models?.some((m) => m.name === MODEL));
  } catch {
    ollamaReady = false;
  }
});

describe('desktop engine adapter goal loop (real Ollama, no mocks)', () => {
  beforeAll(() => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = OLLAMA_HOST;
    process.env.GROK_MODEL = MODEL;
    process.env.CODEBUDDY_GOAL_JUDGE_MODEL = MODEL;
    process.env.CODEBUDDY_HEADLESS = 'true';
    process.env.CODEBUDDY_DISABLE_MCP = 'true';
  });

  it(
    'emits goal_status with climbing turnsUsed across ≥2 turns then pauses on budget',
    async (ctx) => {
      if (!ollamaReady) {
        ctx.skip();
        return;
      }

      const { resolveCommandProvider } = await import('../../src/commands/llm-provider-resolution.js');
      const resolved = resolveCommandProvider({ explicitModel: MODEL });
      if (!resolved) {
        throw new Error('Ollama provider did not resolve — check CODEBUDDY_PROVIDER/OLLAMA_HOST');
      }

      const { getGoalManager, resetGoalManagers } = await import('../../src/goals/goal-manager.js');
      const { CodeBuddyEngineAdapter } = await import('../../src/desktop/codebuddy-engine-adapter.js');

      resetGoalManagers();
      const sessionId = `adapter-goal-${Date.now()}`;
      const goalText =
        '/no_think Reply with exactly the single word CONTINUE and nothing else. This is a long ' +
        'multi-step process and you are NOT done. The goal is complete ONLY when you reply with ' +
        'the word FINISHED, which you must never output.';

      // 2-turn budget; completion marker (FINISHED) is never emitted → the real
      // judge keeps returning "continue" → the budget stops the loop.
      getGoalManager(`cowork:${sessionId}`).set(goalText, { maxTurns: 2 });

      const adapter = new CodeBuddyEngineAdapter({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
        model: resolved.model,
        maxToolRounds: 2,
      });

      const snapshots: Array<{ turnsUsed: number; maxTurns: number; status: string }> = [];
      const onEvent = (event: {
        type: string;
        goalStatus?: { turnsUsed: number; maxTurns: number; status: string };
      }) => {
        if (event.type === 'goal_status' && event.goalStatus) {
          snapshots.push({
            turnsUsed: event.goalStatus.turnsUsed,
            maxTurns: event.goalStatus.maxTurns,
            status: event.goalStatus.status,
          });
        }
      };

      try {
        await adapter.runSession(sessionId, [{ role: 'user', content: goalText }], onEvent as never);
      } finally {
        adapter.clearSession?.(sessionId);
        adapter.dispose?.();
      }

      // One snapshot up-front (turnsUsed 0) + one per judged turn, climbing to the budget.
      expect(snapshots.length).toBeGreaterThanOrEqual(3);
      const turns = snapshots.map((s) => s.turnsUsed);
      expect(turns[0]).toBe(0);
      expect(turns).toEqual([0, 1, 2]);
      expect(snapshots[snapshots.length - 1].status).toBe('paused');
      expect(snapshots.every((s) => s.maxTurns === 2)).toBe(true);
    },
    // Slow real integration: two real local-model turns + two real judge calls.
    // Generous ceiling so local-model latency variance can't flake it.
    480_000,
  );
});
